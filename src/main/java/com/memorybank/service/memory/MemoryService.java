package com.memorybank.service.memory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.memorybank.domain.*;
import com.memorybank.dto.memory.ExtractionMemoryResult;
import com.memorybank.dto.memory.FullSaveRequest;
import com.memorybank.dto.memory.SyncMemoryDto;
import com.memorybank.dto.memory.SyncResponse;
import com.memorybank.repository.MemberRepository;
import com.memorybank.repository.MemoryRepository;
import com.memorybank.repository.MemorySyncJobRepository;
import com.memorybank.service.WorkspaceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

@Slf4j
@Service
// 🌟 클래스 레벨의 @Transactional 제거 유지! (DB 파이프 낭비 원천 차단)
@RequiredArgsConstructor
public class MemoryService {

    // 🌟 [핵심 픽스 1] 자기 자신을 Lazy하게 주입받아 내부 호출 시에도 프록시(문지기)를 거치게 만듭니다.
    @Autowired
    @Lazy
    private MemoryService self;

    private final MemoryRepository memoryRepository;
    private final WorkspaceService workspaceService;
    private final MemberRepository memberRepository;
    private final MemorySyncJobRepository memorySyncJobRepository;
    private final EmbeddingModel embeddingModel;

    @Scheduled(cron = "0 0 * * * *")
    @Transactional
    public void cleanupZombieJobs() {
        LocalDateTime oneHourAgo = LocalDateTime.now().minusHours(1);
        List<MemorySyncJob> zombieJobs = memorySyncJobRepository.findZombieJobs(SyncStatus.PENDING, oneHourAgo);

        for (MemorySyncJob job : zombieJobs) {
            job.markAsFailed();
            memorySyncJobRepository.save(job);

            Member member = job.getWorkspace().getMember();
            member.addRewardCredits(job.getEstimatedCredits());
            memberRepository.save(member);

            log.warn("🧹 좀비 작업 정리 완료. Job ID: {}, 크레딧 환불 완료", job.getId());
        }
    }

    @Qualifier("aiTaskExecutor")
    private final Executor aiExecutor;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${spring.ai.openai.api-key}")
    private String apiKey;

    @Value("${spring.ai.openai.base-url:https://api.openai.com}")
    private String baseUrl;

    private static final int MAX_SINGLE_SAVE_CHARS = 10000;

    private final ConcurrentHashMap<Long, Semaphore> userSemaphores = new ConcurrentHashMap<>();

    private Semaphore getUserSemaphore(Long memberId) {
        return userSemaphores.computeIfAbsent(memberId, k -> new Semaphore(3));
    }


    // =====================================================================
    // 1. 단일 저장
    // =====================================================================
    public List<Long> saveMemory(Long memberId, Long workspaceId, String content, String type) {
        if (content != null && content.length() > MAX_SINGLE_SAVE_CHARS) {
            throw new IllegalArgumentException("단일 저장 허용 범위를 초과했습니다. 전체 스캔 기능을 이용해주세요.");
        }

        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);
        if (!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("권한 없음");

        // 🌟 [핵심 픽스 2] self를 통해 호출하여 새로운 트랜잭션을 강제로 엽니다!
        self.deductCredit(memberId, 1); // CreditPolicy 상수가 없어서 임시로 1 할당 (원래코드 맞춤)

        List<Long> saveIds = new ArrayList<>();

        if (content.length() <= 300 && !content.contains("```")) {
            float[] vector = embeddingModel.embed(content);
            // 🌟 self를 통해 호출
            saveIds.add(self.saveRawMemoryToDb(workspace, content, vector));
            return saveIds;
        }

        List<String> chunks = splitContent(content, 50000);
        for (String chunk : chunks) {
            saveIds.addAll(executeAiExtractionAndSave(workspace, chunk, type));
        }
        return saveIds;
    }


    // =====================================================================
    // 2. 전체 저장
    // =====================================================================
    @Transactional
    public Long initiateFullSave(Long memberId, FullSaveRequest request){
        Workspace workspace = workspaceService.findByIdWithMember(request.workspaceId());
        if(!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("권한 없음");

        MemorySyncJob pendingJob = MemorySyncJob.createPendingJob(workspace, request.rawContent(), request.estimatedCredits());
        memorySyncJobRepository.save(pendingJob);
        return pendingJob.getId();
    }

    @Async
    public void processFullSave(Long jobId) {
        MemorySyncJob job = memorySyncJobRepository.findByIdWithMember(jobId).orElseThrow();
        if(job.getStatus() != SyncStatus.PENDING) return;

        Workspace workspace = job.getWorkspace();
        Long memberId = workspace.getMember().getId();

        try {
            // 🌟 self 호출로 변경
            self.deductCredit(memberId, 0);

            List<String> chunks = splitContent(job.getRawContent(), 50000);

            // 🌟 self 호출로 변경
            self.updateJobProgressInDb(jobId, 0, chunks.size());

            Semaphore semaphore = getUserSemaphore(memberId);
            List<CompletableFuture<Void>> futures = new ArrayList<>();
            AtomicInteger processedCount = new AtomicInteger(0);

            for (String chunkText : chunks) {
                CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
                    try {
                        semaphore.acquire();
                        executeAiExtractionAndSave(workspace, chunkText, "FULL_CONV");

                        int currentProcessed = processedCount.incrementAndGet();
                        // 🌟 self 호출로 변경
                        self.updateJobProgressInDb(jobId, currentProcessed, chunks.size());
                    } catch (Exception e) {
                        log.error("청크 처리 중 오류", e);
                    } finally {
                        semaphore.release();
                    }
                }, aiExecutor);
                futures.add(future);
            }

            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

            // 🌟 self 호출로 변경
            self.markJobStatusInDb(jobId, SyncStatus.COMPLETED);
            log.info("🟢 Job ID {}: 전체 저장 성공!", jobId);

        } catch (Exception e){
            // 🌟 self 호출로 변경
            self.markJobStatusInDb(jobId, SyncStatus.FAILED);
            log.error("🔴 Job ID {}: 전체 저장 실패!", jobId, e);
        }
    }


    // =====================================================================
    // 3. 검색 및 조회
    // =====================================================================
    public List<String> searchSimilarMemories(Long memberId, Long workspaceId, String question, int topK, float threshold) {
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);
        if (!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("권한 없음");

        // 🌟 self 호출로 변경
        self.deductCredit(memberId, 1);

        float[] questionVector = embeddingModel.embed(question);

        // 🌟 self 호출로 변경
        return self.executeSearchInDb(workspaceId, questionVector, topK, threshold);
    }

    @Transactional(readOnly = true)
    public SyncResponse getMemoriesForSync(Long memberId, Long workspaceId, Long lastId, int limit) {
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);
        if (!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("권한 없음");

        // 🌟 self 호출로 변경
        self.deductCredit(memberId, 1);

        List<Memory> memories = memoryRepository.findMemoriesForSync(workspaceId, lastId, limit);
        long remainingCount = memoryRepository.countRemainingMemories(workspaceId, lastId);

        List<SyncMemoryDto> dtoList = memories.stream().map(m -> new SyncMemoryDto(m.getId(), m.getContent())).toList();
        return new SyncResponse(dtoList, remainingCount > memories.size(), remainingCount);
    }

    // =====================================================================
    // 내부 헬퍼 메서드
    // =====================================================================

    private List<Long> executeAiExtractionAndSave(Workspace workspace, String content, String type) {
        List<Long> saveIds = new ArrayList<>();
        String systemInstruction;
        String targetModel;

        if ("SNIPPET".equals(type)) {
            targetModel = "gpt-5-nano";

            systemInstruction = """
                            너는 사용자가 웹서핑이나 대화 중 중요하다고 생각하여 직접 드래그해서 스크랩한 텍스트를 정리하는 AI 데이터 아키텍트야.
                            이 텍스트는 이미 사용자가 필터링한 중요 정보이므로, 원본의 디테일(특히 코드, 명령어, 고유명사, 문제 원인과 해결책)을 절대 훼손하지 마.
                            
                            [분류 기준] (무조건 다음 5가지 중 가장 적합한 하나를 선택하여 요약본 맨 앞에 태그로 기재해)
                            1. [스크랩-트러블슈팅]: 에러 및 버그 해결 방법, 문제 발생 원인과 대처법.
                            2. [스크랩-코드/기술]: 프로그래밍 코드 스니펫, 터미널 명령어, IT 아키텍처 및 기술 개념.
                            3. [스크랩-지식/정보]: 웹서핑 중 발견한 객관적인 팩트, 뉴스 기사, 유용한 팁, 방법론.
                            4. [스크랩-아이디어/영감]: 벤치마킹할 레퍼런스, 기획 아이디어, 인상 깊은 문구.
                            5. [스크랩-기타]: 위 카테고리에 속하지 않는 단순 메모, 개인적인 기록.
                            
                            [지시사항]
                            1. 텍스트가 너무 길면 핵심 주제별로 1~3개의 조각(summary)으로 나누되, 각 조각은 문맥이 온전히 이어지도록 작성해.
                            2. 불필요한 인사말, 이모지, 감탄사만 제거하고, 정보의 밀도를 극대화해.
                            3. 원문에 코드가 있다면 요약본 안에도 반드시 그 코드를 그대로 포함시켜서 문장을 구성해.
                            4. **[매우 중요: JSON 문법 준수]** summary 문자열 내부에 따옴표(\"), 백슬래시(\\\\\\\\), 또는 \\u 같은 이스케이프 문자를 포함해야 할 경우, 반드시 유효한 JSON 형식에 맞게 이중 이스케이프(\\\\\\\\\\\\\\\\) 처리를 하거나, 오류를 유발할 수 있는 특수 정규식 기호는 일반 텍스트로 풀어써.
                            5. **[매우 중요: 형식 엄수]** 절대 인사말이나 부연 설명을 덧붙이지 말고, 오직 중괄호 {} 로 시작하고 끝나는 JSON 객체만 출력해.
                            
                            [필수 출력 형식] (반드시 JSON)
                            {
                                "memories": [
                                    { "summary": "[스크랩-트러블슈팅] Gemini 대화 JSON 파싱 에러 원인과 해결책: ..." },
                                    { "summary": "[스크랩-코드/기술] 적용된 핵심 자바스크립트 코드: let uniqueLines = [...new Set(textLines)];" }
                                ]
                            }
                            """;
        } else {
            targetModel = "gpt-5-nano";

            systemInstruction = """
                            너는 대화 기록에서 중요한 문맥과 정보를 추출하여 장기 기억 장소에 저장할 수 있도록 가공하는 AI 데이터 아키텍트야.
                            제공된 전체 대화를 분석하여, 파편화되지 않은 '독립적이고 완전한 문맥을 가진 정보 덩어리'로 추출해줘.
                            
                            [분류 기준] (무조건 다음 5가지 중 가장 적합한 하나만을 선택)
                            1. [사용자 정보]: 사용자의 인적 사항, 선호도(취향), 가치관, 관계, 습관 등.
                            2. [지식]: 객관적인 사실, 방법론, 노하우, 학습 내용, 구체적인 정보 등.
                            3. [이벤트]: 과거에 일어난 일, 미래의 일정, 기념일 등 시간 중심의 기록등.
                            4. [프로젝트 및 목표]: 목적을 가진 활동, 업무 진행 상황, 개인적 도전 과제 및 계획.
                            5. [생각]: 사용자의 주관적인 의견, 아이디어, 영감, 감정, 일기 같은 기록.
                            
                            [지시사항]
                            1. 1인칭 대명사(나, 내)나 2인칭 대명사(너) 대신 '사용자' 또는 중립적인 명칭을 사용해.
                            2. 입력된 텍스트의 길이나 주제의 다양성에 따라 필요한 만큼 무제한으로 기억 조각(summary)을 생성해.
                            3. 각 조각(summary)은 3~5줄짜리 완성된 덩어리로 작성해.
                            4. 의미 없는 인사말, 감정 표현, 단순 맞장구는 제외해.
                            5. **[매우 중요: JSON 문법 준수]** summary 문자열 내부에 코드가 포함될 경우 따옴표(\"), 백슬래시(\\\\\\\\), \\u 등을 엄격하게 이스케이프 처리하여 JSON 파싱(ObjectMapper) 시 에러가 나지 않도록 해.
                            6. **[매우 중요: 형식 엄수]** 절대 인사말이나 부연 설명을 덧붙이지 말고, 오직 중괄호 {} 로 시작하고 끝나는 JSON 객체만 출력해.
                            
                            [필수 출력 형식] (반드시 JSON)
                            {
                                "memories": [
                                    { "summary": "[지식] Spring Boot의 RestTemplate을 사용하면..." },
                                    { "summary": "[사용자 정보] 사용자는 백엔드 개발에 깊은 이해도를..." }
                                ]
                            }
                            """;
        }

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("model", targetModel);
        requestBody.put("messages", List.of(Map.of("role", "system", "content", systemInstruction), Map.of("role", "user", "content", "입력 텍스트:\n" + content)));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
        String url = baseUrl.endsWith("/") ? baseUrl + "v1/chat/completions" : baseUrl + "/v1/chat/completions";

        String llmResponse;
        try {
            ResponseEntity<JsonNode> response = restTemplate.postForEntity(url, entity, JsonNode.class);
            llmResponse = response.getBody().path("choices").get(0).path("message").path("content").asText();
        } catch (Exception e) { throw new RuntimeException("API 직접 호출 실패", e); }

        String cleanedResponse = llmResponse.trim();
        int jsonStart = cleanedResponse.indexOf("{");
        int jsonEnd = cleanedResponse.lastIndexOf("}");

        if (jsonStart != -1 && jsonEnd != -1) {
            cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);
        } else {
            throw new RuntimeException("LLM 응답에서 JSON 포맷을 찾을 수 없습니다.");
        }

        ExtractionMemoryResult extraction;
        try {
            extraction = objectMapper.readValue(cleanedResponse, ExtractionMemoryResult.class);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("JSON 파싱 실패", e);
        }

        if (extraction != null && extraction.memories() != null) {
            for (var item : extraction.memories()) {
                float[] vector = embeddingModel.embed(item.summary());
                // 🌟 self 호출로 변경
                saveIds.add(self.saveRawMemoryToDb(workspace, item.summary(), vector));
            }
        }
        return saveIds;
    }

    // --- 철저하게 분리된 짧은 DB 트랜잭션 메서드들 ---

    // 🌟 [핵심 픽스 3] 스프링 프록시는 protected 메서드에는 트랜잭션을 적용하지 않습니다!
    // 반드시 public으로 열어두어야 합니다.

    @Transactional
    public void deductCredit(Long memberId, int cost) {
        Member member = memberRepository.findById(memberId).orElseThrow();
        member.useCredit(cost);
        memberRepository.save(member);
    }

    @Transactional
    public Long saveRawMemoryToDb(Workspace workspace, String content, float[] vector) {
        Memory memory = Memory.builder().content(content).workspace(workspace).vector(vector).createdAt(LocalDateTime.now()).build();
        memoryRepository.save(memory);
        return memory.getId();
    }

    @Transactional
    public void updateJobProgressInDb(Long jobId, int processed, int total) {
        MemorySyncJob job = memorySyncJobRepository.findByIdWithMember(jobId).orElseThrow();
        job.updateProgress(processed, total);
        memorySyncJobRepository.saveAndFlush(job);
    }

    @Transactional
    public void markJobStatusInDb(Long jobId, SyncStatus status) {
        MemorySyncJob job = memorySyncJobRepository.findByIdWithMember(jobId).orElseThrow();
        if(status == SyncStatus.COMPLETED) job.markAsCompleted();
        else job.markAsFailed();
        memorySyncJobRepository.saveAndFlush(job);
    }

    @Transactional(readOnly = true)
    public List<String> executeSearchInDb(Long workspaceId, float[] vector, int topK, float threshold) {
        return memoryRepository.findTopKSimilarMemories(workspaceId, vector, topK, threshold)
                .stream().map(Memory::getContent).toList();
    }

    public MemorySyncJob getJobStatusWithProgress(Long jobId, Long memberId) {
        return memorySyncJobRepository.findByIdWithMember(jobId).orElseThrow();
    }

    private List<String> splitContent(String content, int chunkSize) {
        List<String> chunks = new ArrayList<>();
        if (content == null || content.isEmpty()) return chunks;
        int length = content.length();
        for (int i = 0; i < length; i += chunkSize) {
            chunks.add(content.substring(i, Math.min(length, i + chunkSize)));
        }
        return chunks;
    }
}
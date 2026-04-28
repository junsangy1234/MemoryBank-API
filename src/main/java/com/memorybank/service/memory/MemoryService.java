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
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
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
// 🌟 클래스 레벨의 @Transactional을 제거했습니다! (DB 파이프 낭비 원천 차단)
@RequiredArgsConstructor
public class MemoryService {

    private final MemoryRepository memoryRepository;
    private final WorkspaceService workspaceService;
    private final MemberRepository memberRepository;
    private final MemorySyncJobRepository memorySyncJobRepository;
    private final EmbeddingModel embeddingModel;

    //일정 시간마다 정찰해서 뻗은 스캐쥴 제거
    @Scheduled(cron = "0 0 * * * *") // 1시간마다 실행
    @Transactional
    public void cleanupZombieJobs() {
        // 1. 현재 시간 기준으로 1시간이 지났는데도 여전히 'PENDING'인 녀석들을 DB에서 찾습니다.
        // (정상적인 작업이라면 1시간이나 걸릴 리가 없으므로 서버가 중간에 뻗은 '좀비'라고 간주합니다.)
        LocalDateTime oneHourAgo = LocalDateTime.now().minusHours(1);
        List<MemorySyncJob> zombieJobs = memorySyncJobRepository.findZombieJobs(SyncStatus.PENDING, oneHourAgo);

        for (MemorySyncJob job : zombieJobs) {
            // 2. 상태를 강제로 FAILED(실패)로 바꿉니다.
            job.markAsFailed();
            memorySyncJobRepository.save(job);

            // 3. (옵션) 유저가 억울하게 날린 크레딧이 있다면 여기서 다시 환불(Rollback) 해줍니다.
            Member member = job.getWorkspace().getMember();
            member.addRewardCredits(job.getEstimatedCredits()); // 크레딧 복구
            memberRepository.save(member);

            log.warn("🧹 좀비 작업 정리 완료. Job ID: {}, 크레딧 환불 완료", job.getId());
        }
    }

    // 병렬 처리를 위한 스레드 풀 주입
    @Qualifier("aiTaskExecutor")
    private final Executor aiExecutor;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${spring.ai.openai.api-key}")
    private String apiKey;

    @Value("${spring.ai.openai.base-url:https://api.openai.com}")
    private String baseUrl;

    private static final int MAX_SINGLE_SAVE_CHARS = 10000;

    // 🌟 유저별 동시 AI 호출 개수를 3개로 제한하는 세마포어 맵
    private final ConcurrentHashMap<Long, Semaphore> userSemaphores = new ConcurrentHashMap<>();

    private Semaphore getUserSemaphore(Long memberId) {
        // 유저 1명당 최대 3개의 스레드만 허용하여 공평하게 자원 분배
        return userSemaphores.computeIfAbsent(memberId, k -> new Semaphore(3));
    }


    // =====================================================================
    // 1. 단일 저장 (DB 연결 분리 완료)
    // =====================================================================
    public List<Long> saveMemory(Long memberId, Long workspaceId, String content, String type) {
        if (content != null && content.length() > MAX_SINGLE_SAVE_CHARS) {
            throw new IllegalArgumentException("단일 저장 허용 범위를 초과했습니다. 전체 스캔 기능을 이용해주세요.");
        }

        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);
        if (!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("권한 없음");

        // DB 트랜잭션을 짧게 쥐고 크레딧 차감 후 바로 놓아줍니다.
        deductCredit(memberId, CreditPolicy.SAVE_COST);

        List<Long> saveIds = new ArrayList<>();

        if (content.length() <= 300 && !content.contains("```")) {
            // AI 호출 (이 동안 DB 파이프 안 씀!)
            float[] vector = embeddingModel.embed(content);
            saveIds.add(saveRawMemoryToDb(workspace, content, vector));
            return saveIds;
        }

        List<String> chunks = splitContent(content, 50000);
        for (String chunk : chunks) {
            // 내부에서 AI 호출 시 DB 파이프를 잡지 않음
            saveIds.addAll(executeAiExtractionAndSave(workspace, chunk, type));
        }
        return saveIds;
    }


    // =====================================================================
    // 2. 전체 저장 (하이브리드 병렬 처리 + 트랜잭션 분리)
    // =====================================================================
    @Transactional
    public Long initiateFullSave(Long memberId, FullSaveRequest request){
        Workspace workspace = workspaceService.findByIdWithMember(request.workspaceId());
        if(!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("권한 없음");

        MemorySyncJob pendingJob = MemorySyncJob.createPendingJob(workspace, request.rawContent(), request.estimatedCredits());
        memorySyncJobRepository.save(pendingJob);
        return pendingJob.getId();
    }

    @Async // 이 메서드 자체는 기본 백그라운드 스레드에서 돕니다.
    public void processFullSave(Long jobId) {
        // 1. 트랜잭션 없이 Job 조회
        MemorySyncJob job = memorySyncJobRepository.findByIdWithMember(jobId).orElseThrow();
        if(job.getStatus() != SyncStatus.PENDING) return;

        Workspace workspace = job.getWorkspace();
        Long memberId = workspace.getMember().getId();

        try {
            // 크레딧 차감 (DB 트랜잭션 분리)
            deductCredit(memberId, 0); // 테스트용 0

            List<String> chunks = splitContent(job.getRawContent(), 50000);

            // 진행률 초기화 DB 반영
            updateJobProgressInDb(jobId, 0, chunks.size());

            // 병렬 처리 제어용
            Semaphore semaphore = getUserSemaphore(memberId);
            List<CompletableFuture<Void>> futures = new ArrayList<>();
            AtomicInteger processedCount = new AtomicInteger(0);

            // 🌟 64개의 청크를 동시에 Executor에 던지지만, Semaphore 때문에 유저당 3개씩만 돌아감!
            for (String chunkText : chunks) {
                CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
                    try {
                        semaphore.acquire(); // 입장권 대기

                        // AI 호출 (DB 파이프 전혀 안 씀)
                        executeAiExtractionAndSave(workspace, chunkText, "FULL_CONV");

                        // 완료 후 진행률 1증가 시키고 DB 업데이트 (0.01초)
                        int currentProcessed = processedCount.incrementAndGet();
                        updateJobProgressInDb(jobId, currentProcessed, chunks.size());

                    } catch (Exception e) {
                        log.error("청크 처리 중 오류", e);
                    } finally {
                        semaphore.release(); // 입장권 반납
                    }
                }, aiExecutor);
                futures.add(future);
            }

            // 모든 청크가 다 끝날 때까지 대기
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

            // 완료 처리 DB 반영
            markJobStatusInDb(jobId, SyncStatus.COMPLETED);
            log.info("🟢 Job ID {}: 전체 저장 성공!", jobId);

        } catch (Exception e){
            markJobStatusInDb(jobId, SyncStatus.FAILED);
            log.error("🔴 Job ID {}: 전체 저장 실패!", jobId, e);
        }
    }


    // =====================================================================
    // 3. 검색 및 조회 (DB 연결 분리)
    // =====================================================================
    public List<String> searchSimilarMemories(Long memberId, Long workspaceId, String question, int topK, float threshold) {
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);
        if (!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("권한 없음");

        deductCredit(memberId, CreditPolicy.SEARCH_COST);

        // 🌟 AI 임베딩 호출 (이 동안 DB 파이프 안 씀!)
        float[] questionVector = embeddingModel.embed(question);

        // 결과 검색만 트랜잭션 타게 함
        return executeSearchInDb(workspaceId, questionVector, topK, threshold);
    }

    @Transactional(readOnly = true)
    public SyncResponse getMemoriesForSync(Long memberId, Long workspaceId, Long lastId, int limit) {
        // AI 호출이 없으므로 단순 조회는 기존대로 유지
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);
        if (!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("권한 없음");

        deductCredit(memberId, CreditPolicy.LOAD_COST);

        List<Memory> memories = memoryRepository.findMemoriesForSync(workspaceId, lastId, limit);
        long remainingCount = memoryRepository.countRemainingMemories(workspaceId, lastId);

        List<SyncMemoryDto> dtoList = memories.stream().map(m -> new SyncMemoryDto(m.getId(), m.getContent())).toList();
        return new SyncResponse(dtoList, remainingCount > memories.size(), remainingCount);
    }


    // =====================================================================
    // 내부 헬퍼 메서드 (순수 AI 로직 vs 순수 DB 로직 분리)
    // =====================================================================

    private List<Long> executeAiExtractionAndSave(Workspace workspace, String content, String type) {
        List<Long> saveIds = new ArrayList<>();
        String systemInstruction;
        String targetModel;
        // ... (systemInstruction 및 RestTemplate 호출 로직은 기존 코드와 100% 동일) ...
        if ("SNIPPET".equals(type)) {
            targetModel = "gpt-5-nano";

            systemInstruction = """
                            너는 사용자가 웹서핑이나 대화 중 중요하다고 생각하여 직접 드래그해서 스크랩한 텍스트를 정리하는 AI 데이터 아키텍트야.
                            이 텍스트는 이미 사용자가 필터링한 중요 정보이므로, 원본의 디테일(특히 코드, 명령어, 고유명사, 문제 원인과 해결책)을 절대 훼손하지 마.
                            
                            [지시사항]
                            1. 텍스트가 너무 길면 핵심 주제별로 1~3개의 조각(summary)으로 나누되, 각 조각은 [문제 상황 -> 해결책 -> 중요 코드/개념]의 문맥이 온전히 이어지도록 작성해.
                            2. 불필요한 인사말, 이모지, 감탄사만 제거하고, 정보의 밀도를 극대화해.
                            3. 원문에 코드가 있다면 요약본 안에도 반드시 그 코드를 포함시켜서 문장을 구성해.
                            4. **[매우 중요: JSON 문법 준수]** summary 문자열 내부에 따옴표(\\"), 백슬래시(\\\\\\\\), 또는 \\\\u 같은 이스케이프 문자를 포함해야 할 경우, 반드시 유효한 JSON 형식에 맞게 이중 이스케이프(\\\\\\\\\\\\\\\\) 처리를 하거나, 오류를 유발할 수 있는 특수 정규식 기호는 일반 텍스트로 풀어써.
                            
                            [필수 출력 형식] (반드시 JSON)
                            {
                                "memories": [
                                    { "summary": "[스크랩-트러블슈팅] Gemini 대화 에러 원인..." },
                                    { "summary": "[스크랩-코드] 적용된 핵심 코드: let uniqueLines = [...new Set(textLines)];" }
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
                            5. **[매우 중요: JSON 문법 준수]** summary 문자열 내부에 코드가 포함될 경우 따옴표(\\"), 백슬래시(\\\\\\\\), \\\\u 등을 엄격하게 이스케이프 처리하여 JSON 파싱(ObjectMapper) 시 에러가 나지 않도록 해.
                            
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
        if (cleanedResponse.startsWith("```json")) cleanedResponse = cleanedResponse.substring(7, cleanedResponse.length() - 3).trim();
        else if (cleanedResponse.startsWith("```")) cleanedResponse = cleanedResponse.substring(3, cleanedResponse.length() - 3).trim();

        ExtractionMemoryResult extraction;
        try { extraction = objectMapper.readValue(cleanedResponse, ExtractionMemoryResult.class); }
        catch (JsonProcessingException e) { throw new RuntimeException("JSON 파싱 실패", e); }

        if (extraction != null && extraction.memories() != null) {
            for (var item : extraction.memories()) {
                // 임베딩 (API 호출 - DB 안 잡음)
                float[] vector = embeddingModel.embed(item.summary());
                // 저장 (DB 잠깐 씀)
                saveIds.add(saveRawMemoryToDb(workspace, item.summary(), vector));
            }
        }
        return saveIds;
    }

    // --- 철저하게 분리된 짧은 DB 트랜잭션 메서드들 ---

    @Transactional
    protected void deductCredit(Long memberId, int cost) {
        Member member = memberRepository.findById(memberId).orElseThrow();
        member.useCredit(cost);
        memberRepository.save(member);
    }

    @Transactional
    protected Long saveRawMemoryToDb(Workspace workspace, String content, float[] vector) {
        Memory memory = Memory.builder().content(content).workspace(workspace).vector(vector).createdAt(LocalDateTime.now()).build();
        memoryRepository.save(memory);
        return memory.getId();
    }

    @Transactional
    protected void updateJobProgressInDb(Long jobId, int processed, int total) {
        MemorySyncJob job = memorySyncJobRepository.findByIdWithMember(jobId).orElseThrow();
        job.updateProgress(processed, total);
        memorySyncJobRepository.saveAndFlush(job);
    }

    @Transactional
    protected void markJobStatusInDb(Long jobId, SyncStatus status) {
        MemorySyncJob job = memorySyncJobRepository.findByIdWithMember(jobId).orElseThrow();
        if(status == SyncStatus.COMPLETED) job.markAsCompleted();
        else job.markAsFailed();
        memorySyncJobRepository.saveAndFlush(job);
    }

    @Transactional(readOnly = true)
    protected List<String> executeSearchInDb(Long workspaceId, float[] vector, int topK, float threshold) {
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
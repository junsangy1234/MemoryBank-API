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
            systemInstruction = "너는 사용자가 스크랩한 텍스트를 정리하는 AI 데이터 아키텍트야..."; // 축약
        } else {
            targetModel = "gpt-5-nano";
            systemInstruction = "너는 대화 기록에서 중요한 문맥을 추출하는 AI 데이터 아키텍트야..."; // 축약
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
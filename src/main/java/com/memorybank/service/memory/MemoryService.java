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
@RequiredArgsConstructor
public class MemoryService {

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

            log.warn("🧹 Zombie job cleaned up. Job ID: {}, Credits refunded.", job.getId());
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
            throw new IllegalArgumentException("Single save limit exceeded. Please use the full scan feature.");
        }

        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);
        if (!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("Unauthorized access");

        if(type.equalsIgnoreCase("SNIPPET")) {
            self.deductCredit(memberId, CreditPolicy.SAVE_COST - 1);
        }else{
            self.deductCredit(memberId, CreditPolicy.SAVE_COST);
        }

        List<Long> saveIds = new ArrayList<>();

        if (content.length() <= 300 && !content.contains("```")) {
            float[] vector = embeddingModel.embed(content);
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
        if(!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("Unauthorized access");

        String content = request.rawContent() != null ? request.rawContent() : "";
        int calculatedCredits = Math.max(1, (int) Math.ceil(content.length() / 5000.0));

        MemorySyncJob pendingJob = MemorySyncJob.createPendingJob(workspace, request.rawContent(), request.estimatedCredits());
        memorySyncJobRepository.save(pendingJob);

        self.deductCredit(memberId, calculatedCredits);

        return pendingJob.getId();
    }

    @Async
    public void processFullSave(Long jobId) {
        MemorySyncJob job = memorySyncJobRepository.findByIdWithMember(jobId).orElseThrow();
        if(job.getStatus() != SyncStatus.PENDING) return;

        Workspace workspace = job.getWorkspace();
        Long memberId = workspace.getMember().getId();

        try {
            List<String> chunks = splitContent(job.getRawContent(), 50000);

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
                        self.updateJobProgressInDb(jobId, currentProcessed, chunks.size());
                    } catch (Exception e) {
                        log.error("Error processing chunk", e);
                    } finally {
                        semaphore.release();
                    }
                }, aiExecutor);
                futures.add(future);
            }

            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

            self.markJobStatusInDb(jobId, SyncStatus.COMPLETED);
            log.info("🟢 Job ID {}: Full save successful!", jobId);

        } catch (Exception e){
            self.markJobStatusInDb(jobId, SyncStatus.FAILED);
            log.error("🔴 Job ID {}: Full save failed!", jobId, e);
        }
    }


    // =====================================================================
    // 3. 검색 및 조회
    // =====================================================================
    public List<String> searchSimilarMemories(Long memberId, Long workspaceId, String question, int topK, float threshold) {
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);
        if (!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("Unauthorized access");

        self.deductCredit(memberId, 1);

        float[] questionVector = embeddingModel.embed(question);

        return self.executeSearchInDb(workspaceId, questionVector, topK, threshold);
    }

    @Transactional(readOnly = true)
    public SyncResponse getMemoriesForSync(Long memberId, Long workspaceId, Long lastId, int limit) {
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);
        if (!workspace.getMember().getId().equals(memberId)) throw new IllegalStateException("Unauthorized access");

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
                            You are an AI Data Architect responsible for organizing snippets manually selected and saved by the user from web browsing or conversations.
                            Since the user has already deemed this text important, NEVER alter or lose any details from the original content (especially codes, commands, proper nouns, problem causes, and solutions).
                            
                            [Classification Criteria] (You MUST select the ONE most appropriate category from the 5 below and prepend it as a tag at the beginning of the summary)
                            1. [Snippet-Troubleshooting]: Error and bug resolution methods, causes of problems, and workarounds.
                            2. [Snippet-Code/Tech]: Programming code snippets, terminal commands, IT architecture, and technical concepts.
                            3. [Snippet-Knowledge/Info]: Objective facts found during web surfing, news articles, useful tips, and methodologies.
                            4. [Snippet-Idea/Inspiration]: Benchmarking references, planning ideas, and impressive quotes.
                            5. [Snippet-Misc]: Simple notes or personal records that do not fit into the above categories.
                            
                            [Instructions]
                            1. If the text is too long, break it down into 1 to 3 chunks (summaries) based on key topics, ensuring each chunk maintains full context.
                            2. Remove unnecessary greetings, emojis, and exclamations, maximizing the density of information.
                            3. If the original text contains code, you MUST include that code exactly as is within the summary sentence.
                            4. **[CRITICAL: strict JSON formatting]** If you must include quotes(\"), backslashes(\\\\\\\\), or escape characters like \\u inside the summary string, you MUST properly double-escape them (\\\\\\\\\\\\\\\\) to keep the JSON valid. Do not use regex tokens that could break parsing; write them out as plain text.
                            5. **[CRITICAL: strict Output]** NEVER output any conversational filler, greetings, or explanations. ONLY output a valid JSON object starting and ending with curly braces {}.
                            
                            [Required Output Format] (MUST be valid JSON)
                            {
                                "memories": [
                                    { "summary": "[Snippet-Troubleshooting] Cause and solution for Gemini conversation JSON parsing error: ..." },
                                    { "summary": "[Snippet-Code/Tech] Applied core Javascript code: let uniqueLines = [...new Set(textLines)];" }
                                ]
                            }
                            """;
        } else {
            targetModel = "gpt-5-nano";

            systemInstruction = """
                            You are an AI Data Architect tasked with extracting important contexts and information from conversation logs to be saved in long-term memory.
                            Analyze the provided full conversation and extract it into independent, complete context chunks, ensuring no information is fragmented.
                            
                            [Classification Criteria] (You MUST select the ONE most appropriate category from the 5 below)
                            1. [User Info]: User's personal details, preferences (tastes), values, relationships, habits, etc.
                            2. [Knowledge]: Objective facts, methodologies, know-how, learning content, specific information, etc.
                            3. [Event]: Time-centric records such as past occurrences, future schedules, anniversaries, etc.
                            4. [Project & Goal]: Purpose-driven activities, work progress, personal challenges, and plans.
                            5. [Thought]: Subjective opinions, ideas, inspirations, emotions, and diary-like entries.
                            
                            [Instructions]
                            1. Use 'User' or neutral terms instead of first-person pronouns (I, me) or second-person pronouns (you).
                            2. Generate an unlimited number of memory chunks (summaries) as needed based on the length and topic diversity of the input text.
                            3. Write each chunk (summary) as a complete, self-contained block of 3 to 5 sentences.
                            4. Exclude meaningless greetings, emotional expressions, and simple agreements.
                            5. **[CRITICAL: strict JSON formatting]** If code is included inside the summary string, you MUST strictly escape quotes(\"), backslashes(\\\\\\\\), and \\u to prevent JSON parsing (ObjectMapper) errors.
                            6. **[CRITICAL: strict Output]** NEVER output any conversational filler, greetings, or explanations. ONLY output a valid JSON object starting and ending with curly braces {}.
                            
                            [Required Output Format] (MUST be valid JSON)
                            {
                                "memories": [
                                    { "summary": "[Knowledge] Using Spring Boot's RestTemplate allows..." },
                                    { "summary": "[User Info] The user has a deep understanding of backend development..." }
                                ]
                            }
                            """;
        }

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("model", targetModel);
        requestBody.put("messages", List.of(Map.of("role", "system", "content", systemInstruction), Map.of("role", "user", "content", "Input Text:\n" + content)));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
        String url = baseUrl.endsWith("/") ? baseUrl + "v1/chat/completions" : baseUrl + "/v1/chat/completions";

        String llmResponse;
        try {
            ResponseEntity<JsonNode> response = restTemplate.postForEntity(url, entity, JsonNode.class);
            llmResponse = response.getBody().path("choices").get(0).path("message").path("content").asText();
        } catch (Exception e) { throw new RuntimeException("Direct API call failed", e); }

        String cleanedResponse = llmResponse.trim();
        int jsonStart = cleanedResponse.indexOf("{");
        int jsonEnd = cleanedResponse.lastIndexOf("}");

        if (jsonStart != -1 && jsonEnd != -1) {
            cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);
        } else {
            throw new RuntimeException("Cannot find JSON format in LLM response.");
        }

        ExtractionMemoryResult extraction;
        try {
            extraction = objectMapper.readValue(cleanedResponse, ExtractionMemoryResult.class);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("JSON parsing failed", e);
        }

        if (extraction != null && extraction.memories() != null) {
            for (var item : extraction.memories()) {
                float[] vector = embeddingModel.embed(item.summary());
                saveIds.add(self.saveRawMemoryToDb(workspace, item.summary(), vector));
            }
        }
        return saveIds;
    }

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
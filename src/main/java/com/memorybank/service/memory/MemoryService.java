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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class MemoryService {

    private final MemoryRepository memoryRepository;
    private final WorkspaceService workspaceService;
    private final MemberRepository memberRepository;
    private final MemorySyncJobRepository memorySyncJobRepository;

    // Spring Ai 추상화 모델
    private final EmbeddingModel embeddingModel;

    //자바 표준 JSON 파서 및 순수 HTTP 클라이언트
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final RestTemplate restTemplate = new RestTemplate();

    // application.yml에서 API 키, URL, 모델명을 직접 가져옵니다.
    @Value("${spring.ai.openai.api-key}")
    private String apiKey;

    @Value("${spring.ai.openai.base-url:https://api.openai.com}")
    private String baseUrl;

    @Transactional
    public List<Long> saveMemory(Long memberId, Long workspaceId, String content, String type) {
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);

        if (!workspace.getMember().getId().equals(memberId)) {
            throw new IllegalStateException("해당 워크스페이스에 대한 접근 권한이 없습니다.");
        }

        //저장시 크레딧 사용(3)
        Member manageMember = memberRepository.findById(memberId).get();
        manageMember.useCredit(CreditPolicy.SAVE_COST);

        List<Long> saveIds = new ArrayList<>();

        // [Route A] 300자 이하의 짧은 일상 문장이나 메모는 LLM 요약 없이 DB로 직행!
        // 단, 짧더라도 마크다운 코드블록(```)이 포함되어 있다면 분석이 필요하므로 LLM으로 보냅니다.
        if (content.length() <= 300 && !content.contains("```")) {
            float[] vector = embeddingModel.embed(content);
            Memory memory = Memory.builder()
                    .content(content)
                    .workspace(workspace)
                    .vector(vector)
                    .createdAt(LocalDateTime.now())
                    .build();
            memoryRepository.save(memory);
            saveIds.add(memory.getId());
            return saveIds; // 여기서 바로 종료
        }

        // [Route B] 300자가 넘거나 코드가 포함된 경우, 목적(type)에 따라 지시를 다르게 내립니다.
        return executeAiExtractionAndSave(workspace, content, type);
    }

    // 전체저장 1단계: PENDING 임시저장
    @Transactional
    public Long initiateFullSave(Long memberId, FullSaveRequest request){
        Workspace workspace = workspaceService.findByIdWithMember(request.workspaceId());

        if(!workspace.getMember().getId().equals(memberId)){
            throw new IllegalStateException("해당 워크스페이스에 대한 접근 권한이 없습니다.");
        }

        // MemorySyncJob(작업 큐) 엔티티를 생성하고 저장합니다.
        MemorySyncJob pendingJob = MemorySyncJob.createPendingJob(
                workspace,
                request.rawContent(),
                request.estimatedCredits()
        );

        memorySyncJobRepository.save(pendingJob);

        log.info("🟡 [전체 저장] 임시 작업 큐 저장 완료. Job ID: {}, 견적 토큰: {}", pendingJob.getId(), pendingJob.getEstimatedCredits());

        return pendingJob.getId();
    }

    // 전체저장 2단계
    @Async("fullSaveExecutor")
    @Transactional
    public void processFullSave(Long jobId){
        MemorySyncJob job = memorySyncJobRepository.findByIdWithMember(jobId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 작업입니다."));

        if(job.getStatus() != SyncStatus.PENDING){
            log.warn("이미 처리 중이거나 완료된 작업입니다. Job ID: {}", jobId);
            return;
        }

        try{
            Member member = job.getWorkspace().getMember();
            //잔여 토큰 확인후 토큰 차감
            member.useCredit(job.getEstimatedCredits());

            log.info("💳 Job ID {}: 토큰 {}개 차감 완료", jobId, job.getEstimatedCredits());

            // AI 작업 및 저장
            executeAiExtractionAndSave(job.getWorkspace(), job.getRawContent(), "FULL_CONV");

            job.markAsCompleted();
            log.info("🟢 Job ID {}: 전체 저장 성공!", jobId);
        }catch (Exception e){
            job.markAsFailed();
            log.error("🔴 Job ID {}: 전체 저장 실패!", jobId, e);
            throw new RuntimeException("전체 저장 처리 중 오류가 발생했습니다.", e);
        }
    }

    @Transactional
    public List<String> searchSimilarMemories(Long memberId, Long workspaceId, String question, int topK, float threshold) {
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);

        if (!workspace.getMember().getId().equals(memberId)) {
            throw new IllegalStateException("해당 워크스페이스에 대한 접근 권한이 없습니다.");
        }


        //검색 크레딧 사용(1)
        Member manageMember = memberRepository.findById(memberId).get();
        manageMember.useCredit(CreditPolicy.SEARCH_COST);

        float[] questionVector = embeddingModel.embed(question);
        memoryRepository.debugDistances(workspaceId, questionVector);
        List<Memory> similarMemories = memoryRepository.findTopKSimilarMemories(workspaceId, questionVector, topK, threshold);

        return similarMemories.stream()
                .map(Memory::getContent)
                .toList();
    }

    @Transactional
    public SyncResponse getMemoriesForSync(Long memberId, Long workspaceId, Long lastId, int limit) {
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);

        if (!workspace.getMember().getId().equals(memberId)) {
            throw new IllegalStateException("해당 워크스페이스에 대한 접근 권한이 없습니다.");
        }

        //불러오기시 크레딧 사용(2)
        Member manageMember = memberRepository.findById(memberId).get();
        manageMember.useCredit(CreditPolicy.LOAD_COST);

        // 💡 Pageable 없이 limit 숫자를 바로 넘깁니다! (훨씬 직관적)
        List<Memory> memories = memoryRepository.findMemoriesForSync(workspaceId, lastId, limit);

        // 남은 전체 개수 계산 (더 가져오기 UI를 위해)
        long remainingCount = memoryRepository.countRemainingMemories(workspaceId, lastId);
        boolean hasMore = remainingCount > memories.size();

        // 엔티티 -> record DTO 변환
        List<SyncMemoryDto> dtoList = memories.stream()
                .map(m -> new SyncMemoryDto(m.getId(), m.getContent()))
                .toList();

        return new SyncResponse(dtoList, hasMore, remainingCount);
    }

    private List<Long> executeAiExtractionAndSave(Workspace workspace, String content, String type) {
        List<Long> saveIds = new ArrayList<>();
        String systemInstruction;
        String targetModel;

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

        // 순수 HTTP 통신으로 LLM 호출 (extra_body 에러 원천 차단)
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("model", targetModel);
        requestBody.put("messages", List.of(
                Map.of("role", "system", "content", systemInstruction),
                Map.of("role", "user", "content", "입력 텍스트:\n" + content)
        ));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(apiKey);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
        String url = baseUrl.endsWith("/") ? baseUrl + "v1/chat/completions" : baseUrl + "/v1/chat/completions";

        String llmResponse;
        try {
            ResponseEntity<JsonNode> response = restTemplate.postForEntity(url, entity, JsonNode.class);
            llmResponse = response.getBody().path("choices").get(0).path("message").path("content").asText();
        } catch (Exception e) {
            throw new RuntimeException("API 직접 호출 실패 (프록시/URL 확인 필요): " + e.getMessage(), e);
        }

        // 혹시 모를 JSON 마크다운 찌꺼기 완벽 제거
        String cleanedResponse = llmResponse.trim();
        if (cleanedResponse.startsWith("```json")) {
            cleanedResponse = cleanedResponse.substring(7, cleanedResponse.length() - 3).trim();
        } else if (cleanedResponse.startsWith("```")) {
            cleanedResponse = cleanedResponse.substring(3, cleanedResponse.length() - 3).trim();
        }

        // JSON 텍스트를 DTO 객체로 수동 파싱
        ExtractionMemoryResult extraction;
        try {
            extraction = objectMapper.readValue(cleanedResponse, ExtractionMemoryResult.class);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("LLM JSON 파싱 실패. 응답: " + cleanedResponse, e);
        }

        // 쪼개진 조각들을 임베딩(벡터화)하여 DB에 다중 저장
        if (extraction != null && extraction.memories() != null) {
            for (var item : extraction.memories()) {
                float[] vector = embeddingModel.embed(item.summary());

                Memory memory = Memory.builder()
                        .content(item.summary())
                        .workspace(workspace)
                        .vector(vector)
                        .createdAt(LocalDateTime.now())
                        .build();

                memoryRepository.save(memory);
                saveIds.add(memory.getId());
            }
        }

        return saveIds;
    }
}
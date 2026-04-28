package com.memorybank.controller;

import com.memorybank.domain.Member;
import com.memorybank.domain.MemorySyncJob;
import com.memorybank.domain.Role;
import com.memorybank.dto.common.Result;
import com.memorybank.dto.memory.*;
import com.memorybank.service.member.MemberService;
import com.memorybank.service.memory.MemoryQueryService;
import com.memorybank.service.memory.MemoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.Serializable;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/memories")
@RequiredArgsConstructor
public class MemoryController {
    private final MemoryService memoryService;
    private final MemoryQueryService memoryQueryService;
    private final MemberService memberService;

    @PostMapping("/join")
    public SaveMemoryResponse saveMemory(
            @RequestHeader("X-API-KEY") String apiKey,
            @RequestBody SaveMemoryRequest request){

        Member member = memberService.findByApiKey(apiKey);
        List<Long> memoryId = memoryService.saveMemory(member.getId(), request.getWorkspaceId(), request.getContent(), request.getType());

        return new SaveMemoryResponse(memoryId, "기억이 성공적으로 저장 되었습니다.");
    }

    @GetMapping("/list")
    public Result listMemory(
            @RequestHeader("X-API-KEY") String apiKey,
            @RequestParam("workspaceId") Long workspaceId) {
        Member member = memberService.findByApiKey(apiKey);

        List<MemoryDto> collect = memoryQueryService.listMemory(workspaceId, member);
        return new Result(collect.size(), collect);
    }

    @GetMapping("/search")
    public Result searchMemory(
            @RequestHeader("X-API-KEY") String apiKey,
            @RequestParam("workspaceId") Long workspaceId,
            @RequestParam("question") String question,
            @RequestParam(value = "topK", defaultValue = "3") int topK,
            @RequestParam(value = "threshold", defaultValue = "0.8") float threshold) {
        Member member = memberService.findByApiKey(apiKey);

        List<String> similarMemories = memoryService.searchSimilarMemories(member.getId(), workspaceId, question, topK,threshold);

        return new Result(similarMemories.size(), similarMemories);
    }

    @GetMapping("/sync")
    public ResponseEntity<SyncResponse> syncMemories(
            @RequestHeader("X-API-KEY") String apiKey,
            @RequestParam Long workspaceId,
            @RequestParam(defaultValue = "0") Long lastId,
            @RequestParam(defaultValue = "50") int limit
    ){
        Member member = memberService.findByApiKey(apiKey);

        SyncResponse response = memoryService.getMemoriesForSync(member.getId(), workspaceId, lastId, limit);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/full-save/init")
    public ResponseEntity<String> initFullSave(
            @RequestHeader("X-API-KEY") String apiKey,
            @RequestBody FullSaveRequest request){
        Member member = memberService.findByApiKey(apiKey);

        //Lite등급 이상인지 확인
        if(member.getRole() == Role.FREE && !member.isHasStarterPack()){
            throw new IllegalStateException("전체 저장 기능은 스타터팩 구매 또는 LITE 등급 이상부터 사용 가능합니다.");
        }

        //임시 저장
        Long savedJobId = memoryService.initiateFullSave(member.getId(), request);
        memoryService.processFullSave(savedJobId);

        return ResponseEntity.ok("전체 대화 수집 완료. (임시 ID: " + savedJobId + ")");
    }

    @GetMapping("/full-save/{jobId}/status")
    public ResponseEntity<Map<String, Serializable>> checkFullSaveStatus(
            @RequestHeader("X-API-KEY") String apiKey,
            @PathVariable Long jobId) {

        Member member = memberService.findByApiKey(apiKey);

        MemorySyncJob job = memoryService.getJobStatusWithProgress(jobId, member.getId());

        return ResponseEntity.ok(Map.of(
                "status", job.getStatus().name(),
                "processed", job.getProcessedChunks() != null ? job.getProcessedChunks() : 0,
                "total", job.getTotalChunks() != null ? job.getTotalChunks() : 0
        ));
    }
}

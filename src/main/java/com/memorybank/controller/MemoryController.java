package com.memorybank.controller;

import com.memorybank.domain.Member;
import com.memorybank.dto.common.Result;
import com.memorybank.dto.memory.MemoryDto;
import com.memorybank.dto.memory.SaveMemoryRequest;
import com.memorybank.dto.memory.SaveMemoryResponse;
import com.memorybank.dto.memory.SyncResponse;
import com.memorybank.service.member.MemberService;
import com.memorybank.service.memory.MemoryQueryService;
import com.memorybank.service.memory.MemoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

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
        List<Long> memoryId = memoryService.saveMemory(member, request.getWorkspaceId(), request.getContent(), request.getType());

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

        List<String> similarMemories = memoryService.searchSimilarMemories(member, workspaceId, question, topK,threshold);

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

        SyncResponse response = memoryService.getMemoriesForSync(member, workspaceId, lastId, limit);
        return ResponseEntity.ok(response);
    }
}

package com.memorybank.controller;

import com.memorybank.domain.Member;
import com.memorybank.dto.common.Result;
import com.memorybank.dto.memory.MemoryDto;
import com.memorybank.dto.memory.SaveMemoryRequest;
import com.memorybank.dto.memory.SaveMemoryResponse;
import com.memorybank.service.member.MemberService;
import com.memorybank.service.memory.MemoryQueryService;
import com.memorybank.service.memory.MemoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/memories")
@RequiredArgsConstructor
public class MemoryController {
    private final MemoryService memoryService;
    private final MemoryQueryService memoryQueryService;
    private final MemberService memberService;

    @PostMapping
    public SaveMemoryResponse saveMemory(
            @RequestHeader("X-API-KEY") String apiKey,
            @RequestBody SaveMemoryRequest request){

        Member member = memberService.findByApiKey(apiKey);
        Long memoryId = memoryService.saveMemory(member, request.getWorkspaceId(), request.getContent());

        return new SaveMemoryResponse(memoryId, "기억이 성공적으로 저장 되었습니다.");
    }

    @GetMapping("/list")
    public Result listMemory() {
        List<MemoryDto> collect = memoryQueryService.listMemory();
        return new Result(collect.size(), collect);
    }
}

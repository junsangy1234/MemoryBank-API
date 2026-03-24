package com.memorybank.controller;

import com.memorybank.domain.Member;
import com.memorybank.dto.workspace.CreateWorkspaceRequest;
import com.memorybank.dto.workspace.CreateWorkspaceResponse;
import com.memorybank.service.member.MemberService;
import com.memorybank.service.WorkspaceService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/workspaces")
public class WorkspaceController {
    private final WorkspaceService workspaceService;
    private final MemberService memberService;

    @PostMapping("/")
    public CreateWorkspaceResponse createWorkspace(
            @RequestHeader("X-API-KEY") String apiKey,
            @RequestBody CreateWorkspaceRequest request){
        Member member = memberService.findByApiKey(apiKey);

        Long workspaceId = workspaceService.createWorkspace(member, request.getName());

        return new CreateWorkspaceResponse(workspaceId, request.getName());
    }
}

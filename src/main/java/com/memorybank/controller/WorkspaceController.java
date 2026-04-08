package com.memorybank.controller;

import com.memorybank.domain.Member;
import com.memorybank.domain.Workspace;
import com.memorybank.dto.workspace.CreateWorkspaceRequest;
import com.memorybank.dto.workspace.WorkspaceDto;
import com.memorybank.service.member.MemberService;
import com.memorybank.service.WorkspaceService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequiredArgsConstructor
@RequestMapping("/api/workspaces")
public class WorkspaceController {
    private final WorkspaceService workspaceService;
    private final MemberService memberService;

    @PostMapping
    public ResponseEntity<WorkspaceDto> createWorkspace(
            @RequestHeader("X-API-KEY") String apiKey,
            @RequestBody CreateWorkspaceRequest request){
        Member member = memberService.findByApiKey(apiKey);
        String name = request.getName();

        Long workspaceId = workspaceService.createWorkspace(member, request.getName());

        return ResponseEntity.ok(new WorkspaceDto(workspaceId, name));
    }

    @GetMapping("/list")
    public ResponseEntity<List<WorkspaceDto>> list(
            @RequestHeader("X-API-KEY") String apiKey) {
        Member member = memberService.findByApiKey(apiKey);
        List<Workspace> workspaces = workspaceService.findByMember(member);

        List<WorkspaceDto> workspaceDtos = workspaces.stream()
                .map(w -> new WorkspaceDto(w.getId(), w.getName()))
                .toList();

        return ResponseEntity.ok(workspaceDtos);
    }

    // 이름 변경 (Patch)
    @PutMapping("/{workspaceId}")
    public ResponseEntity<Void> rename(
            @RequestHeader("X-API-KEY") String apiKey,
            @PathVariable Long workspaceId,
            @RequestBody Map<String, String> request) {
        Member member = memberService.findByApiKey(apiKey);
        workspaceService.renameWorkspace(member, workspaceId, request.get("name"));
        return ResponseEntity.ok().build();
    }

    // 삭제 (Delete)
    @DeleteMapping("/{workspaceId}")
    public ResponseEntity<Void> delete(
            @RequestHeader("X-API-KEY") String apiKey,
            @PathVariable Long workspaceId) {
        Member member = memberService.findByApiKey(apiKey);
        workspaceService.deleteWorkspace(member, workspaceId);
        return ResponseEntity.ok().build();
    }

}

package com.memorybank.service;

import com.memorybank.domain.Member;
import com.memorybank.domain.Workspace;
import com.memorybank.repository.WorkspaceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional(readOnly = true) // 기본적으로 읽기 전용 트랜잭션 (성능 최적화)
@RequiredArgsConstructor
public class WorkspaceService {

    private final WorkspaceRepository workspaceRepository;

    @Transactional
    public Long createWorkspace(Member member, String name) {
        validateDuplicateWorkspace(name, member);

        Workspace workspace = Workspace.builder()
                .member(member)
                .name(name)
                .build();

        workspaceRepository.save(workspace);
        return workspace.getId();
    }

    private void validateDuplicateWorkspace(String name, Member member) {
        List<Workspace> findWorkspaces = workspaceRepository.findByNameAndMember(name, member);
        if (!findWorkspaces.isEmpty()) {
            throw new IllegalStateException("이미 존재하는 워크스페이스 이름입니다.");
        }
    }


    public Workspace findById(Long workspaceId) {
        return workspaceRepository.findOne(workspaceId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 워크스페이스입니다. ID=" + workspaceId));
    }

    public Workspace findByIdWithMember(Long workspaceId){
        return workspaceRepository.findByIdWithMember(workspaceId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 워크스페이스입니다. ID=" + workspaceId));
    }

    public List<Workspace> findAll() {
        return workspaceRepository.findAll();
    }
}
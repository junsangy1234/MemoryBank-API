package com.memorybank.service;

import com.memorybank.domain.Member;
import com.memorybank.domain.Role;
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

         List<Workspace> myWorkspaces = workspaceRepository.findByMember(member);
         int currentCount = myWorkspaces.size();

        if (member.getRole() == Role.FREE && currentCount >= 1) {
            throw new IllegalStateException("FREE 등급은 1개의 워크스페이스만 생성 가능합니다.");
        } else if (member.getRole() == Role.PRO && currentCount >= 3) {
            throw new IllegalStateException("PRO 등급은 최대 3개까지 생성 가능합니다.");
        }

        Workspace workspace = Workspace.builder()
                .member(member)
                .name(name)
                .build();

        workspaceRepository.save(workspace);
        return workspace.getId();
    }

    @Transactional
    public void renameWorkspace(Member member, Long workspaceId, String newName){
        Workspace workspace = workspaceRepository.findByIdWithMember(workspaceId).get();

        if(!workspace.getMember().getId().equals(member.getId())){
            throw new IllegalStateException("수정 권한이 없습니다.");
        }
        validateDuplicateWorkspace(newName, member);
        workspace.updateName(newName);
    }

    @Transactional
    public void deleteWorkspace(Member member, Long workspaceId){
        Workspace workspace = workspaceRepository.findByIdWithMember(workspaceId).get();

        if(!workspace.getMember().getId().equals(member.getId())){
            throw new IllegalStateException("삭제 권한이 없습니다.");
        }

        List<Workspace> list = workspaceRepository.findByMember(member);
        if (list.size() <= 1) {
            throw new IllegalStateException("최소 하나 이상의 워크스페이스가 필요합니다.");
        }

        workspaceRepository.delete(workspace);
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

    public List<Workspace> findByMember(Member member){
        return workspaceRepository.findByMember(member);
    }
}
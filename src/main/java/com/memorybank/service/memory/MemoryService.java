package com.memorybank.service.memory;

import com.memorybank.domain.Member;
import com.memorybank.domain.Memory;
import com.memorybank.domain.Workspace;
import com.memorybank.dto.memory.MemoryDto;
import com.memorybank.repository.MemoryRepository;
import com.memorybank.service.WorkspaceService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class MemoryService {
    private final MemoryRepository memoryRepository;
    private final WorkspaceService workspaceService;

    @Transactional
    public Long saveMemory(Member member, Long workspaceId, String content){
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);

        if(!workspace.getMember().getId().equals(member.getId())){
            throw new IllegalStateException("해당 워크스페이스에 대한 접근 권한이 없습니다.");
        }

        Memory memory = Memory.builder()
                .content(content)
                .workspace(workspace)
                .createdAt(LocalDateTime.now())
                .build();

        memoryRepository.save(memory);

        return memory.getId();
    }
}

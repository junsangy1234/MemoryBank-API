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

import java.util.List;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MemoryQueryService {

    private final MemoryRepository memoryRepository;
    private final WorkspaceService workspaceService;

    public List<MemoryDto> listMemory(Long workspaceId, Member member){
        Workspace workspace = workspaceService.findByIdWithMember(workspaceId);
        if (!workspace.getMember().getId().equals(member.getId())) {
            throw new IllegalStateException("해당 워크스페이스에 대한 접근 권한이 없습니다.");
        }

        List<Memory> memories = memoryRepository.findByWorkspace(workspaceService.findById(workspaceId));

        return memories.stream()
                .map(memory -> new MemoryDto(
                        memory.getId(),
                        memory.getContent(),
                        memory.getCreatedAt(),
                        memory.getWorkspace().getName()))
                .toList();
    }
}

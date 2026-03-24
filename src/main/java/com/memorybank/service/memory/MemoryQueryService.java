package com.memorybank.service.memory;

import com.memorybank.domain.Memory;
import com.memorybank.dto.memory.MemoryDto;
import com.memorybank.repository.MemoryRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MemoryQueryService {

    private final MemoryRepository memoryRepository;

    public List<MemoryDto> listMemory(){
        List<Memory> memories = memoryRepository.findAllWithWorkspace();

        return memories.stream()
                .map(memory -> new MemoryDto(
                        memory.getId(),
                        memory.getContent(),
                        memory.getCreatedAt(),
                        memory.getWorkspace().getName()))
                .toList();
    }
}

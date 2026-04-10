package com.memorybank.dto.memory;


public record FullSaveRequest(
        Long workspaceId,
        String rawContent,
        int estimatedCredits
){}

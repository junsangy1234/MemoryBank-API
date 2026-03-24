package com.memorybank.dto.memory;

import java.time.LocalDateTime;

public record MemoryDto (
    Long memoryId,
    String content,
    LocalDateTime createAt,
    String workspaceName
){}

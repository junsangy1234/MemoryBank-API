package com.memorybank.dto.memory;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.ToString;

import java.util.List;

public record SyncResponse(
        List<SyncMemoryDto> data,
        boolean hasMore,
        long remainingCount
) {}

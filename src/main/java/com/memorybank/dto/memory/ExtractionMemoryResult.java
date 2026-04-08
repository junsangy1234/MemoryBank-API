package com.memorybank.dto.memory;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public record ExtractionMemoryResult(
        @JsonProperty("memories") List<MemoryItem> memories
) {
    public record MemoryItem(
            @JsonProperty("summary") String summary
    ) {}
}
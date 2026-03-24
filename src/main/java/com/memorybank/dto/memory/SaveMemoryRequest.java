package com.memorybank.dto.memory;

import lombok.*;

@Getter
@ToString
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SaveMemoryRequest {
    private Long workspaceId;
    private String content;

    @Builder
    public SaveMemoryRequest(Long workspaceId, String content) {
        this.workspaceId = workspaceId;
        this.content = content;
    }
}

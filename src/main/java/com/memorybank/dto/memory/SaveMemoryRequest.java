package com.memorybank.dto.memory;

import lombok.*;

@Getter
@ToString
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SaveMemoryRequest {
    private Long workspaceId;
    private String content;
    String type; //FULL_CONV or SNIPPET

    @Builder
    public SaveMemoryRequest(Long workspaceId, String content, String type) {
        this.workspaceId = workspaceId;
        this.content = content;
        this.type = type;
    }
}

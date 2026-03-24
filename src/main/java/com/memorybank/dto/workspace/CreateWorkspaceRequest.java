package com.memorybank.dto.workspace;

import lombok.*;

@Getter
@ToString
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CreateWorkspaceRequest {
    private String name;

    @Builder
    public CreateWorkspaceRequest(String name) {
        this.name = name;
    }
}

package com.memorybank.dto.workspace;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.ToString;

@Getter
@AllArgsConstructor
@ToString
@EqualsAndHashCode
public class CreateWorkspaceResponse {
    private Long id;
    private String name;
}

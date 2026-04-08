package com.memorybank.dto.auth;

import com.memorybank.dto.workspace.WorkspaceDto;

import java.util.List;

public record LoginResponse(
        String apiKey,
        String email,
        String name,
        List<WorkspaceDto> workspaces,
        int dailyCredits
) {}
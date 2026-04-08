package com.memorybank.dto.auth;

// 2. 구글 서버가 우리 백엔드에 돌려주는 유저 정보
public record GoogleUserInfo(String email, String name) {}
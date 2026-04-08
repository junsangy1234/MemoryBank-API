package com.memorybank.dto.member;

//record: Getter, ToString, EqualsAndHashCode, 생성자
public record MemberDto (
    Long id,
    String email,
    String apiKey
){}

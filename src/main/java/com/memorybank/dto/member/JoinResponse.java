package com.memorybank.dto.member;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.ToString;

@Getter
@ToString
@EqualsAndHashCode
@AllArgsConstructor
public class JoinResponse {
    private Long id;
    private String email;
    private String apiKey;
}

package com.memorybank.dto.member;

import lombok.*;

@Getter
@ToString
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class JoinRequest {
    private String email;
    private String password;

    @Builder
    public JoinRequest(String email, String password) {
        this.email = email;
        this.password = password;
    }
}

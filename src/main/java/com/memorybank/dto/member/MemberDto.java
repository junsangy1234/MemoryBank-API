package com.memorybank.dto.member;

import com.memorybank.domain.Member;

//record: Getter, ToString, EqualsAndHashCode, 생성자
public record MemberDto (
    Long id,
    String email,
    String name,
    String apiKey,
    String role,
    int dailyCredits,
    boolean hasStarterPack
){
    public static MemberDto from(Member member){
        return new MemberDto(
                member.getId(),
                member.getEmail(),
                member.getName(),
                member.getApiKey(),
                member.getRole().name(), // Enum을 String으로 변환
                member.getDailyCredits(),
                member.isHasStarterPack()
        );
    }
}

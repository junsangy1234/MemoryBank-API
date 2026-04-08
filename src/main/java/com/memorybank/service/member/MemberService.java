package com.memorybank.service.member;

import com.memorybank.domain.Member;
import com.memorybank.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class MemberService {

    private final MemberRepository memberRepository;

    @Transactional
    public Long join(String email, String name) {

        validateDuplicateMember(email);

        Member member = Member.builder()
                .email(email)
                .name(name)
                .build();

        member.generateApiKey();

        memberRepository.save(member);
        return member.getId();
    }

    private void validateDuplicateMember(String email) {
        memberRepository.findByEmail(email).ifPresent(m -> {
            throw new IllegalStateException("이미 존재하는 이메일입니다.");
        });
    }

    public Member findById(Long memberId) {
        return memberRepository.findOne(memberId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 회원입니다. ID=" + memberId));
    }

    public Member findByApiKey(String apiKey) {
        return memberRepository.findByApiKey(apiKey)
                .orElseThrow(() -> new IllegalArgumentException("유효하지 않은 API Key입니다."));
    }

    // AuthService에서 가입 여부를 확인하기 위해 쓸 메서드
    public Optional<Member> findOptionalByEmail(String email) {
        return memberRepository.findByEmail(email);
    }
}
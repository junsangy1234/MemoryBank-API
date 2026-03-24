package com.memorybank.service.member;

import com.memorybank.domain.Member;
import com.memorybank.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class MemberService {

    private final MemberRepository memberRepository;

    @Transactional
    public Long join(String email, String password) {

        validateDuplicateMember(email);

        Member member = Member.builder()
                .email(email)
                .password(password)
                .build();

        member.generateApiKey();

        memberRepository.save(member);
        return member.getId();
    }

    private void validateDuplicateMember(String email) {
        List<Member> findMembers = memberRepository.findByEmail(email);
        if (!findMembers.isEmpty()) {
            throw new IllegalStateException("이미 존재하는 이메일입니다.");
        }
    }

    public Member findById(Long memberId) {
        return memberRepository.findOne(memberId)
                .orElseThrow(() -> new IllegalArgumentException("존재하지 않는 회원입니다. ID=" + memberId));
    }

    public Member findByApiKey(String apiKey) {
        return memberRepository.findByApiKey(apiKey)
                .orElseThrow(() -> new IllegalArgumentException("유효하지 않은 API Key입니다."));
    }
}
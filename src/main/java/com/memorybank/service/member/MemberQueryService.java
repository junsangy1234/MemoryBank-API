package com.memorybank.service.member;

import com.memorybank.domain.Member;
import com.memorybank.dto.member.MemberDto;
import com.memorybank.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class MemberQueryService {
    private final MemberRepository memberRepository;

    public List<MemberDto> listMember(){
        List<Member> members = memberRepository.findAll();
        return members.stream()
                .map(m -> new MemberDto(m.getId(), m.getEmail(), m.getApiKey()))
                .toList();
    }
}

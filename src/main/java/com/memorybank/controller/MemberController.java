package com.memorybank.controller;

import com.memorybank.domain.Member;
import com.memorybank.dto.common.Result;
import com.memorybank.dto.member.JoinRequest;
import com.memorybank.dto.member.JoinResponse;
import com.memorybank.dto.member.MemberDto;
import com.memorybank.service.member.MemberQueryService;
import com.memorybank.service.member.MemberService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/members")
@RequiredArgsConstructor
public class MemberController {
    private final MemberService memberService;
    private final MemberQueryService memberQueryService;

    @PostMapping("/join")
    public JoinResponse join(@RequestBody JoinRequest request){
        Long memberId = memberService.join(request.getEmail(), request.getPassword());
        Member member = memberService.findById(memberId);

        return new JoinResponse(member.getId(), member.getEmail(), member.getApiKey());
    }

    @GetMapping("/list")
    public Result listMember(){
        List<MemberDto> collect = memberQueryService.listMember();

        return new Result(collect.size(), collect);
    }
}

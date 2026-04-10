package com.memorybank.service.auth;

import com.memorybank.domain.Member;
import com.memorybank.domain.Workspace;
import com.memorybank.dto.auth.GoogleLoginRequest;
import com.memorybank.dto.auth.GoogleUserInfo;
import com.memorybank.dto.auth.LoginResponse;
import com.memorybank.dto.workspace.WorkspaceDto;
import com.memorybank.service.WorkspaceService;
import com.memorybank.service.member.MemberService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import org.springframework.http.HttpHeaders;

import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AuthService {
    private final MemberService memberService;
    private final WorkspaceService workspaceService;
    private final RestTemplate restTemplate = new RestTemplate();

    @Transactional
    public LoginResponse googleLogin(GoogleLoginRequest request) {
        String googleUserInfoUrl = "https://www.googleapis.com/oauth2/v3/userinfo";

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(request.accessToken());
        HttpEntity<String> entity = new HttpEntity<>(headers);

        ResponseEntity<GoogleUserInfo> response = restTemplate.exchange(
                googleUserInfoUrl,
                HttpMethod.GET,
                entity,
                GoogleUserInfo.class
        );

        GoogleUserInfo userInfo = response.getBody();
        if(userInfo == null || userInfo.email() == null){
            throw new IllegalArgumentException("구글 인증에 실패했습니다.");
        }

        Optional<Member> optionalMember = memberService.findOptionalByEmail(userInfo.email());
        Member member;

        if(optionalMember.isPresent()) {
            member = optionalMember.get();
        }else{
            Long memberId = memberService.join(userInfo.email(), userInfo.name());
            member = memberService.findById(memberId);
        }

        // 날짜가 지났다면 로그인 시점에 크레딧을 가득 채워줍니다!
        member.resetCreditsIfNeeded();

        List<Workspace> workspaces = workspaceService.findByMember(member);
        if (workspaces.isEmpty()) {
            Long defaultId = workspaceService.createWorkspace(member, "default_workspace");
            workspaces = List.of(workspaceService.findById(defaultId));
        }

        List<WorkspaceDto> workspaceDtos = workspaces.stream()
                .map(w -> new WorkspaceDto(w.getId(), w.getName()))
                .toList();

        return new LoginResponse(member.getApiKey(), member.getEmail(), member.getName(), member.getDailyCredits(), member.getRole().name(),workspaceDtos );
    }
}
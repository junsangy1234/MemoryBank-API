package com.memorybank.controller;

import com.memorybank.domain.Member;
import com.memorybank.domain.Role;
import com.memorybank.service.PaymentService;
import com.memorybank.service.member.MemberService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/billing")
@RequiredArgsConstructor
public class PaymentController {
    private final MemberService memberService;
    private final PaymentService paymentService;

    // 결제 성공 후 등급 업그레이드 API
    @PostMapping("/upgrade")
    public ResponseEntity<String> upgradePlan(
            @RequestHeader("X-API-KEY") String apiKey,
            @RequestBody Map<String, String> request) {

        Member member = memberService.findByApiKey(apiKey);
        String plan = request.get("plan"); // "PRO" 또는 "PREMIUM"

        if ("PRO".equals(plan)) {
            member.upgradeRole(Role.PRO);
        } else if ("PREMIUM".equals(plan)) {
            member.upgradeRole(Role.PREMIUM);
        }

        return ResponseEntity.ok(plan + " 플랜으로 업그레이드가 완료되었습니다.");
    }

    // 광고 시청 완 후 번개 충전
    @PostMapping("/ad-reward")
    public ResponseEntity<Integer> rewardByAd(@RequestHeader("X-API-KEY") String apiKey) {
        Member member = memberService.findByApiKey(apiKey);

        // 광고 시청 보상으로 10 크레딧 추가
        member.addRewardCredits(10);

        return ResponseEntity.ok(member.getDailyCredits());
    }

    @PostMapping("/webhook")
    public ResponseEntity<String> handleLemonSqueezyWebhook(
            @RequestHeader("X-Signature") String signature, // 레몬스퀴지가 보낸 암호화 서명
            @RequestBody String rawBody // 서명 검증을 위해 가공되지 않은 날것의 JSON을 받음
    ) {
        paymentService.processWebhook(signature, rawBody);
        return ResponseEntity.ok("Webhook received successfully");
    }
}

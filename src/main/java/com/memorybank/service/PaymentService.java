package com.memorybank.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.memorybank.domain.Member;
import com.memorybank.domain.Role;
import com.memorybank.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

@Slf4j
@Service
@RequiredArgsConstructor
public class PaymentService {

    @Value("${lemon-squeezy.webhook-secret}")
    private String webhookSecret;

    private final MemberRepository memberRepository;
    private final ObjectMapper objectMapper;

    @Transactional
    public void processWebhook(String signature, String rawBody) {
        // 1. 보안 검증: 레몬 스퀴지가 보낸 게 맞는지 확인 (해킹 방지)
        verifySignature(signature, rawBody);

        try {
            // 2. JSON 파싱
            JsonNode rootNode = objectMapper.readTree(rawBody);
            String eventName = rootNode.path("meta").path("event_name").asText();

            // 3. '결제 완료(order_created)' 이벤트일 때만 로직 실행
            if ("order_created".equals(eventName)) {

                // 프론트엔드에서 결제창 띄울 때 심어둔 커스텀 데이터(유저 ID) 꺼내기
                JsonNode customData = rootNode.path("data").path("custom_data");
                Long memberId = customData.path("member_id").asLong();

                // 4. 등급 업그레이드 (더티 체킹 발동!)
                Member member = memberRepository.findById(memberId)
                        .orElseThrow(() -> new IllegalArgumentException("회원을 찾을 수 없습니다."));

                member.upgradeRole(Role.PREMIUM);
                log.info("💳 회원 ID {} Premium 결제 및 업그레이드 완료!", memberId);
            }
        } catch (Exception e) {
            log.error("웹훅 JSON 파싱 중 오류 발생", e);
            throw new RuntimeException("웹훅 처리 실패");
        }
    }

    // ================= [서명 검증 암호화 로직] =================
    private void verifySignature(String signature, String rawBody) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secretKeySpec = new SecretKeySpec(webhookSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            mac.init(secretKeySpec);

            byte[] hash = mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8));

            // 바이트 배열을 16진수 문자열로 변환
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            String expectedSignature = hexString.toString();

            // 서명이 다르면 즉시 에러 발생시켜서 로직 차단
            if (!expectedSignature.equals(signature)) {
                log.error("웹훅 서명 불일치! 해킹 시도가 의심됩니다.");
                throw new SecurityException("Invalid webhook signature");
            }
        } catch (Exception e) {
            throw new SecurityException("서명 검증 과정에서 오류 발생", e);
        }
    }
}
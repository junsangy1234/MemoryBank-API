package com.memorybank.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.memorybank.domain.Member;
import com.memorybank.domain.Role;
import com.memorybank.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

@Slf4j
@Service
@RequiredArgsConstructor
public class PaymentService {

    @Value("${lemon-squeezy.webhook-secret}")
    private String webhookSecret;

    @Value("${lemon-squeezy.api-key}")
    private String lemonSqueezyApiKey;

    private final MemberRepository memberRepository;
    private final ObjectMapper objectMapper;

    // 🌟 레몬스퀴지 대시보드에서 생성한 Product ID (실제 ID로 변경 필요)
    private static final String PRODUCT_ID_STARTER = "1018424";
    private static final String PRODUCT_ID_LITE = "1018429";
    private static final String PRODUCT_ID_PRO = "1018439";
    private static final String PRODUCT_ID_PREMIUM = "1018443";

    @Transactional
    public void processWebhook(String signature, String rawBody) {
        // 1. 보안 검증: 레몬 스퀴지가 보낸 게 맞는지 확인 (해킹 방지)
        verifySignature(signature, rawBody);

        try {
            // 2. JSON 파싱
            JsonNode rootNode = objectMapper.readTree(rawBody);
            String eventName = rootNode.path("meta").path("event_name").asText();

            // 프론트엔드 URL 파라미터에서 넘어온 user_email을 커스텀 데이터에서 추출
            JsonNode customData = rootNode.path("meta").path("custom_data");
            String userEmail = customData.path("user_email").asText();

            // 결제한 상품 ID (어떤 요금제를 샀는지 식별)
            String productId = rootNode.path("data").path("attributes").path("first_order_item").path("product_id").asText();

            Member member = memberRepository.findByEmail(userEmail)
                    .orElseThrow(() -> new IllegalArgumentException("회원을 찾을 수 없습니다. Email: " + userEmail));

            // 1. 일회성 상품 결제 (스타터팩)
            if ("order_created".equals(eventName) && PRODUCT_ID_STARTER.equals(productId)) {
                member.unlockStarterPack(); // 평생 해금 + 100 크레딧 즉시 지급
                log.info("회원 ID {} 스타터팩 결제 완료! (전체스캔 해금)", member.getId());
                return;
            }
            // 3. 이벤트 종류에 따른 분기 처리 (구독 결제/수정 vs 구독 취소/만료)
            if ("subscription_created".equals(eventName) || "subscription_updated".equals(eventName) || "order_created".equals(eventName)) {

                // 상품 ID에 따라 등급 및 일일 크레딧 업데이트
                if (PRODUCT_ID_LITE.equals(productId)) {
                    member.upgradeRole(Role.LITE);
                } else if (PRODUCT_ID_PRO.equals(productId)) {
                    member.upgradeRole(Role.PRO);
                } else if (PRODUCT_ID_PREMIUM.equals(productId)) {
                    member.upgradeRole(Role.PREMIUM);
                }
                log.info("회원 ID {} 결제 및 업그레이드 완료! 상품ID: {}", member.getId(), productId);

            } else if ("subscription_cancelled".equals(eventName)) {
                // [수정 핵심 1] 구독 취소 버튼을 누른 상태 (결제 만료일까지 혜택 유지)
                // 유저의 Role을 건드리지 않고, 운영자 확인용 로그만 남겨둡니다.
                log.info("⚠️ 회원 ID {} 구독 취소 예약 (결제일 만료 전까지 기존 혜택 유지)", member.getId());

            } else if ("subscription_expired".equals(eventName)) {
                // FREE로 변경.
                member.resetRole();
                log.info("💔 회원 ID {} 구독 완전히 만료됨 (FREE 강등 완료)", member.getId());
            } else if ("order_refunded".equals(eventName) || "subscription_payment_refunded".equals(eventName)) {

                if (PRODUCT_ID_STARTER.equals(productId)) {
                    // 스타터팩 환불: 영구 소장 권한 회수 (Member 엔티티에 lockStarterPack 메서드가 없다면 만들어주세요!)
                    member.lockStarterPack();
                    log.info("💸 회원 ID {} 스타터팩 환불 완료 (권한 회수)", member.getId());
                } else {
                    // 구독 환불: 즉시 FREE로 강등
                    member.resetRole();
                    log.info("💸 회원 ID {} 구독 환불 완료 (FREE 강등)", member.getId());
                }
            } else {
                log.info("무시되는 웹훅 이벤트입니다: {}", eventName);
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

    // ================= [고객 포털 URL 조회 로직] =================
    public String getCustomerPortalUrl(Member member) {
        // 1. 회원의 이메일을 기반으로 Lemon Squeezy Customer ID 조회
        String customerId = getLemonSqueezyCustomerId(member.getEmail());
        if (customerId == null) {
            return null; // 결제 기록(고객 정보)이 없는 경우
        }

        // 2. Customer ID로 고객 정보(포털 URL 포함) 재요청
        try {
            org.springframework.web.client.RestTemplate restTemplate = new org.springframework.web.client.RestTemplate();
            org.springframework.http.HttpHeaders headers = new org.springframework.http.HttpHeaders();
            headers.set("Accept", "application/vnd.api+json");
            headers.set("Authorization", "Bearer " + lemonSqueezyApiKey);

            org.springframework.http.HttpEntity<String> entity = new org.springframework.http.HttpEntity<>(headers);

            org.springframework.http.ResponseEntity<String> response = restTemplate.exchange(
                    "https://api.lemonsqueezy.com/v1/customers/" + customerId,
                    org.springframework.http.HttpMethod.GET,
                    entity,
                    String.class
            );

            // 3. JSON 응답에서 customer_portal URL 추출
            JsonNode rootNode = objectMapper.readTree(response.getBody());
            String portalUrl = rootNode.path("data").path("attributes").path("urls").path("customer_portal").asText();

            log.info("회원 ID {}의 결제 관리 포털 URL 발급 성공", member.getId());
            return portalUrl;

        } catch (Exception e) {
            log.error("Lemon Squeezy 고객 포털 URL 발급 실패 (Email: {})", member.getEmail(), e);
            return null;
        }
    }

    //이메일로 Lemon customer ID find
    public String getLemonSqueezyCustomerId(String email){
        try{
            RestTemplate restTemplate = new RestTemplate();
            HttpHeaders headers = new org.springframework.http.HttpHeaders();
            headers.set("Accept", "application/vnd.api+json");
            headers.set("Authorization", "Bearer " + lemonSqueezyApiKey);

            HttpEntity<String> entity = new HttpEntity<>(headers);

            // 이메일로 필터링하여 고객(Customer) 목록 조회
            org.springframework.http.ResponseEntity<String> response = restTemplate.exchange(
                    "https://api.lemonsqueezy.com/v1/customers?filter[email]=" + email,
                    org.springframework.http.HttpMethod.GET,
                    entity,
                    String.class
            );

            JsonNode rootNode = objectMapper.readTree(response.getBody());
            JsonNode dataArray = rootNode.path("data");

            //일치 고객 데이터 있으면 첫번째 고객 id 반환
            if(dataArray.isArray() && dataArray.size() > 0){
                return dataArray.get(0).path("id").asText();
            }
            return null;
        } catch (Exception e){
            log.error("Lemon Squeezy Customer ID 조회 실패 (Email: {})", email, e);
            return null;
        }
    }

}
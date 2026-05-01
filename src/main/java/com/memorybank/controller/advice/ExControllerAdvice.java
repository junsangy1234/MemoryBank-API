package com.memorybank.controller.advice;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

@Slf4j
@RestControllerAdvice
public class ExControllerAdvice {

    @Value("${DISCORD_WEBHOOK_URL}")
    private String discordWebhookUrl;

    //디스코드로 HTTP 요청을 보내기 위한 객체 추가
    private final RestTemplate restTemplate = new RestTemplate();

    // ==========================================
    // 1. 기존 에러 처리 (유저 실수 -> 디스코드 알림 안 보냄)
    // ==========================================
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<ErrorResult> illegalExHandler(IllegalStateException e) {
        if ("INSUFFICIENT_CREDITS".equals(e.getMessage())) {
            ErrorResult errorResult = new ErrorResult("PAYMENT_REQUIRED", "크레딧이 부족합니다. 광고를 시청하거나 업그레이드 해주세요.");
            return new ResponseEntity<>(errorResult, HttpStatus.PAYMENT_REQUIRED);
        }
        ErrorResult errorResult = new ErrorResult("BAD_REQUEST", e.getMessage());
        return new ResponseEntity<>(errorResult, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResult> illegalArgExHandler(IllegalArgumentException e) {
        ErrorResult errorResult = new ErrorResult("INVALID_ARGUMENT", e.getMessage());
        return new ResponseEntity<>(errorResult, HttpStatus.BAD_REQUEST);
    }

    // ==========================================
    // 2. 치명적인 서버 에러 처리 (디스코드 알림 발송!)
    // ==========================================
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResult> handleAllUncaughtException(Exception e) {
        // 1. 서버 도커 로그에는 아주 상세하게 빨간불 켜기
        log.error("🚨 [치명적 서버 에러 발생] ", e);

        // 2. 대표님 디스코드로 알림 쏘기!
        sendDiscordAlert(e.getMessage(), e.toString());

        // 3. 유저에게는 안전한 에러 메시지만 반환
        ErrorResult errorResult = new ErrorResult("INTERNAL_SERVER_ERROR", "서버 내부 오류가 발생했습니다. 관리자에게 알림이 전송되었습니다.");
        return new ResponseEntity<>(errorResult, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // ==========================================
    // 3. 디스코드 발송 헬퍼 메서드
    // ==========================================
    private void sendDiscordAlert(String errorMessage, String exceptionDetail) {
        // 로컬 환경 등 웹훅 주소가 없을 때는 무시
        if (discordWebhookUrl == null || discordWebhookUrl.isEmpty()) {
            return;
        }

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);

            Map<String, Object> body = new HashMap<>();
            String content = "🚨 **[AI Memory Bank 치명적 에러]** 🚨\n" +
                    "> **원인:** `" + errorMessage + "`\n" +
                    "```java\n" + exceptionDetail.substring(0, Math.min(exceptionDetail.length(), 1500)) + "\n```";
            body.put("content", content);

            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);
            restTemplate.postForEntity(discordWebhookUrl, entity, String.class);

        } catch (Exception ex) {
            log.error("디스코드 알림 전송 실패", ex);
        }
    }

    @Data
    @AllArgsConstructor
    static class ErrorResult {
        private String code;
        private String message;
    }
}
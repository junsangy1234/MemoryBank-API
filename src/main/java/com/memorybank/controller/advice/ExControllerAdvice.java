package com.memorybank.controller.advice;

import lombok.AllArgsConstructor;
import lombok.Data;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice // 모든 컨트롤러에서 발생하는 에러를 여기서 잡습니다.
public class ExControllerAdvice {

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<ErrorResult> illegalExHandler(IllegalStateException e) {
        // 크레딧 부족 에러인 경우 402 상태 코드 반환
        if ("INSUFFICIENT_CREDITS".equals(e.getMessage())) {
            ErrorResult errorResult = new ErrorResult("PAYMENT_REQUIRED", "크레딧이 부족합니다. 광고를 시청하거나 업그레이드 해주세요.");
            return new ResponseEntity<>(errorResult, HttpStatus.PAYMENT_REQUIRED);
        }

        // IllegalStateException이 발생하면 400(Bad Request) 에러와 메시지를 보냅니다.
        ErrorResult errorResult = new ErrorResult("BAD_REQUEST", e.getMessage());
        return new ResponseEntity<>(errorResult, HttpStatus.BAD_REQUEST);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResult> illegalArgExHandler(IllegalArgumentException e) {
        ErrorResult errorResult = new ErrorResult("INVALID_ARGUMENT", e.getMessage());
        return new ResponseEntity<>(errorResult, HttpStatus.BAD_REQUEST);
    }

    @Data
    @AllArgsConstructor
    static class ErrorResult {
        private String code;
        private String message;
    }
}
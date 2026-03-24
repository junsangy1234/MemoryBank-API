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
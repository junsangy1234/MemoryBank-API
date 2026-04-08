package com.memorybank.controller;

import com.memorybank.dto.auth.GoogleLoginRequest;
import com.memorybank.dto.auth.LoginResponse;
import com.memorybank.service.auth.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
@CrossOrigin(
        origins = "*",
        allowedHeaders = "*",
        methods = {RequestMethod.POST, RequestMethod.OPTIONS}
)
public class AuthController {
    private final AuthService authService;

    //로그인
    @PostMapping("/google")
    public ResponseEntity<LoginResponse> googleLogin(@RequestBody GoogleLoginRequest request){
        LoginResponse response = authService.googleLogin(request);
        return ResponseEntity.ok(response);
    }
}

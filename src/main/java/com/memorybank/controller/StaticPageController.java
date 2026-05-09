package com.memorybank.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class StaticPageController {

    // 1. 홈페이지 (소개 페이지)
    @GetMapping("/home")
    public String homePage() {
        return "home"; // home.html 연결
    }

    // 2. 개인정보처리방침
    @GetMapping("/privacy-policy")
    public String privacyPolicy() {
        return "privacy"; // privacy.html 연결
    }

    // 3. 서비스 약관
    @GetMapping("/terms-of-service")
    public String termsOfService() {
        return "terms"; // terms.html 연결
    }
}
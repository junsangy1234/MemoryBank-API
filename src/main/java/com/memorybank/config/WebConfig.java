package com.memorybank.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOriginPatterns("*") // 모든 주소 허용
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS") // OPTIONS 필수!
                .allowedHeaders("*")
                .exposedHeaders("Authorization", "X-API-KEY") // 브라우저가 읽을 수 있게 헤더 노출
                .allowCredentials(false); // 💡 true로 하면 보안상 "*"를 못 씁니다. false가 안전합니다!
    }
}
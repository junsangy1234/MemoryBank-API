package com.memorybank.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

@EnableAsync
@Configuration
public class AsyncConfig {

    @Bean(name = "fullSaveExecutor")
    public Executor threadPoolTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();

        // 🌟 1. 기본 바리스타 수 (평소에 대기하는 인원)
        executor.setCorePoolSize(2);

        // 🌟 2. 최대 바리스타 수 (주문이 아무리 밀려도 이 이상 고용 안 함!)
        executor.setMaxPoolSize(3);

        // 🌟 3. 대기열 크기 (주문표 100개까지는 큐에 쌓아둠)
        executor.setQueueCapacity(100);

        executor.setThreadNamePrefix("AI-Save-");
        executor.initialize();
        return executor;
    }
}
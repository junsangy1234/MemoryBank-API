package com.memorybank.config;

import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.StringRedisSerializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

@EnableCaching
@Configuration
public class CacheConfig {

    /**
     * 기본 캐시 설정
     * - TTL: 1시간 + 랜덤 0~10분 (Cache Stampede 방지)
     * - 직렬화: JSON 방식 (사람이 읽을 수 있는 형태로 Redis에 저장)
     */
    private RedisCacheConfiguration defaultCacheConfig() {
        // 1시간(3600초) + 랜덤 0~600초 추가 → 동시 만료 방지
        long ttlSeconds = 3600 + ThreadLocalRandom.current().nextInt(600);

        return RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofSeconds(ttlSeconds))
                // key는 문자열로 저장 ("member-by-apikey::abc-key" 형태)
                .serializeKeysWith(
                        RedisSerializationContext.SerializationPair
                                .fromSerializer(new StringRedisSerializer()))
                // value는 JSON으로 저장 (역직렬화 시 타입 정보 포함)
                .serializeValuesWith(
                        RedisSerializationContext.SerializationPair
                                .fromSerializer(new GenericJackson2JsonRedisSerializer(objectMapper())));
    }

    /**
     * 캐시별 TTL을 다르게 주고 싶을 때 여기서 설정
     *
     * member-by-apikey : 1시간  → API 요청마다 쓰이는 핵심 캐시
     * workspaces       : 30분   → 워크스페이스는 자주 바뀔 수 있으므로 짧게
     * workspace-by-id  : 1시간  → 단건 조회는 변경 빈도 낮음
     */
    @Bean
    public RedisCacheManager cacheManager(RedisConnectionFactory connectionFactory) {
        Map<String, RedisCacheConfiguration> cacheConfigurations = new HashMap<>();

        cacheConfigurations.put("member-by-apikey",
                defaultCacheConfig().entryTtl(Duration.ofHours(1)));

        cacheConfigurations.put("workspaces",
                defaultCacheConfig().entryTtl(Duration.ofMinutes(30)));

        cacheConfigurations.put("workspace-by-id",
                defaultCacheConfig().entryTtl(Duration.ofHours(1)));

        return RedisCacheManager.builder(connectionFactory)
                .cacheDefaults(defaultCacheConfig())    // 위 목록에 없는 캐시는 기본값 적용
                .withInitialCacheConfigurations(cacheConfigurations)
                .build();
    }

    private ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();

        // Java 8 날짜 타입 (LocalDate, LocalDateTime 등) 지원 추가
        mapper.registerModule(new JavaTimeModule());

        // 날짜를 타임스탬프 숫자가 아닌 문자열로 저장 ("2024-01-15" 형태)
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        // 역직렬화 시 타입 정보 포함 (없으면 꺼낼 때 타입 못 찾음)
        mapper.activateDefaultTyping(
                mapper.getPolymorphicTypeValidator(),
                ObjectMapper.DefaultTyping.NON_FINAL
        );

        return mapper;
    }
}
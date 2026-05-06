package com.memorybank.domain;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.pgvector.PGvector;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.jdbc.Work;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Memory {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "memory_id")
    private Long id;

    // Redis 직렬화 시 순환참조 방지용 (Memory → Workspace → Memory 무한루프)
    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "workspace_id")
    private Workspace workspace;

    @Column(columnDefinition = "TEXT")
    private String content;

    @JdbcTypeCode(SqlTypes.VECTOR)
    @Column(columnDefinition = "vector(1536)")
    private float[] vector;

    private LocalDateTime createdAt;

    @Builder
    public Memory(Workspace workspace, String content, float[] vector, LocalDateTime createdAt){
        this.workspace = workspace;
        this.content = content;
        this.vector = vector;
        this.createdAt = createdAt;
    }
}

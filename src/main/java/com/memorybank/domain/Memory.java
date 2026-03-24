package com.memorybank.domain;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.jdbc.Work;

import java.time.LocalDateTime;

@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Memory {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "memory_id")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "workspace_id")
    private Workspace workspace;

    @Column(columnDefinition = "TEXT")
    private String content;

    private String vector;
    private LocalDateTime createdAt;

    @Builder
    public Memory(Workspace workspace, String content, LocalDateTime createdAt){
        this.workspace = workspace;
        this.content = content;
        this.createdAt = createdAt;
    }
}

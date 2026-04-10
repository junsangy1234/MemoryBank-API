package com.memorybank.domain;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MemorySyncJob {
    @Id @GeneratedValue
    @Column(name = "sync_memory_id")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "workspace_id")
    private Workspace workspace;

    @Column(columnDefinition = "TEXT")
    private String rawContent;

    private int estimatedCredits;

    @Enumerated(EnumType.STRING)
    private SyncStatus status;

    private LocalDateTime createdAt;

    public static MemorySyncJob createPendingJob(Workspace workspace, String rawContent, int estimatedCredits) {
        MemorySyncJob job = new MemorySyncJob();
        job.workspace = workspace;
        job.rawContent = rawContent;
        job.estimatedCredits = estimatedCredits;
        job.status = SyncStatus.PENDING;
        job.createdAt = LocalDateTime.now();
        return job;
    }

    public void markAsCompleted() {
        this.status = SyncStatus.COMPLETED;
    }

    public void markAsFailed() {
        this.status = SyncStatus.FAILED;
    }
}

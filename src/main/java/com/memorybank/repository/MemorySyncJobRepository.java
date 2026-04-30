package com.memorybank.repository;

import com.memorybank.domain.MemorySyncJob;
import com.memorybank.domain.SyncStatus;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class MemorySyncJobRepository {
    private final EntityManager em;

    public MemorySyncJob save(MemorySyncJob memorySyncJob){
        if (memorySyncJob.getId() == null) {
            em.persist(memorySyncJob);
            return memorySyncJob;
        } else {
            return em.merge(memorySyncJob);
        }
    }

    public void saveAndFlush(MemorySyncJob memorySyncJob) {
        if (memorySyncJob.getId() == null) {
            em.persist(memorySyncJob);
        } else {
            em.merge(memorySyncJob);
        }
        em.flush();
    }

    public Optional<MemorySyncJob> findByIdWithMember(Long jobId){
        return em.createQuery("SELECT j FROM MemorySyncJob j"
                        + " JOIN FETCH j.workspace w"
                        + " JOIN FETCH w.member"
                        + " WHERE j.id = :id", MemorySyncJob.class)
                .setParameter("id", jobId)
                .getResultList()
                .stream().findFirst();
    }

    // 좀비 작업(1시간 이상 PENDING 상태인 작업) 조회 메서드
    public List<MemorySyncJob> findZombieJobs(SyncStatus status, LocalDateTime beforeTime) {
        return em.createQuery("SELECT j FROM MemorySyncJob j"
                        + " JOIN FETCH j.workspace w"
                        + " JOIN FETCH w.member"
                        + " WHERE j.status = :status AND j.createdAt < :beforeTime", MemorySyncJob.class)
                .setParameter("status", status)
                .setParameter("beforeTime", beforeTime)
                .getResultList();
    }

    // 워크스페이스 ID와 상태로 조회 (기존 작업 취소용)
    public List<MemorySyncJob> findByWorkspaceIdAndStatus(Long workspaceId, SyncStatus status) {
        return em.createQuery("SELECT m FROM MemorySyncJob m " +
                                "WHERE m.workspace.id = :workspaceId AND m.status = :status", MemorySyncJob.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("status", status)
                .getResultList();
    }

}

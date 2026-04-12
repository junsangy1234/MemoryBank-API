package com.memorybank.repository;

import com.memorybank.domain.MemorySyncJob;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class MemorySyncJobRepository {
    private final EntityManager em;

    public void save(MemorySyncJob memorySyncJob){
        em.persist(memorySyncJob);
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
}

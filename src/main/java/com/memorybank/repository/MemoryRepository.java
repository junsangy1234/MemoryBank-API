package com.memorybank.repository;

import com.memorybank.domain.Memory;
import com.memorybank.domain.Workspace;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class MemoryRepository {
    private final EntityManager em;

    public void save(Memory memory){
        em.persist(memory);
    }

    public List<Memory> findAllWithWorkspace() {
        return em.createQuery("select m from Memory m" +
                        " join fetch m.workspace w", Memory.class)
                .getResultList();
    }

    public Optional<Memory> findOne(Long id){
        return Optional.ofNullable(em.find(Memory.class, id));
    }

    public List<Memory> findByWorkspace(Workspace workspace){
        return em.createQuery("SELECT m FROM Memory m WHERE m.workspace = :workspace", Memory.class)
                .setParameter("workspace", workspace)
                .getResultList();
    }
}

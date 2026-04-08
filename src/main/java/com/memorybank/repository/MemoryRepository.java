package com.memorybank.repository;

import com.memorybank.domain.Memory;
import com.memorybank.domain.Workspace;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.awt.print.Pageable;
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

    public List<Memory> findTopKSimilarMemories(Long workspaceId, float[] questionVector, int topK,float threshold) {
        return em.createQuery(
                        "SELECT m FROM Memory m " +
                                "WHERE m.workspace.id = :workspaceId " +
                                "AND cosine_distance(m.vector, :vector) < :threshold " + //정확도 설정
                                "ORDER BY cosine_distance(m.vector, :vector)", Memory.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("vector", questionVector)
                .setParameter("threshold", threshold)
                .setMaxResults(topK) // 상위 K개만 가져오도록 제한
                .getResultList();
    }

    public List<Memory> findMemoriesForSync(Long workspaceId, Long lastId, int limit) {
        return em.createQuery(
                        "SELECT m FROM Memory m WHERE m.workspace.id = :workspaceId AND m.id > :lastId ORDER BY m.id ASC", Memory.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("lastId", lastId)
                .setMaxResults(limit) // 여기서 limit 개수만큼만 딱 잘라서 가져옵니다.
                .getResultList();
    }

    // 2. lastId 이후에 남은 전체 데이터 개수 세기
    public long countRemainingMemories(Long workspaceId, Long lastId) {
        return em.createQuery(
                        "SELECT COUNT(m) FROM Memory m WHERE m.workspace.id = :workspaceId AND m.id > :lastId", Long.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("lastId", lastId)
                .getSingleResult();
    }

    public void debugDistances(Long workspaceId, float[] questionVector) {
        List<Object[]> results = em.createQuery(
                        "SELECT m.content, cosine_distance(m.vector, :vector) " +
                                "FROM Memory m " +
                                "WHERE m.workspace.id = :workspaceId " +
                                "ORDER BY cosine_distance(m.vector, :vector) ASC", Object[].class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("vector", questionVector)
                .getResultList();

        System.out.println("========== [벡터 거리 측정 결과] ==========");
        for (Object[] row : results) {
            String content = (String) row[0];
            Double distance = (Double) row[1];
            // 내용이 너무 길면 잘라서 출력
            String shortContent = content.length() > 20 ? content.substring(0, 20) + "..." : content;
            System.out.printf("거리: %.4f | 내용: %s%n", distance, shortContent);
        }
        System.out.println("===========================================");
    }
}

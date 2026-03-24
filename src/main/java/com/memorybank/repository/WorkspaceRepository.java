package com.memorybank.repository;

import com.memorybank.domain.Member;
import com.memorybank.domain.Workspace;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
@RequiredArgsConstructor
public class WorkspaceRepository {
    private final EntityManager em;

    public void save(Workspace workspace){
        em.persist(workspace);
    }

    public List<Workspace> findAll(){
        return em.createQuery("SELECT w FROM Workspace w", Workspace.class).getResultList();
    }


    public Optional<Workspace> findOne(Long id){
        return Optional.ofNullable(em.find(Workspace.class,id));
    }

    public Optional<Workspace> findByIdWithMember(Long id){
        return em.createQuery("SELECT w FROM Workspace w"
                + " JOIN FETCH w.member m"
                + " WHERE w.id = :id", Workspace.class)
                .setParameter("id", id)
                .getResultList().stream().findFirst();
    }

    public List<Workspace> findByName(String name){
        return em.createQuery("SELECT w FROM Workspace w WHERE w.name = :name", Workspace.class)
                .setParameter("name", name)
                .getResultList();
    }

    public List<Workspace> findByNameAndMember(String name, Member member){
        return em.createQuery("SELECT w FROM Workspace w WHERE w.name = :name AND w.member = :member",Workspace.class)
                .setParameter("name", name)
                .setParameter("member", member)
                .getResultList();
    }

}

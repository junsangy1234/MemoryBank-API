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
public class MemberRepository {
    private final EntityManager em;

    public void save(Member member){
        if(member.getId() == null){
            em.persist(member);
        }else{
            em.merge(member);
        }
    }

    public Optional<Member> findOne(Long id){
        return Optional.ofNullable(em.find(Member.class, id));
    }

    public List<Member> findAll(){
        return em.createQuery("SELECT m FROM Member m", Member.class).getResultList();
    }

    public Optional<Member> findById(long memberId){
        return em.createQuery("SELECT m FROM Member m WHERE m.id = :memberId",Member.class)
                .setParameter("memberId", memberId)
                .getResultList()
                .stream().findFirst();
    }

    public Optional<Member> findByEmail(String email){
        return em.createQuery("SELECT m FROM Member m WHERE m.email = :email",Member.class)
                .setParameter("email", email)
                .getResultList()
                .stream().findFirst();
    }

    public Optional<Member> findByApiKey(String apiKey){
        return em.createQuery("SELECT m FROM Member m WHERE m.apiKey = :apiKey",Member.class)
                .setParameter("apiKey", apiKey)
                .getResultList()
                .stream().findFirst();
    }
}

package com.memorybank.domain;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Member {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "member_id")
    private Long id;

    @OneToMany(mappedBy = "member")
    private List<Workspace> workspaces = new ArrayList<>();

    @Column(nullable = false, unique = true)
    private String email;

    private String password;

    @Column(unique = true)
    private String apiKey;

    @Builder
    public Member(String email, String password, String apiKey){
        this.email = email;
        this.password = password;
        this.apiKey = apiKey;
    }

    public void generateApiKey(){
        this.apiKey = UUID.randomUUID().toString();
    }
}

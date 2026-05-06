package com.memorybank.domain;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Entity
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Workspace {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "workspace_id")
    private Long id;

    @Column(nullable = false)
    private String name;

    // Redis 직렬화 시 순환참조 방지용 (Workspace → Member → Workspace 무한루프)
    @JsonIgnore
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "member_id")
    private Member member;

    // Redis 직렬화 시 Lazy Loading 오류 방지용
    @JsonIgnore
    @OneToMany(mappedBy = "workspace", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Memory> memories = new ArrayList<>();

    @Builder
    public Workspace(String name, Member member) {
        this.name = name;
        this.member = member;
    }

    public void updateName(String newName) {
        this.name = newName;
    }
}

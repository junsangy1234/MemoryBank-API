package com.memorybank.domain;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;
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

    private String name;

    @Column(unique = true)
    private String apiKey;

    @Enumerated(EnumType.STRING)
    private Role role = Role.FREE;

    @Column(nullable = false, columnDefinition = "boolean default false")
    private boolean hasStarterPack = false;

    private int dailyCredits = 20; //기본 크레딧

    private LocalDate lastCreditResetDate = LocalDate.now();

    public void generateApiKey(){
        this.apiKey = UUID.randomUUID().toString();
    }

    @Builder
    public Member(String email, String name, String apiKey){
        this.email = email;
        this.apiKey = apiKey;
        this.name = name;
    }
    //===========
    //비지니스 로직

    //날짜 바뀌면 크레딧 초기화
    public void resetCreditsIfNeeded(){
        LocalDate today = LocalDate.now();
        if(this.lastCreditResetDate == null || this.lastCreditResetDate.isBefore(today)){
            this.lastCreditResetDate = today;

            //등급에 따라 리셋
            if(this.role == Role.FREE) this.dailyCredits = 20;
            else if(this.role == Role.LITE) this.dailyCredits = 100;
            else if(this.role == Role.PRO) this.dailyCredits = 500;
            else if(this.role == Role.PREMIUM) this.dailyCredits = 2000;
        }
    }

    //크레딧 사용(저장: 3, 검색: 1)
    public void useCredit(int amount){
        resetCreditsIfNeeded();

        if(this.dailyCredits < amount){
            throw new IllegalStateException("INSUFFICIENT_CREDITS");
        }

        this.dailyCredits -= amount;
    }

    //광고 시청 완료시 크레딧 보상
    public void addRewardCredits(int amount){
        this.dailyCredits += amount;
    }

    public void unlockStarterPack() {
        this.hasStarterPack = true; // 전체스캔 평생 해금
        this.dailyCredits += 100;   // 1회성 100 크레딧 보너스 충전
    }

    public void upgradeRole(Role newRole) {
        this.role = newRole;
        // 등급 업그레이드 즉시 해당 등급의 최대 크레딧으로 충전
        if (newRole == Role.LITE) this.dailyCredits = 100;
        else if (newRole == Role.PRO) this.dailyCredits = 500;
        else if (newRole == Role.PREMIUM) this.dailyCredits = 2000;
        this.lastCreditResetDate = LocalDate.now();
    }
}

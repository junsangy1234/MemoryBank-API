package com.memorybank.domain;

public enum SyncStatus {
    PENDING,    // 🟡 데이터만 긁어온 상태 (결제/AI 전)
    COMPLETED,  // 🟢 결제 및 AI 요약까지 완벽하게 끝난 상태
    FAILED      // 🔴 처리 중 에러 발생 (재시도 필요)
}

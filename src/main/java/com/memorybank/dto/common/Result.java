package com.memorybank.dto.common;

import lombok.*;

@Getter
@ToString
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Result<T>{
    private int count;
    private T data;

    @Builder
    public Result(int count, T data) {
        this.count = count;
        this.data = data;
    }
}
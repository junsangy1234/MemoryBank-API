package com.memorybank.dto.memory;


import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.ToString;

@Getter
@ToString
@AllArgsConstructor
@EqualsAndHashCode
public class SaveMemoryResponse {
    private Long id;
    private String message;
}

package com.memorybank.dto.memory;


import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.ToString;

import java.util.List;

@Getter
@ToString
@AllArgsConstructor
@EqualsAndHashCode
public class SaveMemoryResponse {
    private List<Long> id;
    private String message;
}

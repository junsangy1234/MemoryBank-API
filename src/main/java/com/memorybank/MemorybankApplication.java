package com.memorybank;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootApplication
public class MemorybankApplication {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	public static void main(String[] args) {
		SpringApplication.run(MemorybankApplication.class, args);
	}

	@PostConstruct
	public void initVectorExtension() {
		jdbcTemplate.execute("CREATE EXTENSION IF NOT EXISTS vector;");
	}
}
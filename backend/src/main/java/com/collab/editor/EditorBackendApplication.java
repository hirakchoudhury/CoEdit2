package com.collab.editor;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class EditorBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(EditorBackendApplication.class, args);
    }
}

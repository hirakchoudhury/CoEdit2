package com.collab.editor.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConfigurationProperties(prefix = "app")
@Getter
@Setter
public class AppProperties {

    private Jwt jwt = new Jwt();
    private Snapshot snapshot = new Snapshot();

    @Getter
    @Setter
    public static class Jwt {
        private String secret = "default-secret-change-in-production";
        private long expirationMs = 86400000L;
    }

    @Getter
    @Setter
    public static class Snapshot {
        private int updatesThreshold = 50;
        private int intervalSeconds = 60;
    }
}

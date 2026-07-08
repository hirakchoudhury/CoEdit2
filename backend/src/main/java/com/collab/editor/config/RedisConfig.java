package com.collab.editor.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.RedisSerializer;

/**
 * Redis config: Pub/Sub for multi-instance WebSocket relay, and presence storage.
 * DESIGN: Redis for online users per document and Pub/Sub for multi-instance sync.
 */
@Configuration
public class RedisConfig {

    public static final String DOCUMENT_UPDATES_CHANNEL_PREFIX = "doc:updates:";
    public static final String PRESENCE_KEY_PREFIX = "presence:doc:";

    @Bean
    public RedisTemplate<String, byte[]> binaryRedisTemplate(RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, byte[]> t = new RedisTemplate<>();
        t.setConnectionFactory(connectionFactory);
        t.setKeySerializer(RedisSerializer.string());
        t.setValueSerializer(RedisSerializer.byteArray());
        t.setHashKeySerializer(RedisSerializer.string());
        t.setHashValueSerializer(RedisSerializer.byteArray());
        t.afterPropertiesSet();
        return t;
    }

}

package com.collab.editor.collab;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * Publish CRDT updates to Redis so other backend instances can relay to their WebSocket clients.
 * DESIGN: Pub/Sub for multi-instance sync.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class RedisDocumentUpdatePublisher {

    public static final String CHANNEL_PREFIX = "doc:updates:";

    private final RedisTemplate<String, String> stringRedisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public void publish(String documentId, byte[] payload, String senderId) {
        try {
            Map<String, Object> msg = new HashMap<>();
            msg.put("documentId", documentId);
            msg.put("payload", Base64.getEncoder().encodeToString(payload));
            msg.put("senderId", senderId);
            String json = objectMapper.writeValueAsString(msg);
            stringRedisTemplate.convertAndSend("doc:updates", json);
        } catch (JsonProcessingException e) {
            log.warn("Failed to publish update: {}", e.getMessage());
        }
    }
}

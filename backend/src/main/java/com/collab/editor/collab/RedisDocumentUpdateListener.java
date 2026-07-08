package com.collab.editor.collab;

import com.collab.editor.websocket.CollabWebSocketHandler;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.util.Base64;
import java.util.Map;

@Component
@RequiredArgsConstructor
@Slf4j
public class RedisDocumentUpdateListener implements MessageListener {

    private final RedisMessageListenerContainer redisMessageListenerContainer;
    private final CollabWebSocketHandler collabWebSocketHandler;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @PostConstruct
    public void subscribe() {
        redisMessageListenerContainer.addMessageListener(this, new ChannelTopic("doc:updates"));
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            String body = new String(message.getBody());
            @SuppressWarnings("unchecked")
            Map<String, Object> msg = objectMapper.readValue(body, Map.class);
            String documentId = (String) msg.get("documentId");
            String payloadB64 = (String) msg.get("payload");
            String senderId = (String) msg.get("senderId");
            if (documentId == null || payloadB64 == null) return;
            byte[] payload = Base64.getDecoder().decode(payloadB64);
            collabWebSocketHandler.onRedisUpdate(documentId, payload, senderId);
        } catch (Exception e) {
            log.warn("Redis update message parse failed: {}", e.getMessage());
        }
    }
}

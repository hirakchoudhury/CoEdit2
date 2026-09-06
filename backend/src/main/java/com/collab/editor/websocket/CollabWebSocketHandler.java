package com.collab.editor.websocket;

import com.collab.editor.collab.*;
import com.collab.editor.collab.RedisDocumentUpdatePublisher;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * WebSocket handler: document room subscription, CRDT update relay, presence broadcast.
 * DESIGN: Backend never merges document content; only relays binary CRDT updates.
 */
@Component
@Slf4j
public class CollabWebSocketHandler extends TextWebSocketHandler {

    private final PresenceService presenceService;
    private final RedisDocumentUpdatePublisher redisPublisher;
    private final ObjectMapper objectMapper = new ObjectMapper();

    // documentId -> list of sessions (this instance only; Redis Pub/Sub syncs across instances)
    private final Map<String, List<WebSocketSession>> documentSessions = new ConcurrentHashMap<>();

    public CollabWebSocketHandler(PresenceService presenceService, RedisDocumentUpdatePublisher redisPublisher) {
        this.presenceService = presenceService;
        this.redisPublisher = redisPublisher;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        WsSessionPrincipal principal = getPrincipal(session);
        if (principal == null) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        String docId = principal.documentId().toString();
        documentSessions.computeIfAbsent(docId, k -> new java.util.concurrent.CopyOnWriteArrayList<>()).add(session);

        presenceService.join(docId, principal.userId(), principal.userEmail());
        broadcastPresence(docId, PresenceMessage.Type.JOIN, principal.userId(), principal.userEmail(), null);
        sendCurrentPresence(session, docId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        WsSessionPrincipal principal = getPrincipal(session);
        if (principal == null) return;
        String docId = principal.documentId().toString();

        String payload = message.getPayload();
        try {
            Map<?, ?> msg = objectMapper.readValue(payload, Map.class);
            String type = (String) msg.get("type");
            if ("cursor".equals(type)) {
                Object index = msg.get("index");
                Object length = msg.get("length");
                CursorPosition cursor = new CursorPosition(
                        index != null ? ((Number) index).intValue() : 0,
                        length != null ? ((Number) length).intValue() : 0
                );
                presenceService.updateCursor(docId, principal.userId(), cursor);
                broadcastPresence(docId, PresenceMessage.Type.CURSOR, principal.userId(), principal.userEmail(), cursor);
            }
        } catch (Exception e) {
            log.trace("Non-JSON or unknown text message: {}", e.getMessage());
        }
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
        WsSessionPrincipal principal = getPrincipal(session);
        if (principal == null) return;
        String docId = principal.documentId().toString();
        try {
            // BinaryMessage payload is a ByteBuffer; array() is not safe (may include extra bytes or be unsupported).
            var buf = message.getPayload();
            byte[] payload = new byte[buf.remaining()];
            buf.get(payload);

            redisPublisher.publish(docId, payload, principal.userId().toString());
            broadcastCrdtToPeers(docId, payload, principal.userId().toString(), session);
        } catch (Exception e) {
            log.warn("Failed to handle binary CRDT update for doc {}: {}", docId, e.getMessage());
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        WsSessionPrincipal principal = getPrincipal(session);
        if (principal == null) return;
        String docId = principal.documentId().toString();

        List<WebSocketSession> list = documentSessions.get(docId);
        if (list != null) {
            list.remove(session);
            if (list.isEmpty()) documentSessions.remove(docId);
        }
        presenceService.leave(docId, principal.userId());
        broadcastPresence(docId, PresenceMessage.Type.LEAVE, principal.userId(), principal.userEmail(), null);
    }

    /**
     * Called when Redis delivers an update that originated on ANOTHER instance.
     * Updates from this instance are filtered out in RedisDocumentUpdateListener,
     * because handleBinaryMessage already relayed them to local peers.
     */
    public void onRedisUpdate(String documentId, byte[] payload, String senderId) {
        broadcastCrdtToPeers(documentId, payload, senderId, null);
    }

    private void broadcastCrdtToPeers(String documentId, byte[] payload, String senderId, WebSocketSession exclude) {
        List<WebSocketSession> list = documentSessions.get(documentId);
        if (list == null) return;
        for (WebSocketSession s : list) {
            if (s == exclude || !s.isOpen()) continue;
            try {
                s.sendMessage(new BinaryMessage(payload));
            } catch (IOException e) {
                log.debug("Failed to send CRDT update to session: {}", e.getMessage());
            }
        }
    }

    private void broadcastPresence(String documentId, PresenceMessage.Type type, java.util.UUID userId, String userEmail, CursorPosition cursor) {
        PresenceMessage msg = new PresenceMessage(type, userId, userEmail, documentId, cursor);
        try {
            String json = objectMapper.writeValueAsString(msg);
            TextMessage text = new TextMessage(json);
            List<WebSocketSession> list = documentSessions.get(documentId);
            if (list == null) return;
            for (WebSocketSession s : list) {
                if (!s.isOpen()) continue;
                try {
                    s.sendMessage(text);
                } catch (IOException e) {
                    log.trace("Failed to send presence: {}", e.getMessage());
                }
            }
        } catch (Exception e) {
            log.warn("Serialize presence failed: {}", e.getMessage());
        }
    }

    private void sendCurrentPresence(WebSocketSession session, String documentId) throws IOException {
        Map<java.util.UUID, String> users = presenceService.getPresentUsers(documentId);
        Map<java.util.UUID, CursorPosition> cursors = presenceService.getCursors(documentId);
        Map<String, Object> msg = Map.of(
                "type", "presence_snapshot",
                "users", users.entrySet().stream().collect(java.util.stream.Collectors.toMap(e -> e.getKey().toString(), Map.Entry::getValue)),
                "cursors", cursors.entrySet().stream().collect(java.util.stream.Collectors.toMap(e -> e.getKey().toString(), e -> Map.of("index", e.getValue().getIndex(), "length", e.getValue().getLength() != null ? e.getValue().getLength() : 0)))
        );
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(msg)));
    }

    private WsSessionPrincipal getPrincipal(WebSocketSession session) {
        if (session.getPrincipal() instanceof WsSessionPrincipal p) return p;
        String userIdStr = (String) session.getAttributes().get("userId");
        String documentIdStr = (String) session.getAttributes().get("documentId");
        String userEmail = (String) session.getAttributes().get("userEmail");
        if (userIdStr == null || documentIdStr == null) return null;
        try {
            return new WsSessionPrincipal(java.util.UUID.fromString(userIdStr), java.util.UUID.fromString(documentIdStr), userEmail != null ? userEmail : "");
        } catch (Exception e) {
            return null;
        }
    }
}

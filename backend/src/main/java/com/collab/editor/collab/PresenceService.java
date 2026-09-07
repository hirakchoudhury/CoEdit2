package com.collab.editor.collab;

import com.collab.editor.config.RedisConfig;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * Presence tracking per document via Redis. Ephemeral; not persisted.
 * DESIGN: Presence & cursors stored in Redis, keyed by document.
 */
@Service
@RequiredArgsConstructor
public class PresenceService {

    private final RedisTemplate<String, byte[]> binaryRedisTemplate;
    private static final long PRESENCE_TTL_MINUTES = 30;

    public void join(String documentId, UUID userId, String userEmail) {
        String key = presenceKey(documentId);
        String field = userId.toString();
        byte[] value = (userEmail + ":" + System.currentTimeMillis()).getBytes();
        binaryRedisTemplate.opsForHash().put(key, field, value);
        binaryRedisTemplate.expire(key, PRESENCE_TTL_MINUTES, TimeUnit.MINUTES);
    }

    public void leave(String documentId, UUID userId) {
        String field = userId.toString();
        binaryRedisTemplate.opsForHash().delete(presenceKey(documentId), field);
        // The cursor lives in a separate hash. Leaving it behind meant a
        // departed user's caret stayed in the presence snapshot until the
        // 30-minute TTL expired, and was replayed to every new joiner.
        binaryRedisTemplate.opsForHash().delete(cursorKey(documentId), field);
    }

    public void updateCursor(String documentId, UUID userId, CursorPosition cursor) {
        String key = cursorKey(documentId);
        String field = userId.toString();
        if (cursor == null) {
            binaryRedisTemplate.opsForHash().delete(key, field);
        } else {
            String val = cursor.getIndex() + "," + (cursor.getLength() != null ? cursor.getLength() : 0);
            binaryRedisTemplate.opsForHash().put(key, field, val.getBytes());
        }
        binaryRedisTemplate.expire(key, PRESENCE_TTL_MINUTES, TimeUnit.MINUTES);
    }

    public Map<UUID, String> getPresentUsers(String documentId) {
        String key = presenceKey(documentId);
        Map<Object, Object> raw = binaryRedisTemplate.opsForHash().entries(key);
        Map<UUID, String> out = new HashMap<>();
        for (Map.Entry<Object, Object> e : raw.entrySet()) {
            try {
                UUID uid = UUID.fromString((String) e.getKey());
                String v = new String((byte[]) e.getValue());
                String email = v.contains(":") ? v.substring(0, v.lastIndexOf(':')) : v;
                out.put(uid, email);
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    public Map<UUID, CursorPosition> getCursors(String documentId) {
        String key = cursorKey(documentId);
        Map<Object, Object> raw = binaryRedisTemplate.opsForHash().entries(key);
        Map<UUID, CursorPosition> out = new HashMap<>();
        for (Map.Entry<Object, Object> e : raw.entrySet()) {
            try {
                UUID uid = UUID.fromString((String) e.getKey());
                String v = new String((byte[]) e.getValue());
                String[] parts = v.split(",");
                int index = parts.length > 0 ? Integer.parseInt(parts[0]) : 0;
                int length = parts.length > 1 ? Integer.parseInt(parts[1]) : 0;
                out.put(uid, new CursorPosition(index, length));
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    private String presenceKey(String documentId) {
        return RedisConfig.PRESENCE_KEY_PREFIX + documentId + ":users";
    }

    private String cursorKey(String documentId) {
        return RedisConfig.PRESENCE_KEY_PREFIX + documentId + ":cursors";
    }
}

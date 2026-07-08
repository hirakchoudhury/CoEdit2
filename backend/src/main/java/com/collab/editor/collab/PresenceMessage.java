package com.collab.editor.collab;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * Ephemeral presence: cursor and user in document session.
 * DESIGN: DocumentSession { documentId, activeUsers, cursors } - not persisted.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PresenceMessage {

    public enum Type {
        JOIN,
        LEAVE,
        CURSOR
    }

    private Type type;
    private UUID userId;
    private String userEmail;
    private String documentId;
    private CursorPosition cursor;
}

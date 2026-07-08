package com.collab.editor.websocket;

import java.security.Principal;
import java.util.UUID;

public record WsSessionPrincipal(UUID userId, UUID documentId, String userEmail) implements Principal {

    @Override
    public String getName() {
        return userId.toString();
    }
}

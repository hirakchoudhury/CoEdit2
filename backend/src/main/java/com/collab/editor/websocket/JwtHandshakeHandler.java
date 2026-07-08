package com.collab.editor.websocket;

import com.collab.editor.security.JwtService;
import com.collab.editor.service.DocumentService;
import com.collab.editor.domain.Permission;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.support.DefaultHandshakeHandler;

import java.security.Principal;
import java.util.UUID;
import java.util.Map;

/**
 * Validates JWT and document access during WebSocket handshake.
 * Expects query params: token, documentId
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class JwtHandshakeHandler extends DefaultHandshakeHandler {

    private final JwtService jwtService;
    private final DocumentService documentService;

    @Override
    protected Principal determineUser(ServerHttpRequest request, WebSocketHandler handler, Map<String, Object> attributes) {
        if (!(request instanceof ServletServerHttpRequest servletRequest)) {
            return null;
        }
        String token = servletRequest.getServletRequest().getParameter("token");
        String documentIdStr = servletRequest.getServletRequest().getParameter("documentId");
        if (token == null || documentIdStr == null) {
            log.debug("WebSocket handshake missing token or documentId");
            return null;
        }
        if (!jwtService.validateToken(token)) {
            log.debug("WebSocket handshake invalid token");
            return null;
        }
        JwtService.JwtClaims claims = jwtService.parseToken(token);
        UUID documentId;
        try {
            documentId = UUID.fromString(documentIdStr);
        } catch (Exception e) {
            return null;
        }
        if (!documentService.canAccess(documentId, claims.userId(), Permission.READ)) {
            log.debug("WebSocket handshake access denied for document {}", documentId);
            return null;
        }
        attributes.put("userId", claims.userId().toString());
        attributes.put("documentId", documentId.toString());
        attributes.put("userEmail", claims.email());
        return new WsSessionPrincipal(claims.userId(), documentId, claims.email());
    }
}

package com.collab.editor.security;

import com.collab.editor.config.AppProperties;
import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class JwtService {

    private final AppProperties appProperties;

    public String generateToken(UUID userId, String email) {
        SecretKey key = key();
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .subject(userId.toString())
                .claim("email", email)
                .issuedAt(new Date(now))
                .expiration(new Date(now + appProperties.getJwt().getExpirationMs()))
                .signWith(key)
                .compact();
    }

    public JwtClaims parseToken(String token) {
        SecretKey key = key();
        Jws<Claims> jws = Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token);
        Claims claims = jws.getPayload();
        return new JwtClaims(
                UUID.fromString(claims.getSubject()),
                claims.get("email", String.class)
        );
    }

    public boolean validateToken(String token) {
        try {
            parseToken(token);
            return true;
        } catch (JwtException e) {
            log.debug("Invalid JWT: {}", e.getMessage());
            return false;
        }
    }

    private SecretKey key() {
        String secret = appProperties.getJwt().getSecret();
        return Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    public record JwtClaims(UUID userId, String email) {}
}

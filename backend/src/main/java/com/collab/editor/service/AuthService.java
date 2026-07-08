package com.collab.editor.service;

import com.collab.editor.api.auth.AuthRequest;
import com.collab.editor.api.auth.AuthResponse;
import com.collab.editor.api.auth.RegisterRequest;
import com.collab.editor.domain.User;
import com.collab.editor.repository.UserRepository;
import com.collab.editor.security.JwtService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new IllegalArgumentException("Email already registered");
        }
        User user = User.builder()
                .email(request.getEmail().trim().toLowerCase())
                .passwordHash(passwordEncoder.encode(request.getPassword()))
                .build();
        user = userRepository.save(user);
        String token = jwtService.generateToken(user.getId(), user.getEmail());
        return new AuthResponse(token, user.getEmail(), user.getId().toString());
    }

    public AuthResponse login(AuthRequest request) {
        User user = userRepository.findByEmail(request.getEmail().trim().toLowerCase())
                .orElseThrow(() -> new IllegalArgumentException("Invalid email or password"));
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            throw new IllegalArgumentException("Invalid email or password");
        }
        String token = jwtService.generateToken(user.getId(), user.getEmail());
        return new AuthResponse(token, user.getEmail(), user.getId().toString());
    }
}

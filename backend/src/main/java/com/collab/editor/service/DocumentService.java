package com.collab.editor.service;

import com.collab.editor.api.document.*;
import com.collab.editor.domain.*;
import com.collab.editor.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class DocumentService {

    private final DocumentRepository documentRepository;
    private final DocumentPermissionRepository permissionRepository;
    private final DocumentSnapshotRepository snapshotRepository;
    private final UserRepository userRepository;
    private final SnapshotService snapshotService;

    @Transactional(readOnly = true)
    public List<DocumentDto> listDocumentsForUser(UUID userId) {
        List<Document> owned = documentRepository.findByOwnerIdOrderByUpdatedAtDesc(userId);
        List<UUID> sharedDocIds = permissionRepository.findByUserId(userId).stream()
                .map(DocumentPermission::getDocumentId)
                .distinct()
                .toList();
        List<Document> shared = sharedDocIds.isEmpty() ? List.of() : documentRepository.findAllById(sharedDocIds);
        java.util.Map<UUID, Document> byId = new java.util.HashMap<>();
        owned.forEach(d -> byId.put(d.getId(), d));
        shared.forEach(d -> byId.putIfAbsent(d.getId(), d));
        return byId.values().stream()
                .sorted((a, b) -> b.getUpdatedAt().compareTo(a.getUpdatedAt()))
                .map(this::toDto)
                .collect(Collectors.toList());
    }

    @Transactional
    public DocumentDto create(UUID ownerId, CreateDocumentRequest request) {
        Document doc = Document.builder()
                .title(request.getTitle())
                .ownerId(ownerId)
                .build();
        doc = documentRepository.save(doc);
        return toDto(doc);
    }

    @Transactional(readOnly = true)
    public DocumentDto get(UUID documentId, UUID userId) {
        Document doc = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found"));
        requireAccess(doc, userId, Permission.READ);
        return toDto(doc);
    }

    @Transactional
    public DocumentDto updateTitle(UUID documentId, UUID userId, String title) {
        Document doc = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found"));
        requireAccess(doc, userId, Permission.WRITE);
        doc.setTitle(title);
        doc = documentRepository.save(doc);
        return toDto(doc);
    }

    @Transactional
    public void delete(UUID documentId, UUID userId) {
        Document doc = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found"));
        if (!doc.getOwnerId().equals(userId)) {
            throw new IllegalArgumentException("Only owner can delete document");
        }
        documentRepository.delete(doc);
    }

    @Transactional(readOnly = true)
    public SnapshotResponse getLatestSnapshot(UUID documentId, UUID userId) {
        Document doc = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found"));
        requireAccess(doc, userId, Permission.READ);
        DocumentSnapshot snap = snapshotService.getLatest(documentId);
        return snap != null ? new SnapshotResponse(snap.getCrdtState(), snap.getVersion()) : new SnapshotResponse(null, 0L);
    }

    @Transactional(readOnly = true)
    public List<PermissionDto> listPermissions(UUID documentId, UUID userId) {
        Document doc = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found"));
        requireAccess(doc, userId, Permission.READ);
        return permissionRepository.findByDocumentId(documentId).stream()
                .map(p -> {
                    String email = userRepository.findById(p.getUserId()).map(User::getEmail).orElse("");
                    return new PermissionDto(p.getId(), p.getDocumentId(), p.getUserId(), email, p.getPermission());
                })
                .collect(Collectors.toList());
    }

    @Transactional
    public PermissionDto grantPermission(UUID documentId, UUID ownerId, GrantPermissionRequest request) {
        Document doc = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found"));
        if (!doc.getOwnerId().equals(ownerId)) {
            throw new IllegalArgumentException("Only owner can grant permissions");
        }
        UUID targetUserId = resolveTargetUserId(request);
        if (targetUserId.equals(ownerId)) {
            throw new IllegalArgumentException("Owner already has full access");
        }
        DocumentPermission perm = permissionRepository.findByDocumentIdAndUserId(documentId, targetUserId)
                .orElse(DocumentPermission.builder()
                        .documentId(documentId)
                        .userId(targetUserId)
                        .permission(request.getPermission())
                        .build());
        perm.setPermission(request.getPermission());
        perm = permissionRepository.save(perm);
        String email = userRepository.findById(perm.getUserId()).map(User::getEmail).orElse("");
        return new PermissionDto(perm.getId(), perm.getDocumentId(), perm.getUserId(), email, perm.getPermission());
    }

    @Transactional
    public void revokePermission(UUID documentId, UUID ownerId, UUID targetUserId) {
        Document doc = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found"));
        if (!doc.getOwnerId().equals(ownerId)) {
            throw new IllegalArgumentException("Only owner can revoke permissions");
        }
        permissionRepository.deleteByDocumentIdAndUserId(documentId, targetUserId);
    }

    public boolean canAccess(UUID documentId, UUID userId, Permission required) {
        Document doc = documentRepository.findById(documentId).orElse(null);
        if (doc == null) return false;
        if (doc.getOwnerId().equals(userId)) return true;
        return permissionRepository.findByDocumentIdAndUserId(documentId, userId)
                .map(p -> hasPermission(p.getPermission(), required))
                .orElse(false);
    }

    private void requireAccess(Document doc, UUID userId, Permission required) {
        if (doc.getOwnerId().equals(userId)) return;
        DocumentPermission perm = permissionRepository.findByDocumentIdAndUserId(doc.getId(), userId)
                .orElseThrow(() -> new IllegalArgumentException("Access denied"));
        if (!hasPermission(perm.getPermission(), required)) {
            throw new IllegalArgumentException("Access denied");
        }
    }

    private boolean hasPermission(Permission userPerm, Permission required) {
        if (userPerm == Permission.OWNER) return true;
        if (required == Permission.READ) return userPerm == Permission.READ || userPerm == Permission.WRITE;
        if (required == Permission.WRITE) return userPerm == Permission.WRITE;
        return false;
    }

    private UUID resolveTargetUserId(GrantPermissionRequest request) {
        if (request.getUserId() != null) {
            userRepository.findById(request.getUserId())
                    .orElseThrow(() -> new IllegalArgumentException("User not found"));
            return request.getUserId();
        }

        String email = request.getUserEmail();
        if (email == null || email.isBlank()) {
            throw new IllegalArgumentException("userId or userEmail is required");
        }

        return userRepository.findByEmail(email.trim().toLowerCase())
                .map(User::getId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
    }

    private DocumentDto toDto(Document d) {
        return DocumentDto.builder()
                .id(d.getId())
                .title(d.getTitle())
                .ownerId(d.getOwnerId())
                .createdAt(d.getCreatedAt())
                .updatedAt(d.getUpdatedAt())
                .build();
    }
}

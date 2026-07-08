package com.collab.editor.repository;

import com.collab.editor.domain.DocumentPermission;
import com.collab.editor.domain.Permission;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DocumentPermissionRepository extends JpaRepository<DocumentPermission, UUID> {

    List<DocumentPermission> findByDocumentId(UUID documentId);

    Optional<DocumentPermission> findByDocumentIdAndUserId(UUID documentId, UUID userId);

    boolean existsByDocumentIdAndUserId(UUID documentId, UUID userId);

    void deleteByDocumentIdAndUserId(UUID documentId, UUID userId);

    List<DocumentPermission> findByUserId(UUID userId);
}

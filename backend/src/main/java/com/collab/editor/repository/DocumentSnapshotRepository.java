package com.collab.editor.repository;

import com.collab.editor.domain.DocumentSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Optional;
import java.util.UUID;

public interface DocumentSnapshotRepository extends JpaRepository<DocumentSnapshot, UUID> {

    @Query("SELECT s FROM DocumentSnapshot s WHERE s.documentId = :documentId ORDER BY s.version DESC LIMIT 1")
    Optional<DocumentSnapshot> findLatestByDocumentId(UUID documentId);
}

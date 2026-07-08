package com.collab.editor.domain;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * Persisted CRDT state only. DESIGN: DocumentSnapshot { id, documentId, crdtState, version, createdAt }
 * No plain text document content is stored.
 */
@Entity
@Table(name = "document_snapshots", indexes = {
    @Index(name = "idx_snapshot_doc_version", columnList = "document_id, version DESC")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DocumentSnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "document_id", nullable = false)
    private UUID documentId;

    @Column(name = "crdt_state", nullable = false, columnDefinition = "bytea")
    private byte[] crdtState;

    @Column(nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}

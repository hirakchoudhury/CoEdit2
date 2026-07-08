package com.collab.editor.service;

import com.collab.editor.domain.Document;
import com.collab.editor.domain.DocumentSnapshot;
import com.collab.editor.domain.Permission;
import com.collab.editor.repository.DocumentPermissionRepository;
import com.collab.editor.repository.DocumentRepository;
import com.collab.editor.repository.DocumentSnapshotRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Persist CRDT snapshots only. DESIGN: Save snapshot every N updates or T seconds (client-driven).
 * Backend accepts snapshot uploads and serves latest on document open.
 */
@Service
@RequiredArgsConstructor
public class SnapshotService {

    private final DocumentSnapshotRepository snapshotRepository;
    private final DocumentRepository documentRepository;
    private final DocumentPermissionRepository permissionRepository;

    @Transactional
    public long saveSnapshot(UUID documentId, UUID userId, byte[] crdtState) {
        Document doc = documentRepository.findById(documentId)
                .orElseThrow(() -> new IllegalArgumentException("Document not found"));
        if (!doc.getOwnerId().equals(userId) && permissionRepository.findByDocumentIdAndUserId(documentId, userId).isEmpty()) {
            throw new IllegalArgumentException("Only document participants may save snapshots");
        }
        long nextVersion = snapshotRepository.findLatestByDocumentId(documentId)
                .map(s -> s.getVersion() + 1)
                .orElse(1L);
        DocumentSnapshot snapshot = DocumentSnapshot.builder()
                .documentId(documentId)
                .crdtState(crdtState)
                .version(nextVersion)
                .build();
        snapshotRepository.save(snapshot);
        return nextVersion;
    }

    @Transactional(readOnly = true)
    public DocumentSnapshot getLatest(UUID documentId) {
        return snapshotRepository.findLatestByDocumentId(documentId).orElse(null);
    }
}

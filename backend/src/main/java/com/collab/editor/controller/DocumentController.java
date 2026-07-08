package com.collab.editor.controller;

import com.collab.editor.api.document.*;
import com.collab.editor.service.DocumentService;
import com.collab.editor.service.SnapshotService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/documents")
@RequiredArgsConstructor
public class DocumentController {

    private final DocumentService documentService;
    private final SnapshotService snapshotService;

    private static UUID userId(Authentication auth) {
        return (UUID) auth.getPrincipal();
    }

    @GetMapping
    public List<DocumentDto> list(Authentication auth) {
        return documentService.listDocumentsForUser(userId(auth));
    }

    @PostMapping
    public ResponseEntity<DocumentDto> create(@Valid @RequestBody CreateDocumentRequest request, Authentication auth) {
        return ResponseEntity.ok(documentService.create(userId(auth), request));
    }

    @GetMapping("/{documentId}")
    public DocumentDto get(@PathVariable UUID documentId, Authentication auth) {
        return documentService.get(documentId, userId(auth));
    }

    @PatchMapping("/{documentId}")
    public DocumentDto updateTitle(@PathVariable UUID documentId, @RequestBody Map<String, String> body, Authentication auth) {
        String title = body.get("title");
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("title required");
        }
        return documentService.updateTitle(documentId, userId(auth), title.trim());
    }

    @DeleteMapping("/{documentId}")
    public ResponseEntity<Void> delete(@PathVariable UUID documentId, Authentication auth) {
        documentService.delete(documentId, userId(auth));
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{documentId}/snapshot")
    public SnapshotResponse getSnapshot(@PathVariable UUID documentId, Authentication auth) {
        return documentService.getLatestSnapshot(documentId, userId(auth));
    }

    @PostMapping(value = "/{documentId}/snapshot", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<Map<String, Object>> uploadSnapshot(
            @PathVariable UUID documentId,
            @RequestBody byte[] crdtState,
            Authentication auth
    ) {
        long version = snapshotService.saveSnapshot(documentId, userId(auth), crdtState);
        return ResponseEntity.ok(Map.of("version", version));
    }

    @GetMapping("/{documentId}/permissions")
    public List<PermissionDto> listPermissions(@PathVariable UUID documentId, Authentication auth) {
        return documentService.listPermissions(documentId, userId(auth));
    }

    @PostMapping("/{documentId}/permissions")
    public PermissionDto grantPermission(
            @PathVariable UUID documentId,
            @Valid @RequestBody GrantPermissionRequest request,
            Authentication auth
    ) {
        return documentService.grantPermission(documentId, userId(auth), request);
    }

    @DeleteMapping("/{documentId}/permissions/{userId}")
    public ResponseEntity<Void> revokePermission(
            @PathVariable UUID documentId,
            @PathVariable UUID userId,
            Authentication auth
    ) {
        documentService.revokePermission(documentId, userId(auth), userId);
        return ResponseEntity.noContent().build();
    }
}

package com.collab.editor.domain;

import jakarta.persistence.*;
import lombok.*;

import java.util.UUID;

/**
 * Document share permission. DESIGN: DocumentPermission { id, documentId, userId, permission }
 */
@Entity
@Table(name = "document_permissions", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"document_id", "user_id"})
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DocumentPermission {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "document_id", nullable = false)
    private UUID documentId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Permission permission;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "document_id", insertable = false, updatable = false)
    private Document document;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", insertable = false, updatable = false)
    private User user;
}

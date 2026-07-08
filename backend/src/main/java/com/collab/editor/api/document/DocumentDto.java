package com.collab.editor.api.document;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DocumentDto {

    private UUID id;
    private String title;
    private UUID ownerId;
    private Instant createdAt;
    private Instant updatedAt;
}

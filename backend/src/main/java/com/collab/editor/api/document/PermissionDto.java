package com.collab.editor.api.document;

import com.collab.editor.domain.Permission;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class PermissionDto {

    private UUID id;
    private UUID documentId;
    private UUID userId;
    private String userEmail;
    private Permission permission;
}

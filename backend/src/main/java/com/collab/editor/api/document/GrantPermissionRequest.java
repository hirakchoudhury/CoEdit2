package com.collab.editor.api.document;

import com.collab.editor.domain.Permission;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.UUID;

@Data
public class GrantPermissionRequest {

    private UUID userId;

    private String userEmail;

    @NotNull
    private Permission permission;
}

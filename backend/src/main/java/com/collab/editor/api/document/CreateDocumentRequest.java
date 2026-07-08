package com.collab.editor.api.document;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class CreateDocumentRequest {

    @NotBlank
    @Size(max = 500)
    private String title;
}

package com.collab.editor.collab;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * CRDT update relay payload. Backend does not interpret content; relay only.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DocumentUpdateMessage {

    private String documentId;
    private byte[] payload;  // opaque CRDT update (e.g. Yjs state vector diff)
    private String senderId; // for optional echo suppression on sender
}

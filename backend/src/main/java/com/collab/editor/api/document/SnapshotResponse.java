package com.collab.editor.api.document;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SnapshotResponse {

    private byte[] crdtState;
    private long version;
}

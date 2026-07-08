package com.collab.editor.collab;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class CursorPosition {

    private Integer index;
    private Integer length;
}

/**
 * Minimal single-splice diff between two strings.
 *
 * Returns the one contiguous region that changed: everything in
 * `prev.slice(start, endPrev)` was replaced by `next.slice(start, endNext)`.
 * That is enough to describe any single edit (typing, backspace, paste,
 * select-and-replace) which is all a textarea can produce in one event.
 */
export interface TextSplice {
  start: number;
  endPrev: number;
  endNext: number;
}

export function diffSplice(prev: string, next: string): TextSplice | null {
  if (prev === next) return null;

  let start = 0;
  const maxStart = Math.min(prev.length, next.length);
  while (start < maxStart && prev[start] === next[start]) start++;

  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }

  return { start, endPrev, endNext };
}

/**
 * Map a caret offset in `prev` onto the equivalent offset in `next`.
 *
 * - Edit entirely after the caret  -> caret is unchanged.
 * - Edit entirely before the caret -> caret shifts by the length delta.
 * - Caret inside the replaced span -> clamp into the replacement.
 *
 * This is what keeps a remote edit from throwing the local cursor to the end
 * of the document.
 */
export function transformCaret(prev: string, next: string, caret: number): number {
  const splice = diffSplice(prev, next);
  if (!splice) return caret;
  const { start, endPrev, endNext } = splice;

  if (caret <= start) return caret;
  if (caret >= endPrev) return caret + (endNext - endPrev);
  return Math.max(start, Math.min(caret, endNext));
}

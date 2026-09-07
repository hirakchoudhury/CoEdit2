import { useLayoutEffect, useRef, useState } from 'react';
import type { PresenceCursor } from '../sync/WebSocketProvider';

/**
 * Draws other people's carets and selections on top of a <textarea>.
 *
 * A textarea renders its own text in an opaque shadow tree, so there is no way
 * to position anything against a character offset inside it. The workaround is
 * a "mirror": an off-screen div styled to lay text out identically. Because the
 * mirror holds a real text node, a DOM Range can be placed at any offset and
 * asked for its client rects, which gives pixel positions that survive line
 * wrapping, variable-width fonts, and multi-line selections.
 *
 * The mirror is aria-hidden and never receives pointer events; it exists purely
 * as a measuring device.
 */

// Every property that can change where a glyph lands. Miss one and the carets
// drift from the real text.
const MIRRORED_STYLES = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'letter-spacing', 'word-spacing', 'text-transform', 'text-indent',
  'line-height', 'white-space', 'overflow-wrap', 'word-break', 'tab-size',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'box-sizing',
] as const;

const PALETTE = [
  '#f87171', '#fbbf24', '#4ade80', '#38bdf8',
  '#a78bfa', '#f472b6', '#2dd4bf', '#fb923c',
];

/** Stable per-user colour, so someone keeps the same colour across sessions. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

interface Rect { left: number; top: number; width: number; height: number }
interface Drawn {
  userId: string;
  label: string;
  color: string;
  caret: Rect;
  selection: Rect[];
}

interface Props {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  /** Current textarea contents. Drives re-measurement. */
  text: string;
  cursors: Record<string, PresenceCursor>;
  users: Record<string, string>;
  /** Our own id, so we do not draw a second caret over the real one. */
  selfId: string | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export default function RemoteCursors({ textareaRef, text, cursors, users, selfId }: Props) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<Drawn[]>([]);
  const [scrollTop, setScrollTop] = useState(0);

  // Keep the overlay pinned to the textarea's scroll position.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const onScroll = () => setScrollTop(ta.scrollTop);
    ta.addEventListener('scroll', onScroll);
    onScroll();
    return () => ta.removeEventListener('scroll', onScroll);
  }, [textareaRef]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;

    const others = Object.entries(cursors).filter(([id]) => id !== selfId);
    if (others.length === 0) {
      setDrawn([]);
      return;
    }

    // Re-copy styles every pass: a theme change or font load would otherwise
    // leave the mirror measuring against stale metrics.
    const cs = window.getComputedStyle(ta);
    for (const prop of MIRRORED_STYLES) {
      mirror.style.setProperty(prop, cs.getPropertyValue(prop));
    }
    // Match the wrapping width exactly. clientWidth excludes the scrollbar,
    // which is what the text actually wraps against.
    mirror.style.width = `${ta.clientWidth}px`;
    mirror.style.borderStyle = 'solid';
    mirror.style.borderColor = 'transparent';

    // A trailing newline collapses in a div but not in a textarea; the extra
    // space keeps the final line measurable.
    mirror.textContent = text.endsWith('\n') ? `${text} ` : text;

    const node = mirror.firstChild;
    if (!node) {
      setDrawn([]);
      return;
    }

    const origin = mirror.getBoundingClientRect();
    const toLocal = (r: DOMRect): Rect => ({
      left: r.left - origin.left,
      top: r.top - origin.top,
      width: r.width,
      height: r.height,
    });

    const next: Drawn[] = [];
    for (const [userId, cursor] of others) {
      const start = clamp(cursor.index, 0, text.length);
      const end = clamp(start + Math.max(0, cursor.length), start, text.length);

      const caretRange = document.createRange();
      caretRange.setStart(node, start);
      caretRange.setEnd(node, start);
      let caretRect = caretRange.getBoundingClientRect();

      // A collapsed range at a line break can report a zero-height rect. Fall
      // back to measuring the adjacent character, which always has one.
      if (caretRect.height === 0 && text.length > 0) {
        const probe = document.createRange();
        const at = start < text.length ? start : Math.max(0, start - 1);
        probe.setStart(node, at);
        probe.setEnd(node, Math.min(at + 1, text.length));
        const pr = probe.getBoundingClientRect();
        caretRect = new DOMRect(
          start < text.length ? pr.left : pr.right,
          pr.top,
          0,
          pr.height,
        );
      }

      const selection: Rect[] =
        end > start
          ? (() => {
              const r = document.createRange();
              r.setStart(node, start);
              r.setEnd(node, end);
              // One rect per visual line, so wrapped selections render correctly.
              return Array.from(r.getClientRects()).map(toLocal);
            })()
          : [];

      next.push({
        userId,
        label: users[userId] || userId.slice(0, 8),
        color: colorForUser(userId),
        caret: toLocal(caretRect),
        selection,
      });
    }
    setDrawn(next);
  }, [text, cursors, users, selfId, textareaRef]);

  return (
    <>
      {/* Measuring device. Not visible, not focusable, not read aloud. */}
      <div
        ref={mirrorRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}
      />

      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          borderRadius: 8,
        }}
      >
        <div style={{ transform: `translateY(${-scrollTop}px)` }}>
          {drawn.map((d) => (
            <div key={d.userId}>
              {d.selection.map((r, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: r.left,
                    top: r.top,
                    width: r.width,
                    height: r.height,
                    background: d.color,
                    opacity: 0.22,
                    borderRadius: 2,
                  }}
                />
              ))}

              <div
                style={{
                  position: 'absolute',
                  left: d.caret.left,
                  top: d.caret.top,
                  width: 2,
                  height: d.caret.height || 18,
                  background: d.color,
                }}
              />

              <div
                style={{
                  position: 'absolute',
                  left: d.caret.left,
                  // Sit the label just above the caret, clamped so it stays
                  // visible when the caret is on the first line.
                  top: Math.max(0, d.caret.top - 16),
                  background: d.color,
                  color: '#18181b',
                  fontSize: 11,
                  lineHeight: '14px',
                  padding: '0 4px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
                  fontFamily: 'system-ui, sans-serif',
                  fontWeight: 600,
                }}
              >
                {d.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

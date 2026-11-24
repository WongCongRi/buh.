export type MarkdownTokenStyle =
  | 'plain'
  | 'syntax'
  | 'bold'
  | 'italic'
  | 'bold-italic'
  | 'strike'
  | 'code'
  | 'link';

export type MarkdownLineKind = 'normal' | 'h1' | 'h2' | 'h3' | 'quote';

export interface MarkdownSegment {
  rawStart: number;
  rawEnd: number;
  raw: string;
  visible: boolean;
  style: MarkdownTokenStyle;
  visStart: number;
  visEnd: number;
}

export interface MarkdownParsedLine {
  lineStart: number;
  lineEnd: number;
  kind: MarkdownLineKind;
  segments: MarkdownSegment[];
}

export interface MarkdownProjection {
  lines: MarkdownParsedLine[];
  segments: MarkdownSegment[];
  visibleText: string;
}

/**
 * Characters that can be escaped with a preceding backslash `\` so they render
 * literally instead of triggering Markdown formatting.
 */
const ESCAPABLE_CHARS = new Set([
  '\\',
  '*',
  '_',
  '~',
  '`',
  '#',
  '>',
  '[',
  ']',
  '(',
  ')',
  '!',
]);

function isEscapableChar(ch: string | undefined): boolean {
  return Boolean(ch && ESCAPABLE_CHARS.has(ch));
}

function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0;
  let i = index - 1;
  while (i >= 0 && text[i] === '\\') {
    backslashes += 1;
    i -= 1;
  }
  return backslashes % 2 === 1;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const lo = Math.min(aStart, aEnd);
  const hi = Math.max(aStart, aEnd);
  return lo <= bEnd && hi >= bStart;
}

function getFirstWordEnd(text: string): number {
  const match = text.match(/^\S+/);
  return match ? match[0].length : 0;
}

function getWordBoundsInLine(line: string, pos: number): { start: number; end: number } {
  let start = Math.max(0, Math.min(pos, line.length));
  let end = start;
  while (start > 0 && !/\s/.test(line[start - 1])) {
    start -= 1;
  }
  while (end < line.length && !/\s/.test(line[end])) {
    end += 1;
  }
  return { start, end };
}

function expandAlnumBounds(
  line: string,
  startIdx: number,
  endIdx: number
): { start: number; end: number } {
  let start = startIdx;
  let end = endIdx;
  while (start > 0 && /[A-Za-z0-9]/.test(line[start - 1])) {
    start -= 1;
  }
  while (end < line.length && /[A-Za-z0-9]/.test(line[end])) {
    end += 1;
  }
  return { start, end };
}

interface InlineMatch {
  index: number;
  fullLength: number;
  open: string;
  inner: string;
  close: string;
  style: MarkdownTokenStyle;
  processEscapesInInner: boolean;
}

function tryMatchDelimited(
  line: string,
  i: number,
  delim: string,
  style: MarkdownTokenStyle,
  requireWordBoundary: boolean
): InlineMatch | null {
  if (!line.startsWith(delim, i)) return null;

  const delimChar = delim[0];
  // Do not start inside a longer run of the same unescaped delimiter character
  if (i > 0 && line[i - 1] === delimChar && !isEscapedAt(line, i - 1)) {
    return null;
  }
  if (i + delim.length < line.length && line[i + delim.length] === delimChar) {
    return null;
  }

  if (requireWordBoundary) {
    const before = i > 0 ? line[i - 1] : '';
    if (/[A-Za-z0-9_]/.test(before)) {
      return null;
    }
  }

  const contentStart = i + delim.length;
  if (contentStart >= line.length || /\s/.test(line[contentStart])) {
    return null;
  }

  let j = contentStart;
  while (j <= line.length - delim.length) {
    if (line[j] === '\\' && j + 1 < line.length && isEscapableChar(line[j + 1])) {
      j += 2;
      continue;
    }

    if (line.startsWith(delim, j)) {
      const prevIsSameUnescaped =
        j > contentStart && line[j - 1] === delimChar && !isEscapedAt(line, j - 1);
      const nextIsSame =
        j + delim.length < line.length && line[j + delim.length] === delimChar;
      const validBoundary =
        !prevIsSameUnescaped &&
        !nextIsSame &&
        j > contentStart &&
        !/\s/.test(line[j - 1]);

      if (validBoundary) {
        if (requireWordBoundary) {
          const afterIdx = j + delim.length;
          const after = afterIdx < line.length ? line[afterIdx] : '';
          if (/[A-Za-z0-9_]/.test(after)) {
            j += delim.length;
            continue;
          }
        }
        return {
          index: i,
          fullLength: j + delim.length - i,
          open: delim,
          inner: line.slice(contentStart, j),
          close: delim,
          style,
          processEscapesInInner: true,
        };
      }

      // Skip past a mismatched longer run of the same delimiter character
      let runEnd = j + 1;
      while (runEnd < line.length && line[runEnd] === delimChar) {
        runEnd += 1;
      }
      j = runEnd;
      continue;
    }

    j += 1;
  }

  return null;
}

function tryMatchInlineAt(line: string, i: number): InlineMatch | null {
  const ch = line[i];

  // 1. Inline code: `code` (no backslash escaping inside code spans)
  if (ch === '`') {
    const closeIdx = line.indexOf('`', i + 1);
    if (closeIdx > i + 1) {
      return {
        index: i,
        fullLength: closeIdx - i + 1,
        open: '`',
        inner: line.slice(i + 1, closeIdx),
        close: '`',
        style: 'code',
        processEscapesInInner: false,
      };
    }
    return null;
  }

  // 2. Link: [label](url)
  if (ch === '[') {
    let j = i + 1;
    let labelClose = -1;
    while (j < line.length) {
      if (line[j] === '\\' && j + 1 < line.length && isEscapableChar(line[j + 1])) {
        j += 2;
        continue;
      }
      if (line[j] === ']') {
        labelClose = j;
        break;
      }
      j += 1;
    }

    if (labelClose > i + 1 && line[labelClose + 1] === '(') {
      let k = labelClose + 2;
      let urlClose = -1;
      while (k < line.length) {
        if (/\s/.test(line[k])) break;
        if (line[k] === '\\' && k + 1 < line.length && isEscapableChar(line[k + 1])) {
          k += 2;
          continue;
        }
        if (line[k] === ')') {
          urlClose = k;
          break;
        }
        k += 1;
      }
      if (urlClose > labelClose + 2) {
        return {
          index: i,
          fullLength: urlClose - i + 1,
          open: '[',
          inner: line.slice(i + 1, labelClose),
          close: line.slice(labelClose, urlClose + 1),
          style: 'link',
          processEscapesInInner: true,
        };
      }
    }
    return null;
  }

  // 3-8. Paired formatting delimiters (ordered longest-first for same char)
  if (ch === '*') {
    return (
      tryMatchDelimited(line, i, '***', 'bold-italic', false) ||
      tryMatchDelimited(line, i, '**', 'bold', false) ||
      tryMatchDelimited(line, i, '*', 'italic', false)
    );
  }

  if (ch === '_') {
    return (
      tryMatchDelimited(line, i, '__', 'bold', true) ||
      tryMatchDelimited(line, i, '_', 'italic', true)
    );
  }

  if (ch === '~') {
    return tryMatchDelimited(line, i, '~~', 'strike', false);
  }

  return null;
}

function findNextInlineMatch(line: string, fromIndex: number): InlineMatch | null {
  let i = fromIndex;
  while (i < line.length) {
    if (line[i] === '\\' && i + 1 < line.length && isEscapableChar(line[i + 1])) {
      i += 2;
      continue;
    }
    const match = tryMatchInlineAt(line, i);
    if (match) {
      return match;
    }
    i += 1;
  }
  return null;
}

/**
 * Projects raw markdown text into lines and styled segments while keeping
 * markdown syntax characters (and backslash escape markers) visible in grey
 * ONLY when the cursor/selection is over the attached word / formatted token.
 */
export function projectMarkdownLive(
  rawText: string,
  cursorStart: number,
  cursorEnd: number,
  isFocused: boolean,
  allowBlockSyntax: boolean
): MarkdownProjection {
  const lines: MarkdownParsedLine[] = [];
  const allSegments: MarkdownSegment[] = [];
  let visCursor = 0;

  const pushSegment = (
    target: MarkdownSegment[],
    rawStart: number,
    raw: string,
    visible: boolean,
    style: MarkdownTokenStyle
  ) => {
    if (!raw.length) return;
    const visStart = visCursor;
    const visEnd = visible ? visCursor + raw.length : visCursor;
    visCursor = visEnd;
    const seg: MarkdownSegment = {
      rawStart,
      rawEnd: rawStart + raw.length,
      raw,
      visible,
      style,
      visStart,
      visEnd,
    };
    target.push(seg);
    allSegments.push(seg);
  };

  /**
   * Emits `lineText.slice(from, to)` while honoring backslash escapes (`\*`, `\#`, `\\`, etc.).
   * The escape `\` is hidden unless the cursor is over the word containing that escape.
   */
  const pushTextWithEscapes = (
    target: MarkdownSegment[],
    lineText: string,
    lineStart: number,
    from: number,
    to: number,
    style: MarkdownTokenStyle
  ) => {
    let chunkStart = from;
    let i = from;
    while (i < to) {
      if (lineText[i] === '\\' && i + 1 < to && isEscapableChar(lineText[i + 1])) {
        if (i > chunkStart) {
          pushSegment(
            target,
            lineStart + chunkStart,
            lineText.slice(chunkStart, i),
            true,
            style
          );
        }
        const word = getWordBoundsInLine(lineText, i);
        const showEscape =
          isFocused &&
          rangesOverlap(cursorStart, cursorEnd, lineStart + word.start, lineStart + word.end);
        pushSegment(target, lineStart + i, '\\', showEscape, 'syntax');
        pushSegment(target, lineStart + i + 1, lineText[i + 1], true, style);
        i += 2;
        chunkStart = i;
        continue;
      }
      i += 1;
    }
    if (chunkStart < to) {
      pushSegment(
        target,
        lineStart + chunkStart,
        lineText.slice(chunkStart, to),
        true,
        style
      );
    }
  };

  const rawLines = rawText.split('\n');
  let offset = 0;

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx += 1) {
    const lineText = rawLines[lineIdx];
    const lineStart = offset;
    const lineEnd = offset + lineText.length;
    const lineSegments: MarkdownSegment[] = [];

    let kind: MarkdownLineKind = 'normal';
    let inlineCursor = 0;

    if (allowBlockSyntax) {
      const headingMatch = lineText.match(/^(#{1,3})([ \t]+)/);
      const quoteMatch = !headingMatch ? lineText.match(/^(>)([ \t]+)/) : null;

      if (headingMatch) {
        const hashes = headingMatch[1];
        const prefix = headingMatch[0];
        kind = hashes.length === 1 ? 'h1' : hashes.length === 2 ? 'h2' : 'h3';
        const afterPrefix = lineText.slice(prefix.length);
        const firstWordLen = getFirstWordEnd(afterPrefix);
        // Attach the heading marker (# / ## / ###) to the first word on the line
        const attachedEnd =
          firstWordLen > 0 ? lineStart + prefix.length + firstWordLen : lineEnd;
        const showPrefix =
          isFocused && rangesOverlap(cursorStart, cursorEnd, lineStart, attachedEnd);
        pushSegment(lineSegments, lineStart, prefix, showPrefix, 'syntax');
        inlineCursor = prefix.length;
      } else if (quoteMatch) {
        const prefix = quoteMatch[0];
        kind = 'quote';
        const afterPrefix = lineText.slice(prefix.length);
        const firstWordLen = getFirstWordEnd(afterPrefix);
        const attachedEnd =
          firstWordLen > 0 ? lineStart + prefix.length + firstWordLen : lineEnd;
        const showPrefix =
          isFocused && rangesOverlap(cursorStart, cursorEnd, lineStart, attachedEnd);
        pushSegment(lineSegments, lineStart, prefix, showPrefix, 'syntax');
        inlineCursor = prefix.length;
      }
    }

    while (inlineCursor < lineText.length) {
      const match = findNextInlineMatch(lineText, inlineCursor);
      if (!match) {
        pushTextWithEscapes(
          lineSegments,
          lineText,
          lineStart,
          inlineCursor,
          lineText.length,
          'plain'
        );
        break;
      }

      if (match.index > inlineCursor) {
        pushTextWithEscapes(
          lineSegments,
          lineText,
          lineStart,
          inlineCursor,
          match.index,
          'plain'
        );
      }

      const tokenLineStart = match.index;
      const innerLineStart = tokenLineStart + match.open.length;
      const innerLineEnd = innerLineStart + match.inner.length;
      const tokenLineEnd = tokenLineStart + match.fullLength;

      const tokenRawStart = lineStart + tokenLineStart;
      const innerRawStart = lineStart + innerLineStart;
      const closeRawStart = lineStart + innerLineEnd;

      // Expand across immediately adjacent alphanumeric characters (e.g. un*believ*able),
      // while stopping before whitespace or trailing punctuation (so typing `.` or ` ` hides syntax).
      const revealBounds = expandAlnumBounds(lineText, tokenLineStart, tokenLineEnd);
      const showPair =
        isFocused &&
        rangesOverlap(
          cursorStart,
          cursorEnd,
          lineStart + revealBounds.start,
          lineStart + revealBounds.end
        );

      pushSegment(lineSegments, tokenRawStart, match.open, showPair, 'syntax');
      if (match.processEscapesInInner) {
        pushTextWithEscapes(
          lineSegments,
          lineText,
          lineStart,
          innerLineStart,
          innerLineEnd,
          match.style
        );
      } else {
        pushSegment(lineSegments, innerRawStart, match.inner, true, match.style);
      }
      pushSegment(lineSegments, closeRawStart, match.close, showPair, 'syntax');

      inlineCursor = tokenLineEnd;
    }

    lines.push({
      lineStart,
      lineEnd,
      kind,
      segments: lineSegments,
    });

    // Account for the newline character between lines
    if (lineIdx < rawLines.length - 1) {
      pushSegment([], lineEnd, '\n', true, 'plain');
    }
    offset = lineEnd + 1;
  }

  const visibleText = allSegments
    .filter((s) => s.visible)
    .map((s) => s.raw)
    .join('');

  return { lines, segments: allSegments, visibleText };
}

/**
 * Maps a raw character offset in `rawText` to its corresponding offset in `visibleText`.
 */
export function rawOffsetToVisible(projection: MarkdownProjection, rawOffset: number): number {
  const clamped = Math.max(0, rawOffset);
  for (const seg of projection.segments) {
    if (clamped < seg.rawStart) {
      return seg.visStart;
    }
    if (clamped <= seg.rawEnd) {
      if (seg.visible) {
        return seg.visStart + (clamped - seg.rawStart);
      }
      // Inside a hidden syntax marker: snap to its adjacent visible boundary
      return seg.visStart;
    }
  }
  return projection.visibleText.length;
}

/**
 * Maps a visible character offset in `visibleText` back to its raw offset in `rawText`.
 */
export function visibleOffsetToRaw(
  projection: MarkdownProjection,
  visOffset: number,
  bias: 'before' | 'after' = 'before'
): number {
  const clamped = Math.max(0, Math.min(visOffset, projection.visibleText.length));
  const visibleSegments = projection.segments.filter((s) => s.visible);
  if (visibleSegments.length === 0) {
    if (bias === 'after' && projection.segments.length > 0) {
      return projection.segments[projection.segments.length - 1].rawEnd;
    }
    return 0;
  }

  for (let i = 0; i < visibleSegments.length; i += 1) {
    const seg = visibleSegments[i];
    if (clamped < seg.visStart) {
      return seg.rawStart;
    }
    if (clamped === seg.visStart) {
      if (bias === 'before' && i === 0 && seg.rawStart > 0) {
        return 0;
      }
      return seg.rawStart;
    }
    if (clamped < seg.visEnd) {
      return seg.rawStart + (clamped - seg.visStart);
    }
    if (clamped === seg.visEnd) {
      const next = visibleSegments[i + 1];
      if (!next) {
        if (bias === 'after' && projection.segments.length > 0) {
          return projection.segments[projection.segments.length - 1].rawEnd;
        }
        return seg.rawEnd;
      }
      if (bias === 'after' && next.rawStart > seg.rawEnd) {
        return next.rawStart;
      }
      return seg.rawEnd;
    }
  }
  return visibleSegments[visibleSegments.length - 1].rawEnd;
}

/**
 * Applies an edit made to `visibleText` back onto `oldRawText` without disturbing
 * hidden markdown syntax markers elsewhere in the block.
 */
export function applyVisibleEditToRaw(
  oldRaw: string,
  projection: MarkdownProjection,
  newVisible: string,
  newVisibleCaret: number
): { nextRaw: string; nextRawCaret: number } {
  const oldVisible = projection.visibleText;
  if (oldVisible === newVisible) {
    return {
      nextRaw: oldRaw,
      nextRawCaret: visibleOffsetToRaw(
        projection,
        newVisibleCaret,
        newVisibleCaret === oldVisible.length ? 'after' : 'before'
      ),
    };
  }

  let prefix = 0;
  const maxPrefix = Math.min(oldVisible.length, newVisible.length);
  while (prefix < maxPrefix && oldVisible[prefix] === newVisible[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  const maxSuffix = Math.min(oldVisible.length - prefix, newVisible.length - prefix);
  while (
    suffix < maxSuffix &&
    oldVisible[oldVisible.length - 1 - suffix] === newVisible[newVisible.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const visStart = prefix;
  const visEnd = oldVisible.length - suffix;
  const inserted = newVisible.slice(prefix, newVisible.length - suffix);

  // When removing characters starting right after a hidden syntax marker,
  // or inserting at the very end past a hidden closing marker, bias 'after'
  // so hidden syntax markers are never accidentally overwritten or trap trailing text.
  const startBias: 'before' | 'after' =
    visEnd > visStart || visStart === oldVisible.length ? 'after' : 'before';
  const rawStart = visibleOffsetToRaw(projection, visStart, startBias);
  const rawEnd = Math.max(rawStart, visibleOffsetToRaw(projection, visEnd, 'before'));

  const nextRaw = oldRaw.slice(0, rawStart) + inserted + oldRaw.slice(rawEnd);

  let nextRawCaret: number;
  if (newVisibleCaret <= prefix) {
    nextRawCaret = visibleOffsetToRaw(projection, newVisibleCaret, 'before');
  } else if (newVisibleCaret <= prefix + inserted.length) {
    nextRawCaret = rawStart + (newVisibleCaret - prefix);
  } else {
    const oldCorrespondingVis = visEnd + (newVisibleCaret - (prefix + inserted.length));
    const oldCorrespondingRaw = visibleOffsetToRaw(projection, oldCorrespondingVis, 'before');
    nextRawCaret = oldCorrespondingRaw + (inserted.length - (rawEnd - rawStart));
  }

  nextRawCaret = Math.max(0, Math.min(nextRawCaret, nextRaw.length));
  return { nextRaw, nextRawCaret };
}

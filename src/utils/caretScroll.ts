interface CaretClientRect {
  top: number;
  bottom: number;
  height: number;
}

let textareaMirrorDiv: HTMLDivElement | null = null;
let textareaMirrorMarker: HTMLSpanElement | null = null;

function ensureTextareaMirror(): {
  mirror: HTMLDivElement;
  marker: HTMLSpanElement;
} {
  if (!textareaMirrorDiv || !textareaMirrorMarker) {
    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.style.position = 'fixed';
    mirror.style.top = '-9999px';
    mirror.style.left = '-9999px';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.overflow = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';

    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    textareaMirrorDiv = mirror;
    textareaMirrorMarker = marker;
  }
  return { mirror: textareaMirrorDiv, marker: textareaMirrorMarker };
}

function measureTextareaCaretRect(el: HTMLTextAreaElement): CaretClientRect | null {
  const elRect = el.getBoundingClientRect();
  if (elRect.width <= 0 || elRect.height <= 0) return null;

  const style = window.getComputedStyle(el);
  const caretOffset = Math.max(
    0,
    Math.min(el.selectionEnd ?? el.selectionStart ?? el.value.length, el.value.length)
  );

  const { mirror, marker } = ensureTextareaMirror();
  mirror.style.boxSizing = 'border-box';
  mirror.style.width = `${el.offsetWidth}px`;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.fontStyle = style.fontStyle;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.textTransform = style.textTransform;
  mirror.style.wordSpacing = style.wordSpacing;
  mirror.style.paddingTop = style.paddingTop;
  mirror.style.paddingRight = style.paddingRight;
  mirror.style.paddingBottom = style.paddingBottom;
  mirror.style.paddingLeft = style.paddingLeft;
  mirror.style.borderTopWidth = style.borderTopWidth;
  mirror.style.borderRightWidth = style.borderRightWidth;
  mirror.style.borderBottomWidth = style.borderBottomWidth;
  mirror.style.borderLeftWidth = style.borderLeftWidth;
  mirror.style.borderStyle = 'solid';
  mirror.style.wordBreak = style.wordBreak;
  mirror.style.overflowWrap = style.overflowWrap;
  mirror.style.tabSize = style.tabSize;

  mirror.textContent = el.value.slice(0, caretOffset);
  mirror.appendChild(marker);
  if (!mirror.isConnected) {
    document.body.appendChild(mirror);
  }

  const lineHeightPx =
    parseFloat(style.lineHeight) || Math.round((parseFloat(style.fontSize) || 15) * 1.55);
  const scaleY = el.offsetHeight > 0 ? elRect.height / el.offsetHeight : 1;
  const relTop = marker.offsetTop - el.scrollTop;
  const markerHeight = marker.offsetHeight > 0 ? marker.offsetHeight : lineHeightPx;

  const top = elRect.top + relTop * scaleY;
  const height = markerHeight * scaleY;

  mirror.remove();

  return {
    top,
    bottom: top + height,
    height,
  };
}

function measureContentEditableCaretRect(el: HTMLElement): CaretClientRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
    return null;
  }

  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);

  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (r.height > 0 && (r.top !== 0 || r.bottom !== 0)) {
      return { top: r.top, bottom: r.bottom, height: r.height };
    }
  }

  const bounding = range.getBoundingClientRect();
  if (bounding.height > 0 && (bounding.top !== 0 || bounding.bottom !== 0)) {
    return { top: bounding.top, bottom: bounding.bottom, height: bounding.height };
  }

  // Fallback for empty lines (e.g., <div data-md-line="true"><br></div>)
  let lineEl: HTMLElement | null = null;
  if (range.startContainer instanceof HTMLElement) {
    const childAtOffset = range.startContainer.children[range.startOffset];
    lineEl =
      (childAtOffset instanceof HTMLElement ? childAtOffset : null) ??
      (range.startContainer.closest('[data-md-line="true"]') as HTMLElement | null) ??
      range.startContainer;
  } else {
    lineEl =
      (range.startContainer.parentElement?.closest('[data-md-line="true"]') as HTMLElement | null) ??
      range.startContainer.parentElement;
  }

  if (lineEl) {
    const lr = lineEl.getBoundingClientRect();
    if (lr.height > 0) {
      return { top: lr.top, bottom: lr.bottom, height: lr.height };
    }
  }

  return null;
}

function getCaretClientRect(el: HTMLElement | null): CaretClientRect | null {
  if (!el || !el.isConnected) return null;
  if (el instanceof HTMLTextAreaElement) {
    return measureTextareaCaretRect(el);
  }
  if (el instanceof HTMLInputElement) {
    const r = el.getBoundingClientRect();
    return r.height > 0 ? { top: r.top, bottom: r.bottom, height: r.height } : null;
  }
  if (el.isContentEditable) {
    return measureContentEditableCaretRect(el);
  }
  const r = el.getBoundingClientRect();
  return r.height > 0 ? { top: r.top, bottom: r.bottom, height: r.height } : null;
}

/**
 * Keeps the active caret line visible inside `scrollContainer` without scrolling
 * if the caret is already comfortably in view, and without disturbing outer viewports.
 */
export function ensureCaretVisibleInContainer(
  el: HTMLElement | null,
  scrollContainer?: HTMLElement | null,
  margin = 18
): boolean {
  if (!el || !el.isConnected) return false;
  const container = scrollContainer ?? (el.closest('.device-scroll') as HTMLElement | null);
  if (!container || container.clientHeight <= 0) return false;

  const containerRect = container.getBoundingClientRect();
  if (containerRect.height <= 0) return false;

  const caretRect = getCaretClientRect(el);
  if (!caretRect) return false;

  const scaleY = container.clientHeight > 0 ? containerRect.height / container.clientHeight : 1;
  const effectiveMargin = Math.min(margin * scaleY, containerRect.height * 0.25);
  const safeTop = containerRect.top + effectiveMargin;
  const safeBottom = containerRect.bottom - effectiveMargin;

  if (caretRect.top >= safeTop && caretRect.bottom <= safeBottom) {
    return false;
  }

  let deltaVisual = 0;
  if (caretRect.height > safeBottom - safeTop) {
    deltaVisual = caretRect.top - safeTop;
  } else if (caretRect.bottom > safeBottom) {
    deltaVisual = caretRect.bottom - safeBottom;
  } else if (caretRect.top < safeTop) {
    deltaVisual = caretRect.top - safeTop;
  }

  if (Math.abs(deltaVisual) < 1) return false;

  const deltaScroll = deltaVisual / scaleY;
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  const nextTop = Math.max(0, Math.min(maxScroll, container.scrollTop + deltaScroll));

  if (Math.abs(nextTop - container.scrollTop) < 1) return false;
  container.scrollTop = nextTop;
  return true;
}

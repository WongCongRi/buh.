import React from 'react';
import {
  MarkdownLineKind,
  MarkdownTokenStyle,
  projectMarkdownLive,
} from '../utils/markdownLive';
import { HighlightedText } from './HighlightedText';

interface MarkdownPreviewTextProps {
  text: string;
  query?: string;
  highlightActive?: boolean;
}

function getPreviewTokenClass(style: MarkdownTokenStyle): string {
  switch (style) {
    case 'bold':
      return 'font-semibold text-stone-700 dark:text-stone-200';
    case 'italic':
      return 'italic';
    case 'bold-italic':
      return 'font-semibold italic text-stone-700 dark:text-stone-200';
    case 'strike':
      return 'line-through opacity-75';
    case 'code':
      return 'font-mono text-[11.5px] px-1 py-0.25 rounded bg-stone-200/80 dark:bg-stone-700/75 text-stone-800 dark:text-stone-200';
    case 'link':
      return 'underline decoration-1 underline-offset-2 text-[var(--tf-accent-text)]';
    default:
      return '';
  }
}

function getPreviewLineClass(kind: MarkdownLineKind): string {
  switch (kind) {
    case 'h1':
    case 'h2':
    case 'h3':
      return 'font-semibold text-stone-700 dark:text-stone-200';
    case 'quote':
      return 'italic border-l-2 border-stone-300 dark:border-stone-600 pl-1.5';
    default:
      return '';
  }
}

/**
 * Renders a single-line preview of a Markdown-enabled note with formatting applied
 * and raw markdown syntax characters hidden (consistent with unfocused editor display).
 */
export const MarkdownPreviewText: React.FC<MarkdownPreviewTextProps> = ({
  text,
  query = '',
  highlightActive = false,
}) => {
  const firstLine =
    text
      .split('\n')
      .find((line) => line.trim().length > 0) ?? text;

  const projection = projectMarkdownLive(firstLine, 0, 0, false, true);
  const parsedLine = projection.lines[0];

  if (!parsedLine) {
    return (
      <HighlightedText text={firstLine} query={query} active={highlightActive} />
    );
  }

  const visibleSegments = parsedLine.segments.filter((seg) => seg.visible);
  if (visibleSegments.length === 0) {
    return (
      <HighlightedText text={firstLine} query={query} active={highlightActive} />
    );
  }

  const lineClass = getPreviewLineClass(parsedLine.kind);

  return (
    <span className={lineClass || undefined}>
      {visibleSegments.map((seg, idx) => {
        const tokenClass = getPreviewTokenClass(seg.style);
        const content = (
          <HighlightedText
            text={seg.raw}
            query={query}
            active={highlightActive}
          />
        );
        return tokenClass ? (
          <span key={`${seg.rawStart}-${idx}`} className={tokenClass}>
            {content}
          </span>
        ) : (
          <React.Fragment key={`${seg.rawStart}-${idx}`}>{content}</React.Fragment>
        );
      })}
    </span>
  );
};

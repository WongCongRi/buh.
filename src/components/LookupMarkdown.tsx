import React from 'react';

interface LookupMarkdownProps {
  content: string;
}

type TableAlign = 'left' | 'center' | 'right';

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'hr' }
  | { type: 'code'; lang: string; code: string }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'table'; headers: string[]; alignments: TableAlign[]; rows: string[][] }
  | { type: 'ul'; items: { text: string; indent: number }[] }
  | { type: 'ol'; items: { num: string; text: string; indent: number }[] }
  | { type: 'paragraph'; text: string };

const UL_ITEM_RE = /^(\s*)[-*+•]\s+(.+\S)\s*$/;
const OL_ITEM_RE = /^(\s*)(\d+)[.)]\s+(.+\S)\s*$/;

function isSafeLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (trimmed[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += trimmed[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseTableSeparator(line: string): TableAlign[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return null;
  if (!/^\|?[\s:|-]+\|?$/.test(trimmed)) return null;
  const rawCells = splitTableRow(trimmed);
  if (rawCells.length === 0) return null;

  const alignments: TableAlign[] = [];
  for (const cell of rawCells) {
    const c = cell.trim();
    if (!/^:?-{2,}:?$/.test(c)) return null;
    if (c.startsWith(':') && c.endsWith(':')) {
      alignments.push('center');
    } else if (c.endsWith(':')) {
      alignments.push('right');
    } else {
      alignments.push('left');
    }
  }
  return alignments;
}

function isHorizontalRule(line: string): boolean {
  return /^([-*_])(?:\s*\1){2,}$/.test(line.trim());
}

function parseMarkdownBlocks(rawContent: string): MarkdownBlock[] {
  const cleaned = rawContent
    .replace(/\r\n?/g, '\n')
    .replace(/!\[[^\]]*\]\(https?:\/\/[^\s)]+\)/gi, '')
    .trim();

  if (!cleaned) return [];

  const lines = cleaned.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const startI = i;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Fenced code block (``` or ~~~)
    const fenceMatch = trimmed.match(/^(```|~~~)\s*([a-zA-Z0-9_+-]*)\s*$/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const lang = fenceMatch[2] || '';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    // 2. Markdown table (header line with | followed by separator row)
    if (trimmed.includes('|') && i + 1 < lines.length) {
      const alignments = parseTableSeparator(lines[i + 1]);
      if (alignments) {
        const headers = splitTableRow(trimmed);
        const colCount = Math.max(headers.length, alignments.length);
        const normalizedHeaders = Array.from({ length: colCount }, (_, c) => headers[c] ?? '');
        const normalizedAligns = Array.from(
          { length: colCount },
          (_, c) => alignments[c] ?? 'left'
        );

        i += 2;
        const rows: string[][] = [];
        while (i < lines.length) {
          const rowTrimmed = lines[i].trim();
          if (!rowTrimmed || !rowTrimmed.includes('|')) break;
          if (parseTableSeparator(rowTrimmed)) {
            i += 1;
            continue;
          }
          const cells = splitTableRow(rowTrimmed);
          rows.push(Array.from({ length: colCount }, (_, c) => cells[c] ?? ''));
          i += 1;
        }

        blocks.push({
          type: 'table',
          headers: normalizedHeaders,
          alignments: normalizedAligns,
          rows,
        });
        continue;
      }
    }

    // 3. ATX Heading (# to ######)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i += 1;
      continue;
    }

    // 4. Horizontal rule
    if (isHorizontalRule(trimmed)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // 5. Blockquote
    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    // 6. Unordered list (-, *, +, •)
    if (UL_ITEM_RE.test(rawLine)) {
      const items: { text: string; indent: number }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(UL_ITEM_RE);
        if (!m) break;
        const indent = Math.min(2, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
        items.push({ text: m[2].trim(), indent });
        i += 1;
      }
      if (items.length > 0) {
        blocks.push({ type: 'ul', items });
        continue;
      }
    }

    // 7. Ordered list (1. or 1))
    if (OL_ITEM_RE.test(rawLine)) {
      const items: { num: string; text: string; indent: number }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(OL_ITEM_RE);
        if (!m) break;
        const indent = Math.min(2, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
        items.push({ num: m[2], text: m[3].trim(), indent });
        i += 1;
      }
      if (items.length > 0) {
        blocks.push({ type: 'ol', items });
        continue;
      }
    }

    // 8. Paragraph (group consecutive plain text lines that don't start another block)
    const paraLines: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const nextRaw = lines[i];
      const nextTrimmed = nextRaw.trim();
      if (
        !nextTrimmed ||
        /^(```|~~~)/.test(nextTrimmed) ||
        /^#{1,6}\s+/.test(nextTrimmed) ||
        isHorizontalRule(nextTrimmed) ||
        /^>\s?/.test(nextTrimmed) ||
        UL_ITEM_RE.test(nextRaw) ||
        OL_ITEM_RE.test(nextRaw) ||
        (nextTrimmed.includes('|') && i + 1 < lines.length && Boolean(parseTableSeparator(lines[i + 1])))
      ) {
        break;
      }
      paraLines.push(nextTrimmed);
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: paraLines.join(' ') });

    // Safety guard so malformed input can never stall the parser loop
    if (i === startI) {
      i += 1;
    }
  }

  return blocks;
}

const INLINE_TOKEN_PATTERN =
  '(`[^`\\n]+`|\\[[^\\]]+\\]\\((?:https?:\\/\\/[^\\s)]+)\\)|\\*\\*\\*[^*\\n]+?\\*\\*\\*|\\*\\*[^*\\n]+?\\*\\*|__[^_\\n]+?__|~~[^~\\n]+?~~|\\*[^*\\n]+?\\*|(?<!\\w)_[^_\\n]+?_(?!\\w))';

function renderInlineMarkdown(text: string, keyPrefix = 'in', depth = 0): React.ReactNode {
  if (!text) return null;
  if (depth >= 4) return text;

  // Fresh RegExp instance per call so recursive inline formatting never resets an outer loop's lastIndex
  const regex = new RegExp(INLINE_TOKEN_PATTERN, 'g');
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let tokenIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const token = match[0];
    if (!token) {
      regex.lastIndex += 1;
      continue;
    }

    if (match.index > lastIndex) {
      nodes.push(
        <React.Fragment key={`${keyPrefix}-t-${tokenIdx++}`}>
          {text.slice(lastIndex, match.index)}
        </React.Fragment>
      );
    }

    const key = `${keyPrefix}-m-${tokenIdx++}`;

    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      nodes.push(
        <code
          key={key}
          className="font-mono text-[12.5px] px-1.5 py-0.5 rounded bg-stone-200/80 dark:bg-stone-800 text-stone-800 dark:text-stone-100"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch && isSafeLinkUrl(linkMatch[2])) {
        nodes.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="underline decoration-1 underline-offset-2 text-[var(--tf-accent-text)] hover:opacity-80 break-words"
          >
            {renderInlineMarkdown(linkMatch[1], `${key}-a`, depth + 1)}
          </a>
        );
      } else {
        nodes.push(<React.Fragment key={key}>{token}</React.Fragment>);
      }
    } else if (token.startsWith('***') && token.endsWith('***') && token.length > 6) {
      nodes.push(
        <strong key={key} className="font-semibold italic text-stone-900 dark:text-stone-100">
          {renderInlineMarkdown(token.slice(3, -3), `${key}-bi`, depth + 1)}
        </strong>
      );
    } else if (
      ((token.startsWith('**') && token.endsWith('**')) ||
        (token.startsWith('__') && token.endsWith('__'))) &&
      token.length > 4
    ) {
      nodes.push(
        <strong key={key} className="font-semibold text-stone-900 dark:text-stone-100">
          {renderInlineMarkdown(token.slice(2, -2), `${key}-b`, depth + 1)}
        </strong>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~') && token.length > 4) {
      nodes.push(
        <del key={key} className="line-through opacity-75">
          {renderInlineMarkdown(token.slice(2, -2), `${key}-s`, depth + 1)}
        </del>
      );
    } else if (
      ((token.startsWith('*') && token.endsWith('*')) ||
        (token.startsWith('_') && token.endsWith('_'))) &&
      token.length > 2
    ) {
      nodes.push(
        <em key={key} className="italic">
          {renderInlineMarkdown(token.slice(1, -1), `${key}-i`, depth + 1)}
        </em>
      );
    } else {
      nodes.push(<React.Fragment key={key}>{token}</React.Fragment>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(
      <React.Fragment key={`${keyPrefix}-tail`}>{text.slice(lastIndex)}</React.Fragment>
    );
  }

  return nodes;
}

function alignClass(align: TableAlign): string {
  if (align === 'center') return 'text-center';
  if (align === 'right') return 'text-right';
  return 'text-left';
}

export const LookupMarkdown: React.FC<LookupMarkdownProps> = ({ content }) => {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="select-text-callout space-y-2 text-[14.5px] leading-relaxed text-stone-700 dark:text-stone-200 min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading': {
            const headingClasses =
              block.level === 1
                ? 'text-[17px] font-bold text-stone-900 dark:text-stone-50 leading-snug pt-1 first:pt-0'
                : block.level === 2
                  ? 'text-[16px] font-semibold text-stone-900 dark:text-stone-50 leading-snug pt-1 first:pt-0'
                  : block.level === 3
                    ? 'text-[15px] font-semibold text-stone-900 dark:text-stone-100 leading-snug pt-0.5 first:pt-0'
                    : 'text-[14.5px] font-semibold text-stone-800 dark:text-stone-100 leading-snug pt-0.5 first:pt-0';
            return (
              <div key={`h-${idx}`} role="heading" aria-level={block.level} className={headingClasses}>
                {renderInlineMarkdown(block.text, `h-${idx}`)}
              </div>
            );
          }

          case 'hr':
            return (
              <hr
                key={`hr-${idx}`}
                className="border-t border-stone-200 dark:border-stone-800 my-2"
              />
            );

          case 'code':
            return (
              <div
                key={`code-${idx}`}
                className="rounded-lg overflow-hidden border border-stone-200/80 dark:border-stone-800 bg-stone-100/90 dark:bg-stone-900/90 min-w-0 max-w-full"
              >
                {block.lang && (
                  <div className="px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 border-b border-stone-200/70 dark:border-stone-800">
                    {block.lang}
                  </div>
                )}
                <pre className="overflow-x-auto device-scroll px-3 py-2 text-[12.5px] font-mono leading-relaxed text-stone-800 dark:text-stone-200 whitespace-pre">
                  <code>{block.code}</code>
                </pre>
              </div>
            );

          case 'blockquote':
            return (
              <blockquote
                key={`bq-${idx}`}
                className="border-l-2 border-[var(--tf-accent)] pl-3 py-0.5 space-y-1 text-stone-600 dark:text-stone-300 italic"
              >
                {block.lines.map((qLine, qIdx) => (
                  <p key={qIdx} className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {renderInlineMarkdown(qLine, `bq-${idx}-${qIdx}`)}
                  </p>
                ))}
              </blockquote>
            );

          case 'table':
            return (
              <div
                key={`tbl-${idx}`}
                className="w-full max-w-full overflow-x-auto device-scroll rounded-lg border border-stone-200/90 dark:border-stone-700/80 bg-white/60 dark:bg-stone-900/40"
              >
                <table className="w-full border-collapse text-[13px] leading-snug">
                  <thead>
                    <tr className="bg-stone-100/90 dark:bg-stone-800/80 border-b border-stone-200/90 dark:border-stone-700/80">
                      {block.headers.map((header, cIdx) => (
                        <th
                          key={cIdx}
                          className={`px-2.5 py-2 font-semibold text-stone-900 dark:text-stone-100 align-top ${alignClass(
                            block.alignments[cIdx] ?? 'left'
                          )}`}
                        >
                          {renderInlineMarkdown(header, `th-${idx}-${cIdx}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200/70 dark:divide-stone-800/80">
                    {block.rows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className="odd:bg-transparent even:bg-stone-50/60 dark:even:bg-stone-900/30"
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className={`px-2.5 py-1.5 text-stone-700 dark:text-stone-200 align-top ${alignClass(
                              block.alignments[cIdx] ?? 'left'
                            )}`}
                          >
                            {renderInlineMarkdown(cell, `td-${idx}-${rIdx}-${cIdx}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'ul':
            return (
              <ul key={`ul-${idx}`} className="space-y-1.5 min-w-0">
                {block.items.map((item, itemIdx) => (
                  <li
                    key={itemIdx}
                    className={`flex items-start gap-2.5 min-w-0 ${
                      item.indent === 2 ? 'pl-8' : item.indent === 1 ? 'pl-4' : 'pl-0.5'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-2.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                        item.indent > 0
                          ? 'border border-[var(--tf-accent)] bg-transparent'
                          : 'bg-[var(--tf-accent)]'
                      }`}
                    />
                    <span className="flex-1 min-w-0 break-words [overflow-wrap:anywhere]">
                      {renderInlineMarkdown(item.text, `ul-${idx}-${itemIdx}`)}
                    </span>
                  </li>
                ))}
              </ul>
            );

          case 'ol':
            return (
              <ol key={`ol-${idx}`} className="space-y-1.5 min-w-0">
                {block.items.map((item, itemIdx) => (
                  <li
                    key={itemIdx}
                    className={`flex items-start gap-2 min-w-0 ${
                      item.indent === 2 ? 'pl-8' : item.indent === 1 ? 'pl-4' : 'pl-0.5'
                    }`}
                  >
                    <span className="font-mono-tabular text-[13px] font-semibold text-[var(--tf-accent-text)] shrink-0 min-w-[1.25rem]">
                      {item.num}.
                    </span>
                    <span className="flex-1 min-w-0 break-words [overflow-wrap:anywhere]">
                      {renderInlineMarkdown(item.text, `ol-${idx}-${itemIdx}`)}
                    </span>
                  </li>
                ))}
              </ol>
            );

          case 'paragraph':
          default:
            return (
              <p key={`p-${idx}`} className="min-w-0 break-words [overflow-wrap:anywhere]">
                {renderInlineMarkdown(block.text, `p-${idx}`)}
              </p>
            );
        }
      })}
    </div>
  );
};

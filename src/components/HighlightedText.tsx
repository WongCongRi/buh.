import React from 'react';

interface HighlightedTextProps {
  text: string;
  query: string;
  active?: boolean;
  className?: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  query,
  active = true,
  className = '',
}) => {
  const trimmed = query.trim();
  if (!active || !trimmed) {
    return <span className={className}>{text}</span>;
  }

  const regex = new RegExp(`(${escapeRegExp(trimmed)})`, 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {parts.map((part, i) => {
        const isMatch = part.toLowerCase() === trimmed.toLowerCase();
        if (!isMatch) {
          return <React.Fragment key={i}>{part}</React.Fragment>;
        }
        return (
          <mark
            key={i}
            className="bg-[var(--tf-accent-soft)] text-[var(--tf-accent-text)] rounded-xs px-0.5 font-semibold ring-1 ring-[var(--tf-accent-border)]"
          >
            {part}
          </mark>
        );
      })}
    </span>
  );
};

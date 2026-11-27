import React from 'react';
import { Repeat } from 'lucide-react';
import { StyleThemeTokens } from '../utils/themeTokens';

interface TaskCheckboxProps {
  checked: boolean;
  celebrating?: boolean;
  isProjected?: boolean;
  tokens: StyleThemeTokens;
  ariaLabel: string;
  onClick: () => void;
  size?: 'sm' | 'md';
}

export const TaskCheckbox: React.FC<TaskCheckboxProps> = ({
  checked,
  celebrating = false,
  isProjected = false,
  tokens,
  ariaLabel,
  onClick,
  size = 'md',
}) => {
  const boxSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const iconSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={isProjected ? undefined : checked}
      className={`relative ${boxSize} rounded-full border-2 flex items-center justify-center shrink-0 transition-colors duration-200 ${
        isProjected
          ? 'border-dashed border-stone-300 dark:border-stone-600 text-stone-400'
          : checked
            ? `${tokens.accentBg} border-transparent ${celebrating ? 'task-check-pop' : ''}`
            : 'border-stone-300 dark:border-stone-600 hover:border-[var(--tf-accent)]'
      }`}
    >
      {celebrating && !isProjected && (
        <span
          aria-hidden="true"
          className="task-check-ripple pointer-events-none absolute -inset-[3px] rounded-full border-2 border-[var(--tf-accent)]"
        />
      )}
      {isProjected ? (
        <Repeat className="w-2.5 h-2.5" />
      ) : (
        checked && (
          <svg
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={iconSize}
          >
            <path
              d="M4.5 10.5L8.2 14.2L15.5 6.5"
              pathLength={1}
              stroke="currentColor"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={celebrating ? 'task-check-draw' : undefined}
            />
          </svg>
        )
      )}
    </button>
  );
};

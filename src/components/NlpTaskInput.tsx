import React, { useMemo, useRef } from 'react';
import { tokenizeQuickTaskInput } from '../utils/quickAddParser';

interface NlpTaskInputProps {
  value: string;
  onChange: (value: string) => void;
  nlpEnabled: boolean;
  availableLists: string[];
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
  paddingClassName?: string;
  ariaLabel?: string;
}

export const NlpTaskInput: React.FC<NlpTaskInputProps> = ({
  value,
  onChange,
  nlpEnabled,
  availableLists,
  placeholder,
  autoFocus = false,
  className = '',
  paddingClassName = 'px-3.5 py-2',
  ariaLabel = 'Quick add task',
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  const segments = useMemo(
    () => tokenizeQuickTaskInput(value, nlpEnabled, availableLists),
    [value, nlpEnabled, availableLists]
  );

  const syncScroll = () => {
    if (inputRef.current && backdropRef.current) {
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  if (!nlpEnabled) {
    return (
      <input
        ref={inputRef}
        type="text"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`w-full text-[14.5px] leading-5 ${paddingClassName} text-stone-900 dark:text-stone-100 placeholder:text-stone-400 focus:outline-none ${className}`}
      />
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Highlighted NLP backdrop synchronized pixel-for-pixel with the input */}
      <div
        ref={backdropRef}
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 block whitespace-pre overflow-hidden text-[14.5px] leading-5 font-normal tracking-normal ${paddingClassName}`}
      >
        {value ? (
          segments.map((seg, idx) =>
            seg.kind === 'text' ? (
              <span key={idx} className="text-stone-900 dark:text-stone-100">
                {seg.text}
              </span>
            ) : (
              <span
                key={idx}
                className="bg-[var(--tf-accent-soft)] text-[var(--tf-accent-text)] rounded-xs ring-1 ring-[var(--tf-accent-border)]"
              >
                {seg.text}
              </span>
            )
          )
        ) : (
          <span className="text-stone-400">{placeholder}</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="text"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          requestAnimationFrame(syncScroll);
        }}
        onScroll={syncScroll}
        onKeyUp={syncScroll}
        aria-label={ariaLabel}
        spellCheck={false}
        className={`relative block w-full bg-transparent text-[14.5px] leading-5 font-normal tracking-normal ${paddingClassName} text-transparent caret-stone-900 dark:caret-stone-100 selection:bg-[var(--tf-accent-soft)] focus:outline-none`}
      />
    </div>
  );
};

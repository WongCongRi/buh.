import React from 'react';

interface StudioHeaderProps {
  onApproveClick: () => void;
  approved: boolean;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({ onApproveClick, approved }) => {
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/80 dark:border-stone-800 bg-[#F6F7F5]/90 dark:bg-[#0D100E]/90 backdrop-blur-md">
      <div className="max-w-[1440px] mx-auto px-6 h-13 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element Brand wordmark */}
        <a
          href="#preview"
          className="font-display text-lg font-bold tracking-tight text-stone-900 dark:text-stone-100 whitespace-nowrap shrink-0"
        >
          buh.
        </a>

        {/* Zone 2: 4 concise single-line text nav links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-stone-600 dark:text-stone-400">
          <a
            href="#preview"
            className="hover:text-stone-900 dark:hover:text-stone-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Preview
          </a>
          <a
            href="#screen-bar"
            className="hover:text-stone-900 dark:hover:text-stone-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Screens
          </a>
          <a
            href="#decisions"
            className="hover:text-stone-900 dark:hover:text-stone-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Decisions
          </a>
          <a
            href="#review-notes"
            className="hover:text-stone-900 dark:hover:text-stone-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Review Spec
          </a>
        </nav>

        {/* Zone 3: 1 Primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onApproveClick}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              approved
                ? 'bg-[var(--tf-accent)] text-[var(--tf-accent-fg)] hover:opacity-90'
                : 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-stone-200'
            }`}
          >
            {approved ? 'Direction Approved' : 'Approve Direction'}
          </button>
        </div>
      </div>
    </header>
  );
};

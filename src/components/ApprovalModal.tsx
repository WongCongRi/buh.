import React, { useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { DefaultHome, DesignDecisions, NavMode, QuickCaptureMode, VisualStyle } from '../types/taskflow';
import { normalizeHex } from '../utils/colorUtils';

interface ApprovalModalProps {
  open: boolean;
  decisions: DesignDecisions;
  reviewNote: string;
  onClose: () => void;
  onConfirmApprove: () => void;
}

export const ApprovalModal: React.FC<ApprovalModalProps> = ({
  open,
  decisions,
  reviewNote,
  onClose,
  onConfirmApprove,
}) => {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const accentHex = normalizeHex(decisions.accentColor);

  const styleLabel =
    decisions.visualStyle === VisualStyle.Minimal
      ? `Minimal (clean whitespace, ${accentHex} accent)`
      : decisions.visualStyle === VisualStyle.Samsung
        ? `Samsung-inspired (One UI squircles, ${accentHex} accent)`
        : `Professional (compact, information-dense, ${accentHex} accent)`;

  const navLabel =
    decisions.navMode === NavMode.Five
      ? 'Five tabs (Today, Tasks, Lookup, Notes, Settings)'
      : 'Four tabs (Today, Lookup, Notes, More)';

  const captureLabel =
    decisions.quickCapture === QuickCaptureMode.Fab
      ? 'Floating + button (thumb-zone FAB)'
      : decisions.quickCapture === QuickCaptureMode.Bar
        ? 'Persistent top quick-add bar'
        : 'Both (persistent top bar + floating + button)';

  const homeLabel =
    decisions.defaultHome === DefaultHome.Today
      ? 'Today (focus on what matters today)'
      : decisions.defaultHome === DefaultHome.Inbox
        ? 'Inbox (capture everything first)'
        : 'Dashboard (tasks, calendar & notes overview)';

  const specText = [
    'buh. — Galaxy Z Fold 8 Approved UI Spec',
    `1. Visual Style: ${styleLabel}`,
    `2. Accent Colour: ${accentHex}`,
    `3. Navigation: ${navLabel}`,
    `4. Quick Capture: ${captureLabel}`,
    `5. Default Home: ${homeLabel}`,
    reviewNote.trim() ? `Review Notes: ${reviewNote.trim()}` : 'Review Notes: None',
  ].join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(specText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-[#161917] border border-stone-200 dark:border-stone-800 rounded-2xl p-6 space-y-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-stone-900 dark:text-stone-100">
              Confirm buh. UI Direction
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
              These preferences will guide the Kotlin Jetpack Compose implementation for Samsung Galaxy Z Fold 8.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-800 dark:hover:text-stone-100 rounded-lg"
            aria-label="Close specification modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-xl bg-stone-50 dark:bg-[#111412] border border-stone-200/80 dark:border-stone-800 divide-y divide-stone-200/70 dark:divide-stone-800 text-xs">
          <div className="px-4 py-3 flex justify-between gap-4">
            <span className="text-stone-500 dark:text-stone-400 shrink-0">Visual style</span>
            <span className="font-medium text-stone-900 dark:text-stone-100 text-right">{styleLabel}</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <span className="text-stone-500 dark:text-stone-400 shrink-0">Accent colour</span>
            <span className="inline-flex items-center gap-2 font-mono-tabular font-medium text-stone-900 dark:text-stone-100">
              <span className="w-3.5 h-3.5 rounded-full border border-black/10 bg-[var(--tf-accent)]" />
              {accentHex}
            </span>
          </div>
          <div className="px-4 py-3 flex justify-between gap-4">
            <span className="text-stone-500 dark:text-stone-400 shrink-0">Navigation</span>
            <span className="font-medium text-stone-900 dark:text-stone-100 text-right">{navLabel}</span>
          </div>
          <div className="px-4 py-3 flex justify-between gap-4">
            <span className="text-stone-500 dark:text-stone-400 shrink-0">Quick capture</span>
            <span className="font-medium text-stone-900 dark:text-stone-100 text-right">{captureLabel}</span>
          </div>
          <div className="px-4 py-3 flex justify-between gap-4">
            <span className="text-stone-500 dark:text-stone-400 shrink-0">Default home</span>
            <span className="font-medium text-stone-900 dark:text-stone-100 text-right">{homeLabel}</span>
          </div>
          {reviewNote.trim() && (
            <div className="px-4 py-3 space-y-1">
              <span className="block text-stone-500 dark:text-stone-400">Reviewer notes</span>
              <p className="text-stone-800 dark:text-stone-200 leading-relaxed">{reviewNote}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[var(--tf-accent-text)]" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied spec' : 'Copy spec'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
            >
              Keep reviewing
            </button>
            <button
              type="button"
              onClick={onConfirmApprove}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--tf-accent)] text-[var(--tf-accent-fg)] hover:opacity-90 transition-opacity"
            >
              Lock UI Direction
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

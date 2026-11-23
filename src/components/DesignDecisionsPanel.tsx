import React, { useRef } from 'react';
import {
  DefaultHome,
  DesignDecisions,
  NavMode,
  QuickCaptureMode,
  VisualStyle,
} from '../types/taskflow';
import { ACCENT_PRESETS, DEFAULT_ACCENT_COLOR, normalizeHex } from '../utils/colorUtils';

interface DesignDecisionsPanelProps {
  decisions: DesignDecisions;
  onChangeDecisions: (patch: Partial<DesignDecisions>) => void;
  onSelectAccentColor: (hex: string) => void;
  reviewNote: string;
  onChangeReviewNote: (val: string) => void;
}

export const DesignDecisionsPanel: React.FC<DesignDecisionsPanelProps> = ({
  decisions,
  onChangeDecisions,
  onSelectAccentColor,
  reviewNote,
  onChangeReviewNote,
}) => {
  const debounceRef = useRef<number | null>(null);
  const isRecommended =
    decisions.visualStyle === VisualStyle.Minimal &&
    decisions.navMode === NavMode.Five &&
    decisions.quickCapture === QuickCaptureMode.Fab &&
    decisions.defaultHome === DefaultHome.Today &&
    normalizeHex(decisions.accentColor) === DEFAULT_ACCENT_COLOR;

  const currentHex = normalizeHex(decisions.accentColor);

  const handlePickerChange = (rawHex: string) => {
    const normalized = normalizeHex(rawHex);
    onChangeDecisions({ accentColor: normalized });
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      onSelectAccentColor(normalized);
      debounceRef.current = null;
    }, 450);
  };

  const handlePickerBlur = () => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    onSelectAccentColor(currentHex);
  };

  const renderSegmented = <T extends string>(
    options: { value: T; label: string; hint: string; recommended?: boolean }[],
    current: T,
    onSelect: (val: T) => void
  ) => {
    const activeOption = options.find((o) => o.value === current) || options[0];
    return (
      <div className="space-y-1">
        <div
          className={`grid gap-1 p-1 rounded-xl bg-stone-100 dark:bg-stone-800/80 ${
            options.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
          }`}
        >
          {options.map((opt) => {
            const active = opt.value === current;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSelect(opt.value)}
                className={`px-2 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap truncate ${
                  active
                    ? 'bg-[var(--tf-accent-soft)] text-[var(--tf-accent-text)] border border-[var(--tf-accent-border)]'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 border border-transparent'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-stone-500 dark:text-stone-400 px-0.5 flex items-center justify-between gap-2">
          <span className="truncate">{activeOption.hint}</span>
          {activeOption.recommended && (
            <span className="text-[10.5px] font-medium text-[var(--tf-accent-text)] shrink-0">
              Recommended
            </span>
          )}
        </p>
      </div>
    );
  };

  return (
    <div id="decisions" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-stone-900 dark:text-stone-100">
          Design decisions
        </h2>
        {!isRecommended && (
          <button
            type="button"
            onClick={() => {
              onChangeDecisions({
                visualStyle: VisualStyle.Minimal,
                navMode: NavMode.Five,
                quickCapture: QuickCaptureMode.Fab,
                defaultHome: DefaultHome.Today,
                accentColor: DEFAULT_ACCENT_COLOR,
              });
              onSelectAccentColor(DEFAULT_ACCENT_COLOR);
            }}
            className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-[var(--tf-accent-soft)] text-[var(--tf-accent-text)] whitespace-nowrap shrink-0 hover:opacity-90"
          >
            Apply recommended
          </button>
        )}
      </div>

      {/* Accent Colour Picker */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
            Accent colour
          </h3>
          <span className="font-mono-tabular text-[11px] text-stone-500 dark:text-stone-400">
            {currentHex}
          </span>
        </div>

        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-stone-50 dark:bg-[#111412] border border-stone-200/80 dark:border-stone-800">
          <label
            htmlFor="accent-color-picker"
            className="relative flex items-center gap-2 cursor-pointer shrink-0"
          >
            <input
              id="accent-color-picker"
              type="color"
              value={currentHex}
              onChange={(e) => handlePickerChange(e.target.value)}
              onBlur={handlePickerBlur}
              className="w-7 h-7 rounded-lg border border-stone-300 dark:border-stone-700 bg-transparent cursor-pointer p-0.5"
              aria-label="Pick custom accent colour"
            />
            <span className="text-[11.5px] font-medium text-stone-700 dark:text-stone-200 whitespace-nowrap">
              Custom
            </span>
          </label>

          <div className="h-4 w-px bg-stone-200 dark:bg-stone-800 shrink-0" />

          <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Preset accent colours">
            {ACCENT_PRESETS.map((preset) => {
              const isCurrent = currentHex === preset.hex;
              return (
                <button
                  key={preset.hex}
                  type="button"
                  title={`${preset.name} (${preset.hex})`}
                  aria-label={`${preset.name} ${preset.hex}`}
                  onClick={() => onSelectAccentColor(preset.hex)}
                  className={`w-5 h-5 rounded-full transition-transform border ${
                    isCurrent
                      ? 'scale-110 ring-2 ring-offset-1 ring-stone-900 dark:ring-stone-100 dark:ring-offset-[#111412] border-transparent'
                      : 'border-black/10 dark:border-white/15 hover:scale-105'
                  }`}
                >
                  <span
                    className="block w-full h-full rounded-full"
                    style={{ backgroundColor: preset.hex }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 1. Overall Visual Style */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
          01. Visual style
        </h3>
        {renderSegmented(
          [
            {
              value: VisualStyle.Minimal,
              label: 'Minimal',
              hint: 'Airy whitespace, subtle hairlines, calm accent',
              recommended: true,
            },
            {
              value: VisualStyle.Samsung,
              label: 'Samsung',
              hint: 'One UI squircles and soft tonal layers',
            },
            {
              value: VisualStyle.Professional,
              label: 'Professional',
              hint: 'Compact rows, tighter corners, higher density',
            },
          ],
          decisions.visualStyle,
          (visualStyle) => onChangeDecisions({ visualStyle })
        )}
      </div>

      {/* 2. Navigation */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
          02. Navigation
        </h3>
        {renderSegmented(
          [
            {
              value: NavMode.Five,
              label: 'Five tabs',
              hint: 'Today, Tasks, Lookup, Notes, Settings',
              recommended: true,
            },
            {
              value: NavMode.Four,
              label: 'Four tabs',
              hint: 'Today, Lookup, Notes, More drawer',
            },
          ],
          decisions.navMode,
          (navMode) => onChangeDecisions({ navMode })
        )}
      </div>

      {/* 3. Quick Task Capture */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
          03. Quick capture
        </h3>
        {renderSegmented(
          [
            {
              value: QuickCaptureMode.Fab,
              label: 'Floating +',
              hint: 'Lower thumb-zone FAB keeps lists uncluttered',
              recommended: true,
            },
            {
              value: QuickCaptureMode.Bar,
              label: 'Top bar',
              hint: 'Always-visible input field below the header',
            },
            {
              value: QuickCaptureMode.Both,
              label: 'Both',
              hint: 'Top inline bar plus floating + button',
            },
          ],
          decisions.quickCapture,
          (quickCapture) => onChangeDecisions({ quickCapture })
        )}
      </div>

      {/* 4. Default Home Screen */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
          04. Default home
        </h3>
        {renderSegmented(
          [
            {
              value: DefaultHome.Today,
              label: 'Today',
              hint: 'Calm focus on what matters today',
              recommended: true,
            },
            {
              value: DefaultHome.Inbox,
              label: 'Inbox',
              hint: 'Capture-first triage stream before sorting',
            },
            {
              value: DefaultHome.Dashboard,
              label: 'Dashboard',
              hint: 'Tasks, next calendar block, and pinned notes',
            },
          ],
          decisions.defaultHome,
          (defaultHome) => onChangeDecisions({ defaultHome })
        )}
      </div>

      {/* Reviewer Feedback / Notes */}
      <div id="review-notes" className="space-y-1.5 pt-2 border-t border-stone-200/80 dark:border-stone-800">
        <label htmlFor="reviewer-notes" className="block text-xs font-semibold text-stone-800 dark:text-stone-200">
          Review notes
        </label>
        <textarea
          id="reviewer-notes"
          rows={2}
          value={reviewNote}
          onChange={(e) => onChangeReviewNote(e.target.value)}
          placeholder="Optional tweaks before Kotlin Compose build..."
          className="w-full text-xs leading-snug p-2.5 rounded-xl bg-white dark:bg-[#161917] border border-stone-200/80 dark:border-stone-800 text-stone-800 dark:text-stone-200 placeholder:text-stone-400 focus:outline-none focus:border-[var(--tf-accent)] resize-none"
        />
      </div>
    </div>
  );
};

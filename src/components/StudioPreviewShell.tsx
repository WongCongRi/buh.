import React from 'react';
import {
  Columns2,
  Download,
  Keyboard,
  Loader2,
  Maximize2,
  Moon,
  RotateCcw,
  Smartphone,
  SplitSquareVertical,
  Sun,
  Tablet,
} from 'lucide-react';
import {
  DefaultHome,
  DesignDecisions,
  FoldPosture,
  ScreenId,
} from '../types/taskflow';
import { ApprovalModal } from './ApprovalModal';
import { DesignDecisionsPanel } from './DesignDecisionsPanel';
import { PWAInstallButton } from './PWAInstallButton';
import { StudioHeader } from './StudioHeader';

export interface StudioPreviewShellProps {
  posture: FoldPosture;
  onChangePosture: (posture: FoldPosture) => void;
  activeScreen: ScreenId;
  onChangeScreen: (screen: ScreenId) => void;
  decisions: DesignDecisions;
  onChangeDecisions: (patch: Partial<DesignDecisions>) => void;
  onSelectAccentColor: (hex: string) => void;
  reviewNote: string;
  onChangeReviewNote: (note: string) => void;
  approved: boolean;
  approvalOpen: boolean;
  onOpenApproval: () => void;
  onCloseApproval: () => void;
  onConfirmApprove: () => void;
  isDark: boolean;
  onToggleDark: () => void;
  showHingeGuide: boolean;
  onToggleHingeGuide: () => void;
  simulatedKeyboardOpen: boolean;
  onToggleSimulatedKeyboard: () => void;
  exportingSource: boolean;
  onDownloadSource: () => void;
  onResetDemo: () => void;
  onEnterAppMode: () => void;
  children: React.ReactNode;
}

export const StudioPreviewShell: React.FC<StudioPreviewShellProps> = ({
  posture,
  onChangePosture,
  activeScreen,
  onChangeScreen,
  decisions,
  onChangeDecisions,
  onSelectAccentColor,
  reviewNote,
  onChangeReviewNote,
  approved,
  approvalOpen,
  onOpenApproval,
  onCloseApproval,
  onConfirmApprove,
  isDark,
  onToggleDark,
  showHingeGuide,
  onToggleHingeGuide,
  simulatedKeyboardOpen,
  onToggleSimulatedKeyboard,
  exportingSource,
  onDownloadSource,
  onResetDemo,
  onEnterAppMode,
  children,
}) => {
  const homeTabTitle =
    decisions.defaultHome === DefaultHome.Inbox ? 'Inbox' : 'Overview';

  const screenTabs: { id: ScreenId; label: string }[] = [
    { id: ScreenId.Home, label: homeTabTitle },
    { id: ScreenId.Tasks, label: 'Tasks' },
    { id: ScreenId.Agent, label: 'Lookup' },
    { id: ScreenId.Notes, label: 'Notes' },
    { id: ScreenId.Settings, label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-[#F6F7F5] dark:bg-[#0D100E] text-stone-900 dark:text-stone-100 transition-colors">
      <StudioHeader onApproveClick={onOpenApproval} approved={approved} />

      <main className="max-w-[1440px] mx-auto px-6 py-4 space-y-4">
        {/* Compact Workspace Title + Quick Actions */}
        <section id="preview" className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Galaxy Z Fold 8 UI Review
            </h1>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Switch postures, test live screens, and lock in your design preferences.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={onEnterAppMode}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-[#161917] border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors whitespace-nowrap"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              App mode
            </button>
            <button
              type="button"
              onClick={onDownloadSource}
              disabled={exportingSource}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-[#161917] border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors whitespace-nowrap disabled:opacity-60"
            >
              {exportingSource ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {exportingSource ? 'Exporting...' : 'Download source (.zip)'}
            </button>
            <button
              type="button"
              onClick={onToggleDark}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-[#161917] border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors whitespace-nowrap"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {isDark ? 'Light' : 'Dark'}
            </button>
            <button
              type="button"
              onClick={onResetDemo}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-[#161917] border border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset data
            </button>
          </div>
        </section>

        {/* Single-Viewport Workspace: Simulator Stage (Left) + Design Decisions Inspector (Right) */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Stage: Galaxy Z Fold 8 Simulator */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-3">
            {/* Unified Posture & Screen Toolbar */}
            <div
              id="screen-bar"
              className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#161917] border border-stone-200/80 dark:border-stone-800 rounded-2xl p-2"
            >
              {/* Posture Switcher */}
              <div className="flex items-center gap-1 p-0.5 bg-stone-100 dark:bg-stone-800/80 rounded-xl">
                <button
                  type="button"
                  onClick={() => onChangePosture(FoldPosture.Cover)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    posture === FoldPosture.Cover
                      ? 'bg-white dark:bg-[#1E2220] text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  Cover 10:16
                </button>
                <button
                  type="button"
                  onClick={() => onChangePosture(FoldPosture.Inner)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    posture === FoldPosture.Inner
                      ? 'bg-white dark:bg-[#1E2220] text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  <Tablet className="w-3.5 h-3.5" />
                  Inner 4:3
                </button>
                <button
                  type="button"
                  onClick={() => onChangePosture(FoldPosture.Flex)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    posture === FoldPosture.Flex
                      ? 'bg-white dark:bg-[#1E2220] text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  <SplitSquareVertical className="w-3.5 h-3.5" />
                  Flex
                </button>
              </div>

              {/* Screen Quick-Jump Tabs + Optional Hinge Guide */}
              <div className="flex flex-wrap items-center gap-1.5">
                {posture === FoldPosture.Inner && (
                  <button
                    type="button"
                    onClick={onToggleHingeGuide}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                      showHingeGuide
                        ? 'bg-[var(--tf-accent-soft)] border-[var(--tf-accent-border)] text-[var(--tf-accent-text)]'
                        : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800'
                    }`}
                  >
                    <Columns2 className="w-3 h-3" />
                    Hinge
                  </button>
                )}

                <button
                  type="button"
                  onClick={onToggleSimulatedKeyboard}
                  aria-pressed={simulatedKeyboardOpen}
                  title="Toggle simulated Android on-screen keyboard inside the device preview"
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    simulatedKeyboardOpen
                      ? 'bg-[var(--tf-accent-soft)] border-[var(--tf-accent-border)] text-[var(--tf-accent-text)]'
                      : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800'
                  }`}
                >
                  <Keyboard className="w-3.5 h-3.5" />
                  Android KB
                </button>

                <div className="flex items-center gap-0.5 p-0.5 bg-stone-100 dark:bg-stone-800/80 rounded-xl">
                  {screenTabs.map((tab) => {
                    const active = activeScreen === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => onChangeScreen(tab.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-[var(--tf-accent-soft)] text-[var(--tf-accent-text)]'
                            : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Interactive Device Canvas */}
            <div className="bg-[#ECEEE9] dark:bg-[#131614] border border-stone-200/80 dark:border-stone-800 rounded-3xl p-4 sm:p-5 flex items-center justify-center">
              {children}
            </div>
          </div>

          {/* Right Rail: Compact Design Decisions & Notes */}
          <aside className="lg:col-span-5 xl:col-span-4 bg-white dark:bg-[#161917] border border-stone-200/80 dark:border-stone-800 rounded-2xl p-4 sm:p-5">
            <DesignDecisionsPanel
              decisions={decisions}
              onChangeDecisions={onChangeDecisions}
              onSelectAccentColor={onSelectAccentColor}
              reviewNote={reviewNote}
              onChangeReviewNote={onChangeReviewNote}
            />
          </aside>
        </section>
      </main>

      <ApprovalModal
        open={approvalOpen}
        decisions={decisions}
        reviewNote={reviewNote}
        onClose={onCloseApproval}
        onConfirmApprove={onConfirmApprove}
      />
    </div>
  );
};

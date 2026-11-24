import React, { useState } from 'react';
import { ArrowUp, ChevronDown, CornerDownLeft, Delete } from 'lucide-react';
import { FoldPosture } from '../types/taskflow';

interface AndroidKeyboardSimulatorProps {
  posture: FoldPosture;
  onDismiss: () => void;
}

const LETTER_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const SYMBOL_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['*', '_', '#', '~', '`', '[', ']', '(', ')'],
  ['>', '-', '/', ':', ';', '!', '?'],
];

function applyTextToActiveElement(action: { type: 'insert'; text: string } | { type: 'backspace' } | { type: 'enter' }) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;

  // Handle native <input> and <textarea> (React controlled compatible)
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? active.value.length;

    if (action.type === 'enter') {
      if (active instanceof HTMLInputElement) {
        const keyEvt = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        });
        active.dispatchEvent(keyEvt);
        if (!keyEvt.defaultPrevented && active.form) {
          active.form.requestSubmit();
        }
        return;
      }
      // Textarea newline
      action = { type: 'insert', text: '\n' };
    }

    let nextValue = active.value;
    let nextCaret = start;

    if (action.type === 'backspace') {
      if (start !== end) {
        nextValue = active.value.slice(0, start) + active.value.slice(end);
        nextCaret = start;
      } else if (start > 0) {
        nextValue = active.value.slice(0, start - 1) + active.value.slice(end);
        nextCaret = start - 1;
      } else {
        active.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Backspace',
            code: 'Backspace',
            bubbles: true,
            cancelable: true,
          })
        );
        return;
      }
    } else if (action.type === 'insert') {
      nextValue = active.value.slice(0, start) + action.text + active.value.slice(end);
      nextCaret = start + action.text.length;
    }

    const proto =
      active instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    descriptor?.set?.call(active, nextValue);
    try {
      active.setSelectionRange(nextCaret, nextCaret);
    } catch {
      // ignore unsupported input types
    }
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Handle contentEditable (e.g. MarkdownLiveField)
  if (active.isContentEditable) {
    if (action.type === 'enter') {
      const enterEvt = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      active.dispatchEvent(enterEvt);
      if (!enterEvt.defaultPrevented) {
        document.execCommand('insertText', false, '\n');
      }
      return;
    }

    if (action.type === 'backspace') {
      if (!active.textContent) {
        active.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Backspace',
            code: 'Backspace',
            bubbles: true,
            cancelable: true,
          })
        );
        return;
      }
      document.execCommand('delete', false);
      return;
    }

    document.execCommand('insertText', false, action.text);
  }
}

export const AndroidKeyboardSimulator: React.FC<AndroidKeyboardSimulatorProps> = ({
  posture,
  onDismiss,
}) => {
  const [shifted, setShifted] = useState(false);
  const [symbolsMode, setSymbolsMode] = useState(false);

  const rows = symbolsMode ? SYMBOL_ROWS : LETTER_ROWS;
  const isWide = posture === FoldPosture.Inner;

  const preventFocusLoss = (e: React.SyntheticEvent) => {
    e.preventDefault();
  };

  const handleKeyPress = (rawKey: string) => {
    const ch = !symbolsMode && shifted ? rawKey.toUpperCase() : rawKey;
    applyTextToActiveElement({ type: 'insert', text: ch });
    if (shifted && !symbolsMode) {
      setShifted(false);
    }
  };

  const keyHeight = isWide ? 'h-8' : 'h-9';
  const keyText = isWide ? 'text-[13px]' : 'text-[14px]';

  return (
    <div
      onPointerDown={preventFocusLoss}
      onMouseDown={preventFocusLoss}
      aria-label="Simulated Android on-screen keyboard"
      className="shrink-0 w-full select-none bg-[#E6E9E4] dark:bg-[#191C1A] border-t border-stone-300/80 dark:border-stone-800 pt-1 pb-2 px-1.5 space-y-1.5 z-30"
    >
      {/* Android Suggestion / Quick-Symbol Strip */}
      <div className="flex items-center justify-between gap-1 px-1 pb-0.5 text-[11px] text-stone-500 dark:text-stone-400">
        <div className="flex items-center gap-1 overflow-hidden">
          {['\\', '**', '*', '#', '`', '~~'].map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => applyTextToActiveElement({ type: 'insert', text: sym })}
              className="px-2 py-0.5 rounded-md bg-white/80 dark:bg-stone-800/90 text-stone-700 dark:text-stone-200 font-mono text-[11px] hover:opacity-85 active:scale-95 transition-transform"
              title={`Insert ${sym}`}
            >
              {sym}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide simulated Android keyboard"
          title="Hide keyboard"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-300/60 dark:hover:bg-stone-700/70 transition-colors shrink-0"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          Hide
        </button>
      </div>

      {/* Row 1 */}
      <div className={`grid grid-cols-10 gap-1 ${isWide ? 'max-w-[540px] mx-auto' : ''}`}>
        {rows[0].map((k) => {
          const display = !symbolsMode && shifted ? k.toUpperCase() : k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => handleKeyPress(k)}
              className={`${keyHeight} ${keyText} font-medium rounded-md bg-white dark:bg-[#262A27] text-stone-900 dark:text-stone-100 shadow-[0_1px_0_rgba(0,0,0,0.18)] active:scale-95 transition-transform`}
            >
              {display}
            </button>
          );
        })}
      </div>

      {/* Row 2 */}
      <div className={`grid grid-cols-9 gap-1 px-3 ${isWide ? 'max-w-[520px] mx-auto' : ''}`}>
        {rows[1].map((k) => {
          const display = !symbolsMode && shifted ? k.toUpperCase() : k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => handleKeyPress(k)}
              className={`${keyHeight} ${keyText} font-medium rounded-md bg-white dark:bg-[#262A27] text-stone-900 dark:text-stone-100 shadow-[0_1px_0_rgba(0,0,0,0.18)] active:scale-95 transition-transform`}
            >
              {display}
            </button>
          );
        })}
      </div>

      {/* Row 3 (Shift + Letters + Backspace) */}
      <div className={`flex items-center gap-1 ${isWide ? 'max-w-[540px] mx-auto' : ''}`}>
        <button
          type="button"
          onClick={() => {
            if (symbolsMode) {
              setSymbolsMode(false);
            } else {
              setShifted((v) => !v);
            }
          }}
          aria-label="Shift"
          className={`${keyHeight} w-10 shrink-0 rounded-md flex items-center justify-center shadow-[0_1px_0_rgba(0,0,0,0.18)] active:scale-95 transition-all ${
            shifted && !symbolsMode
              ? 'bg-[var(--tf-accent)] text-[var(--tf-accent-fg)]'
              : 'bg-[#D5D9D2] dark:bg-[#2F3431] text-stone-800 dark:text-stone-200'
          }`}
        >
          <ArrowUp className="w-4 h-4" />
        </button>

        <div className="flex-1 grid grid-cols-7 gap-1">
          {rows[2].map((k) => {
            const display = !symbolsMode && shifted ? k.toUpperCase() : k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => handleKeyPress(k)}
                className={`${keyHeight} ${keyText} font-medium rounded-md bg-white dark:bg-[#262A27] text-stone-900 dark:text-stone-100 shadow-[0_1px_0_rgba(0,0,0,0.18)] active:scale-95 transition-transform`}
              >
                {display}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => applyTextToActiveElement({ type: 'backspace' })}
          aria-label="Backspace"
          className={`${keyHeight} w-10 shrink-0 rounded-md bg-[#D5D9D2] dark:bg-[#2F3431] text-stone-800 dark:text-stone-200 flex items-center justify-center shadow-[0_1px_0_rgba(0,0,0,0.18)] active:scale-95 transition-transform`}
        >
          <Delete className="w-4 h-4" />
        </button>
      </div>

      {/* Row 4 (?123 + , + Space + . + Enter) */}
      <div className={`flex items-center gap-1 ${isWide ? 'max-w-[540px] mx-auto' : ''}`}>
        <button
          type="button"
          onClick={() => setSymbolsMode((v) => !v)}
          className={`${keyHeight} px-2.5 shrink-0 rounded-md bg-[#D5D9D2] dark:bg-[#2F3431] text-stone-800 dark:text-stone-200 text-[12px] font-semibold shadow-[0_1px_0_rgba(0,0,0,0.18)] active:scale-95 transition-transform`}
        >
          {symbolsMode ? 'ABC' : '?123'}
        </button>
        <button
          type="button"
          onClick={() => applyTextToActiveElement({ type: 'insert', text: ',' })}
          className={`${keyHeight} w-8 shrink-0 rounded-md bg-[#D5D9D2] dark:bg-[#2F3431] text-stone-800 dark:text-stone-200 ${keyText} font-medium shadow-[0_1px_0_rgba(0,0,0,0.18)] active:scale-95 transition-transform`}
        >
          ,
        </button>
        <button
          type="button"
          onClick={() => applyTextToActiveElement({ type: 'insert', text: ' ' })}
          aria-label="Space"
          className={`${keyHeight} flex-1 rounded-md bg-white dark:bg-[#262A27] text-stone-400 dark:text-stone-500 text-[11px] font-medium shadow-[0_1px_0_rgba(0,0,0,0.18)] active:scale-95 transition-transform`}
        >
          Android Keyboard
        </button>
        <button
          type="button"
          onClick={() => applyTextToActiveElement({ type: 'insert', text: '.' })}
          className={`${keyHeight} w-8 shrink-0 rounded-md bg-[#D5D9D2] dark:bg-[#2F3431] text-stone-800 dark:text-stone-200 ${keyText} font-medium shadow-[0_1px_0_rgba(0,0,0,0.18)] active:scale-95 transition-transform`}
        >
          .
        </button>
        <button
          type="button"
          onClick={() => applyTextToActiveElement({ type: 'enter' })}
          aria-label="Enter"
          className={`${keyHeight} w-11 shrink-0 rounded-md bg-[var(--tf-accent)] text-[var(--tf-accent-fg)] flex items-center justify-center shadow-[0_1px_0_rgba(0,0,0,0.18)] active:scale-95 transition-transform`}
        >
          <CornerDownLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

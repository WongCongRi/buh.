import { useEffect, useRef, useState } from 'react';

interface BackLayerEntry {
  id: number;
  priority: number;
  order: number;
  onClose: () => boolean | void;
}

const EXIT_WINDOW_MS = 2200;
const SENTINEL_STATE_KEY = '__buhBackSentinel';

let nextLayerId = 1;
let nextLayerOrder = 1;
const layerStack: BackLayerEntry[] = [];
const layerAddedListeners = new Set<() => void>();

function registerLayer(onClose: () => boolean | void, priority: number): number {
  const id = nextLayerId++;
  layerStack.push({
    id,
    priority,
    order: nextLayerOrder++,
    onClose,
  });
  layerAddedListeners.forEach((fn) => fn());
  return id;
}

function updateLayerHandler(id: number, onClose: () => boolean | void): void {
  const entry = layerStack.find((item) => item.id === id);
  if (entry) {
    entry.onClose = onClose;
  }
}

function unregisterLayer(id: number): void {
  const idx = layerStack.findIndex((item) => item.id === id);
  if (idx !== -1) {
    layerStack.splice(idx, 1);
  }
}

function getTopLayer(): BackLayerEntry | null {
  if (layerStack.length === 0) return null;
  let top = layerStack[0];
  for (let i = 1; i < layerStack.length; i += 1) {
    const candidate = layerStack[i];
    if (
      candidate.priority > top.priority ||
      (candidate.priority === top.priority && candidate.order > top.order)
    ) {
      top = candidate;
    }
  }
  return top;
}

function hasSentinelState(state: unknown): boolean {
  return Boolean(
    state &&
      typeof state === 'object' &&
      (state as Record<string, unknown>)[SENTINEL_STATE_KEY] === true
  );
}

/**
 * Registers a dismissible popup, modal, drawer, sheet, or temporary menu
 * with the global Android Back button stack.
 *
 * Higher `priority` layers close first; equal priorities close in LIFO order.
 * Returning `false` from `onClose` keeps the layer open (e.g. while an action is busy).
 */
export function useBackLayer(
  isOpen: boolean,
  onClose: () => boolean | void,
  priority = 0
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const layerIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      if (layerIdRef.current !== null) {
        unregisterLayer(layerIdRef.current);
        layerIdRef.current = null;
      }
      return;
    }

    const id = registerLayer(() => onCloseRef.current(), priority);
    layerIdRef.current = id;

    return () => {
      unregisterLayer(id);
      if (layerIdRef.current === id) {
        layerIdRef.current = null;
      }
    };
  }, [isOpen, priority]);

  useEffect(() => {
    if (layerIdRef.current !== null) {
      updateLayerHandler(layerIdRef.current, () => onCloseRef.current());
    }
  }, [onClose]);
}

/**
 * Coordinates the Android hardware/gesture Back button via the History API:
 * - If any popup/temp menu is registered via `useBackLayer`, Back closes the topmost one
 *   and keeps the app open.
 * - If no popups are open, the first Back press shows a "Press back again to exit" toast
 *   for 2.2 seconds. Pressing Back again within that window lets the OS exit natively.
 */
export function useAndroidBackController(enabled: boolean): { showExitToast: boolean } {
  const [showExitToast, setShowExitToast] = useState(false);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const sentinelArmedRef = useRef<boolean>(false);
  const exitWindowActiveRef = useRef<boolean>(false);
  const exitTimerRef = useRef<number | null>(null);
  const recentGestureUntilRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasTransientUserActivation = (): boolean => {
      const ua = (
        navigator as Navigator & {
          userActivation?: { isActive?: boolean; hasBeenActive?: boolean };
        }
      ).userActivation;
      if (typeof ua?.isActive === 'boolean') {
        return ua.isActive;
      }
      return Date.now() <= recentGestureUntilRef.current;
    };

    const clearExitWindow = () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      if (exitWindowActiveRef.current) {
        exitWindowActiveRef.current = false;
        setShowExitToast(false);
      }
    };

    const armSentinel = (allowWithoutGesture = false) => {
      if (!enabledRef.current) return;
      if (exitWindowActiveRef.current) return;

      if (hasSentinelState(window.history.state)) {
        sentinelArmedRef.current = true;
        return;
      }

      if (sentinelArmedRef.current) return;
      // Require genuine transient user activation before pushing a history sentinel so
      // Chrome Android's History Manipulation Intervention never marks entry 0 skippable.
      if (!allowWithoutGesture && !hasTransientUserActivation()) return;

      try {
        const baseState =
          window.history.state && typeof window.history.state === 'object'
            ? (window.history.state as Record<string, unknown>)
            : {};
        window.history.pushState(
          { ...baseState, [SENTINEL_STATE_KEY]: true },
          '',
          window.location.href
        );
        sentinelArmedRef.current = true;
      } catch {
        // Ignore restricted history contexts
      }
    };

    if (!enabled) {
      clearExitWindow();
      return;
    }

    // If the page reloaded while already sitting on our sentinel state, recognize it.
    if (hasSentinelState(window.history.state)) {
      sentinelArmedRef.current = true;
    } else if (hasTransientUserActivation()) {
      armSentinel();
    }

    const handleUserInteraction = () => {
      recentGestureUntilRef.current = Date.now() + 1000;
      if (exitWindowActiveRef.current) {
        clearExitWindow();
      }
      armSentinel();
    };

    const handleLayerAdded = () => {
      if (!enabledRef.current) return;
      if (exitWindowActiveRef.current) {
        clearExitWindow();
      }
      armSentinel();
    };

    const handlePopState = (event: PopStateEvent) => {
      if (!enabledRef.current) return;

      // Ignore popstate events that land ON our sentinel (e.g. forward navigation)
      if (hasSentinelState(event.state)) {
        sentinelArmedRef.current = true;
        return;
      }

      // Only intercept if we were previously guarding via our sentinel
      if (!sentinelArmedRef.current) return;
      sentinelArmedRef.current = false;

      const topLayer = getTopLayer();
      if (topLayer) {
        clearExitWindow();
        try {
          const result = topLayer.onClose();
          if (result !== false) {
            unregisterLayer(topLayer.id);
          }
        } finally {
          // Only re-arm immediately inside popstate if another nested layer is still open;
          // otherwise wait for the next real user tap so Chrome never flags entry 0 skippable.
          if (layerStack.length > 0) {
            armSentinel(true);
          }
        }
        return;
      }

      // No popups/temp menus are open: leave browser at base entry 0 during the
      // 2.2s window so a second Back press exits the PWA/TWA natively.
      exitWindowActiveRef.current = true;
      setShowExitToast(true);
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        exitWindowActiveRef.current = false;
        setShowExitToast(false);
      }, EXIT_WINDOW_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clearExitWindow();
        if (hasSentinelState(window.history.state)) {
          sentinelArmedRef.current = true;
        }
      }
    };

    layerAddedListeners.add(handleLayerAdded);
    window.addEventListener('pointerdown', handleUserInteraction, { capture: true, passive: true });
    window.addEventListener('pointerup', handleUserInteraction, { capture: true, passive: true });
    window.addEventListener('touchend', handleUserInteraction, { capture: true, passive: true });
    window.addEventListener('click', handleUserInteraction, { capture: true, passive: true });
    window.addEventListener('keydown', handleUserInteraction, { capture: true, passive: true });
    window.addEventListener('popstate', handlePopState);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearExitWindow();
      layerAddedListeners.delete(handleLayerAdded);
      window.removeEventListener('pointerdown', handleUserInteraction, { capture: true });
      window.removeEventListener('pointerup', handleUserInteraction, { capture: true });
      window.removeEventListener('touchend', handleUserInteraction, { capture: true });
      window.removeEventListener('click', handleUserInteraction, { capture: true });
      window.removeEventListener('keydown', handleUserInteraction, { capture: true });
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled]);

  return { showExitToast };
}

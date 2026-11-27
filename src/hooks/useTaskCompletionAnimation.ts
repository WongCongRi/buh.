import { useCallback, useEffect, useRef, useState } from 'react';
import { TaskItem } from '../types/taskflow';
import { compareTasksAscending } from '../utils/taskSort';

const CELEBRATE_HOLD_MS = 380;
const SETTLE_ANIM_MS = 250;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Tracks tasks that just transitioned from incomplete -> completed so they can:
 * 1. Play the checkbox pop, checkmark ink-draw, accent ring ripple, and left-to-right strikethrough in place.
 * 2. Hold their vertical list position briefly (~380ms) before softly settling down into the completed section.
 */
export function useTaskCompletionAnimation(tasks: TaskItem[]) {
  const [celebratingIds, setCelebratingIds] = useState<Set<string>>(() => new Set());
  const [justSettledIds, setJustSettledIds] = useState<Set<string>>(() => new Set());

  const prevCompletedRef = useRef<Map<string, boolean> | null>(null);
  const holdTimersRef = useRef<Map<string, number>>(new Map());
  const settleTimersRef = useRef<Map<string, number>>(new Map());

  const clearTimersFor = useCallback((id: string) => {
    const holdTimer = holdTimersRef.current.get(id);
    if (holdTimer !== undefined) {
      window.clearTimeout(holdTimer);
      holdTimersRef.current.delete(id);
    }
    const settleTimer = settleTimersRef.current.get(id);
    if (settleTimer !== undefined) {
      window.clearTimeout(settleTimer);
      settleTimersRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const nextMap = new Map<string, boolean>();
    for (const t of tasks) {
      nextMap.set(t.id, t.completed);
    }

    // First render: seed without animating already-completed tasks
    if (prevCompletedRef.current === null) {
      prevCompletedRef.current = nextMap;
      return;
    }

    const prevMap = prevCompletedRef.current;
    prevCompletedRef.current = nextMap;

    const newlyCompleted: string[] = [];
    const newlyReopened: string[] = [];

    for (const t of tasks) {
      const wasCompleted = prevMap.get(t.id);
      if (wasCompleted === false && t.completed) {
        newlyCompleted.push(t.id);
      } else if (wasCompleted === true && !t.completed) {
        newlyReopened.push(t.id);
      }
    }

    if (newlyReopened.length > 0) {
      for (const id of newlyReopened) {
        clearTimersFor(id);
      }
      setCelebratingIds((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of newlyReopened) {
          if (next.delete(id)) changed = true;
        }
        return changed ? next : prev;
      });
      setJustSettledIds((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of newlyReopened) {
          if (next.delete(id)) changed = true;
        }
        return changed ? next : prev;
      });
    }

    if (newlyCompleted.length > 0 && !prefersReducedMotion()) {
      setCelebratingIds((prev) => {
        const next = new Set(prev);
        for (const id of newlyCompleted) next.add(id);
        return next;
      });

      for (const id of newlyCompleted) {
        clearTimersFor(id);
        const holdTimer = window.setTimeout(() => {
          holdTimersRef.current.delete(id);
          setCelebratingIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          setJustSettledIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
          const settleTimer = window.setTimeout(() => {
            settleTimersRef.current.delete(id);
            setJustSettledIds((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }, SETTLE_ANIM_MS);
          settleTimersRef.current.set(id, settleTimer);
        }, CELEBRATE_HOLD_MS);
        holdTimersRef.current.set(id, holdTimer);
      }
    }
  }, [tasks, clearTimersFor]);

  useEffect(() => {
    return () => {
      for (const timer of holdTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      for (const timer of settleTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      holdTimersRef.current.clear();
      settleTimersRef.current.clear();
    };
  }, []);

  // Comparator that temporarily keeps freshly completed tasks in place until their celebration finishes
  const compareWithCompletionHold = useCallback(
    (a: TaskItem, b: TaskItem): number => {
      const aHolding = celebratingIds.has(a.id);
      const bHolding = celebratingIds.has(b.id);
      if (!aHolding && !bHolding) {
        return compareTasksAscending(a, b);
      }
      const effA = aHolding ? { ...a, completed: false } : a;
      const effB = bHolding ? { ...b, completed: false } : b;
      return compareTasksAscending(effA, effB);
    },
    [celebratingIds]
  );

  return {
    celebratingIds,
    justSettledIds,
    compareWithCompletionHold,
  };
}

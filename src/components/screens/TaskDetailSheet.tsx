import React, { useEffect, useRef, useState } from 'react';
import { TaskItem } from '../../types/taskflow';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { TaskDetailPane } from './TaskDetailPane';
import { useBackLayer } from '../../hooks/useAndroidBackNavigation';

interface TaskDetailSheetProps {
  task: TaskItem | null;
  tokens: StyleThemeTokens;
  taskLists: string[];
  heightClass?: string;
  highlightQuery?: string;
  highlightTrigger?: number;
  onDismissHighlight?: () => void;
  onClose: () => void;
  onToggleTask?: (taskId: string) => void;
  onUpdateTask: (updated: TaskItem) => void;
  onDeleteTask: (taskId: string) => void;
  isDirtyGoogleTask?: boolean;
  onSyncGoogleTask?: (task: TaskItem) => void;
  canPushToGoogle?: boolean;
  onPushToGoogle?: (task: TaskItem) => void;
}

const SHEET_EXIT_MS = 220;

export const TaskDetailSheet: React.FC<TaskDetailSheetProps> = ({
  task,
  tokens,
  taskLists,
  heightClass = 'h-[94%]',
  highlightQuery = '',
  highlightTrigger,
  onDismissHighlight,
  onClose,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
  isDirtyGoogleTask = false,
  onSyncGoogleTask,
  canPushToGoogle = false,
  onPushToGoogle,
}) => {
  const [renderedTask, setRenderedTask] = useState<TaskItem | null>(task);
  const [visible, setVisible] = useState(Boolean(task));

  useBackLayer(Boolean(task), onClose, 0);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    canDragBody: boolean;
    engaged: boolean;
  } | null>(null);
  const lastDragYRef = useRef(0);

  useEffect(() => {
    if (task) {
      setRenderedTask(task);
      const raf = window.requestAnimationFrame(() => {
        setVisible(true);
      });
      return () => window.cancelAnimationFrame(raf);
    }

    setVisible(false);
    const timer = window.setTimeout(() => {
      setRenderedTask(null);
    }, SHEET_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [task]);

  useEffect(() => {
    lastDragYRef.current = 0;
    dragStateRef.current = null;
    if (sheetRef.current) {
      sheetRef.current.style.transition = '';
      sheetRef.current.style.transform = '';
    }
  }, [task?.id]);

  const isInteractiveInput = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  const resetSheetTransform = () => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isInteractiveInput(e.target)) {
      dragStateRef.current = null;
      return;
    }
    const bodyEl = bodyScrollRef.current;
    const atTop = !bodyEl || bodyEl.scrollTop <= 1;
    const startedInBody = bodyEl && e.target instanceof Node ? bodyEl.contains(e.target) : false;

    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      canDragBody: !startedInBody || atTop,
      engaged: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    if (!state.engaged) {
      if (dy > 8 && Math.abs(dy) > Math.abs(dx) * 1.15 && state.canDragBody) {
        state.engaged = true;
        if (sheetRef.current) {
          sheetRef.current.style.transition = 'none';
        }
      } else if (dy < -8 || Math.abs(dx) > 18) {
        dragStateRef.current = null;
        return;
      } else {
        return;
      }
    }

    const offset = Math.max(0, dy - 8);
    lastDragYRef.current = offset;
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translate3d(0, ${offset}px, 0)`;
    }
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    const finalDrag = lastDragYRef.current;
    dragStateRef.current = null;
    lastDragYRef.current = 0;

    if (!state.engaged) {
      resetSheetTransform();
      return;
    }

    const elapsed = Date.now() - state.startTime;
    const shouldClose = finalDrag > 56 || (finalDrag > 26 && elapsed < 240);

    resetSheetTransform();
    if (shouldClose) {
      onClose();
    }
  };

  const activeTask = task ?? renderedTask;
  if (!activeTask) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className={`absolute inset-0 z-30 bg-black/35 backdrop-blur-[1px] flex flex-col justify-end transition-opacity duration-150 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className={`${heightClass} w-full will-change-transform transition-transform duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <TaskDetailPane
          task={activeTask}
          tokens={tokens}
          taskLists={taskLists}
          isSheet
          highlightQuery={highlightQuery}
          highlightTrigger={highlightTrigger}
          onDismissHighlight={onDismissHighlight}
          onClose={onClose}
          onToggleTask={onToggleTask}
          onUpdateTask={onUpdateTask}
          onDeleteTask={onDeleteTask}
          isDirtyGoogleTask={isDirtyGoogleTask}
          onSyncGoogleTask={onSyncGoogleTask}
          canPushToGoogle={canPushToGoogle}
          onPushToGoogle={onPushToGoogle}
          bodyScrollRef={bodyScrollRef}
        />
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TaskItem } from '../../types/taskflow';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { TaskDetailPane } from './TaskDetailPane';

interface TaskDetailSheetProps {
  task: TaskItem | null;
  tokens: StyleThemeTokens;
  taskLists: string[];
  heightClass?: string;
  highlightQuery?: string;
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

export const TaskDetailSheet: React.FC<TaskDetailSheetProps> = ({
  task,
  tokens,
  taskLists,
  heightClass = 'h-[94%]',
  highlightQuery = '',
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
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    canDragBody: boolean;
    engaged: boolean;
  } | null>(null);
  const lastDragYRef = useRef(0);

  useEffect(() => {
    setDragY(0);
    setIsDragging(false);
    lastDragYRef.current = 0;
    dragStateRef.current = null;
  }, [task?.id]);

  const isInteractiveInput = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  const beginTrack = (clientX: number, clientY: number, target: EventTarget | null) => {
    if (isInteractiveInput(target)) {
      dragStateRef.current = null;
      return;
    }
    const bodyEl = bodyScrollRef.current;
    const atTop = !bodyEl || bodyEl.scrollTop <= 1;
    const startedInBody = bodyEl && target instanceof Node ? bodyEl.contains(target) : false;

    dragStateRef.current = {
      startX: clientX,
      startY: clientY,
      startTime: Date.now(),
      canDragBody: !startedInBody || atTop,
      engaged: false,
    };
  };

  const moveTrack = (clientX: number, clientY: number) => {
    const state = dragStateRef.current;
    if (!state) return;

    const dx = clientX - state.startX;
    const dy = clientY - state.startY;

    if (!state.engaged) {
      if (dy > 8 && Math.abs(dy) > Math.abs(dx) * 1.15 && state.canDragBody) {
        state.engaged = true;
        setIsDragging(true);
      } else if (dy < -8 || Math.abs(dx) > 18) {
        dragStateRef.current = null;
        return;
      } else {
        return;
      }
    }

    const offset = Math.max(0, dy - 8);
    lastDragYRef.current = offset;
    setDragY(offset);
  };

  const endTrack = () => {
    const state = dragStateRef.current;
    const finalDrag = lastDragYRef.current;
    dragStateRef.current = null;

    if (!state || !state.engaged) {
      setIsDragging(false);
      setDragY(0);
      lastDragYRef.current = 0;
      return;
    }

    const elapsed = Date.now() - state.startTime;
    const shouldClose = finalDrag > 56 || (finalDrag > 26 && elapsed < 240);

    setIsDragging(false);
    setDragY(0);
    lastDragYRef.current = 0;

    if (shouldClose) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {task && (
        <motion.div
          key="task-detail-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
          className="absolute inset-0 z-30 bg-black/35 backdrop-blur-[1px] flex flex-col justify-end"
        >
          <motion.div
            key={`task-detail-sheet-${task.id}`}
            initial={{ y: '100%' }}
            animate={{ y: dragY }}
            exit={{ y: '100%' }}
            transition={
              isDragging
                ? { duration: 0 }
                : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }
            }
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => beginTrack(e.clientX, e.clientY, e.target)}
            onPointerMove={(e) => moveTrack(e.clientX, e.clientY)}
            onPointerUp={endTrack}
            onPointerCancel={endTrack}
            onTouchStart={(e) => {
              if (e.touches[0]) {
                beginTrack(e.touches[0].clientX, e.touches[0].clientY, e.target);
              }
            }}
            onTouchMove={(e) => {
              if (e.touches[0]) {
                moveTrack(e.touches[0].clientX, e.touches[0].clientY);
              }
            }}
            onTouchEnd={endTrack}
            className={`${heightClass} w-full`}
          >
            <TaskDetailPane
              task={task}
              tokens={tokens}
              taskLists={taskLists}
              isSheet
              highlightQuery={highlightQuery}
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

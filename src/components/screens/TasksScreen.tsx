import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { useTaskCompletionAnimation } from '../../hooks/useTaskCompletionAnimation';
import { useTodayDateKey } from '../../hooks/useTodayDateKey';
import { FoldPosture, GoogleTasksSyncState, TaskItem } from '../../types/taskflow';
import { scrollElementIntoContainer } from '../../utils/scrollToMatch';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { GoogleSignInButton } from '../GoogleSignInButton';
import { HighlightedText } from '../HighlightedText';
import { TaskCheckbox } from '../TaskCheckbox';
import { TaskMetaRow } from '../TaskMetaRow';
import { TaskDetailPane } from './TaskDetailPane';
import { TaskDetailSheet } from './TaskDetailSheet';

interface TasksScreenProps {
  posture: FoldPosture;
  tokens: StyleThemeTokens;
  tasks: TaskItem[];
  taskLists: string[];
  selectedTaskId: string | null;
  hingeAwareSplit: boolean;
  googleTasksSync: boolean;
  googleTasks: GoogleTasksSyncState;
  highlightedTaskId?: string | null;
  highlightQuery?: string;
  highlightTrigger?: number;
  onDismissHighlight?: () => void;
  onSelectTask: (id: string | null) => void;
  onToggleTask: (id: string) => void;
  onUpdateTask: (task: TaskItem) => void;
  onDeleteTask: (id: string) => void;
  onSyncGoogleTask: (task: TaskItem) => void;
  onPushLocalTaskToGoogle: (task: TaskItem) => void;
}

type TaskFilter = 'all' | 'today' | 'inbox' | 'high' | 'done';

export const TasksScreen: React.FC<TasksScreenProps> = ({
  posture,
  tokens,
  tasks,
  taskLists,
  selectedTaskId,
  hingeAwareSplit,
  googleTasksSync,
  googleTasks,
  highlightedTaskId = null,
  highlightQuery = '',
  highlightTrigger,
  onDismissHighlight,
  onSelectTask,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
  onSyncGoogleTask,
  onPushLocalTaskToGoogle,
}) => {
  const { todayDateKey } = useTodayDateKey();
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [listFilter, setListFilter] = useState<string>('ALL');
  const taskListScrollRef = useRef<HTMLDivElement | null>(null);

  // Ensure a global-search target is visible in the current status/list filter
  useEffect(() => {
    if (!highlightedTaskId) return;
    const match = tasks.find((t) => t.id === highlightedTaskId);
    if (match) {
      setListFilter('ALL');
      if (match.completed) {
        setFilter((prev) => (prev === 'done' ? 'done' : 'all'));
      } else {
        setFilter((prev) => (prev === 'done' ? 'all' : prev));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedTaskId, highlightQuery, highlightTrigger]);

  useEffect(() => {
    if (!highlightedTaskId || !highlightQuery.trim()) return;
    const raf = window.requestAnimationFrame(() => {
      const container = taskListScrollRef.current;
      if (!container) return;
      const escapedId =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(highlightedTaskId)
          : highlightedTaskId.replace(/["\\]/g, '\\$&');
      const row = container.querySelector<HTMLElement>(`[data-task-id="${escapedId}"]`);
      scrollElementIntoContainer(container, row, 'smooth');
    });
    return () => window.cancelAnimationFrame(raf);
  }, [highlightedTaskId, highlightQuery, highlightTrigger, filter, listFilter]);

  const { celebratingIds, justSettledIds, compareWithCompletionHold } =
    useTaskCompletionAnimation(tasks);

  // Keep checked-off tasks visible and settle them to the bottom after their brief completion animation
  const filteredTasks = useMemo(
    () =>
      tasks
        .filter((t) => {
          if (listFilter !== 'ALL' && t.category !== listFilter) {
            return false;
          }

          switch (filter) {
            case 'today':
              return !t.isInbox && t.dateKey === todayDateKey;
            case 'inbox':
              return t.isInbox;
            case 'high':
              return t.priority === 'High';
            case 'done':
              return t.completed;
            case 'all':
            default:
              return true;
          }
        })
        .sort(compareWithCompletionHold),
    [tasks, listFilter, filter, todayDateKey, compareWithCompletionHold]
  );

  const selectedTask =
    tasks.find((t) => t.id === selectedTaskId) ||
    (posture === FoldPosture.Inner ? filteredTasks[0] || null : null);

  const filterOptions: { id: TaskFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'today', label: 'Today' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'high', label: 'Priority' },
    { id: 'done', label: 'Done' },
  ];

  const allListOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...taskLists,
          ...(googleTasksSync && (googleTasks.isConnected || Boolean(googleTasks.userEmail))
            ? googleTasks.taskLists.map((l) => l.title)
            : []),
          'Inbox',
        ])
      ),
    [taskLists, googleTasksSync, googleTasks.isConnected, googleTasks.userEmail, googleTasks.taskLists]
  );

  const renderList = () => (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale}`}>
            Tasks
          </h2>
          {googleTasksSync && (googleTasks.isConnected || googleTasks.userEmail) && (
            <>
              <span className="text-[12px] text-stone-400 dark:text-stone-500 truncate">
                · Google
              </span>
              <button
                type="button"
                disabled={googleTasks.isSyncing || googleTasks.isSigningIn}
                onClick={() => void googleTasks.onSyncNow()}
                title={googleTasks.isConnected ? 'Sync Google Tasks' : 'Refresh Google Tasks'}
                aria-label={googleTasks.isConnected ? 'Sync Google Tasks' : 'Refresh Google Tasks'}
                className="relative p-1 text-stone-400 hover:text-[var(--tf-accent-text)] transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-4 h-4 ${
                    googleTasks.isSyncing || googleTasks.isSigningIn ? 'animate-spin' : ''
                  }`}
                />
                {!googleTasks.isConnected && (googleTasks.pendingSyncCount ?? 0) > 0 && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
                )}
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {googleTasksSync && !googleTasks.isConnected && !googleTasks.userEmail && (
            <GoogleSignInButton
              compact
              onClick={() => googleTasks.onSignIn()}
              loading={googleTasks.isSigningIn}
              label="Connect"
            />
          )}
          <select
            aria-label="Filter tasks by list"
            value={listFilter}
            onChange={(e) => setListFilter(e.target.value)}
            className={`text-[13px] font-medium px-2.5 py-1.5 ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} focus:outline-none max-w-[140px]`}
          >
            <option value="ALL">All lists</option>
            {allListOptions.map((listName) => (
              <option key={listName} value={listName}>
                {listName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {googleTasks.error && (
        <div className="px-3 py-2 text-[12.5px] text-rose-600 dark:text-rose-400 bg-rose-500/10 rounded-lg">
          {googleTasks.error}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center justify-between gap-2">
        <div
          className={`flex items-center gap-1.5 ${
            posture === FoldPosture.Inner ? 'flex-wrap min-w-0' : 'overflow-x-auto'
          }`}
        >
          {filterOptions.map((opt) => {
            const active = filter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`${
                  posture === FoldPosture.Inner
                    ? 'px-2.5 py-1 text-[12.5px]'
                    : 'px-3 py-1.5 text-[13px]'
                } font-medium transition-colors whitespace-nowrap shrink-0 ${tokens.buttonRadius} ${
                  active
                    ? `${tokens.accentBg}`
                    : `${tokens.subtleBg} text-stone-600 dark:text-stone-300 hover:opacity-85`
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <span className="text-[12px] text-stone-400 tabular-nums shrink-0">{filteredTasks.length}</span>
      </div>

      {/* Task Rows */}
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {filteredTasks.length === 0 ? (
          <div className="p-6 text-center space-y-1.5">
            <p className="text-[14.5px] font-medium text-stone-700 dark:text-stone-300">No tasks match this view</p>
            <p className="text-[13px] text-stone-400">Try another filter or add a new task.</p>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const isSelected = selectedTask?.id === task.id;
            const isHighlighted = highlightedTaskId === task.id && Boolean(highlightQuery.trim());
            const isCelebrating = celebratingIds.has(task.id);
            const isSettling = justSettledIds.has(task.id);
            return (
              <div
                key={task.id}
                data-task-id={task.id}
                className={`flex items-center gap-3 ${tokens.rowPadding} border-b last:border-b-0 ${tokens.divider} transition-colors ${
                  isSelected ? tokens.accentSoftBg : ''
                } ${isSettling ? 'task-row-settle' : ''}`}
              >
                <TaskCheckbox
                  checked={task.completed}
                  celebrating={isCelebrating}
                  tokens={tokens}
                  ariaLabel={
                    task.completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`
                  }
                  onClick={() => onToggleTask(task.id)}
                />
                <button
                  type="button"
                  onClick={() => onSelectTask(task.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p
                    className={`text-[15px] font-medium truncate leading-snug transition-colors duration-250 ${
                      task.completed ? 'text-stone-400' : 'text-stone-900 dark:text-stone-100'
                    }`}
                  >
                    <span
                      className={`inline-block max-w-full truncate align-bottom ${
                        isCelebrating
                          ? 'task-strike-sweep'
                          : task.completed
                            ? 'line-through'
                            : ''
                      }`}
                    >
                      <HighlightedText text={task.title} query={highlightQuery} active={isHighlighted} />
                    </span>
                  </p>
                  <TaskMetaRow
                    task={task}
                    tokens={tokens}
                    isDirtyGoogle={googleTasks.dirtyTaskIds.includes(task.id)}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTask(task.id)}
                  className="p-1 text-stone-300 dark:text-stone-600"
                  aria-label="Open task details"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const detailHighlight = selectedTask && highlightedTaskId === selectedTask.id ? highlightQuery : '';
  const selectedIsDirty = Boolean(selectedTask && googleTasks.dirtyTaskIds.includes(selectedTask.id));
  const canPushToGoogle =
    googleTasksSync && (googleTasks.isConnected || Boolean(googleTasks.userEmail));

  if (posture === FoldPosture.Inner) {
    return (
      <div className={`h-full grid grid-cols-2 ${hingeAwareSplit ? 'gap-5' : 'gap-3'} px-3.5 py-2 overflow-hidden`}>
        <div ref={taskListScrollRef} className="h-full overflow-y-auto device-scroll pr-0.5">{renderList()}</div>
        <div className="h-full overflow-hidden pl-0.5">
          <TaskDetailPane
            task={selectedTask}
            tokens={tokens}
            taskLists={taskLists}
            highlightQuery={detailHighlight}
            highlightTrigger={detailHighlight ? highlightTrigger : undefined}
            onDismissHighlight={onDismissHighlight}
            onToggleTask={onToggleTask}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
            isDirtyGoogleTask={selectedIsDirty}
            onSyncGoogleTask={onSyncGoogleTask}
            canPushToGoogle={canPushToGoogle}
            onPushToGoogle={onPushLocalTaskToGoogle}
          />
        </div>
      </div>
    );
  }

  if (posture === FoldPosture.Flex) {
    const flexTask = selectedTask || filteredTasks[0] || null;
    const flexIsDirty = Boolean(flexTask && googleTasks.dirtyTaskIds.includes(flexTask.id));
    return (
      <div className="h-full flex flex-col">
        <div ref={taskListScrollRef} className="h-[46%] overflow-y-auto device-scroll px-3.5 py-2">{renderList()}</div>
        <div className="h-3.5 flex items-center justify-center bg-stone-200/60 dark:bg-black/40 border-y border-stone-300/60 dark:border-stone-800 shrink-0">
          <span className="text-[9px] font-mono-tabular text-stone-500 dark:text-stone-400">
            Flex hinge · Detail editor
          </span>
        </div>
        <div className="flex-1 overflow-hidden p-2">
          <TaskDetailPane
            task={flexTask}
            tokens={tokens}
            taskLists={taskLists}
            highlightQuery={detailHighlight}
            highlightTrigger={detailHighlight ? highlightTrigger : undefined}
            onDismissHighlight={onDismissHighlight}
            onToggleTask={onToggleTask}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
            isDirtyGoogleTask={flexIsDirty}
            onSyncGoogleTask={onSyncGoogleTask}
            canPushToGoogle={canPushToGoogle}
            onPushToGoogle={onPushLocalTaskToGoogle}
            extraBottomClearance
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden">
      <div ref={taskListScrollRef} className="h-full overflow-y-auto device-scroll px-3.5 pt-2.5 pb-24">
        {renderList()}
      </div>
      <TaskDetailSheet
        task={selectedTaskId ? selectedTask : null}
        tokens={tokens}
        taskLists={taskLists}
        heightClass="h-[94%]"
        highlightQuery={detailHighlight}
        highlightTrigger={detailHighlight ? highlightTrigger : undefined}
        onDismissHighlight={onDismissHighlight}
        onClose={() => onSelectTask(null)}
        onToggleTask={onToggleTask}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        isDirtyGoogleTask={selectedIsDirty}
        onSyncGoogleTask={onSyncGoogleTask}
        canPushToGoogle={canPushToGoogle}
        onPushToGoogle={onPushLocalTaskToGoogle}
      />
    </div>
  );
};

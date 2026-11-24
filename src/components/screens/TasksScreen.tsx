import React, { useEffect, useState } from 'react';
import { Bell, Check, ChevronRight, RefreshCw } from 'lucide-react';
import { TODAY_DATE_KEY } from '../../data/initialData';
import { FoldPosture, GoogleTasksSyncState, TaskItem } from '../../types/taskflow';
import { StyleThemeTokens } from '../../utils/themeTokens';
import { GoogleSignInButton } from '../GoogleSignInButton';
import { HighlightedText } from '../HighlightedText';
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
  onDismissHighlight,
  onSelectTask,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
  onSyncGoogleTask,
  onPushLocalTaskToGoogle,
}) => {
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [listFilter, setListFilter] = useState<string>('ALL');

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
  }, [highlightedTaskId, highlightQuery]);

  // Keep checked-off tasks visible and shifted to the bottom of the list
  const filteredTasks = tasks
    .filter((t) => {
      if (listFilter !== 'ALL' && t.category !== listFilter) {
        return false;
      }

      switch (filter) {
        case 'today':
          return !t.isInbox && t.dateKey === TODAY_DATE_KEY;
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
    .sort((a, b) => Number(a.completed) - Number(b.completed));

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

  const allListOptions = Array.from(
    new Set([
      ...taskLists,
      ...(googleTasksSync && googleTasks.isConnected
        ? googleTasks.taskLists.map((l) => l.title)
        : []),
      'Inbox',
    ])
  );

  const renderList = () => (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale}`}>
            Tasks
          </h2>
          {googleTasksSync && googleTasks.isConnected && (
            <>
              <span className="text-[12px] text-stone-400 dark:text-stone-500 truncate">
                · Google
              </span>
              <button
                type="button"
                disabled={googleTasks.isSyncing}
                onClick={() => googleTasks.onSyncNow()}
                title="Sync Google Tasks"
                aria-label="Sync Google Tasks"
                className="p-1 text-stone-400 hover:text-[var(--tf-accent-text)] transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${googleTasks.isSyncing ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {googleTasksSync && !googleTasks.isConnected && (
            <GoogleSignInButton
              compact
              onClick={() => googleTasks.onSignIn()}
              loading={googleTasks.isSigningIn}
              label={googleTasks.userEmail ? 'Reconnect' : 'Connect'}
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
            return (
              <div
                key={task.id}
                className={`flex items-center gap-3 ${tokens.rowPadding} border-b last:border-b-0 ${tokens.divider} transition-colors ${
                  isSelected ? tokens.accentSoftBg : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onToggleTask(task.id)}
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                    task.completed
                      ? `${tokens.accentBg} border-transparent`
                      : 'border-stone-300 dark:border-stone-600'
                  }`}
                  aria-label={`Toggle ${task.title}`}
                >
                  {task.completed && <Check className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTask(task.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p
                    className={`text-[15px] font-medium truncate leading-snug ${
                      task.completed ? 'line-through text-stone-400' : 'text-stone-900 dark:text-stone-100'
                    }`}
                  >
                    <HighlightedText text={task.title} query={highlightQuery} active={isHighlighted} />
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[12.5px] text-stone-500 dark:text-stone-400 tabular-nums flex-wrap">
                    <span>{task.timeLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      <HighlightedText text={task.category} query={highlightQuery} active={isHighlighted} />
                    </span>
                    {task.subtasks.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {task.subtasks.filter((s) => s.done).length}/{task.subtasks.length} steps
                        </span>
                      </>
                    )}
                    {task.priority === 'High' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={`font-medium ${tokens.accentText}`}>High</span>
                      </>
                    )}
                    {(task.reminders?.length ?? 0) > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`inline-flex items-center gap-0.5 ${tokens.accentText}`}
                          title={`${task.reminders!.length} notification${task.reminders!.length > 1 ? 's' : ''}`}
                        >
                          <Bell className="w-3.5 h-3.5" />
                          {task.reminders!.length > 1 && <span>{task.reminders!.length}</span>}
                        </span>
                      </>
                    )}
                    {task.source === 'google' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className={`font-medium ${tokens.accentText}`}>
                          {googleTasks.dirtyTaskIds.includes(task.id) ? 'Google · Unsynced' : 'Google'}
                        </span>
                      </>
                    )}
                  </div>
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
  const canPushToGoogle = googleTasksSync && googleTasks.isConnected;

  if (posture === FoldPosture.Inner) {
    return (
      <div className={`h-full grid grid-cols-2 ${hingeAwareSplit ? 'gap-5' : 'gap-3'} px-3.5 py-2 overflow-hidden`}>
        <div className="h-full overflow-y-auto device-scroll pr-0.5">{renderList()}</div>
        <div className="h-full overflow-hidden pl-0.5">
          <TaskDetailPane
            task={selectedTask}
            tokens={tokens}
            taskLists={taskLists}
            highlightQuery={detailHighlight}
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
        <div className="h-[46%] overflow-y-auto device-scroll px-3.5 py-2">{renderList()}</div>
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
      <div className="h-full overflow-y-auto device-scroll px-3.5 pt-2.5 pb-24">
        {renderList()}
      </div>
      <TaskDetailSheet
        task={selectedTaskId ? selectedTask : null}
        tokens={tokens}
        taskLists={taskLists}
        heightClass="h-[94%]"
        highlightQuery={detailHighlight}
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

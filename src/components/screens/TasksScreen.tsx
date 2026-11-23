import React, { useEffect, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { FoldPosture, TaskItem } from '../../types/taskflow';
import { StyleThemeTokens } from '../../utils/themeTokens';
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
  highlightedTaskId?: string | null;
  highlightQuery?: string;
  onDismissHighlight?: () => void;
  onSelectTask: (id: string | null) => void;
  onToggleTask: (id: string) => void;
  onUpdateTask: (task: TaskItem) => void;
  onDeleteTask: (id: string) => void;
}

type TaskFilter = 'all' | 'today' | 'inbox' | 'high' | 'done';

export const TasksScreen: React.FC<TasksScreenProps> = ({
  posture,
  tokens,
  tasks,
  taskLists,
  selectedTaskId,
  hingeAwareSplit,
  highlightedTaskId = null,
  highlightQuery = '',
  onDismissHighlight,
  onSelectTask,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
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
          return !t.isInbox && t.dateKey === '2026-11-23';
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

  const allListOptions = Array.from(new Set([...taskLists, 'Inbox']));

  const renderList = () => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className={`font-display font-semibold text-stone-900 dark:text-stone-100 ${tokens.headingScale}`}>
          Tasks
        </h2>
        <select
          aria-label="Filter tasks by list"
          value={listFilter}
          onChange={(e) => setListFilter(e.target.value)}
          className={`text-[10.5px] font-medium px-2 py-0.5 ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} focus:outline-none`}
        >
          <option value="ALL">All lists</option>
          {allListOptions.map((listName) => (
            <option key={listName} value={listName}>
              {listName}
            </option>
          ))}
        </select>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 overflow-x-auto">
          {filterOptions.map((opt) => {
            const active = filter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`px-2 py-0.5 text-[10.5px] font-medium transition-colors whitespace-nowrap shrink-0 ${tokens.buttonRadius} ${
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
        <span className="text-[10px] text-stone-400 tabular-nums shrink-0">{filteredTasks.length}</span>
      </div>

      {/* Task Rows */}
      <div className={`${tokens.cardBg} ${tokens.cardRadius} overflow-hidden`}>
        {filteredTasks.length === 0 ? (
          <div className="p-5 text-center space-y-1">
            <p className="text-xs font-medium text-stone-700 dark:text-stone-300">No tasks match this view</p>
            <p className="text-[11px] text-stone-400">Try another filter or add a new task.</p>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const isSelected = selectedTask?.id === task.id;
            const isHighlighted = highlightedTaskId === task.id && Boolean(highlightQuery.trim());
            return (
              <div
                key={task.id}
                className={`flex items-center gap-2.5 ${tokens.rowPadding} border-b last:border-b-0 ${tokens.divider} transition-colors ${
                  isSelected ? tokens.accentSoftBg : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onToggleTask(task.id)}
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                    task.completed
                      ? `${tokens.accentBg} border-transparent`
                      : 'border-stone-300 dark:border-stone-600'
                  }`}
                  aria-label={`Toggle ${task.title}`}
                >
                  {task.completed && <Check className="w-2.5 h-2.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTask(task.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p
                    className={`text-[13px] font-medium truncate ${
                      task.completed ? 'line-through text-stone-400' : 'text-stone-900 dark:text-stone-100'
                    }`}
                  >
                    <HighlightedText text={task.title} query={highlightQuery} active={isHighlighted} />
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-stone-500 dark:text-stone-400 tabular-nums">
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
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTask(task.id)}
                  className="p-0.5 text-stone-300 dark:text-stone-600"
                  aria-label="Open task details"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const detailHighlight = selectedTask && highlightedTaskId === selectedTask.id ? highlightQuery : '';

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
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
          />
        </div>
      </div>
    );
  }

  if (posture === FoldPosture.Flex) {
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
            task={selectedTask || filteredTasks[0] || null}
            tokens={tokens}
            taskLists={taskLists}
            highlightQuery={detailHighlight}
            onDismissHighlight={onDismissHighlight}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto device-scroll px-3 pt-1.5 pb-11">
      {renderList()}
      <TaskDetailSheet
        task={selectedTaskId ? selectedTask : null}
        tokens={tokens}
        taskLists={taskLists}
        heightClass="h-[82%]"
        highlightQuery={detailHighlight}
        onDismissHighlight={onDismissHighlight}
        onClose={() => onSelectTask(null)}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
      />
    </div>
  );
};

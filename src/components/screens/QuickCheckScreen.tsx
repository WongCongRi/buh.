import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckSquare,
  ExternalLink,
  FileText,
  Film,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  Play,
  Send,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { TODAY_DATE_KEY } from '../../data/initialData';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useBackLayer } from '../../hooks/useAndroidBackNavigation';
import { CalendarEvent, FoldPosture, NoteItem, TaskItem } from '../../types/taskflow';
import { StyleThemeTokens } from '../../utils/themeTokens';

export interface QuickCheckSource {
  title: string;
  uri: string;
}

export interface QuickCheckMedia {
  id: string;
  type: 'image' | 'video';
  title: string;
  url: string;
  embedUrl?: string;
  thumbnailUrl?: string;
  sourceName?: string;
  sourceUrl?: string;
  mimeType?: string;
}

export interface QuickCheckEntry {
  id: string;
  prompt: string;
  answer: string;
  sources: QuickCheckSource[];
  media: QuickCheckMedia[];
  webSearchQueries: string[];
  timestamp: string;
  usedAgenda: boolean;
  savedTask?: boolean;
  savedTaskId?: string;
  savedNote?: boolean;
  savedNoteId?: string;
}

interface QuickCheckScreenProps {
  posture: FoldPosture;
  tokens: StyleThemeTokens;
  hingeAwareSplit: boolean;
  tasks: TaskItem[];
  events: CalendarEvent[];
  notes: NoteItem[];
  entries: QuickCheckEntry[];
  onAddEntry: (entry: QuickCheckEntry) => void;
  onDeleteEntry: (entryId: string) => void;
  onClearEntries: () => void;
  onSaveAsTask: (entryId: string, title: string, notes: string) => void;
  onRemoveSavedTask: (entryId: string, taskId: string) => void;
  onSaveAsNote: (entryId: string, title: string, body: string) => void;
  onRemoveSavedNote: (entryId: string, noteId: string) => void;
}

interface SuggestedCheck {
  id: string;
  prompt: string;
  badge: string;
}

function parseTimeToMinutes(timeStr: string): number | null {
  const trimmed = timeStr.trim();
  if (!trimmed || /no time/i.test(trimmed)) return null;

  const ampm = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const mer = ampm[3].toUpperCase();
    if (mer === 'PM' && h !== 12) h += 12;
    if (mer === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }

  const h24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    return parseInt(h24[1], 10) * 60 + parseInt(h24[2], 10);
  }
  return null;
}

function dateKeyToDayOffset(dateKey: string): number {
  const base = Date.parse(`${TODAY_DATE_KEY}T00:00:00Z`);
  const target = Date.parse(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(base) || Number.isNaN(target)) return 999;
  return Math.round((target - base) / 86_400_000);
}

function formatCompactTime(timeStr: string): string {
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return '';
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function buildSuggestionFromTask(task: TaskItem): string {
  const combined = `${task.title} ${task.notes} ${task.subtasks.map((s) => s.title).join(' ')}`;
  if (/fold\s*8/i.test(combined)) {
    return 'Samsung Galaxy Z Fold 8 cover screen & ergonomics specs';
  }
  if (/kotlin|room\s+schema|proposal/i.test(combined)) {
    return 'Kotlin Multiplatform vs native Android Room migration guide';
  }
  if (/supplier|shipping|lead\s+time/i.test(combined)) {
    return 'December shipping lead times & supplier negotiation checklist';
  }
  if (/ticktick|csv/i.test(combined)) {
    return 'TickTick CSV import priority & column mapping format';
  }
  if (/weekly\s+report|sprint|velocity/i.test(combined)) {
    return 'Concise 3-line executive sprint weekly report template';
  }
  if (/espresso|coffee/i.test(combined)) {
    return 'Best freshly roasted espresso beans & roast date tips';
  }
  return `${task.title} — quick live lookup`;
}

function buildSuggestionFromEvent(ev: CalendarEvent): string {
  const combined = `${ev.title} ${ev.location || ''}`;
  if (/walk|trail|outdoor|run/i.test(combined)) {
    return `Current weather & sunset time for ${ev.title}`;
  }
  if (/dentist|clinic|doctor/i.test(combined)) {
    return `Quick checklist before ${ev.title}`;
  }
  if (/fold\s*8/i.test(combined)) {
    return 'Samsung Galaxy Z Fold 8 adaptive layout guidelines';
  }
  return `${ev.title}${ev.location ? ` (${ev.location})` : ''} — quick check`;
}

function buildSuggestionFromNote(note: NoteItem): string {
  const text = `${note.title} ${note.blocks.map((b) => b.text).join(' ')}`;
  if (/fold\s*8/i.test(text)) {
    return 'Samsung Galaxy Z Fold 8 display dimensions & Flex mode specs';
  }
  if (/room|kotlin|ticktick/i.test(text)) {
    return 'Android Room database with Kotlin Flows best practices';
  }
  if (/morning|routine|agenda/i.test(text)) {
    return 'Focused 3-priority morning planning tips';
  }
  return `${note.title} — latest references & info`;
}

function buildRelevantSuggestions(
  tasks: TaskItem[],
  events: CalendarEvent[],
  notes: NoteItem[]
): SuggestedCheck[] {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  type RankedCandidate = {
    id: string;
    prompt: string;
    badge: string;
    score: number;
    keywords: string[];
  };

  const candidates: RankedCandidate[] = [];

  // Score scheduled incomplete tasks by closeness to current time (upcoming preferred over just-passed)
  for (const task of tasks) {
    if (task.completed) continue;
    const dayOffset = dateKeyToDayOffset(task.dateKey);
    const mins = parseTimeToMinutes(task.timeLabel);
    const deltaMins =
      mins !== null
        ? dayOffset * 1440 + (mins - nowMinutes)
        : dayOffset * 1440 + 720; // unscheduled tasks on today rank after timed ones

    // Upcoming items score directly by minutes away; already-elapsed items get a mild penalty so upcoming wins,
    // while still staying close if all today's times have already passed.
    const score = deltaMins >= -15 ? Math.abs(deltaMins) : Math.abs(deltaMins) + 360;
    const dayTag =
      dayOffset === 0 ? (mins !== null ? formatCompactTime(task.timeLabel) : 'Today') : dayOffset === 1 ? 'Tomorrow' : task.dateKey.slice(5);

    candidates.push({
      id: `task-${task.id}`,
      prompt: buildSuggestionFromTask(task),
      badge: dayTag,
      score,
      keywords: `${task.title} ${task.notes}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4),
    });
  }

  // Score calendar events not already represented by a linked incomplete task
  const linkedTaskIds = new Set(tasks.filter((t) => !t.completed).map((t) => t.id));
  for (const ev of events) {
    if (ev.linkedTaskId && linkedTaskIds.has(ev.linkedTaskId)) continue;
    const dayOffset = dateKeyToDayOffset(ev.dateKey);
    const mins = parseTimeToMinutes(ev.startTime);
    const deltaMins = mins !== null ? dayOffset * 1440 + (mins - nowMinutes) : dayOffset * 1440 + 720;
    const score = deltaMins >= -15 ? Math.abs(deltaMins) : Math.abs(deltaMins) + 360;
    const dayTag =
      dayOffset === 0 ? formatCompactTime(ev.startTime) : dayOffset === 1 ? 'Tomorrow' : ev.dateKey.slice(5);

    candidates.push({
      id: `ev-${ev.id}`,
      prompt: buildSuggestionFromEvent(ev),
      badge: dayTag,
      score,
      keywords: `${ev.title} ${ev.location || ''}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4),
    });
  }

  candidates.sort((a, b) => a.score - b.score);

  const picked: SuggestedCheck[] = [];
  const seenPrompts = new Set<string>();
  const topTaskKeywords = new Set<string>();

  for (const cand of candidates) {
    const key = cand.prompt.toLowerCase();
    if (seenPrompts.has(key)) continue;
    seenPrompts.add(key);
    picked.push({ id: cand.id, prompt: cand.prompt, badge: cand.badge });
    cand.keywords.forEach((k) => topTaskKeywords.add(k));
    if (picked.length >= 3) break;
  }

  // Pick the most relevant note (matching closest upcoming task keywords first, then pinned/recent)
  const rankedNotes = [...notes]
    .map((note) => {
      const noteText = `${note.title} ${note.blocks.map((b) => b.text).join(' ')}`.toLowerCase();
      let overlap = 0;
      for (const kw of topTaskKeywords) {
        if (noteText.includes(kw)) overlap += 1;
      }
      const recencyBonus = /today/i.test(note.updatedAt) ? 2 : /yesterday/i.test(note.updatedAt) ? 1 : 0;
      const pinBonus = note.pinned ? 2 : 0;
      return { note, relevance: overlap * 3 + pinBonus + recencyBonus };
    })
    .sort((a, b) => b.relevance - a.relevance);

  for (const { note } of rankedNotes) {
    const prompt = buildSuggestionFromNote(note);
    const key = prompt.toLowerCase();
    if (seenPrompts.has(key)) continue;
    seenPrompts.add(key);
    picked.push({
      id: `note-${note.id}`,
      prompt,
      badge: note.pinned ? 'Pinned note' : 'Note',
    });
    if (picked.length >= 4) break;
  }

  if (picked.length === 0) {
    return [
      { id: 'fallback-1', prompt: 'Weather forecast today', badge: 'Live' },
      { id: 'fallback-2', prompt: 'Samsung Galaxy Z Fold 8 specs', badge: 'Live' },
    ];
  }

  return picked;
}

function formatDomain(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return uri;
  }
}

function renderInlineFormatting(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-stone-900 dark:text-stone-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function renderStructuredAnswer(answer: string): React.ReactNode {
  const cleanedAnswer = answer.replace(/!\[[^\]]*\]\(https?:\/\/[^\s)]+\)/gi, '').trim();
  const lines = cleanedAnswer
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <div className="space-y-2 text-[14.5px] leading-relaxed text-stone-700 dark:text-stone-200 min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
      {lines.map((line, idx) => {
        const isBullet = /^[-*•]\s+/.test(line);
        if (isBullet) {
          const clean = line.replace(/^[-*•]\s+/, '');
          return (
            <div key={idx} className="flex items-start gap-2.5 pl-0.5 min-w-0">
              <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-[var(--tf-accent)] shrink-0" />
              <span className="flex-1 min-w-0 break-words [overflow-wrap:anywhere]">
                {renderInlineFormatting(clean)}
              </span>
            </div>
          );
        }
        return (
          <p key={idx} className="min-w-0 break-words [overflow-wrap:anywhere]">
            {renderInlineFormatting(line)}
          </p>
        );
      })}
    </div>
  );
}

export const QuickCheckScreen: React.FC<QuickCheckScreenProps> = ({
  posture,
  tokens,
  hingeAwareSplit,
  tasks,
  events,
  notes,
  entries,
  onAddEntry,
  onDeleteEntry,
  onClearEntries,
  onSaveAsTask,
  onRemoveSavedTask,
  onSaveAsNote,
  onRemoveSavedNote,
}) => {
  const isOnline = useOnlineStatus();
  const [promptInput, setPromptInput] = useState('');
  const [includeAgenda, setIncludeAgenda] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);
  const [playingVideoKey, setPlayingVideoKey] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<QuickCheckMedia | null>(null);
  const [failedMediaIds, setFailedMediaIds] = useState<Record<string, boolean>>({});
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useBackLayer(Boolean(lightboxImage), () => setLightboxImage(null), 25);
  useBackLayer(Boolean(playingVideoKey), () => setPlayingVideoKey(null), 15);

  const activeEntry =
    entries.find((e) => e.id === selectedEntryId) || entries[entries.length - 1] || null;

  const relevantChecks = useMemo(
    () => buildRelevantSuggestions(tasks, events, notes),
    [tasks, events, notes]
  );

  const markMediaFailed = (key: string) => {
    setFailedMediaIds((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  };

  useEffect(() => {
    if (entries.length > 0 && feedEndRef.current) {
      feedEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [entries.length]);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => {
      if (entries.length > 0 && feedEndRef.current) {
        feedEndRef.current.scrollIntoView({ block: 'end' });
      }
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [entries.length]);

  const buildAgendaContext = (): string => {
    const activeTasks = tasks
      .filter((t) => !t.completed)
      .slice(0, 6)
      .map((t) => `- ${t.title} (${t.timeLabel}, ${t.category}, ${t.priority})`);
    const todayEvents = events
      .filter((e) => e.dateKey === TODAY_DATE_KEY)
      .map((e) => `- ${e.startTime}-${e.endTime}: ${e.title}${e.location ? ` (${e.location})` : ''}`);

    return [
      activeTasks.length > 0 ? `Tasks:\n${activeTasks.join('\n')}` : '',
      todayEvents.length > 0 ? `Schedule (Today, ${TODAY_DATE_KEY}):\n${todayEvents.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  };

  const runOfflineWorkspaceLookup = (query: string) => {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    const matchesText = (text: string) => {
      const lower = text.toLowerCase();
      return terms.length === 0 ? lower.includes(query.toLowerCase()) : terms.some((t) => lower.includes(t));
    };

    const matchedTasks = tasks.filter((t) =>
      matchesText(`${t.title} ${t.notes} ${t.category} ${t.subtasks.map((s) => s.title).join(' ')}`)
    );
    const matchedEvents = events.filter((e) =>
      matchesText(`${e.title} ${e.location || ''} ${e.calendarName}`)
    );
    const matchedNotes = notes.filter((n) =>
      matchesText(`${n.title} ${n.folder} ${n.blocks.map((b) => b.text).join(' ')}`)
    );

    const lines: string[] = [];
    if (matchedTasks.length > 0) {
      lines.push(`**Saved tasks (${matchedTasks.length})**`);
      for (const t of matchedTasks.slice(0, 5)) {
        lines.push(`- ${t.title} (${t.dateKey} · ${t.timeLabel} · ${t.category}${t.completed ? ' · Done' : ''})`);
      }
    }
    if (matchedEvents.length > 0) {
      lines.push(`**Saved schedule (${matchedEvents.length})**`);
      for (const ev of matchedEvents.slice(0, 5)) {
        lines.push(`- ${ev.title} (${ev.dateKey} · ${ev.startTime}${ev.location ? ` · ${ev.location}` : ''})`);
      }
    }
    if (matchedNotes.length > 0) {
      lines.push(`**Saved notes (${matchedNotes.length})**`);
      for (const n of matchedNotes.slice(0, 4)) {
        const snippet = n.blocks.map((b) => b.text).filter(Boolean).join(' ').slice(0, 90);
        lines.push(`- **${n.title || 'Untitled Note'}**${snippet ? `: ${snippet}` : ''}`);
      }
    }

    const answer =
      lines.length > 0
        ? lines.join('\n')
        : `Offline workspace lookup found no saved tasks, schedule items, or notes matching "${query}". Live web search will resume automatically when you reconnect.`;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const created: QuickCheckEntry = {
      id: `qc-offline-${Date.now()}`,
      prompt: query,
      answer,
      sources: [],
      media: [],
      webSearchQueries: [],
      timestamp: `${timeStr} · Offline`,
      usedAgenda: true,
    };
    onAddEntry(created);
    setSelectedEntryId(created.id);
    setPlayingVideoKey(null);
    setPromptInput('');
  };

  const runQuickCheck = async (rawPrompt: string) => {
    const query = rawPrompt.trim();
    if (!query || isLoading) return;

    setErrorMsg(null);
    if (!isOnline) {
      runOfflineWorkspaceLookup(query);
      return;
    }

    setIsLoading(true);
    setPromptInput('');

    const history = entries.flatMap((entry) => [
      { role: 'user' as const, text: entry.prompt },
      { role: 'model' as const, text: entry.answer },
    ]);

    try {
      const response = await fetch('/api/agent/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: query,
          history,
          taskContext: includeAgenda ? buildAgendaContext() : undefined,
        }),
      });

      const data = (await response.json()) as {
        answer?: string;
        sources?: QuickCheckSource[];
        media?: QuickCheckMedia[];
        webSearchQueries?: string[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const created: QuickCheckEntry = {
        id: `qc-${Date.now()}`,
        prompt: query,
        answer: data.answer || '',
        sources: Array.isArray(data.sources) ? data.sources : [],
        media: Array.isArray(data.media) ? data.media : [],
        webSearchQueries: Array.isArray(data.webSearchQueries) ? data.webSearchQueries : [],
        timestamp: timeStr,
        usedAgenda: includeAgenda,
      };
      onAddEntry(created);
      setSelectedEntryId(created.id);
      setPlayingVideoKey(null);
    } catch (err: unknown) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        runOfflineWorkspaceLookup(query);
      } else {
        const msg = err instanceof Error ? err.message : 'Unable to reach quick-check service.';
        setErrorMsg(msg);
        setPromptInput(query);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const triggerSavedBanner = (label: string) => {
    setSavedFeedback(label);
    window.setTimeout(() => setSavedFeedback(null), 2200);
  };

  const renderHeader = () => (
    <div className="flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center" aria-label="Lookup">
        <HelpCircle className={`w-6 h-6 ${tokens.accentText}`} />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setIncludeAgenda((v) => !v)}
          title="Include today's tasks and calendar in checks"
          className={`px-2.5 py-1.5 text-[13px] font-medium ${tokens.buttonRadius} border transition-colors ${
            includeAgenda
              ? `${tokens.accentSoftBg} ${tokens.accentText} ${tokens.accentBorder}`
              : `${tokens.subtleBg} border-transparent text-stone-600 dark:text-stone-300`
          }`}
        >
          {includeAgenda ? 'Agenda on' : 'Agenda off'}
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onClearEntries();
              setSelectedEntryId(null);
              setPlayingVideoKey(null);
              setLightboxImage(null);
              setErrorMsg(null);
            }}
            aria-label="Clear quick checks"
            title="Clear history"
            className={`p-2 ${tokens.subtleBg} text-stone-400 hover:text-rose-500 ${tokens.buttonRadius} transition-colors`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  const renderComposer = () => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        runQuickCheck(promptInput);
      }}
      className={`flex items-center gap-2 pt-2 border-t ${tokens.divider} shrink-0 w-full min-w-0`}
    >
      <input
        type="text"
        value={promptInput}
        onChange={(e) => setPromptInput(e.target.value)}
        onFocus={() => {
          window.setTimeout(() => {
            if (entries.length > 0 && feedEndRef.current) {
              feedEndRef.current.scrollIntoView({ block: 'end' });
            }
          }, 180);
        }}
        placeholder={
          isOnline
            ? 'Ask anything on the live web...'
            : 'Search saved tasks, notes & schedule offline...'
        }
        disabled={isLoading}
        aria-label="Ask Lookup"
        className={`flex-1 min-w-0 text-[14.5px] px-3 py-2.5 ${tokens.subtleBg} text-stone-900 dark:text-stone-100 placeholder:text-stone-400 ${tokens.buttonRadius} focus:outline-none disabled:opacity-60`}
      />
      <button
        type="submit"
        disabled={isLoading || !promptInput.trim()}
        aria-label="Run lookup"
        className={`inline-flex items-center justify-center px-3.5 py-2.5 text-[14px] font-medium ${tokens.accentBg} ${tokens.buttonRadius} disabled:opacity-45 shrink-0 transition-opacity`}
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      </button>
    </form>
  );

  const renderStarterChips = () => (
    <div className="space-y-2 min-w-0 max-w-full">
      <p className="text-[12.5px] font-medium text-stone-500 dark:text-stone-400">
        Instant live checks
      </p>
      <div className="grid grid-cols-1 gap-1.5 min-w-0">
        {relevantChecks.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={isLoading}
            onClick={() => runQuickCheck(item.prompt)}
            className={`w-full max-w-full min-w-0 overflow-hidden text-left px-3 py-2.5 text-[14px] font-medium ${tokens.cardBg} ${tokens.cardRadius} text-stone-700 dark:text-stone-200 hover:border-[var(--tf-accent-border)] transition-colors flex items-center justify-between gap-2`}
          >
            <span className="flex-1 min-w-0 truncate">{item.prompt}</span>
            <span className="text-[11.5px] font-mono-tabular text-stone-400 shrink-0">
              {item.badge}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderMediaSection = (entry: QuickCheckEntry, scope: 'inline' | 'pane') => {
    const mediaList = Array.isArray(entry.media) ? entry.media : [];
    const images = mediaList.filter(
      (m) => m.type === 'image' && !failedMediaIds[`${entry.id}:${m.id}`]
    );
    const videos = mediaList.filter((m) => m.type === 'video');

    if (images.length === 0 && videos.length === 0) return null;

    const maxImages = scope === 'pane' ? 4 : 3;
    const shownImages = images.slice(0, maxImages);
    const shownVideos = videos.slice(0, scope === 'pane' ? 2 : 1);

    return (
      <div className="space-y-2 min-w-0 max-w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {shownImages.length > 0 && (
          <div
            className={`grid gap-1.5 ${
              shownImages.length === 1
                ? 'grid-cols-1'
                : shownImages.length === 2
                  ? 'grid-cols-2'
                  : 'grid-cols-3'
            }`}
          >
            {shownImages.map((img) => {
              const failKey = `${entry.id}:${img.id}`;
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setLightboxImage(img)}
                  aria-label={`View image: ${img.title}`}
                  className={`group relative ${
                    shownImages.length === 1 ? 'aspect-[16/9]' : 'aspect-[4/3]'
                  } w-full overflow-hidden ${tokens.buttonRadius} bg-stone-200 dark:bg-stone-800 text-left`}
                >
                  <img
                    src={img.thumbnailUrl || img.url}
                    alt={img.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => markMediaFailed(failKey)}
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2 py-1.5">
                    <p className="text-[11.5px] font-medium text-white truncate leading-tight">
                      {img.title}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {shownVideos.length > 0 && (
          <div className="space-y-2">
            {shownVideos.map((vid) => {
              const playKey = `${scope}:${entry.id}:${vid.id}`;
              const isPlaying = playingVideoKey === playKey;
              const thumbFailKey = `thumb:${entry.id}:${vid.id}`;
              const hasThumb = Boolean(vid.thumbnailUrl) && !failedMediaIds[thumbFailKey];

              return (
                <div
                  key={vid.id}
                  className={`overflow-hidden ${tokens.buttonRadius} border ${tokens.divider} bg-stone-950`}
                >
                  <div className="relative aspect-video w-full bg-stone-950">
                    {isPlaying ? (
                      vid.embedUrl ? (
                        <iframe
                          key={vid.embedUrl}
                          src={vid.embedUrl}
                          title={vid.title}
                          className="w-full h-full border-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allowFullScreen
                        />
                      ) : (
                        <video
                          key={vid.url}
                          src={vid.url}
                          controls
                          autoPlay
                          playsInline
                          className="w-full h-full object-contain bg-black"
                        />
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPlayingVideoKey(playKey)}
                        aria-label={`Play video: ${vid.title}`}
                        className="group relative w-full h-full block text-left"
                      >
                        {hasThumb ? (
                          <img
                            src={vid.thumbnailUrl}
                            alt={vid.title}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() => markMediaFailed(thumbFailKey)}
                            className="w-full h-full object-cover opacity-90 group-hover:scale-[1.02] transition-transform duration-200"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-800 to-stone-950">
                            <Film className="w-8 h-8 text-stone-500" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent flex items-center justify-center">
                          <span
                            className={`w-12 h-12 rounded-full ${tokens.accentBg} shadow-lg flex items-center justify-center group-hover:scale-105 transition-transform`}
                          >
                            <Play className="w-5 h-5 fill-current ml-0.5" />
                          </span>
                        </div>
                        <div className="absolute inset-x-0 bottom-0 px-3 py-2 flex items-center justify-between gap-2">
                          <span className="text-[12.5px] font-medium text-white truncate">
                            {vid.title}
                          </span>
                          <span className="text-[11.5px] text-white/80 shrink-0">
                            {vid.sourceName || 'Video'}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>

                  <div className={`px-2.5 py-1.5 flex items-center justify-between gap-2 min-w-0 ${tokens.subtleBg}`}>
                    <span className="flex-1 min-w-0 text-[12px] font-medium text-stone-700 dark:text-stone-200 truncate">
                      {vid.title}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isPlaying && (
                        <button
                          type="button"
                          onClick={() => setPlayingVideoKey(null)}
                          className="px-2 py-0.5 text-[11.5px] font-medium text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 rounded"
                        >
                          Close
                        </button>
                      )}
                      <a
                        href={vid.sourceUrl || vid.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${vid.title} in new tab`}
                        className="p-1 text-stone-400 hover:text-[var(--tf-accent-text)] transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderEntryCard = (entry: QuickCheckEntry, compactSources: boolean) => {
    const isActive = activeEntry?.id === entry.id;
    return (
      <div
        key={entry.id}
        onClick={() => setSelectedEntryId(entry.id)}
        className={`${tokens.cardBg} ${tokens.cardRadius} p-3.5 space-y-2.5 min-w-0 max-w-full overflow-hidden transition-colors ${
          posture === FoldPosture.Inner && isActive ? 'ring-1 ring-[var(--tf-accent-border)]' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-2 min-w-0">
          <p className="flex-1 min-w-0 text-[15px] font-semibold text-stone-900 dark:text-stone-100 leading-snug break-words [overflow-wrap:anywhere]">
            {entry.prompt}
          </p>
          <span className="text-[12px] font-mono-tabular text-stone-400 shrink-0">
            {entry.timestamp}
          </span>
        </div>

        {renderStructuredAnswer(entry.answer)}

        {compactSources && renderMediaSection(entry, 'inline')}

        {compactSources && entry.sources.length > 0 && (
          <div className={`pt-2.5 border-t ${tokens.divider} space-y-1.5 min-w-0 max-w-full`}>
            <p className="text-[12px] font-medium text-stone-400 dark:text-stone-500">
              Web sources ({entry.sources.length})
            </p>
            <div className="space-y-1.5 min-w-0 max-w-full">
              {entry.sources.slice(0, 3).map((src) => (
                <a
                  key={src.uri}
                  href={src.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12.5px] min-w-0 max-w-full overflow-hidden ${tokens.subtleBg} ${tokens.buttonRadius} text-stone-700 dark:text-stone-200 hover:text-[var(--tf-accent-text)] transition-colors`}
                >
                  <span className="flex-1 min-w-0 truncate">
                    {src.title} · {formatDomain(src.uri)}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0 text-stone-400" />
                </a>
              ))}
            </div>
          </div>
        )}

        <div className={`pt-2 border-t ${tokens.divider} flex flex-wrap items-center gap-2`}>
          {(() => {
            const linkedTask = entry.savedTaskId
              ? tasks.find((t) => t.id === entry.savedTaskId)
              : entry.savedTask
                ? tasks.find((t) => t.title === entry.prompt && t.notes === entry.answer)
                : undefined;
            const linkedNote = entry.savedNoteId
              ? notes.find((n) => n.id === entry.savedNoteId)
              : entry.savedNote
                ? notes.find(
                    (n) =>
                      n.title === entry.prompt && n.blocks.some((b) => b.text === entry.answer)
                  )
                : undefined;
            const isTaskSaved = Boolean(linkedTask);
            const isNoteSaved = Boolean(linkedNote);

            return (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (linkedTask) {
                      onRemoveSavedTask(entry.id, linkedTask.id);
                    } else {
                      onSaveAsTask(entry.id, entry.prompt, entry.answer);
                    }
                  }}
                  title={isTaskSaved ? 'Tap again to remove task' : 'Add as task'}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] font-medium ${tokens.buttonRadius} transition-colors ${
                    isTaskSaved
                      ? `${tokens.accentBg} shadow-xs hover:opacity-90`
                      : `${tokens.subtleBg} text-stone-700 dark:text-stone-200 hover:opacity-85`
                  }`}
                >
                  {isTaskSaved ? (
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  ) : (
                    <CheckSquare className="w-3.5 h-3.5" />
                  )}
                  {isTaskSaved ? 'Added task' : 'Add task'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (linkedNote) {
                      onRemoveSavedNote(entry.id, linkedNote.id);
                    } else {
                      onSaveAsNote(entry.id, entry.prompt, entry.answer);
                      triggerSavedBanner('Saved to Notes');
                    }
                  }}
                  title={isNoteSaved ? 'Tap again to remove note' : 'Save as note'}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] font-medium ${tokens.buttonRadius} transition-colors ${
                    isNoteSaved
                      ? `${tokens.accentBg} shadow-xs hover:opacity-90`
                      : `${tokens.subtleBg} text-stone-700 dark:text-stone-200 hover:opacity-85`
                  }`}
                >
                  {isNoteSaved ? (
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                  ) : (
                    <FileText className="w-3.5 h-3.5" />
                  )}
                  {isNoteSaved ? 'Saved note' : 'Save note'}
                </button>
              </>
            );
          })()}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (selectedEntryId === entry.id) setSelectedEntryId(null);
              if (playingVideoKey?.startsWith(`${entry.id}:`)) setPlayingVideoKey(null);
              onDeleteEntry(entry.id);
            }}
            aria-label="Delete lookup chat"
            title="Delete lookup chat"
            className={`ml-auto p-1.5 text-stone-400 hover:text-rose-500 ${tokens.buttonRadius} transition-colors`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const renderSourcesPane = () => {
    const activeMedia = activeEntry?.media ?? [];
    const activeImageCount = activeMedia.filter(
      (m) => m.type === 'image' && !failedMediaIds[`${activeEntry?.id}:${m.id}`]
    ).length;
    const activeVideoCount = activeMedia.filter((m) => m.type === 'video').length;

    return (
      <div className="h-full min-w-0 max-w-full overflow-y-auto overflow-x-hidden device-scroll space-y-3 pl-0.5">
        {activeEntry && (activeImageCount > 0 || activeVideoCount > 0) && (
          <div className={`${tokens.cardBg} ${tokens.cardRadius} p-3.5 space-y-2.5 min-w-0 max-w-full overflow-hidden`}>
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-semibold text-stone-800 dark:text-stone-200 flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4 text-stone-400" />
                Images & videos
              </span>
              <span className="text-[12px] font-mono-tabular text-stone-400">
                {activeImageCount > 0 ? `${activeImageCount} img` : ''}
                {activeImageCount > 0 && activeVideoCount > 0 ? ' · ' : ''}
                {activeVideoCount > 0 ? `${activeVideoCount} vid` : ''}
              </span>
            </div>
            {renderMediaSection(activeEntry, 'pane')}
          </div>
        )}

        <div className={`${tokens.cardBg} ${tokens.cardRadius} p-3.5 space-y-2.5 min-w-0 max-w-full overflow-hidden`}>
          <div className="flex items-center justify-between">
            <span className="text-[13.5px] font-semibold text-stone-800 dark:text-stone-200">
              Live web sources
            </span>
            <span className="text-[12px] font-mono-tabular text-stone-400">
              {activeEntry ? `${activeEntry.sources.length} cited` : 'Ready'}
            </span>
          </div>

          {!activeEntry ? (
            <p className="text-[13.5px] text-stone-500 dark:text-stone-400 leading-relaxed">
              Run a lookup on the left to view embedded images, playable videos, and live web citations.
            </p>
          ) : activeEntry.sources.length === 0 ? (
            <p className="text-[13.5px] text-stone-500 dark:text-stone-400">
              Answered directly without external citations.
            </p>
          ) : (
            <div className="space-y-2 min-w-0">
              {activeEntry.sources.map((src) => (
                <a
                  key={src.uri}
                  href={src.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 min-w-0 max-w-full overflow-hidden ${tokens.subtleBg} ${tokens.buttonRadius} hover:opacity-90 transition-opacity`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-medium text-stone-800 dark:text-stone-100 truncate">
                      {src.title}
                    </p>
                    <p className="text-[12px] text-stone-400 truncate">{formatDomain(src.uri)}</p>
                  </div>
                  <ExternalLink className={`w-4 h-4 shrink-0 ${tokens.accentText}`} />
                </a>
              ))}
            </div>
          )}

          {activeEntry && activeEntry.webSearchQueries.length > 0 && (
            <div className={`pt-2.5 border-t ${tokens.divider} space-y-1 min-w-0`}>
              <p className="text-[12px] font-medium text-stone-400">Search queries used</p>
              <p className="text-[13px] text-stone-600 dark:text-stone-300 leading-snug break-words [overflow-wrap:anywhere]">
                {activeEntry.webSearchQueries.join(' · ')}
              </p>
            </div>
          )}
        </div>

        {entries.length > 0 && renderStarterChips()}
      </div>
    );
  };

  const renderLightbox = () => {
    if (!lightboxImage) return null;
    return (
      <div
        className="absolute inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3"
        onClick={() => setLightboxImage(null)}
      >
        <div
          className={`w-full max-w-md ${tokens.cardBg} ${tokens.cardRadius} overflow-hidden shadow-2xl`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative bg-stone-950 max-h-[60vh] flex items-center justify-center overflow-hidden">
            <img
              src={lightboxImage.url}
              alt={lightboxImage.title}
              referrerPolicy="no-referrer"
              className="w-full max-h-[60vh] object-contain"
            />
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              aria-label="Close image preview"
              className="absolute top-2.5 right-2.5 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold text-stone-900 dark:text-stone-100 truncate">
                {lightboxImage.title}
              </p>
              <p className="text-[12px] text-stone-400 truncate">
                {lightboxImage.sourceName || formatDomain(lightboxImage.sourceUrl || lightboxImage.url)}
              </p>
            </div>
            <a
              href={lightboxImage.sourceUrl || lightboxImage.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] font-medium ${tokens.subtleBg} ${tokens.accentText} ${tokens.buttonRadius} shrink-0`}
            >
              Open
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    );
  };

  const renderFeedBody = (compactSources: boolean) => (
    <div className="flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto overflow-x-hidden device-scroll space-y-3 pr-0.5">
      {savedFeedback && (
        <div
          className={`flex items-center gap-2 px-3 py-2 text-[13px] font-medium ${tokens.accentSoftBg} ${tokens.accentText} ${tokens.buttonRadius}`}
        >
          <Check className="w-4 h-4 shrink-0" />
          <span className="min-w-0 break-words">{savedFeedback}</span>
        </div>
      )}

      {!isOnline && (
        <div
          className={`flex items-start gap-2.5 px-3 py-2.5 ${tokens.subtleBg} ${tokens.buttonRadius} text-stone-600 dark:text-stone-300 text-[13px] min-w-0`}
        >
          <WifiOff className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <span className="leading-snug min-w-0 break-words">
            Offline — live web search resumes when connected. You can search saved tasks, notes, and schedule below or review past lookups.
          </span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-[13.5px] min-w-0">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="leading-snug min-w-0 break-words [overflow-wrap:anywhere]">{errorMsg}</span>
        </div>
      )}

      {entries.length === 0 && !isLoading ? (
        <div className="pt-0.5 min-w-0 max-w-full">{renderStarterChips()}</div>
      ) : (
        <div className="space-y-3 min-w-0 max-w-full">
          {entries.map((entry) => renderEntryCard(entry, compactSources))}
          {isLoading && (
            <div className={`${tokens.cardBg} ${tokens.cardRadius} p-3.5 flex items-center gap-2.5 text-[14px] text-stone-500 dark:text-stone-400`}>
              <Loader2 className={`w-4 h-4 animate-spin ${tokens.accentText}`} />
              <span>Checking live web results...</span>
            </div>
          )}
          <div ref={feedEndRef} />
        </div>
      )}
    </div>
  );

  if (posture === FoldPosture.Inner) {
    return (
      <div className={`relative h-full min-h-0 w-full max-w-full min-w-0 grid grid-cols-2 ${hingeAwareSplit ? 'gap-5' : 'gap-3'} px-3.5 py-2 overflow-hidden`}>
        <div className="h-full min-h-0 min-w-0 max-w-full flex flex-col gap-2 overflow-hidden">
          {renderHeader()}
          {renderFeedBody(false)}
          {renderComposer()}
        </div>
        {renderSourcesPane()}
        {renderLightbox()}
      </div>
    );
  }

  if (posture === FoldPosture.Flex) {
    return (
      <div className="relative h-full min-h-0 w-full max-w-full min-w-0 flex flex-col overflow-hidden">
        <div className="h-[52%] min-h-0 min-w-0 max-w-full flex flex-col gap-1.5 px-3.5 py-2 overflow-hidden">
          {renderHeader()}
          {renderFeedBody(true)}
        </div>
        <div className="h-3.5 flex items-center justify-center bg-stone-200/60 dark:bg-black/40 border-y border-stone-300/60 dark:border-stone-800 shrink-0">
          <span className="text-[9px] font-mono-tabular text-stone-500 dark:text-stone-400">
            Flex hinge · Quick input
          </span>
        </div>
        <div className="flex-1 min-h-0 min-w-0 max-w-full flex flex-col justify-between px-3.5 py-2 gap-2 overflow-y-auto overflow-x-hidden device-scroll">
          <div className="flex flex-wrap gap-1.5 min-w-0">
            {relevantChecks.slice(0, 3).map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={isLoading}
                onClick={() => runQuickCheck(item.prompt)}
                className={`px-2.5 py-1 text-[12.5px] font-medium ${tokens.subtleBg} text-stone-700 dark:text-stone-200 ${tokens.buttonRadius} hover:opacity-85 max-w-full truncate`}
              >
                {item.prompt}
              </button>
            ))}
          </div>
          {renderComposer()}
        </div>
        {renderLightbox()}
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 w-full max-w-full min-w-0 flex flex-col px-3.5 pt-2 pb-2.5 gap-2 overflow-hidden">
      {renderHeader()}
      {renderFeedBody(true)}
      {renderComposer()}
      {renderLightbox()}
    </div>
  );
};

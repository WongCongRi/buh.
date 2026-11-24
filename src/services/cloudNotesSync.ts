import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { NoteBlock, NoteItem } from '../types/taskflow';

// Blueprint-synchronized constants (verbatim match with firebase-blueprint.json & firestore.rules)
const ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;
const MAX_ID_LEN = 128;
const MAX_TITLE_LEN = 300;
const MAX_FOLDER_LEN = 100;
const MAX_UPDATED_LABEL_LEN = 60;
const MAX_BLOCKS = 250;
const MAX_BLOCK_TEXT_LEN = 20000;
const MAX_FOLDERS = 50;

const VALID_BLOCK_TYPES = new Set<NoteBlock['type']>([
  'paragraph',
  'heading',
  'checklist',
  'bullet',
]);

export interface CloudNotePreferencesData {
  folders: string[];
  collapsedFolders: string[];
}

export interface CloudNoteDoc {
  id: string;
  ownerId: string;
  title: string;
  folder: string;
  updatedAtLabel: string;
  pinned: boolean;
  markdownEnabled: boolean;
  sortOrder?: number;
  blocks: NoteBlock[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export function sanitizeCloudId(raw: string, fallbackPrefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, MAX_ID_LEN);
  if (cleaned.length > 0 && ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return `${fallbackPrefix}-${Date.now()}`.slice(0, MAX_ID_LEN);
}

export function sanitizeFoldersForCloud(folders: string[]): string[] {
  const unique = Array.from(
    new Set(
      folders
        .map((f) => (typeof f === 'string' ? f.trim().slice(0, MAX_FOLDER_LEN) : ''))
        .filter((f) => f.length > 0)
    )
  ).slice(0, MAX_FOLDERS);
  return unique.length > 0 ? unique : ['Work'];
}

export function sanitizeCollapsedFoldersForCloud(
  collapsed: string[],
  validFolders: string[]
): string[] {
  const validSet = new Set(validFolders);
  return Array.from(
    new Set(
      collapsed
        .map((f) => (typeof f === 'string' ? f.trim().slice(0, MAX_FOLDER_LEN) : ''))
        .filter((f) => f.length > 0 && validSet.has(f))
    )
  ).slice(0, MAX_FOLDERS);
}

function sanitizeBlockForCloud(block: NoteBlock, index: number): NoteBlock {
  const id = sanitizeCloudId(block.id || `b-${index + 1}`, `b-${index + 1}`);
  const type: NoteBlock['type'] = VALID_BLOCK_TYPES.has(block.type)
    ? block.type
    : 'paragraph';
  const text = (typeof block.text === 'string' ? block.text : '').slice(0, MAX_BLOCK_TEXT_LEN);
  if (type === 'checklist' || typeof block.checked === 'boolean') {
    return { id, type, text, checked: Boolean(block.checked) };
  }
  return { id, type, text };
}

export function isNoteNonEmpty(note: NoteItem): boolean {
  return (
    note.title.trim().length > 0 ||
    note.blocks.some((b) => b.text.trim().length > 0)
  );
}

function sanitizeNotePayload(
  note: NoteItem,
  ownerId: string,
  fallbackFolder: string
): Omit<CloudNoteDoc, 'createdAt' | 'updatedAt'> {
  const safeId = sanitizeCloudId(note.id, 'n');
  const safeFolder =
    (note.folder || fallbackFolder || 'Work').trim().slice(0, MAX_FOLDER_LEN) || 'Work';
  const safeTitle = (note.title || '').slice(0, MAX_TITLE_LEN);
  const safeUpdatedLabel =
    (note.updatedAt || 'Edited just now').trim().slice(0, MAX_UPDATED_LABEL_LEN) ||
    'Edited just now';
  const safeBlocks = (Array.isArray(note.blocks) ? note.blocks : [])
    .slice(0, MAX_BLOCKS)
    .map((b, i) => sanitizeBlockForCloud(b, i));

  const base: Omit<CloudNoteDoc, 'createdAt' | 'updatedAt'> = {
    id: safeId,
    ownerId,
    title: safeTitle,
    folder: safeFolder,
    updatedAtLabel: safeUpdatedLabel,
    pinned: Boolean(note.pinned),
    markdownEnabled: Boolean(note.markdownEnabled),
    blocks: safeBlocks,
  };
  if (typeof note.sortOrder === 'number' && Number.isFinite(note.sortOrder)) {
    base.sortOrder = note.sortOrder;
  }
  return base;
}

function mapCloudDocToNoteItem(data: Partial<CloudNoteDoc>, docId: string): NoteItem | null {
  const id = typeof data.id === 'string' && data.id.trim() ? data.id : docId;
  if (!id) return null;
  const rawBlocks = Array.isArray(data.blocks) ? data.blocks : [];
  const blocks: NoteBlock[] =
    rawBlocks.length > 0
      ? rawBlocks.map((b, i) => sanitizeBlockForCloud(b as NoteBlock, i))
      : [{ id: `b-${id}-1`, type: 'paragraph', text: '' }];

  return {
    id,
    title: typeof data.title === 'string' ? data.title : '',
    folder:
      typeof data.folder === 'string' && data.folder.trim() ? data.folder.trim() : 'Work',
    updatedAt:
      typeof data.updatedAtLabel === 'string' && data.updatedAtLabel.trim()
        ? data.updatedAtLabel
        : 'Synced',
    pinned: Boolean(data.pinned),
    markdownEnabled: Boolean(data.markdownEnabled),
    sortOrder:
      typeof data.sortOrder === 'number' && Number.isFinite(data.sortOrder)
        ? data.sortOrder
        : undefined,
    blocks,
  };
}

function sortCloudNoteRecords(
  records: { note: NoteItem; sortMs: number }[]
): NoteItem[] {
  records.sort((a, b) => {
    const aHas = typeof a.note.sortOrder === 'number';
    const bHas = typeof b.note.sortOrder === 'number';
    if (aHas && bHas && a.note.sortOrder !== b.note.sortOrder) {
      return a.note.sortOrder! - b.note.sortOrder!;
    }
    if (aHas !== bHas) {
      return aHas ? -1 : 1;
    }
    return b.sortMs - a.sortMs;
  });
  return records.map((r) => r.note);
}

export async function ensureUserWorkspace(uid: string): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveCloudNotePreferences(
  uid: string,
  folders: string[],
  collapsedFolders: string[]
): Promise<void> {
  const safeFolders = sanitizeFoldersForCloud(folders);
  const safeCollapsed = sanitizeCollapsedFoldersForCloud(collapsedFolders, safeFolders);
  const path = `users/${uid}/preferences/notes`;
  const ref = doc(db, 'users', uid, 'preferences', 'notes');

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        folders: safeFolders,
        collapsedFolders: safeCollapsed,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        ownerId: uid,
        folders: safeFolders,
        collapsedFolders: safeCollapsed,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function upsertCloudNote(
  uid: string,
  note: NoteItem,
  fallbackFolder = 'Work'
): Promise<void> {
  const payload = sanitizeNotePayload(note, uid, fallbackFolder);
  const path = `users/${uid}/notes/${payload.id}`;
  const ref = doc(db, 'users', uid, 'notes', payload.id);

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const updatePatch: Record<string, unknown> = {
        title: payload.title,
        folder: payload.folder,
        updatedAtLabel: payload.updatedAtLabel,
        pinned: payload.pinned,
        markdownEnabled: payload.markdownEnabled,
        blocks: payload.blocks,
        updatedAt: serverTimestamp(),
      };
      if (typeof payload.sortOrder === 'number') {
        updatePatch.sortOrder = payload.sortOrder;
      }
      await updateDoc(ref, updatePatch);
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCloudNote(uid: string, noteId: string): Promise<void> {
  const safeId = sanitizeCloudId(noteId, 'n');
  const path = `users/${uid}/notes/${safeId}`;
  const ref = doc(db, 'users', uid, 'notes', safeId);

  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeCloudNotePreferences(
  uid: string,
  onData: (prefs: CloudNotePreferencesData | null) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/preferences/notes`;
  const ref = doc(db, 'users', uid, 'preferences', 'notes');

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data() as {
        folders?: unknown;
        collapsedFolders?: unknown;
      };
      const folders = sanitizeFoldersForCloud(
        Array.isArray(data.folders) ? (data.folders as string[]) : []
      );
      const collapsedFolders = sanitizeCollapsedFoldersForCloud(
        Array.isArray(data.collapsedFolders) ? (data.collapsedFolders as string[]) : [],
        folders
      );
      onData({ folders, collapsedFolders });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeCloudNotes(
  uid: string,
  onData: (notes: NoteItem[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/notes`;
  const notesQuery = query(
    collection(db, 'users', uid, 'notes'),
    where('ownerId', '==', uid)
  );

  return onSnapshot(
    notesQuery,
    (snapshot) => {
      const records: { note: NoteItem; sortMs: number }[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Partial<CloudNoteDoc>;
        const mapped = mapCloudDocToNoteItem(data, docSnap.id);
        if (mapped) {
          const ts = data.updatedAt ?? data.createdAt;
          const sortMs = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
          records.push({ note: mapped, sortMs });
        }
      });
      onData(sortCloudNoteRecords(records));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function fetchAllCloudNotesOnce(uid: string): Promise<NoteItem[]> {
  const path = `users/${uid}/notes`;
  const notesQuery = query(
    collection(db, 'users', uid, 'notes'),
    where('ownerId', '==', uid)
  );
  try {
    const snapshot = await getDocs(notesQuery);
    const records: { note: NoteItem; sortMs: number }[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as Partial<CloudNoteDoc>;
      const mapped = mapCloudDocToNoteItem(data, docSnap.id);
      if (mapped) {
        const ts = data.updatedAt ?? data.createdAt;
        const sortMs = ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
        records.push({ note: mapped, sortMs });
      }
    });
    return sortCloudNoteRecords(records);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export function formatFriendlyCloudSyncError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('Quota exceeded')) {
    return 'Cloud sync daily quota exceeded. Quota resets tomorrow.';
  }
  if (raw.includes('Missing or insufficient permissions') || raw.includes('permission-denied')) {
    return 'Cloud sync permission denied. Please verify your Google account email and sign in again.';
  }
  if (raw.includes('offline') || raw.includes('unavailable')) {
    return 'Offline — notes are saved locally and will sync automatically when online.';
  }
  return 'Could not sync notes right now. Your notes remain saved locally.';
}

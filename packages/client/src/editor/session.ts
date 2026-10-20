import { draftFromJson, draftToJson, newDraft, type Draft } from './draft.js';
import type { Status } from './EditorParts.js';
import { EDITOR_PATH, readShared, sharedIn } from './share.js';

/**
 * The editor's work beyond the editor screen. The draft lives in the app,
 * so that a test run can come back to it, and the tab keeps a copy in its
 * sessionStorage, so that a reload does too — „Zurück zum Editor" leaves the
 * room by reloading the page. On load the address decides what the editor
 * starts with: a mission a shared link carries, else the tab's copy, else a
 * new one.
 */

/** The part of the Web Storage API the editor keeps its work in. */
export type WorkStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Where the tab keeps the draft. */
export const DRAFT_KEY = 'escapelab.editor.draft';

/** Where the tab keeps the room it opened for a test run. */
export const RUN_KEY = 'escapelab.editor.run';

/** The draft, and what tells whether it is saved. */
export interface EditorWork {
  draft: Draft;
  /** the mission file as last opened or saved: unsaved changes differ from it */
  baseline: string;
  /** opened from a shared link and not saved since */
  shared: boolean;
}

/** Work that starts at `draft`, with nothing changed yet. */
export function workOf(draft: Draft, shared = false): EditorWork {
  return { draft, baseline: JSON.stringify(draftToJson(draft)), shared };
}

/** The tab's sessionStorage; null where the browser does not let the page have it. */
export function sessionStore(): WorkStore | null {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readItem(store: WorkStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Writes or removes an entry; where the browser refuses, the work stays in the page alone. */
function writeItem(store: WorkStore | null, key: string, value: string | null): void {
  try {
    if (value === null) {
      store?.removeItem(key);
    } else {
      store?.setItem(key, value);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[escapelab] the tab keeps no copy of ${key}: ${reason}`);
  }
}

/** A new draft as its mission file: what nobody has touched yet. */
const BLANK = JSON.stringify(draftToJson(newDraft()));

/**
 * Keeps the work in the tab, for a reload. A new draft nobody has touched
 * leaves nothing behind, so „Neu" clears what was kept.
 */
export function mirrorWork(store: WorkStore | null, work: EditorWork): void {
  const mission = draftToJson(work.draft);
  const blank = !work.shared && JSON.stringify(mission) === BLANK;
  const kept = { mission, baseline: work.baseline, shared: work.shared };
  writeItem(store, DRAFT_KEY, blank ? null : JSON.stringify(kept));
}

/** The work the tab kept; null where it kept none, or none that still reads as a mission. */
export function restoredWork(store: WorkStore | null): EditorWork | null {
  const raw = readItem(store, DRAFT_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const kept = JSON.parse(raw) as { mission?: unknown; baseline?: unknown; shared?: unknown };
    const loaded = draftFromJson(kept.mission);
    if (loaded.ok && typeof kept.baseline === 'string') {
      return { draft: loaded.draft, baseline: kept.baseline, shared: kept.shared === true };
    }
  } catch (err) {
    console.warn(`[escapelab] the kept draft does not read: ${String(err)}`);
  }
  return null;
}

/** What the address asks of the app on load, for the editor. */
export interface EditorBoot {
  /** the address is the editor's: the app opens on it */
  open: boolean;
  /** what the editor starts with */
  work: EditorWork;
  /** what the editor says first: why a shared link could not be read */
  status: Status | null;
}

/**
 * Reads the address the page was loaded with: the editor's path opens the
 * editor, a mission in `#m=` is unpacked into the draft (marked as shared);
 * without one the tab's copy comes back. A link that cannot be read leaves
 * an empty editor that says why.
 */
export async function bootEditor(
  where: { pathname: string; hash: string },
  store: WorkStore | null,
): Promise<EditorBoot> {
  const open = where.pathname === EDITOR_PATH || where.pathname === `${EDITOR_PATH}/`;
  const packed = open ? sharedIn(where.hash) : null;
  if (packed === null) {
    return { open, work: restoredWork(store) ?? workOf(newDraft()), status: null };
  }
  const shared = await readShared(packed);
  if (shared.ok) {
    return { open, work: workOf(shared.draft, true), status: null };
  }
  const status: Status = {
    tone: 'error',
    text: 'Der geteilte Link ließ sich nicht lesen.',
    lines: shared.problems,
  };
  return { open, work: workOf(newDraft()), status };
}

// ── the test run ─────────────────────────────────────────────────────────

/** The room this tab opened for a test run: still awaited (no code yet), or open. */
export interface TestRun {
  code: string | null;
}

/** The test run this tab kept; null where there is none. */
export function storedRun(store: WorkStore | null): TestRun | null {
  try {
    const kept = JSON.parse(readItem(store, RUN_KEY) ?? 'null') as { code?: unknown } | null;
    const code = kept?.code;
    return typeof code === 'string' || code === null ? { code } : null;
  } catch {
    return null;
  }
}

export function mirrorRun(store: WorkStore | null, run: TestRun | null): void {
  writeItem(store, RUN_KEY, run === null ? null : JSON.stringify(run));
}

/** Whether the top bar offers the way back to the editor: to the host of the test run's room. */
export function returnsToEditor(
  run: TestRun | null,
  roomCode: string | null,
  isHost: boolean,
): boolean {
  return run !== null && run.code !== null && run.code === roomCode && isHost;
}

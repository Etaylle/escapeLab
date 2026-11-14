import { AUDIBLE_FLOOR_DBFS, floorDbfsOf } from './listing.js';

/**
 * The music's takes on the audition page (/sounds): what the dev server lists of them (GET
 * /takes/, the server's takes.ts) as the sound script wrote their lists (scripts/sfx.ts
 * `TakesList`) — a suite's take with each of its pieces, where the plan cuts it — where each
 * take plays from, its floor as the page says it, and the command that keeps one — which the
 * page shows and never runs. Pure, but for `loadTakes`, which asks the dev server for the lists
 * and nothing else.
 */

/** Where the dev server serves the takes: their lists, and each take under its entry's id. */
export const TAKES_BASE = '/takes/';

/**
 * A piece of a suite's take as its list names it: scripts/sfx.ts `PieceRecord` — where it lies
 * in the take and how long, whether it loops, its gain, its loudness before it (LUFS; null for
 * silence), its peak, RMS, floor and silence, and the rules it misses: length, silence, floor.
 */
export interface PieceInfo {
  readonly id: string;
  readonly fromMs: number;
  readonly ms: number;
  readonly loop: boolean;
  readonly gain: number;
  readonly loudness: number | null;
  readonly peak: number;
  readonly rms: number;
  readonly floor: number;
  readonly silence: number;
  readonly misses: readonly string[];
}

/** A take as its list names it and the page reads it: scripts/sfx.ts `TakeRecord`, in part. */
export interface TakeInfo {
  readonly n: number;
  readonly file: string;
  readonly ms: number;
  readonly gain: number;
  readonly startMs: number;
  readonly peak: number;
  readonly rms: number;
  readonly floor: number;
  readonly silence: number;
  /** the rules of the script's PICK it misses: peak, start, silence, length, floor */
  readonly misses: readonly string[];
  /** a suite's take: its pieces in the plan's order */
  readonly pieces?: readonly PieceInfo[];
}

/** Every entry's takes, by its id, in the order they were made. */
export type Takes = Readonly<Record<string, readonly TakeInfo[]>>;

/** What the page has of the takes: those the dev server lists, or why there are none to hear. */
export type TakesState =
  | { readonly kind: 'served'; readonly takes: Takes }
  | { readonly kind: 'unserved'; readonly why: string };

const NUMBERS = ['n', 'ms', 'gain', 'startMs', 'peak', 'rms', 'floor', 'silence'] as const;
const PIECE_NUMBERS = ['fromMs', 'ms', 'gain', 'peak', 'rms', 'floor', 'silence'] as const;

/** Whether `record`'s `misses` is a list of the rules it misses, by name. */
const missesRead = (record: Record<string, unknown>): boolean =>
  Array.isArray(record['misses']) && record['misses'].every((miss) => typeof miss === 'string');

/** Whether `value` reads as a piece of a suite's take: its id, its numbers, its misses. */
function isPiece(value: unknown): value is PieceInfo {
  if (typeof value !== 'object' || value === null) return false;
  const piece = value as Record<string, unknown>;
  const loudness = piece['loudness'];
  return (
    typeof piece['id'] === 'string' &&
    typeof piece['loop'] === 'boolean' &&
    (loudness === null || typeof loudness === 'number') &&
    PIECE_NUMBERS.every((key) => typeof piece[key] === 'number') &&
    missesRead(piece)
  );
}

/** Whether `record`'s pieces, where it has any — a suite's take's — each read as a piece. */
function piecesRead(record: Record<string, unknown>): boolean {
  const pieces = record['pieces'];
  return pieces === undefined || (Array.isArray(pieces) && pieces.every(isPiece));
}

/**
 * Whether `value` reads as a take: its numbers, its file as `<n>.mp3`, the rules it misses — and
 * a suite's pieces, where it has any, each as a piece reads.
 */
function isTake(value: unknown): value is TakeInfo {
  if (typeof value !== 'object' || value === null) return false;
  const take = value as Record<string, unknown>;
  return (
    NUMBERS.every((key) => typeof take[key] === 'number') &&
    take['file'] === `${String(take['n'])}.mp3` &&
    missesRead(take) &&
    piecesRead(take)
  );
}

/** The takes of `lists`, the dev server's answer: each entry's that read as takes. */
export function takesOf(lists: unknown): Takes {
  if (typeof lists !== 'object' || lists === null) return {};
  return Object.fromEntries(
    Object.entries(lists).flatMap(([id, list]) => {
      const takes: unknown = (list as { takes?: unknown } | null)?.takes;
      const read = Array.isArray(takes) ? takes.filter(isTake) : [];
      return read.length > 0 ? [[id, read]] : [];
    }),
  );
}

/** Why the page has no takes where the server serves none: a production server's 404. */
export const UNSERVED = 'Takes liefert nur der Entwicklungsserver (pnpm dev).';

/**
 * The takes as the dev server lists them; where it serves none (404, as a production server
 * answers) or the lists cannot be had, why. Asks for the lists alone, with a plain GET.
 */
export async function loadTakes(): Promise<TakesState> {
  try {
    const res = await fetch(TAKES_BASE);
    if (res.status === 404) {
      return { kind: 'unserved', why: UNSERVED };
    }
    if (!res.ok) {
      return { kind: 'unserved', why: `Die Takes ließen sich nicht laden: HTTP ${res.status}` };
    }
    return { kind: 'served', takes: takesOf(await res.json()) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: 'unserved', why: `Die Takes ließen sich nicht laden: ${reason}` };
  }
}

/** Where take `take` of the entry `id` plays from. */
export function takeUrl(id: string, take: Pick<TakeInfo, 'file'>): string {
  return `${TAKES_BASE}${id}/${take.file}`;
}

/** What the page calls take `n` of the entry `id` by while it plays: one key for every take. */
export function takeKey(id: string, n: number): string {
  return `${id}#${n}`;
}

/** What the page calls the piece `piece` of take `n` of the suite `id` by while it plays. */
export function pieceKey(id: string, n: number, piece: string): string {
  return `${takeKey(id, n)}/${piece}`;
}

/**
 * A take's floor once its gain is applied, dBFS — null where its sound masks it — and if heard;
 * a piece of a suite's take's alike.
 */
export function takeFloor(
  take: Pick<TakeInfo, 'floor' | 'rms' | 'gain'>,
): { floorDbfs: number | null; noisy: boolean } {
  const floorDbfs = floorDbfsOf(take);
  return { floorDbfs, noisy: floorDbfs !== null && floorDbfs > AUDIBLE_FLOOR_DBFS };
}

/** Whether `record` misses a rule a recording of the game may not: its length, or its floor. */
const failing = (record: { readonly misses: readonly string[] }): boolean =>
  record.misses.includes('length') || record.misses.includes('floor');

/** Whether a piece of a suite's take, kept, would fail the game's recordings: cut short, or noisy. */
export function pieceFails(piece: PieceInfo): boolean {
  return failing(piece);
}

/**
 * Whether a take, kept, would fail the game's recordings as sampleManifest.test.ts holds them —
 * more than a fifth off its length, or its floor heard — or a suite's could not be kept whole:
 * off its plan's length, or a piece of it cut short or with its floor heard.
 */
export function takeFails(take: TakeInfo): boolean {
  return failing(take) || (take.pieces ?? []).some(failing);
}

/** The takes chosen to be kept, by their entry's id: one take of each entry at most. */
export type Keeping = Readonly<Record<string, number>>;

/** `keeping` with take `n` of `id` chosen — or none of `id`, where `n` was the one chosen. */
export function chooseTake(keeping: Keeping, id: string, n: number): Keeping {
  const others = Object.fromEntries(Object.entries(keeping).filter(([each]) => each !== id));
  return keeping[id] === n ? others : { ...others, [id]: n };
}

/** The command that keeps take `n` of the entry `id`, to be run in packages/client. */
export function keepCommandFor(id: string, n: number): string {
  return `node scripts/sfx.ts --keep ${id}=${n}`;
}

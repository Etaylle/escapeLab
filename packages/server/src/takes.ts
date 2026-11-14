import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { ApiResponse } from './api.js';
import { switchOn } from './switches.js';

/**
 * The music's takes, for the client's /sounds page to play before one is kept: the client's
 * scripts/sfx.ts makes them (`--candidates`) into packages/client/takes/<id>/<n>.mp3, each
 * entry's listed in its folder's index.json, and keeps one (`--keep`). GET /takes/ answers every
 * entry's list by its id, GET /takes/<id>/<n>.mp3 the take itself. Beside them the samples of the
 * radio's voices, for the client's /voices page to play before one is kept: scripts/voice.ts
 * `--design` makes them into takes/voices/<slot>/<n>.mp3 — a role's folder (`pa`), or a role's
 * and a person's (`operator-laura`) — listed alike; GET /takes/voices/ answers every person's
 * list by their folder, GET /takes/voices/<slot>/<n>.mp3 the sample. And the library voices
 * offered for the cast (scripts/casting.json) with their previews, which `--previews` fetches
 * into takes/voices/library/<voice id>.mp3: GET /takes/voices/library/ answers the voices, each
 * with whether its preview is there, GET /takes/voices/library/<voice id>.mp3 the preview. Only
 * with ALLOW_TAKES=1, as `pnpm dev` sets it: without, every address under /takes answers 404 —
 * never the page in its place — so a production server serves no take.
 */

/** An entry's id, as the catalog names it: lower-case words joined by dashes. */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A take's address: its entry's id, then its number as the file's name. */
const TAKE_PATH = /^\/takes\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([1-9]\d*\.mp3)$/;
/** Each entry's list of its takes, in its folder. */
const LIST = 'index.json';
/** The folder of the voices' samples, among the takes. */
const VOICES = 'voices';
/** A person's folder of samples: their role (`pa`), or their role and id (`operator-laura`). */
const SLOT = /^[a-z]+(?:-[a-z]+)?$/;
/** A sample's address: its person's folder, then its number as the file's name. */
const SAMPLE_PATH = /^\/takes\/voices\/([a-z]+(?:-[a-z]+)?)\/([1-9]\d*\.mp3)$/;
/** The folder of the library voices' previews, among the voices' samples. */
const LIBRARY = 'library';
/** A voice's id on the ElevenLabs account. */
const VOICE_ID = /^[A-Za-z0-9]{8,64}$/;
/** A library voice's preview's address: its id as the file's name. */
const PREVIEW_PATH = /^\/takes\/voices\/library\/([A-Za-z0-9]{8,64})\.mp3$/;

/** A library voice offered for the cast, as /voices plays it: whether its preview is there. */
export interface LibraryEntry {
  readonly voiceId: string;
  readonly name: string;
  readonly about: string;
  readonly slot: string;
  readonly preview: boolean;
}

/** Whether `value` reads as a library voice of the casting file: an id, a name, what, for whom. */
function isLibraryVoice(value: unknown): value is Omit<LibraryEntry, 'preview'> {
  const voice = (value ?? {}) as Record<string, unknown>;
  return (
    typeof voice['voiceId'] === 'string' &&
    VOICE_ID.test(voice['voiceId']) &&
    ['name', 'about', 'slot'].every((key) => typeof voice[key] === 'string')
  );
}

/**
 * Whether the server serves the takes: with ALLOW_TAKES=1, as `pnpm dev` sets it; not with 0 or
 * unset. Throws for anything else, so that a misspelt switch is not mistaken for either.
 */
export function takesAllowed(env: NodeJS.ProcessEnv): boolean {
  const does = 'liefert Takes und Stimmproben an /sounds und /voices, ohne bleibt /takes leer';
  return switchOn(env, 'ALLOW_TAKES', does);
}

/**
 * The folder the takes wait in, read as the page asks for it, and the voice script's casting file
 * (`casting`), whose library voices the page offers.
 */
export class TakesShelf {
  constructor(
    readonly dir: string,
    readonly casting: string | null = null,
  ) {}

  /**
   * Every entry's list of takes by its id, each as its folder's index.json has it; a list that
   * does not read as JSON is said on the console and left out.
   */
  lists(): Record<string, unknown> {
    return listsIn(this.dir, ID, 'takes');
  }

  /**
   * Every person's list of voice samples by their folder (`pa`, `operator-laura`), as
   * scripts/voice.ts writes it; one that does not read as JSON is said and left out.
   */
  samples(): Record<string, unknown> {
    return listsIn(join(this.dir, VOICES), SLOT, `takes/${VOICES}`);
  }

  /**
   * The library voices the casting file offers for the cast, each with whether its preview lies in
   * takes/voices/library/; none without a casting file. One that does not read is said and left
   * out, a file that does not read as JSON said and taken as none.
   */
  library(): { library: LibraryEntry[] } {
    const listed = this.casting === null ? [] : readLibrary(this.casting);
    const library = listed.filter(isLibraryVoice).map(({ voiceId, name, about, slot }) => {
      const preview = existsSync(join(this.dir, VOICES, LIBRARY, `${voiceId}.mp3`));
      return { voiceId, name, about, slot, preview };
    });
    if (library.length < listed.length) {
      console.error(`[escapelab] ${this.casting ?? ''}: a library voice does not read, left out`);
    }
    return { library };
  }

  /**
   * The take `name` of the entry `id` and its size, from one look at it — so that a keep deleting
   * it mid-request leaves nothing to throw later; null where there is none. A look that fails for
   * another reason than its absence is said on the console.
   */
  take(id: string, name: string): TakeFile | null {
    const file = join(this.dir, id, name);
    try {
      const stats = statSync(file);
      return stats.isFile() ? { file, size: stats.size } : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[escapelab] the take ${file} could not be looked at: ${reason}`);
      }
      return null;
    }
  }
}

/**
 * The lists in the folders of `dir` whose names `named` takes, by the folder: each its
 * index.json as read; one that does not read is said on the console as `<where>/<folder>/...`.
 */
function listsIn(dir: string, named: RegExp, where: string): Record<string, unknown> {
  const folders = existsSync(dir) ? readdirSync(dir).filter((name) => named.test(name)) : [];
  const lists: Record<string, unknown> = {};
  for (const folder of folders.sort()) {
    const file = join(dir, folder, LIST);
    if (!existsSync(file)) continue;
    try {
      lists[folder] = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[escapelab] ${where}/${folder}/${LIST} could not be read: ${reason}`);
    }
  }
  return lists;
}

/** The library list of the casting file at `file`; none where there is none or it does not read. */
function readLibrary(file: string): unknown[] {
  if (!existsSync(file)) return [];
  try {
    const { library } = JSON.parse(readFileSync(file, 'utf8')) as { library?: unknown };
    return Array.isArray(library) ? library : [];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[escapelab] ${file} could not be read: ${reason}`);
    return [];
  }
}

/** A take as one look found it: its file, and its size in bytes. */
export interface TakeFile {
  readonly file: string;
  readonly size: number;
}

function send(res: ServerResponse, reply: ApiResponse): void {
  res.writeHead(reply.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(reply.body));
}

/** A span of a file's bytes, both ends counted. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** The last `count` bytes of a file `size` long; none, where it asks for none or has none. */
function lastBytes(count: number, size: number): Span | 'unsatisfiable' {
  return count > 0 && size > 0
    ? { start: Math.max(0, size - count), end: size - 1 }
    : 'unsatisfiable';
}

/**
 * The bytes from `start` to `to` — to its end where `to` is empty — of a file `size` long; null
 * where `to` lies before `start`, a span that is invalid rather than unsatisfiable, which the
 * server ignores, sending the whole file (RFC 9110).
 */
function bytesFrom(start: number, to: string, size: number): Span | 'unsatisfiable' | null {
  if (to !== '' && Number(to) < start) {
    return null;
  }
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return start < size ? { start, end } : 'unsatisfiable';
}

/**
 * The bytes the Range header `header` asks of a file `size` long: one span — `bytes=a-b`,
 * `bytes=a-` or the last n, `bytes=-n` — or 'unsatisfiable' where it starts past the end; null
 * for the whole file, where there is no Range, an invalid one (`bytes=9-3`), or one of several
 * spans or of another unit, which a server may answer whole.
 */
export function rangeOf(header: string | undefined, size: number): Span | 'unsatisfiable' | null {
  const [, from = '', to = ''] = /^bytes=(\d*)-(\d*)$/.exec(header ?? '') ?? [];
  if (from === '' && to === '') {
    return null;
  }
  return from === '' ? lastBytes(Number(to), size) : bytesFrom(Number(from), to, size);
}

/**
 * Sends the take at `file`, an MP3, to the page's audio element: whole, or the span a Range asks
 * for (206) — as Safari asks for every audio file, and a loop on its way round — each with its
 * length; a span past its end answers 416.
 */
function sendTake({ file, size }: TakeFile, req: IncomingMessage, res: ServerResponse): void {
  const range = rangeOf(req.headers.range, size);
  const kind = {
    'content-type': 'audio/mpeg',
    'cache-control': 'no-store',
    'accept-ranges': 'bytes',
  };
  if (range === 'unsatisfiable') {
    res.writeHead(416, { ...kind, 'content-range': `bytes */${size}` });
    res.end();
    return;
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const length = { ...kind, 'content-length': String(end - start + 1) };
  if (range === null) {
    res.writeHead(200, length);
  } else {
    res.writeHead(206, { ...length, 'content-range': `bytes ${start}-${end}/${size}` });
  }
  if (req.method === 'HEAD' || end < start) {
    res.end();
    return;
  }
  createReadStream(file, { start, end })
    .on('error', (err) => {
      console.error(`[escapelab] the take ${file} could not be sent: ${err.message}`);
      res.destroy(err);
    })
    .pipe(res);
}

/** The path a GET or HEAD under /takes asks for, its query left off; null for any other. */
function askedUnderTakes(req: IncomingMessage): string | null {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const under = path === '/takes' || path.startsWith('/takes/');
  return under && (req.method === 'GET' || req.method === 'HEAD') ? path : null;
}

/**
 * The addresses under /takes a file is served at, and where each one's file lies on the shelf:
 * its folder and its name — a take, a library voice's preview, a voice's sample.
 */
const FILE_PATHS: readonly (readonly [RegExp, (match: RegExpExecArray) => [string, string]])[] = [
  [TAKE_PATH, ([, id = '', name = '']) => [id, name]],
  [PREVIEW_PATH, ([, voiceId = '']) => [join(VOICES, LIBRARY), `${voiceId}.mp3`]],
  [SAMPLE_PATH, ([, slot = '', sample = '']) => [join(VOICES, slot), sample]],
];

/**
 * The take, the voice sample or the library voice's preview the address `path` names on `shelf`;
 * null where there is none.
 */
function takeFileAt(shelf: TakesShelf, path: string): TakeFile | null {
  for (const [pattern, where] of FILE_PATHS) {
    const match = pattern.exec(path);
    if (match !== null) return shelf.take(...where(match));
  }
  return null;
}

/** Whether `path` names the folder `folder` under /takes, with its slash or without. */
const isFolder = (path: string, folder: string): boolean =>
  path === `/takes/${folder}` || path === `/takes/${folder}/`;

/**
 * The lists the address `path` asks for: the takes', the voices' samples', the library voices',
 * or none of them (null).
 */
function listsAt(shelf: TakesShelf, path: string): Record<string, unknown> | null {
  if (path === '/takes' || path === '/takes/') return shelf.lists();
  if (isFolder(path, `${VOICES}/${LIBRARY}`)) return shelf.library();
  return isFolder(path, VOICES) ? shelf.samples() : null;
}

/**
 * Answers GET and HEAD under /takes — with `shelf` null, as without ALLOW_TAKES=1, a 404 for
 * every address there — and returns true when the request was one.
 */
export function serveTakes(
  shelf: TakesShelf | null,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const path = askedUnderTakes(req);
  if (path === null) {
    return false;
  }
  if (shelf === null) {
    send(res, { status: 404, body: { error: 'Takes liefert der Server nur mit ALLOW_TAKES=1.' } });
    return true;
  }
  const lists = listsAt(shelf, path);
  const take = lists === null ? takeFileAt(shelf, path) : null;
  if (lists !== null) {
    send(res, { status: 200, body: lists });
  } else if (take === null) {
    send(res, { status: 404, body: { error: `Unter ${path} liegt kein Take.` } });
  } else {
    sendTake(take, req, res);
  }
  return true;
}

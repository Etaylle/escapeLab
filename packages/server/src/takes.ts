import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { ApiResponse } from './api.js';
import { switchOn } from './switches.js';

/**
 * The music's takes, for the client's /sounds page to play before one is kept: the client's
 * scripts/sfx.ts makes them (`--candidates`) into packages/client/takes/<id>/<n>.mp3, each
 * entry's listed in its folder's index.json, and keeps one (`--keep`). GET /takes/ answers every
 * entry's list by its id, GET /takes/<id>/<n>.mp3 the take itself. Only with ALLOW_TAKES=1, as
 * `pnpm dev` sets it: without, every address under /takes answers 404 — never the page in its
 * place — so a production server serves no take.
 */

/** An entry's id, as the catalog names it: lower-case words joined by dashes. */
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A take's address: its entry's id, then its number as the file's name. */
const TAKE_PATH = /^\/takes\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([1-9]\d*\.mp3)$/;
/** Each entry's list of its takes, in its folder. */
const LIST = 'index.json';

/**
 * Whether the server serves the takes: with ALLOW_TAKES=1, as `pnpm dev` sets it; not with 0 or
 * unset. Throws for anything else, so that a misspelt switch is not mistaken for either.
 */
export function takesAllowed(env: NodeJS.ProcessEnv): boolean {
  const does = 'liefert die Takes der Musik an die Seite /sounds, ohne bleibt /takes leer';
  return switchOn(env, 'ALLOW_TAKES', does);
}

/** The folder the takes wait in, read as the page asks for it. */
export class TakesShelf {
  constructor(readonly dir: string) {}

  /**
   * Every entry's list of takes by its id, each as its folder's index.json has it; a list that
   * does not read as JSON is said on the console and left out.
   */
  lists(): Record<string, unknown> {
    const ids = existsSync(this.dir) ? readdirSync(this.dir).filter((name) => ID.test(name)) : [];
    const lists: Record<string, unknown> = {};
    for (const id of ids.sort()) {
      const file = join(this.dir, id, LIST);
      if (!existsSync(file)) continue;
      try {
        lists[id] = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[escapelab] takes/${id}/${LIST} could not be read: ${reason}`);
      }
    }
    return lists;
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

/** The take the address `path` names on `shelf`; null where there is none. */
function takeFileAt(shelf: TakesShelf, path: string): TakeFile | null {
  const [, id, name] = TAKE_PATH.exec(path) ?? [];
  return id === undefined || name === undefined ? null : shelf.take(id, name);
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
  } else if (path === '/takes' || path === '/takes/') {
    send(res, { status: 200, body: shelf.lists() });
  } else {
    const take = takeFileAt(shelf, path);
    if (take === null) {
      send(res, { status: 404, body: { error: `Unter ${path} liegt kein Take.` } });
    } else {
      sendTake(take, req, res);
    }
  }
  return true;
}

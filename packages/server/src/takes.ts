import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { ApiResponse } from './api.js';

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
  const flag = env['ALLOW_TAKES'] ?? '';
  if (flag === '1') {
    return true;
  }
  if (flag === '' || flag === '0') {
    return false;
  }
  throw new Error(
    `ALLOW_TAKES=${flag} versteht der Server nicht — ALLOW_TAKES=1 liefert die Takes der Musik ` +
      'an die Seite /sounds, ohne bleibt /takes leer',
  );
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

  /** The file `name` of the entry `id`'s takes; null where there is none. */
  take(id: string, name: string): string | null {
    const file = join(this.dir, id, name);
    return existsSync(file) && statSync(file).isFile() ? file : null;
  }
}

function send(res: ServerResponse, reply: ApiResponse): void {
  res.writeHead(reply.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(reply.body));
}

/** Sends the take at `file`, an MP3, to be streamed by the page's audio element. */
function sendTake(file: string, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file)
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

/** The file of the take the address `path` names on `shelf`; null where there is none. */
function takeFileAt(shelf: TakesShelf, path: string): string | null {
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
    const file = takeFileAt(shelf, path);
    if (file === null) {
      send(res, { status: 404, body: { error: `Unter ${path} liegt kein Take.` } });
    } else {
      sendTake(file, req, res);
    }
  }
  return true;
}

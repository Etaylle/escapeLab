import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticSite } from '../src/static.js';
import {
  rangeOf,
  serveTakes,
  takesAllowed,
  TakesShelf,
  type TakeFile,
} from '../src/takes.js';

/**
 * The music's takes on the dev server (GET /takes/, /takes/<id>/<n>.mp3) and their switch: a
 * production server, without ALLOW_TAKES=1, answers 404 under /takes and never the page.
 */

/** A take's bytes, as an MP3 starts: an ID3 tag. */
const TAKE = Buffer.from('ID3\u0004take two');
/** Where the dev server serves it: menu-theme's take 2. */
const TAKE_URL = '/takes/menu-theme/2.mp3';

/** The lists the sound script writes, a take each: menu-theme's and end-won's. */
const listOf = (id: string, n: number) => ({
  id,
  takes: [{ n, file: `${n}.mp3`, hash: '7376acdcf4c7', ms: 60_029, gain: 0.53, misses: [] }],
});

/** A folder of takes as the sound script leaves it, with a folder that is no entry's beside. */
function shelfIn(): TakesShelf {
  const dir = mkdtempSync(join(tmpdir(), 'escapelab-takes-'));
  for (const [id, n] of [
    ['menu-theme', 2],
    ['end-won', 1],
  ] as const) {
    mkdirSync(join(dir, id));
    writeFileSync(join(dir, id, 'index.json'), JSON.stringify(listOf(id, n)));
    writeFileSync(join(dir, id, `${n}.mp3`), TAKE);
  }
  mkdirSync(join(dir, 'no-list'));
  writeFileSync(join(dir, 'no-list', '1.mp3'), TAKE);
  mkdirSync(join(dir, 'Not An Id'));
  writeFileSync(join(dir, 'Not An Id', 'index.json'), '{}');
  return new TakesShelf(dir);
}

/** What a route sent: its status, its headers and its body. */
interface Sent {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** A request as the route reads one: its address, its method, its headers. */
function request(url: string, method = 'GET', headers: Record<string, string> = {}) {
  return { url, method, headers } as IncomingMessage;
}

/** Sends `req` to `route` and waits for all it sends; null where the route leaves it alone. */
async function ask(
  route: (req: IncomingMessage, res: ServerResponse) => boolean,
  req: IncomingMessage,
): Promise<Sent | null> {
  let status = 0;
  let headers: Record<string, string> = {};
  const res = Object.assign(new PassThrough(), {
    writeHead(code: number, sent: Record<string, string> = {}) {
      status = code;
      headers = sent;
      return res;
    },
  });
  if (!route(req, res as unknown as ServerResponse)) {
    return null;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of res as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return { status, headers, body: Buffer.concat(chunks) };
}

const json = (sent: Sent | null): unknown => JSON.parse(sent?.body.toString('utf8') ?? 'null');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the switch for the takes', () => {
  it('is on with ALLOW_TAKES=1 alone, off unset or 0, and refuses anything else', () => {
    expect(takesAllowed({ ALLOW_TAKES: '1' })).toBe(true);
    expect(takesAllowed({})).toBe(false);
    expect(takesAllowed({ ALLOW_TAKES: '' })).toBe(false);
    expect(takesAllowed({ ALLOW_TAKES: '0' })).toBe(false);
    expect(() => takesAllowed({ ALLOW_TAKES: 'yes' })).toThrow(/ALLOW_TAKES=yes/);
  });
});

describe('a production server, without ALLOW_TAKES=1', () => {
  const urls = ['/takes', '/takes/', '/takes/menu-theme/2.mp3', '/takes/menu-theme/index.json'];

  it('answers 404 to every address under /takes, a list and a take alike', async () => {
    for (const url of urls) {
      for (const method of ['GET', 'HEAD']) {
        const sent = await ask((req, res) => serveTakes(null, req, res), request(url, method));
        expect(sent?.status, `${method} ${url}`).toBe(404);
      }
    }
    const sent = await ask((req, res) => serveTakes(null, req, res), request('/takes/'));
    expect(json(sent)).toEqual({ error: 'Takes liefert der Server nur mit ALLOW_TAKES=1.' });
  });

  it('answers them before the built site, whose fallback would send the page instead', async () => {
    const root = mkdtempSync(join(tmpdir(), 'escapelab-built-'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>t</title>');
    const site = new StaticSite(root);
    const page = await ask((req, res) => site.serve(req, res), request('/takes/'));
    expect(page?.status).toBe(200); // the page's fallback, as for any address it does not know
    const server = (req: IncomingMessage, res: ServerResponse): boolean =>
      serveTakes(null, req, res) || site.serve(req, res);
    for (const url of urls) {
      expect((await ask(server, request(url)))?.status, url).toBe(404);
    }
    expect((await ask(server, request('/sounds')))?.status).toBe(200);
  });
});

describe('the dev server, with ALLOW_TAKES=1', () => {
  it('lists every entry’s takes by its id, as the sound script wrote them', async () => {
    const shelf = shelfIn();
    const sent = await ask((req, res) => serveTakes(shelf, req, res), request('/takes/'));
    expect([sent?.status, sent?.headers['content-type']]).toEqual([200, 'application/json']);
    expect(json(sent)).toEqual({
      'end-won': listOf('end-won', 1),
      'menu-theme': listOf('menu-theme', 2),
    });
    const bare = await ask((req, res) => serveTakes(shelf, req, res), request('/takes?x=1'));
    expect(json(bare)).toEqual(json(sent));
  });

  it('lists none where no take was made, and leaves out a list it cannot read', async () => {
    const none = new TakesShelf(join(tmpdir(), 'escapelab-takes-none-made'));
    expect(json(await ask((req, res) => serveTakes(none, req, res), request('/takes/')))).toEqual(
      {},
    );
    const shelf = shelfIn();
    writeFileSync(join(shelf.dir, 'end-won', 'index.json'), '{ cut short');
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sent = await ask((req, res) => serveTakes(shelf, req, res), request('/takes/'));
    expect(Object.keys(json(sent) as object)).toEqual(['menu-theme']);
    expect(said).toHaveBeenCalledWith(
      expect.stringMatching(/^\[escapelab\] takes\/end-won\/index\.json could not be read: /),
    );
  });

  it('sends a take as audio, its length said, and HEAD its headers alone', async () => {
    const shelf = shelfIn();
    const route = (req: IncomingMessage, res: ServerResponse): boolean =>
      serveTakes(shelf, req, res);
    const sent = await ask(route, request('/takes/menu-theme/2.mp3'));
    expect([sent?.status, sent?.headers['content-type']]).toEqual([200, 'audio/mpeg']);
    expect(sent?.headers).toMatchObject({
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      'content-length': String(TAKE.length),
    });
    expect(sent?.body.equals(TAKE)).toBe(true);
    const head = await ask(route, request('/takes/menu-theme/2.mp3', 'HEAD'));
    expect([head?.status, head?.body.length]).toEqual([200, 0]);
  });

  it('answers 404 to anything else under /takes, and leaves every other address be', async () => {
    const shelf = shelfIn();
    const route = (req: IncomingMessage, res: ServerResponse): boolean =>
      serveTakes(shelf, req, res);
    const missing = [
      '/takes/menu-theme/3.mp3',
      '/takes/menu-theme/index.json',
      '/takes/menu-theme/0.mp3',
      '/takes/Menu/2.mp3',
      '/takes/../server/package.json',
      '/takes/menu-theme/../end-won/1.mp3',
      '/takes/menu-theme',
    ];
    for (const url of missing) {
      expect((await ask(route, request(url)))?.status, url).toBe(404);
    }
    for (const url of ['/takesx', '/sounds', '/music/manifest.json', '/missions']) {
      expect(await ask(route, request(url)), url).toBeNull();
    }
    expect(await ask(route, request('/takes/', 'POST'))).toBeNull();
  });
});

describe('a take in spans, with ALLOW_TAKES=1', () => {
  const size = TAKE.length;

  /** What the route sends for the take, asked with the Range `range`; it has to answer. */
  async function ranged(range: string, method = 'GET'): Promise<Sent> {
    const shelf = shelfIn();
    const req = request(TAKE_URL, method, { range });
    const sent = await ask((asked, res) => serveTakes(shelf, asked, res), req);
    if (sent === null) throw new Error(`the route left ${method} ${range} alone`);
    return sent;
  }

  it('sends the span a Range asks for with 206, where it lies and how long it is', async () => {
    const spans: [string, number, number][] = [
      ['bytes=0-3', 0, 3],
      ['bytes=4-', 4, size - 1],
      ['bytes=-4', size - 4, size - 1],
      ['bytes=2-999', 2, size - 1],
      [`bytes=-${size + 5}`, 0, size - 1],
    ];
    for (const [range, start, end] of spans) {
      const sent = await ranged(range);
      const told = [sent.status, sent.headers['content-range'], sent.headers['content-length']];
      expect(told, range).toEqual([206, `bytes ${start}-${end}/${size}`, String(end - start + 1)]);
      expect(sent.body.equals(TAKE.subarray(start, end + 1)), range).toBe(true);
    }
  });

  it('answers 416 to a span past the end, telling the take’s length', async () => {
    for (const range of [`bytes=${size}-`, `bytes=${size + 3}-${size + 9}`, 'bytes=-0']) {
      const sent = await ranged(range);
      const told = [sent.status, sent.headers['content-range'], sent.body.length];
      expect(told, range).toEqual([416, `bytes */${size}`, 0]);
    }
  });

  it('sends the whole take for an invalid span, several spans or another unit', async () => {
    // bytes=9-3 ends before it starts: invalid rather than unsatisfiable, so ignored (RFC 9110).
    for (const range of ['bytes=9-3', 'bytes=0-1,4-5', 'items=0-1', 'bytes=-']) {
      const sent = await ranged(range);
      expect([sent.status, sent.headers['content-length']], range).toEqual([200, String(size)]);
      expect(sent.body.equals(TAKE), range).toBe(true);
    }
    const read = [rangeOf(undefined, size), rangeOf('bytes=9-3', size), rangeOf('bytes=0-0', 0)];
    expect(read).toEqual([null, null, 'unsatisfiable']);
  });

  it('answers HEAD with the span’s headers alone', async () => {
    const head = await ranged('bytes=0-3', 'HEAD');
    expect([head.status, head.headers['content-length'], head.body.length]).toEqual([206, '4', 0]);
  });
});

describe('a take gone between a look and its sending', () => {
  /** A shelf whose takes a keep deletes right after each look at them. */
  class Vanishing extends TakesShelf {
    override take(id: string, name: string): TakeFile | null {
      const found = super.take(id, name);
      if (found !== null) rmSync(found.file);
      return found;
    }
  }

  it('cuts its answer and says so, throwing nothing at the dev server', async () => {
    const shelf = new Vanishing(shelfIn().dir);
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = Object.assign(new PassThrough(), { writeHead: () => res });
    res.on('error', () => undefined);
    const closed = new Promise((done) => res.on('close', done));
    const answer = res as unknown as ServerResponse;
    expect(() => serveTakes(shelf, request(TAKE_URL), answer)).not.toThrow();
    await closed;
    const cut = /^\[escapelab\] the take \S+2\.mp3 could not be sent: ENOENT/;
    expect(said).toHaveBeenCalledWith(expect.stringMatching(cut));
  });

  it('is found by one look, its size with it; a look that fails else is said, a 404', async () => {
    const shelf = shelfIn();
    const file = join(shelf.dir, 'menu-theme', '2.mp3');
    expect(shelf.take('menu-theme', '2.mp3')).toEqual({ file, size: TAKE.length });
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(shelf.take('menu-theme', '9.mp3')).toBeNull(); // not there: no news
    expect(said).not.toHaveBeenCalled();
    writeFileSync(join(shelf.dir, 'flat'), 'a file where a folder of takes belongs');
    const sent = await ask((req, res) => serveTakes(shelf, req, res), request('/takes/flat/1.mp3'));
    expect(sent?.status).toBe(404);
    expect(said).toHaveBeenCalledWith(expect.stringMatching(/could not be looked at: ENOTDIR/));
  });
});

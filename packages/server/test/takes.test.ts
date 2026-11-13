import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticSite } from '../src/static.js';
import { rangeOf, serveTakes, takesAllowed, TakesShelf } from '../src/takes.js';

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
  it('sends the span a Range asks for, as Safari and a loop on its way round do', async () => {
    const shelf = shelfIn();
    const ranged = (range: string, method = 'GET') =>
      ask((req, res) => serveTakes(shelf, req, res), request(TAKE_URL, method, { range }));
    const size = TAKE.length;
    const spans: [string, number, number][] = [
      ['bytes=0-3', 0, 3],
      ['bytes=4-', 4, size - 1],
      ['bytes=-4', size - 4, size - 1],
      ['bytes=2-999', 2, size - 1],
      [`bytes=-${size + 5}`, 0, size - 1],
    ];
    for (const [range, start, end] of spans) {
      const sent = await ranged(range);
      expect([sent?.status, sent?.headers['content-range']], range).toEqual([
        206,
        `bytes ${start}-${end}/${size}`,
      ]);
      expect(sent?.headers['content-length'], range).toBe(String(end - start + 1));
      expect(sent?.body.equals(TAKE.subarray(start, end + 1)), range).toBe(true);
    }
    for (const range of [`bytes=${size}-`, 'bytes=9-3', 'bytes=-0']) {
      const past = await ranged(range);
      expect([past?.status, past?.headers['content-range'], past?.body.length], range).toEqual([
        416,
        `bytes */${size}`,
        0,
      ]);
    }
    // Several spans, or another unit, a server may answer whole.
    for (const range of ['bytes=0-1,4-5', 'items=0-1', 'bytes=-']) {
      expect((await ranged(range))?.status, range).toBe(200);
    }
    const head = await ranged('bytes=0-3', 'HEAD');
    expect([head?.status, head?.headers['content-length'], head?.body.length]).toEqual([
      206,
      '4',
      0,
    ]);
    expect([rangeOf(undefined, size), rangeOf('bytes=0-0', 0)]).toEqual([null, 'unsatisfiable']);
  });
});

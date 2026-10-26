import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMission } from '@escapelab/core';
import { App, TopBar } from '../src/App.js';
import { draftFromJson, draftToJson, newDraft, type Draft } from '../src/editor/draft.js';
import {
  bootEditor,
  DRAFT_KEY,
  mirrorRun,
  mirrorWork,
  restoredWork,
  returnsToEditor,
  RUN_KEY,
  storedRun,
  workOf,
  type WorkStore,
} from '../src/editor/session.js';
import { readShared, SHARE_MAX_BYTES, sharedIn, shareLink } from '../src/editor/share.js';
import { JoinScreen, keepName, lastName } from '../src/screens/Join.js';

const noop = (): void => undefined;

const MISSIONS = new URL('../../../missions/', import.meta.url);
const shipped = readdirSync(MISSIONS)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(new URL(name, MISSIONS), 'utf8')) as unknown);

/** The mission the harness imports, saves and plays: „Probe", custom-probe. */
const PROBE = JSON.parse(
  readFileSync(new URL('../../../tools/fixtures/probe-mission.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

function loaded(data: unknown): Draft {
  const result = draftFromJson(data);
  if (!result.ok) {
    throw new Error(result.problems.join('; '));
  }
  return result.draft;
}

/** A sessionStorage of its own for each test. */
function memoryStore(): WorkStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

/** Text packed as a link packs it: deflate-raw, then base64url. */
async function packed(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return Buffer.from(bytes).toString('base64url');
}

async function linkFor(mission: Record<string, unknown>): Promise<string> {
  const shared = await shareLink(mission, 'http://lab:3001');
  if (!shared.ok) {
    throw new Error(shared.error);
  }
  return shared.link;
}

describe('a shared link', () => {
  it.each(shipped.map((data) => [(data as { title: string }).title, data]))(
    'carries %s whole, under 32 kB, and opens as the same draft',
    async (_title, data) => {
      const draft = loaded(data);
      const shared = await shareLink(draftToJson(draft), 'http://lab:3001');
      expect(shared.ok && shared.bytes).toBeLessThanOrEqual(SHARE_MAX_BYTES);
      const link = new URL(shared.ok ? shared.link : '');
      expect(`${link.origin}${link.pathname}`).toBe('http://lab:3001/editor');
      const read = await readShared(sharedIn(link.hash) ?? '');
      expect(read).toEqual({ ok: true, draft });
    },
  );

  it('is refused for a mission that packs to more than 32 kB', async () => {
    // Letters drawn at random (xorshift32) hardly pack: 100 000 of them stay well above it.
    let state = 2_463_534_242;
    const noise = Array.from({ length: 100_000 }, () => {
      state = (state ^ (state << 13)) >>> 0;
      state = (state ^ (state >>> 17)) >>> 0;
      state = (state ^ (state << 5)) >>> 0;
      return String.fromCharCode(97 + (state % 26));
    }).join('');
    const big = { ...draftToJson(newDraft()), story: { intro: noise, win: '', lose: '' } };
    const shared = await shareLink(big, 'http://lab');
    expect(shared.ok).toBe(false);
    expect(shared.ok ? '' : shared.error).toMatch(/^Zu groß für einen Link: gepackt \d+ kB/);
  });

  it('says what is wrong with a link that does not carry a mission', async () => {
    const broken = { ok: false, problems: ['Der Link ist unvollständig oder verändert.'] };
    expect(await readShared('ab$cd')).toEqual(broken);
    expect(await readShared('')).toEqual(broken);
    expect(await readShared('QUJD')).toEqual(broken);
    expect(await readShared(await packed('kein JSON'))).toEqual(broken);
    expect(await readShared(await packed('[1, 2]'))).toEqual({
      ok: false,
      problems: ['Die Datei enthält kein Missionsobjekt.'],
    });
    // A short link that would unpack to more than the server takes is not unpacked.
    expect(await readShared(await packed(' '.repeat(300_000)))).toEqual({
      ok: false,
      problems: ['Die Mission im Link ist größer als 256 kB.'],
    });
  });

  it('is found in the fragment after #m= only', () => {
    expect(sharedIn('#m=abc_-')).toBe('abc_-');
    expect(sharedIn('#x=abc')).toBeNull();
    expect(sharedIn('')).toBeNull();
  });
});

describe('the editor on load', () => {
  it('opens on /editor with the mission a link carries, marked as shared', async () => {
    const link = new URL(await linkFor(PROBE));
    const store = memoryStore();
    mirrorWork(store, workOf({ ...newDraft(), title: 'Alt' }));
    const boot = await bootEditor({ pathname: link.pathname, hash: link.hash }, store);
    expect(boot.open).toBe(true);
    expect(boot.status).toBeNull();
    expect(boot.work).toEqual({ ...workOf(loaded(PROBE)), shared: true });
  });

  it('opens an empty editor that says why, where the link cannot be read', async () => {
    const boot = await bootEditor({ pathname: '/editor', hash: '#m=kaputt!' }, memoryStore());
    expect(boot.open).toBe(true);
    expect(boot.work).toEqual(workOf(newDraft()));
    expect(boot.status).toEqual({
      tone: 'error',
      text: 'Der geteilte Link ließ sich nicht lesen.',
      lines: ['Der Link ist unvollständig oder verändert.'],
    });
  });

  it('brings back what the tab kept, and opens the editor only on its path', async () => {
    const store = memoryStore();
    const kept = { ...workOf(loaded(PROBE)), draft: { ...loaded(PROBE), title: 'Probe 2' } };
    mirrorWork(store, kept);
    expect(await bootEditor({ pathname: '/editor', hash: '' }, store)).toEqual({
      open: true,
      work: kept,
      status: null,
    });
    const elsewhere = await bootEditor({ pathname: '/', hash: '#m=kaputt!' }, store);
    expect(elsewhere).toEqual({ open: false, work: kept, status: null });
    expect((await bootEditor({ pathname: '/', hash: '' }, null)).work).toEqual(workOf(newDraft()));
  });
});

describe('the tab’s copy of the draft', () => {
  it('follows every change, and „Neu" clears it', () => {
    const store = memoryStore();
    const work = { ...workOf(loaded(PROBE)), shared: true };
    mirrorWork(store, work);
    expect(restoredWork(store)).toEqual(work);
    mirrorWork(store, workOf(newDraft()));
    expect(store.items.has(DRAFT_KEY)).toBe(false);
    expect(restoredWork(store)).toBeNull();
  });

  it('is left alone where it no longer reads as a mission', () => {
    const store = memoryStore();
    vi.spyOn(console, 'warn').mockImplementation(noop);
    store.setItem(DRAFT_KEY, '{"mission": [1], "baseline": ""}');
    expect(restoredWork(store)).toBeNull();
    store.setItem(DRAFT_KEY, 'kein JSON');
    expect(restoredWork(store)).toBeNull();
    vi.restoreAllMocks();
  });
});

describe('a test run', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is remembered in the tab, awaited and then by its room', () => {
    const store = memoryStore();
    expect(storedRun(store)).toBeNull();
    mirrorRun(store, { code: null });
    expect(storedRun(store)).toEqual({ code: null });
    mirrorRun(store, { code: 'QXT4' });
    expect(storedRun(store)).toEqual({ code: 'QXT4' });
    mirrorRun(store, null);
    expect(store.items.has(RUN_KEY)).toBe(false);
  });

  it('gives the way back to the editor to the host of its own room only', () => {
    expect(returnsToEditor({ code: 'QXT4' }, 'QXT4', true)).toBe(true);
    expect(returnsToEditor({ code: 'QXT4' }, 'QXT4', false)).toBe(false);
    expect(returnsToEditor({ code: 'QXT4' }, 'ABCD', true)).toBe(false);
    expect(returnsToEditor({ code: null }, 'QXT4', true)).toBe(false);
    expect(returnsToEditor(null, 'QXT4', true)).toBe(false);
  });

  it('puts „Zurück zum Editor" into the top bar, and nothing for any other room', () => {
    vi.stubGlobal('window', { location: { origin: 'http://lab', pathname: '/' } });
    const bar = (toEditor: (() => void) | null): string =>
      renderToStaticMarkup(
        <TopBar
          roomCode="QXT4"
          seed={null}
          running={null}
          status="open"
          toEditor={toEditor}
          onSettings={noop}
        />,
      );
    expect(bar(noop)).toContain(
      '<button class="topbar-editor" aria-label="Zurück zum Editor">' +
        '<span class="topbar-editor-way">Zurück zum </span>Editor</button>',
    );
    expect(bar(null)).not.toContain('topbar-editor');
  });

  it('starts with the name the join screen keeps', () => {
    const items = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
      removeItem: (key: string) => items.delete(key),
    };
    vi.stubGlobal('window', { location: { search: '' }, localStorage });
    expect(lastName()).toBe('');
    keepName('Anna');
    expect(lastName()).toBe('Anna');
    const join = renderToStaticMarkup(
      <JoinScreen
        send={noop}
        connected
        missions={[]}
        rooms={[]}
        stats={[]}
        openHandbook={noop}
        openHistory={noop}
      />,
    );
    expect(join).toContain('value="Anna"');
    keepName('  ');
    expect(lastName()).toBe('');
  });
});

describe('the app on /editor#m=', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the editor on the mission the link carries', async () => {
    expect(parseMission(PROBE).title).toBe('Probe');
    const link = new URL(await linkFor(PROBE));
    const boot = await bootEditor({ pathname: link.pathname, hash: link.hash }, null);
    vi.stubGlobal('window', {
      location: { origin: link.origin, pathname: link.pathname, hash: link.hash, search: '' },
    });
    const html = renderToStaticMarkup(<App boot={boot} />);
    expect(html).toContain('<strong>Probe</strong>');
    expect(html).toContain('<code class="editor-id">custom-probe</code>');
    expect(html).toContain('GETEILT · nicht gespeichert');
    expect(html).toContain('<main class="content content--editor">');
  });
});

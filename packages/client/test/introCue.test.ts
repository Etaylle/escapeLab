import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  composeCue,
  CREDIT_FLOOR,
  CUE_FILE,
  CUE_FORMAT,
  CUE_MS,
  CUE_PROMPT,
  cueHash,
  cueRequest,
  INTRO_DIR,
  type CueClient,
  type CueEntry,
  type CueRun,
} from '../scripts/introCue.js';
import { CUE_FADE_S, CUE_PEAK, TITLE, type CueManifest } from '../src/world/intro/cue.js';
import { MUSIC_LEVEL } from '../src/world/music.js';
import type { SampleEntry } from '../src/world/samples.js';
import {
  downstream,
  fakeGraph,
  lastContext,
  type FakeBufferSource,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';
import { elements, fakeMedia, type FakeAudio } from './fakeMedia.js';

/** A client of its own: credits as given, and music that is three bytes; it counts its calls. */
function fakeClient(left: number, spend = 1200) {
  const calls = { compose: [] as unknown[], credits: 0 };
  let used = 131_000 - left;
  const client: CueClient = {
    user: {
      subscription: {
        get: () => {
          calls.credits += 1;
          return Promise.resolve({ characterCount: used, characterLimit: 131_000 });
        },
      },
    },
    music: {
      compose: (request) => {
        calls.compose.push(request);
        used += spend;
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3])).body as ReadableStream);
      },
    },
  };
  return { client, calls };
}

/** A run of the script into a folder of its own, measuring every file at 40.1 s. */
function runIn(dir = mkdtempSync(join(tmpdir(), 'intro-cue-')), dryRun = false) {
  const lines: string[] = [];
  const measure = (): { ms: number; peak: number } => ({ ms: 40_100, peak: 0.84457 });
  const run: CueRun = { dir, measure, log: (line) => lines.push(line), dryRun };
  return { run, lines, dir };
}

describe('the opening’s music, as the script asks for it', () => {
  it('asks for 40 s of an instrumental bed, dark, low and slowly building, as MP3', () => {
    expect(cueRequest()).toEqual({
      prompt: CUE_PROMPT,
      musicLengthMs: 40_000,
      forceInstrumental: true,
      outputFormat: 'mp3_44100_96',
    });
    expect([CUE_MS, CUE_FORMAT]).toEqual([40_000, 'mp3_44100_96']);
    expect(CUE_PROMPT).toMatch(/instrumental/i);
    expect(CUE_PROMPT).toMatch(/builds very slowly/);
    expect(CUE_PROMPT).toMatch(/no vocals/i);
  });

  it('names the cue by a hash of the request, which a changed prompt changes', () => {
    const hash = cueHash(cueRequest());
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(cueHash(cueRequest())).toBe(hash);
    expect(cueHash({ ...cueRequest(), prompt: 'Something else.' })).not.toBe(hash);
  });
});

describe('composing the cue', () => {
  it('composes what is missing: the file, its list with length and hash, the cost', async () => {
    const { client, calls } = fakeClient(129_000);
    const { run, lines, dir } = runIn();
    expect(await composeCue(client, run)).toBe('composed');
    expect(calls.compose).toEqual([cueRequest()]);
    expect([...readFileSync(join(dir, CUE_FILE))]).toEqual([1, 2, 3]);
    const entry = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as CueEntry;
    const hash = cueHash(cueRequest());
    expect(entry).toEqual({ file: CUE_FILE, ms: 40_100, peak: 0.8446, hash });
    expect(lines.at(-1)).toMatch(/1200 credits spent, 127800 left$/);
  });

  it('composes nothing anew where its list names this prompt’s cue and its file', async () => {
    const { client, calls } = fakeClient(129_000);
    const { run, dir } = runIn();
    await composeCue(client, run);
    const again = fakeClient(129_000);
    expect(await composeCue(again.client, run)).toBe('kept');
    expect(again.calls).toEqual({ compose: [], credits: 0 });
    // A list naming another prompt's cue is stale: composed anew.
    const stale: CueEntry = { file: CUE_FILE, ms: 40_100, peak: 0.8, hash: 'aaaaaaaaaaaa' };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(stale));
    expect(await composeCue(client, run)).toBe('composed');
    expect(calls.compose).toHaveLength(2);
  });

  it('stops before composing where fewer credits than the floor remain', async () => {
    const { client, calls } = fakeClient(CREDIT_FLOOR - 1);
    const { run, dir } = runIn();
    await expect(composeCue(client, run)).rejects.toThrow(/39999 credits left, under 40000/);
    expect(calls.compose).toEqual([]);
    expect(existsSync(join(dir, CUE_FILE))).toBe(false);
  });

  it('says on a dry run what it would compose, and composes nothing', async () => {
    const { client, calls } = fakeClient(129_000);
    const { run, lines, dir } = runIn(undefined, true);
    expect(await composeCue(client, run)).toBe('planned');
    expect(calls.compose).toEqual([]);
    expect(lines).toEqual([
      'intro cue: 129000 credits left',
      `intro cue: would compose 40 s (${cueHash(cueRequest())}) into ${dir}`,
    ]);
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false);
  });
});

describe('the cue in the game', () => {
  const MANIFEST: CueManifest = { file: 'title.mp3', ms: 40_000, peak: 0.8, hash: 'abcdefabcdef' };
  let found = true;

  beforeEach(() => {
    fakeGraph();
    fakeMedia();
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined); // a list not to be had
    found = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        const json = (): Promise<CueManifest> => Promise.resolve(MANIFEST);
        return Promise.resolve({ ok: found, status: found ? 200 : 404, json });
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function fresh() {
    vi.resetModules();
    const cue = await import('../src/world/intro/cue.js');
    const audio = await import('../src/world/audio.js');
    audio.audioEngine();
    return { cue, audio };
  }

  /** The cue's list fetched, and its element played, a lookahead on. */
  const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(10).then(() => undefined);

  /** The level the cue's element comes in at: its stream's own gain. */
  const levelOf = (element: FakeAudio | undefined): FakeGain => {
    const media = lastContext()
      .all<FakeNode & { mediaElement: unknown }>('media')
      .find((node) => node.mediaElement === element);
    return media?.outputs[0] as FakeGain;
  };

  it('streams from where the opening stands, low, into the music, as one voice', async () => {
    const { cue, audio } = await fresh();
    cue.startCue(Date.now() - 1000);
    await settle();
    const [element] = elements;
    expect(element?.src).toBe('/intro/title.mp3');
    expect(element?.currentTime).toBe(1); // where the opening stands: no beat to keep
    expect(element?.plays).toBe(1);
    expect(audio.inUse().voice).toBe(1);
    // Its list names its peak over both channels: the cue comes in at CUE_PEAK.
    expect(levelOf(element).gain.value).toBeCloseTo(CUE_PEAK / 0.8, 9);
    const engine = audio.audioEngine() as unknown as { music: FakeNode };
    expect(downstream(levelOf(element) as unknown as FakeNode).has(engine.music)).toBe(true);
    expect(lastContext().all<FakeBufferSource>('buffer')).toEqual([]); // nothing decoded
    expect(cue.cueProbe().playing).toBe(true);
  });

  it('plays the score’s title in its place where the music has one, as loud', async () => {
    const title: SampleEntry = {
      file: 'title.m4a',
      ms: 40_000,
      gain: 1.4,
      startMs: 120,
      floor: 0,
      rms: 0.1,
      loop: false,
      hash: 'abcdefabcdef',
      source: 'elevenlabs',
    };
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        asked.push(url);
        const body = url === '/music/manifest.json' ? { [TITLE]: title } : MANIFEST;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      }),
    );
    const { cue, audio } = await fresh();
    cue.startCue(Date.now() - 1000);
    await settle();
    const [element] = elements;
    expect(element?.src).toBe('/music/title.m4a');
    expect(element?.currentTime).toBeCloseTo(1.12, 9); // where the opening stands, past its lead
    expect(levelOf(element).gain.value).toBeCloseTo(MUSIC_LEVEL * 1.4, 9);
    expect(asked).not.toContain('/intro/manifest.json');
    expect([audio.inUse().voice, cue.cueProbe().playing]).toEqual([1, true]);
    cue.stopCue(0);
    expect(levelOf(element).gain.ramps()).toEqual([[0, expect.closeTo(10.02, 9)]]);
  });

  it('fades out where the player skips, and stops dead at the blackout', async () => {
    const { cue, audio } = await fresh();
    cue.startCue(Date.now());
    await settle();
    const [first] = elements;
    cue.stopCue(CUE_FADE_S);
    expect(levelOf(first).gain.ramps()).toEqual([[0, expect.closeTo(10 + CUE_FADE_S, 9)]]);
    expect(cue.cueProbe().playing).toBe(false);
    await vi.advanceTimersByTimeAsync((CUE_FADE_S + 0.05) * 1000);
    expect([first?.src, audio.inUse().voice]).toEqual(['', 0]); // let go, its voice back
    cue.startCue(Date.now());
    await settle();
    const second = elements[1];
    cue.stopCue(0);
    expect(levelOf(second).gain.ramps()).toEqual([[0, expect.closeTo(10.02, 9)]]);
  });

  it('lets its stream go once it has played through', async () => {
    const { cue, audio } = await fresh();
    cue.startCue(Date.now());
    await settle();
    elements[0]?.fire('ended');
    expect([elements[0]?.src, audio.inUse().voice]).toEqual(['', 0]);
    cue.stopCue(CUE_FADE_S); // nothing left to stop
    expect(audio.inUse().voice).toBe(0);
  });

  it('plays nothing for an opening further in than the cue is long', async () => {
    const { cue } = await fresh();
    cue.startCue(Date.now() - 41_000);
    await settle();
    expect(elements).toEqual([]);
  });

  it('plays nothing where there is no cue, and never throws', async () => {
    found = false;
    const { cue } = await fresh();
    expect(() => cue.startCue(Date.now())).not.toThrow();
    await settle();
    expect(elements).toEqual([]);
    expect(() => cue.stopCue(0)).not.toThrow();
  });

  it('plays nothing for an opening skipped before its list had come', async () => {
    const { cue } = await fresh();
    cue.startCue(Date.now());
    cue.stopCue(CUE_FADE_S);
    await settle();
    expect(elements).toEqual([]);
  });
});

const shipped = join(INTRO_DIR, 'manifest.json');

describe('the cue the game ships', () => {
  it.skipIf(!existsSync(shipped))(
    'is the cue this prompt makes, some 40 s long, its peak named, under 1 MB',
    () => {
      const entry = JSON.parse(readFileSync(shipped, 'utf8')) as CueEntry;
      expect(entry.hash).toBe(cueHash(cueRequest()));
      expect(entry.peak).toBeGreaterThan(0.1);
      expect(entry.peak).toBeLessThanOrEqual(1);
      expect(entry.ms).toBeGreaterThan(CUE_MS - 3000);
      expect(entry.ms).toBeLessThan(CUE_MS + 3000);
      expect(statSync(join(INTRO_DIR, entry.file)).size).toBeLessThan(1024 * 1024);
    },
  );
});

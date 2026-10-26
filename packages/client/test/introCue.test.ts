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
import { CUE_FADE_S, CUE_PEAK, type CueManifest } from '../src/world/intro/cue.js';
import {
  downstream,
  fakeGraph,
  lastContext,
  type FakeBufferSource,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';

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
  const run: CueRun = { dir, measure: () => 40_100, log: (line) => lines.push(line), dryRun };
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
    expect(entry).toEqual({ file: CUE_FILE, ms: 40_100, hash: cueHash(cueRequest()) });
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
    const stale: CueEntry = { file: CUE_FILE, ms: 40_100, hash: 'aaaaaaaaaaaa' };
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
  const MANIFEST: CueManifest = { file: 'title.mp3', ms: 40_000, hash: 'abcdefabcdef' };
  let found = true;

  beforeEach(() => {
    fakeGraph();
    found = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        const json = (): Promise<CueManifest> => Promise.resolve(MANIFEST);
        const arrayBuffer = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8));
        return Promise.resolve({ ok: found, status: found ? 200 : 404, json, arrayBuffer });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function fresh() {
    vi.resetModules();
    const cue = await import('../src/world/intro/cue.js');
    const audio = await import('../src/world/audio.js');
    return { cue, audio };
  }

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  const playing = (): FakeBufferSource[] =>
    lastContext()
      .all<FakeBufferSource>('buffer')
      .filter((source) => source.startedAt !== null);

  it('plays from where the opening stands, low, into the music, as one voice', async () => {
    const { cue, audio } = await fresh();
    audio.audioEngine();
    // The fake decodes every file to 1.5 s: an opening 1 s in still has some of it to hear.
    cue.startCue(Date.now() - 1000);
    await settle();
    const [bed] = playing();
    expect(bed).toBeDefined();
    expect(audio.inUse().voice).toBe(1);
    const level = bed?.outputs[0] as FakeGain;
    // The fake decodes to a peak of 0.45: the cue comes in at CUE_PEAK.
    expect(level.gain.value).toBeCloseTo(CUE_PEAK / 0.45, 6);
    const engine = audio.audioEngine();
    expect(downstream(bed as unknown as FakeNode).has(engine?.music as unknown as FakeNode)).toBe(
      true,
    );
    expect(cue.cueProbe().playing).toBe(true);
  });

  it('fades out where the player skips, and stops dead at the blackout', async () => {
    const { cue, audio } = await fresh();
    audio.audioEngine();
    cue.startCue(Date.now());
    await settle();
    const [bed] = playing();
    const level = bed?.outputs[0] as FakeGain;
    cue.stopCue(CUE_FADE_S);
    expect(level.gain.ramps()).toEqual([[0, expect.closeTo(10 + CUE_FADE_S, 9)]]);
    expect(bed?.stoppedAt).toBeCloseTo(10 + CUE_FADE_S + 0.05, 9);
    expect(cue.cueProbe().playing).toBe(false);
    cue.startCue(Date.now());
    await settle();
    const second = playing()[1];
    cue.stopCue(0);
    expect(second?.stoppedAt).toBeLessThan(10.1);
  });

  it('plays nothing for an opening further in than the cue is long', async () => {
    const { cue, audio } = await fresh();
    audio.audioEngine();
    cue.startCue(Date.now() - 2000);
    await settle();
    expect(playing()).toEqual([]);
  });

  it('plays nothing where there is no cue, and never throws', async () => {
    found = false;
    const { cue, audio } = await fresh();
    audio.audioEngine();
    expect(() => cue.startCue(Date.now())).not.toThrow();
    await settle();
    expect(playing()).toEqual([]);
    expect(() => cue.stopCue(0)).not.toThrow();
  });

  it('plays nothing for an opening skipped before its cue had loaded', async () => {
    const { cue, audio } = await fresh();
    audio.audioEngine();
    cue.startCue(Date.now());
    cue.stopCue(CUE_FADE_S);
    await settle();
    expect(playing()).toEqual([]);
  });
});

const shipped = join(INTRO_DIR, 'manifest.json');

describe('the cue the game ships', () => {
  it.skipIf(!existsSync(shipped))(
    'is the cue this prompt makes, some 40 s long, its file there and under 1 MB',
    () => {
      const entry = JSON.parse(readFileSync(shipped, 'utf8')) as CueEntry;
      expect(entry.hash).toBe(cueHash(cueRequest()));
      expect(entry.ms).toBeGreaterThan(CUE_MS - 3000);
      expect(entry.ms).toBeLessThan(CUE_MS + 3000);
      expect(statSync(join(INTRO_DIR, entry.file)).size).toBeLessThan(1024 * 1024);
    },
  );
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { barOf, CROSSFADE_S, MUSIC_LEVEL, type Tension } from '../src/world/music.js';
import { MIN_FADE_MS, type PackFile } from '../src/world/packFile.js';
import {
  fakeGraph,
  lastContext,
  type FakeContext,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';
import { elements, fakeMedia, type FakeAudio } from './fakeMedia.js';
import { foundPack, ROUND, shipPacks } from './fakePacks.js';
import { loadedSamples, serveSamples, type Served } from './fakeSamples.js';

/**
 * The music packs as the game plays them (world/musicPacks.ts and its listeners: music.ts,
 * menuSound.ts, endTheme.ts, intro/cue.ts): a pack's stems going round by their crossfade, a
 * pack picked mid-run taking over at the loop point, the menu's theme at once and the lobby's
 * piece on the next bar, a pack's endings played once and its title for the opening — against a
 * pack of the test's own (fakePacks.ts) beside the score.
 */

const BAR = barOf(90);
/** A pack of the test's own: every looped piece 60 s round by ROUND. */
const PROBE = foundPack('probe');
/** The round of PROBE's loops, s, and when the next pass comes in after it starts. */
const ROUND_S = (ROUND.endMs - ROUND.fadeMs - ROUND.startMs) / 1000;
const LEAD_S = ROUND.startMs / 1000;

let blobs: string[] = [];
let fetched: string[] = [];

/** A page: a fake graph and media, its clock held, every file fetched a blob of its own. */
function stage(): void {
  fakeGraph();
  fakeMedia();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    blobs.push(`blob:${blobs.length}`);
    return blobs.at(-1) as string;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
}

function unstage(): void {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock('../src/world/packList.js');
}

beforeEach(stage);
afterEach(unstage);

/**
 * The modules afresh, PROBE — and `more` — shipped beside the score, the recordings served as
 * `served` says.
 */
async function fresh(served: Readonly<Record<string, Served>> = {}, ...more: PackFile[]) {
  vi.resetModules();
  shipPacks(PROBE, ...more);
  await loadedSamples(served);
  fetched = serveSamples(served);
  const music = await import('../src/world/music.js');
  const packs = await import('../src/world/musicPacks.js');
  const audio = await import('../src/world/audio.js');
  return { music, packs, audio };
}

/** Lets the files fetched come in: their fetches and their blobs. */
const fetchIn = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

const tension = (over: Partial<Tension> = {}): Tension => ({
  run: 1,
  startAt: Date.now() - 1000,
  left: 600,
  budget: 660,
  alarms: 0,
  escaping: false,
  ending: null,
  ...over,
});

/**
 * The blob the music made of its file `file` (its address under /music/): blobs are made as the
 * music fetched its files, in the order of its fetches — the files, not their lists.
 */
function blobOf(file: string): string {
  const files = fetched.filter((url) => url.startsWith('/music/') && /\.(?:m4a|mp3)$/.test(url));
  return `blob:${files.indexOf(`/music/${file}`)}`;
}

/** The elements playing the music file `file` (its address under /music/), from its blob. */
function decksOf(file: string): FakeAudio[] {
  return elements.filter((element) => element.src === blobOf(file));
}

/** The level an element's sound comes in at: its stream's own gain. */
const outOf = (ctx: FakeContext, element: FakeAudio | undefined): FakeGain => {
  const source = ctx
    .all<FakeNode & { mediaElement: unknown }>('media')
    .find((node) => node.mediaElement === element);
  return source?.outputs[0] as FakeGain;
};

/** The gain after an element's own level: a stem's bus, or a menu piece's level. */
const after = (ctx: FakeContext, element: FakeAudio | undefined): FakeGain =>
  outOf(ctx, element).outputs[0] as FakeGain;

/** The last straight fade on a gain: where it started, where it ends, and to what. */
function lastFade(gain: FakeGain): { start: number; end: number; to: number } {
  const events = gain.gain.events.filter((e) => e[0] === 'set' || e[0] === 'linear');
  const end = events.at(-1);
  const start = events.at(-2);
  return { start: start?.[2] as number, end: end?.[2] as number, to: end?.[1] as number };
}

/** The curve scheduled on a gain: its values, from when, for how long. */
function curveOn(gain: FakeGain): { values: number[]; at: number; seconds: number } | null {
  const curve = gain.gain.events.find((e) => e[0] === 'curve');
  if (curve === undefined) return null;
  return { values: [...(curve[1] as Float32Array)], at: curve[2] as number, seconds: curve[3] };
}

describe('a pack’s stems in a run', () => {
  it('go round by their crossfade, the next pass silent from its start, equal power', async () => {
    const { music, packs } = await fresh();
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    music.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    music.setTension(tension());
    vi.advanceTimersByTime(300);
    const zero = 10.3; // as soon as its timer can make it: no bars to wait for
    // Every stem's file once — a pack's stem heard before the music's list came, too.
    for (const stem of ['calm', 'tense', 'critical']) {
      const url = `/music/packs/probe/${stem}.m4a`;
      expect(fetched.filter((asked) => asked === url), url).toHaveLength(1);
    }
    const [first] = decksOf('packs/probe/calm.m4a');
    expect(first?.plays).toBe(1);
    expect(after(ctx, first).outputs[0]).toMatchObject({ gain: { value: 0.5 } }); // its gain
    ctx.currentTime = zero + ROUND_S - 1.2;
    music.setTension(tension());
    expect(decksOf('packs/probe/calm.m4a').filter((d) => d.plays > 0)).toHaveLength(1);
    ctx.currentTime = zero + ROUND_S - 0.9;
    music.setTension(tension());
    vi.advanceTimersByTime(900);
    const [, second] = decksOf('packs/probe/calm.m4a');
    expect([second?.plays, second?.currentTime]).toEqual([1, 0]); // from its start, no seek
    const into = curveOn(outOf(ctx, second));
    const out = curveOn(outOf(ctx, first));
    const cross = zero + ROUND_S + LEAD_S;
    expect([into?.at, into?.seconds]).toEqual([expect.closeTo(cross, 9), ROUND.fadeMs / 1000]);
    expect([out?.at, out?.seconds]).toEqual([expect.closeTo(cross, 9), ROUND.fadeMs / 1000]);
    expect(ROUND.fadeMs).toBeGreaterThanOrEqual(MIN_FADE_MS);
    into?.values.forEach((level, i) => {
      expect(level ** 2 + (out?.values[i] ?? NaN) ** 2).toBeCloseTo(1, 6);
    });
    vi.advanceTimersByTime((cross + ROUND.fadeMs / 1000 + 0.05 - ctx.currentTime) * 1000);
    expect([first?.paused, first?.currentTime]).toEqual([true, 0]);
  });

  it('change on the pressure at once, where no bars are counted', async () => {
    const { music, packs } = await fresh();
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    music.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    music.setTension(tension());
    ctx.currentTime = 15.3;
    music.setTension(tension({ left: 200 }));
    music.setTension(tension({ left: 200 }));
    const [tense] = decksOf('packs/probe/tense.m4a');
    expect(lastFade(after(ctx, tense))).toEqual({
      start: expect.closeTo(15.6, 9),
      end: expect.closeTo(15.6 + CROSSFADE_S, 9),
      to: 1,
    });
  });

  it('take a pack picked mid-run over at the playing loop point, silent ones at once', async () => {
    const { music, packs } = await fresh();
    music.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    music.setTension(tension());
    vi.advanceTimersByTime(300); // the score's calm from 10.3
    const [score] = decksOf('calm.mp3'); // the score as the test serves it
    expect(score?.plays).toBe(1);
    ctx.currentTime = 20;
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    music.setTension(tension());
    await fetchIn();
    music.setTension(tension());
    for (const file of ['calm', 'tense', 'critical']) {
      expect(fetched).toContain(`/music/packs/probe/${file}.m4a`);
    }
    expect(music.musicProbe().pieces).toEqual({
      calm: 'nachtschicht/calm',
      tense: 'probe/tense',
      critical: 'probe/critical',
    });
    // The score's calm plays on to its loop point: 24 bars on, coming in a bar later.
    const next = 10.3 + 24 * BAR;
    ctx.currentTime = next - 0.9;
    music.setTension(tension());
    expect(music.musicProbe().pieces.calm).toBe('probe/calm');
    const at = next + BAR;
    expect(lastFade(after(ctx, score))).toMatchObject({ start: expect.closeTo(at, 9), to: 0 });
    music.setTension(tension());
    ctx.currentTime = at - 0.5;
    music.setTension(tension());
    const [probe] = decksOf('packs/probe/calm.m4a');
    expect(lastFade(after(ctx, probe))).toEqual({
      start: expect.closeTo(at, 9),
      end: expect.closeTo(at + CROSSFADE_S, 9),
      to: 1,
    });
    vi.advanceTimersByTime(499);
    expect(probe?.plays).toBe(0);
    vi.advanceTimersByTime(1);
    expect(probe?.plays).toBe(1);
    // The score's calm laid no pass after: one element of it played, and it goes with its fade.
    expect(decksOf('calm.mp3').filter((deck) => deck.plays > 0)).toHaveLength(1);
    ctx.currentTime = at + CROSSFADE_S + 0.1;
    music.setTension(tension());
    vi.advanceTimersByTime(300);
    expect(score?.src).toBe('');
  });

  it('let a piece chosen, then passed over before its loop point, go unheard', async () => {
    const { music, packs } = await fresh({}, foundPack('other'));
    music.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    music.setTension(tension());
    vi.advanceTimersByTime(300); // the score's calm from 10.3
    ctx.currentTime = 20;
    packs.setMusicChoice({ pack: 'nachtschicht', pieces: { calm: 'probe' } });
    music.setTension(tension());
    await fetchIn();
    const passedOver = blobOf('packs/probe/calm.m4a');
    expect(blobs).toContain(passedOver);
    packs.setMusicChoice({ pack: 'nachtschicht', pieces: { calm: 'other' } });
    music.setTension(tension());
    await fetchIn();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(passedOver);
    expect(music.musicProbe().pieces.calm).toBe('nachtschicht/calm');
    // At the score's loop point the piece chosen last takes over, and the one passed over never.
    ctx.currentTime = 10.3 + 24 * BAR - 0.9;
    music.setTension(tension());
    expect(music.musicProbe().pieces.calm).toBe('other/calm');
    expect(decksOf('packs/probe/calm.m4a')).toEqual([]);
  });

  it('play the piece the Feinwahl names for a place, the pack’s for the rest', async () => {
    const { music, packs } = await fresh();
    packs.setMusicChoice({ pack: 'nachtschicht', pieces: { calm: 'probe' } });
    music.setTension(tension());
    await fetchIn();
    music.setTension(tension());
    expect(fetched).toContain('/music/packs/probe/calm.m4a');
    expect(fetched).not.toContain('/music/packs/probe/tense.m4a');
    expect(music.musicProbe().pieces).toEqual({
      calm: 'probe/calm',
      tense: 'nachtschicht/tense',
      critical: 'nachtschicht/critical',
    });
  });
});

/** The page's window as the menu's sound reaches it: its listeners, which a test fires. */
function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal('window', {
    location: { search: '', origin: 'http://lab', pathname: '/' },
    addEventListener: (type: string, listener: () => void) => {
      const kept = listeners.get(type) ?? new Set<() => void>();
      kept.add(listener);
      listeners.set(type, kept);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    },
  });
  return { fire: (type: string) => [...(listeners.get(type) ?? [])].forEach((l) => l()) };
}

/**
 * The menu's sound afresh, the score's theme 60 s and its lobby's piece as `served` says, PROBE
 * — and `more` — shipped beside the score.
 */
async function freshMenu(served: Readonly<Record<string, Served>> = {}, ...more: PackFile[]) {
  vi.resetModules();
  shipPacks(PROBE, ...more);
  fetched = serveSamples({ 'menu-theme': { seconds: 60 }, lobby: { listed: false }, ...served });
  const sound = await import('../src/world/menuSound.js');
  const packs = await import('../src/world/musicPacks.js');
  return { sound, packs };
}

describe('a pack picked on the menu and in the lobby', () => {
  it('brings its theme in at once on the menu, crossing with the one playing', async () => {
    const page = fakeWindow();
    const { sound, packs } = await freshMenu();
    sound.wantMenuSound('menu');
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(600);
    expect(sound.menuSoundProbe()).toMatchObject({ piece: 'menu-theme', pack: 'nachtschicht' });
    const ctx = lastContext();
    const [before] = decksOf('menu-theme.mp3');
    ctx.currentTime = 30;
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetched).toContain('/music/packs/probe/menu-theme.m4a');
    await vi.advanceTimersByTimeAsync(200);
    const [theme] = decksOf('packs/probe/menu-theme.m4a');
    // The menu's piece level, then its crossing gain: the one a place's change moves.
    const cross = (element: FakeAudio | undefined): FakeGain =>
      after(ctx, element).outputs[0] as FakeGain;
    expect(lastFade(cross(theme))).toEqual({
      start: expect.closeTo(30.3, 9),
      end: expect.closeTo(30.3 + CROSSFADE_S, 9),
      to: 1,
    });
    expect(lastFade(cross(before))).toMatchObject({ start: expect.closeTo(30.3, 9), to: 0 });
    await vi.advanceTimersByTimeAsync(400);
    expect(theme?.plays).toBe(1);
    expect(sound.menuSoundProbe()).toMatchObject({ theme: true, pack: 'probe' });
    // The theme before plays out under it and is let go.
    ctx.currentTime = 33;
    await vi.advanceTimersByTimeAsync(300);
    expect(before?.src).toBe('');
  });

  it('says on its probe a piece played for the ear, the music 24 dB under it', async () => {
    const page = fakeWindow();
    const { sound } = await freshMenu();
    const preview = await import('../src/world/musicPreview.js');
    sound.wantMenuSound('menu');
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(600);
    expect(sound.menuSoundProbe()).toMatchObject({ theme: true, preview: null, musicDuck: 1 });
    const ctx = lastContext();
    preview.togglePreview('probe', 'calm');
    await vi.advanceTimersByTimeAsync(20);
    ctx.currentTime += 0.1;
    expect(sound.menuSoundProbe().preview).toBe('probe/calm');
    expect(sound.menuSoundProbe().musicDuck).toBeCloseTo(10 ** (-24 / 20), 6);
    preview.stopPreview();
    ctx.currentTime += 1;
    expect(sound.menuSoundProbe()).toMatchObject({ preview: null, musicDuck: 1 });
  });

  it('brings its lobby’s piece in on the next bar of the lobby’s piece playing', async () => {
    const page = fakeWindow();
    const { sound, packs } = await freshMenu({ lobby: { seconds: 61 } });
    sound.wantMenuSound('lobby');
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(600);
    expect(sound.menuSoundProbe()).toMatchObject({ piece: 'lobby', pack: 'nachtschicht' });
    const ctx = lastContext();
    ctx.currentTime = 15;
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    await vi.advanceTimersByTimeAsync(200);
    const [lobby] = decksOf('packs/probe/lobby.m4a');
    // The score's lobby piece came in on 10.3 at 90 bpm: its next bar after 15.3 is 15.633.
    const bar = 10.3 + 2 * BAR;
    expect(lastFade(after(ctx, lobby).outputs[0] as FakeGain)).toEqual({
      start: expect.closeTo(bar, 9),
      end: expect.closeTo(bar + CROSSFADE_S, 9),
      to: 1,
    });
  });
});

describe('a pack’s endings and its title', () => {
  it('plays its ending once through, never round, whatever its piece', async () => {
    vi.resetModules();
    shipPacks(foundPack('probe', { 'end-won': { loop: { crossfade: ROUND }, ms: 70_000 } }));
    await loadedSamples();
    fetched = serveSamples({}, () => Promise.resolve(new Response(null, { status: 404 })));
    const packs = await import('../src/world/musicPacks.js');
    const end = await import('../src/world/endTheme.js');
    const audio = await import('../src/world/audio.js');
    audio.audioEngine();
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    end.playEnding('won');
    await fetchIn();
    const theme = elements.find((element) => element.src === '/music/packs/probe/end-won.m4a');
    expect(theme?.loop).toBe(false);
    vi.advanceTimersByTime(11_000);
    expect(theme?.plays).toBe(1);
    lastContext().currentTime = 90;
    theme?.fire('ended');
    expect(theme?.src).toBe('');
    vi.advanceTimersByTime(120_000);
    expect(theme?.plays).toBe(1);
    expect(elements).toHaveLength(2); // the sting and the theme: nothing after it
  });

  it('opens a run with its title, at the stems’ level by its gain', async () => {
    vi.resetModules();
    shipPacks(PROBE);
    fetched = serveSamples({}, () => Promise.resolve(new Response(null, { status: 404 })));
    const packs = await import('../src/world/musicPacks.js');
    const cue = await import('../src/world/intro/cue.js');
    const audio = await import('../src/world/audio.js');
    audio.audioEngine();
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    cue.startCue(Date.now());
    await vi.advanceTimersByTimeAsync(10);
    const [title] = elements;
    expect(title?.src).toBe('/music/packs/probe/title.m4a');
    expect(outOf(lastContext(), title).gain.value).toBeCloseTo(MUSIC_LEVEL * 0.8, 9);
  });
});

describe('a pack’s file that cannot be had', () => {
  /** What the page warned of: each warning's words. */
  const warned = (): string[] =>
    vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));

  it('gives its stem’s place to the score’s piece, said once', async () => {
    const { music, packs } = await fresh({ 'packs/probe/calm': { status: 404 } });
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    music.setTension(tension());
    await fetchIn();
    music.setTension(tension());
    await fetchIn();
    music.setTension(tension());
    vi.advanceTimersByTime(300);
    expect(music.musicProbe().pieces.calm).toBe('nachtschicht/calm');
    // The blobs follow the files had: the one that failed made none.
    const had = fetched.filter((url) => /\.(?:m4a|mp3)$/.test(url) && !url.includes('probe/calm'));
    const score = `blob:${had.indexOf('/music/calm.mp3')}`;
    expect(elements.some((element) => element.src === score && element.plays > 0)).toBe(true);
    // Asked no more, and said once, however long the run goes on.
    vi.advanceTimersByTime(12_000);
    music.setTension(tension());
    await fetchIn();
    expect(fetched.filter((url) => url === '/music/packs/probe/calm.m4a')).toHaveLength(1);
    expect(warned().filter((line) => line.includes('probe/calm'))).toHaveLength(1);
  });

  it('gives the menu’s theme the score’s, as a pack changed on the menu comes in', async () => {
    const page = fakeWindow();
    const { sound, packs } = await freshMenu({ 'packs/probe/menu-theme': { status: 404 } });
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    sound.wantMenuSound('menu');
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sound.menuSoundProbe()).toMatchObject({ theme: true, pack: 'nachtschicht' });
    expect(fetched).toContain('/music/menu-theme.mp3');
    expect(warned().filter((line) => line.includes('probe/menu-theme'))).toHaveLength(1);
  });

  it('gives an ending and the opening’s title the score’s at once as their stream fails', async () => {
    vi.resetModules();
    shipPacks(PROBE);
    const title = { title: { seconds: 40 } };
    await loadedSamples(title);
    fetched = serveSamples(title, () => Promise.resolve(new Response(null, { status: 404 })));
    const packs = await import('../src/world/musicPacks.js');
    const end = await import('../src/world/endTheme.js');
    const cue = await import('../src/world/intro/cue.js');
    (await import('../src/world/audio.js')).audioEngine();
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    end.playEnding('won');
    await fetchIn();
    const playingFrom = (src: string): FakeAudio | undefined =>
      elements.find((element) => element.src === src);
    playingFrom('/music/packs/probe/end-won.m4a')?.fire('error');
    expect(playingFrom('/music/end-won.mp3')).toBeDefined();
    expect(end.endThemeProbe().playing).toBe('end-won');
    end.stopEnding();
    cue.startCue(Date.now());
    await vi.advanceTimersByTimeAsync(10);
    playingFrom('/music/packs/probe/title.m4a')?.fire('error');
    await vi.advanceTimersByTimeAsync(10);
    expect(playingFrom('/music/title.mp3')).toBeDefined();
    expect(warned().filter((line) => / probe\/(?:end-won|title) /.test(line))).toHaveLength(2);
  });
});

describe('a pack’s stems as they change hands', () => {
  /** The test's fetch, the probe's calm held back until `release` lets it come. */
  function holdProbeCalm(): { release: () => void } {
    const served = globalThis.fetch;
    let release = (): void => undefined;
    vi.stubGlobal('fetch', (url: string) =>
      url.endsWith('packs/probe/calm.m4a')
        ? new Promise((done) => {
            release = () => done(served(url));
          })
        : served(url),
    );
    return { release: () => release() };
  }

  it('cross at their seam over their own fade, not the score’s three seconds', async () => {
    const slow = { crossfade: { startMs: 5000, endMs: 70_000, fadeMs: 5000 } };
    const { music, packs } = await fresh({}, foundPack('slow', { calm: { loop: slow } }));
    packs.setMusicChoice({ pack: 'slow', pieces: {} });
    music.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    music.setTension(tension());
    vi.advanceTimersByTime(300);
    ctx.currentTime = 10.3 + 60 - 0.9; // 60 s round: (70 − 5 − 5) s
    music.setTension(tension());
    vi.advanceTimersByTime(900);
    const [, second] = decksOf('packs/slow/calm.m4a');
    expect(curveOn(outOf(ctx, second))).toMatchObject({ at: expect.closeTo(75.3, 9), seconds: 5 });
  });

  it('take over at a loop point only once the piece chosen has its file', async () => {
    const { music, packs } = await fresh();
    music.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    music.setTension(tension());
    vi.advanceTimersByTime(300);
    const held = holdProbeCalm();
    ctx.currentTime = 20;
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    music.setTension(tension());
    await fetchIn();
    // The score's loop point comes before the probe's file: the score's calm goes round on.
    const next = 10.3 + 24 * BAR;
    ctx.currentTime = next - 0.9;
    music.setTension(tension());
    expect(music.musicProbe().pieces.calm).toBe('nachtschicht/calm');
    held.release();
    await fetchIn();
    ctx.currentTime = next + 24 * BAR - 0.9;
    music.setTension(tension());
    expect(music.musicProbe().pieces.calm).toBe('probe/calm');
  });

  it('keep a stem that is silent silent as it changes hands, and count bars anew', async () => {
    const { music, packs } = await fresh();
    music.setTension(tension());
    await fetchIn();
    const ctx = lastContext();
    music.setTension(tension());
    vi.advanceTimersByTime(300);
    ctx.currentTime = 20;
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    music.setTension(tension());
    await fetchIn();
    music.setTension(tension());
    expect(music.musicProbe()).toMatchObject({ pressure: 0, last: 0 });
    // The probe's calm takes over a bar past the score's loop point; its loop keeps no bars.
    const at = 10.3 + 25 * BAR;
    ctx.currentTime = at - 0.5;
    music.setTension(tension());
    ctx.currentTime = at + 4.1;
    music.setTension(tension({ left: 200 }));
    music.setTension(tension({ left: 200 }));
    const [tense] = decksOf('packs/probe/tense.m4a');
    const start = expect.closeTo(at + 4.4, 9);
    expect(lastFade(after(ctx, tense))).toMatchObject({ start, to: 1 });
  });

  it('ask again for a piece of the score chosen anew that could not be had', async () => {
    const { music, packs } = await fresh({ calm: { status: 404 } });
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    music.setTension(tension());
    await fetchIn();
    music.setTension(tension());
    vi.advanceTimersByTime(300);
    packs.setMusicChoice({ pack: 'nachtschicht', pieces: {} });
    music.setTension(tension());
    await fetchIn();
    expect(fetched.filter((url) => url === '/music/calm.mp3')).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    music.setTension(tension());
    await fetchIn();
    expect(fetched.filter((url) => url === '/music/calm.mp3')).toHaveLength(2);
    expect(music.musicProbe().pieces.calm).toBe('probe/calm');
  });
});

describe('the menu’s pieces as they change hands', () => {
  it('changes the lobby’s piece unheard while the menu plays, its theme as it was', async () => {
    const page = fakeWindow();
    const { sound, packs } = await freshMenu({ lobby: { seconds: 61 } });
    sound.wantMenuSound('menu');
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(600);
    packs.setMusicChoice({ pack: 'nachtschicht', pieces: { lobby: 'probe' } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetched).toContain('/music/packs/probe/lobby.m4a');
    expect(sound.menuSoundProbe()).toMatchObject({ piece: 'menu-theme', sounding: 1 });
    expect(fetched.filter((url) => url === '/music/menu-theme.mp3')).toHaveLength(1);
  });

  it('lets a piece passed over before it came go, its file given back', async () => {
    const page = fakeWindow();
    const { sound, packs } = await freshMenu({}, foundPack('other'));
    sound.wantMenuSound('menu');
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(600);
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    packs.setMusicChoice({ pack: 'other', pieces: {} });
    await vi.advanceTimersByTimeAsync(0);
    // Its file given back as it comes — before any crossing could have played it out.
    const passedOver = blobOf('packs/probe/menu-theme.m4a');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(passedOver);
    await vi.advanceTimersByTimeAsync(3000);
    expect(elements.filter((element) => element.src === passedOver)).toEqual([]);
    expect(sound.menuSoundProbe()).toMatchObject({ theme: true, pack: 'other' });
  });

  it('keeps the theme playing where the piece chosen anew cannot be had', async () => {
    const page = fakeWindow();
    const { sound, packs } = await freshMenu({ 'menu-theme': { status: 404 } });
    packs.setMusicChoice({ pack: 'probe', pieces: {} });
    sound.wantMenuSound('menu');
    page.fire('keydown');
    await vi.advanceTimersByTimeAsync(600);
    expect(sound.menuSoundProbe()).toMatchObject({ theme: true, pack: 'probe' });
    packs.setMusicChoice({ pack: 'nachtschicht', pieces: {} });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetched).toContain('/music/menu-theme.mp3');
    expect(sound.menuSoundProbe()).toMatchObject({ theme: true, pack: 'probe' });
  });
});

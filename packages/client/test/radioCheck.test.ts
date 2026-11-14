import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceManifest } from '../src/world/radioVoice.js';
import {
  chainFrom,
  fakeGraph,
  lastContext,
  type FakeBufferSource,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';
import { serveSamples } from './fakeSamples.js';

const PROBE = 'Funkprobe, Nachtschicht. Ich höre euch laut und klar.';
const MANIFEST: VoiceManifest = {
  lines: {
    dddddddddddd: {
      text: PROBE,
      ms: 3000,
      missions: ['blackout'],
      speaker: 'operator',
      mood: 'calm',
      file: 'dddddddddddd.mp3',
    },
  },
};

describe('the operator’s Funkprobe in the lobby', () => {
  let fetched: string[] = [];

  beforeEach(() => {
    fakeGraph();
    fetched = [];
    serveSamples({}, (url: string) => {
      fetched.push(url);
      const json = (): Promise<VoiceManifest> => Promise.resolve(MANIFEST);
      const arrayBuffer = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8));
      return Promise.resolve({ ok: true, status: 200, json, arrayBuffer });
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The lobby's radio, its sound woken as a click in the lobby wakes it. */
  async function lobby() {
    vi.resetModules();
    await (await import('../src/world/samples.js')).preloadSamples();
    return import('../src/world/radioCheck.js');
  }

  /** Lets the fetches and the decoding settle. */
  const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => undefined);

  /** The Funkprobe's speech as it was played: the fake decodes every line to 1.5 s. */
  const speech = (): FakeBufferSource[] =>
    lastContext()
      .all<FakeBufferSource>('buffer')
      .filter((source) => source.buffer?.duration === 1.5);

  /** The level the Funkprobe goes through, between the radio's chain and the radio's bus. */
  const levelOf = (source: FakeBufferSource | undefined): FakeGain =>
    chainFrom(source as FakeBufferSource)[9] as unknown as FakeGain;

  it('says nothing before every seat is ready, then the Funkprobe, and only once', async () => {
    vi.useFakeTimers();
    const { lobbyRadio, radioCheckProbe } = await lobby();
    const radio = lobbyRadio();
    radio.update(undefined, false);
    await settle();
    expect(fetched).toEqual([]);
    expect(radioCheckProbe()).toEqual({ asked: null, aired: false });
    radio.update(PROBE, false);
    await settle();
    expect(speech()).toHaveLength(1);
    expect(radioCheckProbe()).toEqual({ asked: PROBE, aired: true });
    // Somebody is not ready after all, then is again: the lobby has heard it.
    radio.update(undefined, false);
    radio.update(PROBE, false);
    await settle();
    expect(speech()).toHaveLength(1);
    // Over the radio as a run's lines: its chain, then its level, then the radio's bus.
    const chain = chainFrom(speech()[0] as FakeBufferSource).map((node) => node.kind);
    expect(chain).toEqual([
      'buffer',
      'gain', // the recording's peak at the speech's
      'gain', // the chain's input
      'biquad',
      'biquad',
      'biquad',
      'biquad',
      'shaper',
      'gain', // the voice's level
      'gain', // the Funkprobe's level, under the crew
      'gain', // the radio's bus
      'gain', // the master gain
      'compressor',
      'gain',
      'destination',
    ]);
  });

  it('stands 10 dB down while anybody of the crew speaks, and comes back after', async () => {
    vi.useFakeTimers();
    const { DUCK_ATTACK_S, DUCK_RELEASE_S } = await import('../src/world/mix.js');
    const { lobbyRadio, UNDER_CREW_DB } = await lobby();
    expect(UNDER_CREW_DB).toBe(-10);
    const under = 10 ** (-10 / 20);
    const radio = lobbyRadio();
    // Somebody speaks as the crew stands ready: it starts under them.
    radio.update(PROBE, true);
    await settle();
    const level = levelOf(speech()[0]);
    expect(level.gain.value).toBeCloseTo(under, 9);
    const ctx = lastContext();
    ctx.currentTime = 11;
    radio.update(PROBE, false);
    expect(level.gain.ramps()).toEqual([[1, expect.closeTo(11 + DUCK_RELEASE_S, 9)]]);
    ctx.currentTime = 12;
    radio.update(PROBE, true);
    radio.update(PROBE, true); // nothing new: nothing laid anew
    expect(level.gain.ramps()).toEqual([
      [1, expect.closeTo(11 + DUCK_RELEASE_S, 9)],
      [expect.closeTo(under, 9), expect.closeTo(12 + DUCK_ATTACK_S, 9)],
    ]);
  });

  it('is cut as the lobby goes, its level let go; the next lobby hears it again', async () => {
    vi.useFakeTimers();
    const { lobbyRadio, LET_GO_MS } = await lobby();
    const radio = lobbyRadio();
    radio.update(PROBE, false);
    await settle();
    const [first] = speech();
    const level = levelOf(first);
    lastContext().currentTime = 11;
    radio.end();
    expect(first?.stoppedAt).toBeCloseTo(11.1, 9);
    expect(level.disconnected).toBe(false); // the cut fades first
    await vi.advanceTimersByTimeAsync(LET_GO_MS);
    expect(level.disconnected).toBe(true);
    // The room's next lobby: a radio of its own.
    const next = lobbyRadio();
    next.update(PROBE, false);
    await settle();
    expect(speech()).toHaveLength(2);
  });

  it('plays nothing asked for once the lobby has gone before it could', async () => {
    vi.useFakeTimers();
    const { lobbyRadio } = await lobby();
    const radio = lobbyRadio();
    radio.update(PROBE, false);
    radio.end(); // React's own unmount, before the manifest came
    await settle();
    expect(speech()).toEqual([]);
    // Mounted again, as React does in development: the lobby still hears it, once.
    radio.update(PROBE, false);
    await settle();
    expect(speech()).toHaveLength(1);
  });

  it('stays silent without a recording, and before a gesture woke the sound', async () => {
    vi.useFakeTimers();
    const { lobbyRadio, radioCheckProbe } = await lobby();
    lobbyRadio().update('Eine Funkprobe ohne Aufnahme.', false);
    await settle();
    // Asked for, and not on the air: the walkthrough says it awaits its render.
    expect(radioCheckProbe()).toEqual({ asked: 'Eine Funkprobe ohne Aufnahme.', aired: false });
    const ctx = lastContext();
    expect(ctx.all<FakeBufferSource>('buffer').filter((s) => s.startedAt !== null)).toEqual([]);
    // Nothing of it stays wired to the radio's bus: its level was let go at once.
    const { audioEngine } = await import('../src/world/audio.js');
    const bus = audioEngine()?.voice as unknown as FakeNode;
    const wired = ctx.nodes.filter((node) => node.outputs.includes(bus) && !node.disconnected);
    expect(wired).toEqual([]);
    ctx.state = 'suspended';
    lobbyRadio().update(PROBE, false);
    await settle();
    expect(speech()).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PA_FROM_MS, PA_GAP_MS } from '../src/world/intro/sequence.js';
import {
  DROPOUT_LEVEL,
  DROPOUTS,
  dropOut,
  PA_HIGH,
  PA_LOW,
  paChain,
  WEAK_HIGH,
  WEAK_LOW,
  weakChain,
} from '../src/world/pa.js';
import type { VoiceLine, VoiceManifest } from '../src/world/radioVoice.js';
import {
  chainFrom,
  downstream,
  fakeGraph,
  FakeContext,
  FakeParam,
  lastContext,
  type FakeBufferSource,
  type FakeFilter,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';

/** The plant's lines, each said by its voice in the night's cast: the person `anlage`. */
const plant = (text: string): VoiceLine => ({ text, person: 'anlage' });
const FIRST = plant('Durchsage der Leitstelle für Trakt C. Es ist 23 Uhr 47.');
const SECOND = plant('Reaktor in Teillast, 60 Prozent.');
const ALERT = plant('Störung im Kühlkreislauf. Relaissteuerung auf Handbetrieb.');
const pa = { missions: ['blackout'], role: 'pa', person: 'anlage' } as const;
const MANIFEST: VoiceManifest = {
  lines: {
    'anlage-aaaa': { ...pa, text: FIRST.text, moment: 'pa', ms: 2000, file: 'anlage-aaaa.mp3' },
    'anlage-bbbb': { ...pa, text: SECOND.text, moment: 'pa', ms: 1500, file: 'anlage-bbbb.mp3' },
    'anlage-cccc': {
      ...pa,
      text: ALERT.text,
      moment: 'announce',
      ms: 3100,
      file: 'anlage-cccc.mp3',
    },
  },
};

/** The loudspeakers' chain built on a context of its own, into its output at 0.1. */
function chainOnItsOwn() {
  const ctx = new FakeContext();
  const into = ctx.destination as unknown as AudioNode;
  const pa = paChain(ctx as unknown as BaseAudioContext, into, 0.1);
  return { ctx, pa, input: pa.input as unknown as FakeNode, out: pa.out as unknown as FakeGain };
}

/** A filter's Q as Web Audio takes it for a high- or low-pass, in dB, back to linear. */
const linearQ = (filter: FakeFilter): number => 10 ** (filter.Q.value / 20);

describe('the loudspeakers’ chain', () => {
  it('runs high-pass 300 Hz and low-pass 5 kHz, second order, the direct sound out', () => {
    const { input, out } = chainOnItsOwn();
    expect([PA_LOW, PA_HIGH]).toEqual([300, 5000]);
    const [low] = input.outputs as FakeFilter[];
    const [high] = (low?.outputs ?? []) as FakeFilter[];
    expect([low?.type, low?.frequency.value]).toEqual(['highpass', PA_LOW]);
    expect([high?.type, high?.frequency.value]).toEqual(['lowpass', PA_HIGH]);
    for (const filter of [low, high]) {
      expect(filter && linearQ(filter)).toBeCloseTo(Math.SQRT1_2, 9);
    }
    expect(high?.outputs).toContain(out);
    expect(out.gain.value).toBe(0.1);
  });

  it('leaves the answer to the room it hangs in: no delay, shaper, static or squelch', () => {
    const { ctx, input, out } = chainOnItsOwn();
    const high = (input.outputs[0] as FakeNode).outputs[0] as FakeNode;
    expect(high.outputs).toEqual([out]);
    expect(ctx.all('delay')).toEqual([]);
    expect(ctx.all('shaper')).toEqual([]);
    expect(ctx.all('buffer')).toEqual([]);
    expect(ctx.all('oscillator')).toEqual([]);
  });
});

describe('the loudspeakers on the emergency power', () => {
  it('pass a narrower band, 450 Hz to 3.2 kHz, behind a gate the dropouts are laid on', () => {
    const ctx = new FakeContext();
    const into = ctx.destination as unknown as AudioNode;
    const weak = weakChain(ctx as unknown as BaseAudioContext, into, 0.1);
    const nodes = chainFrom(weak.input as unknown as FakeNode);
    expect(nodes.map((node) => node.kind)).toEqual([
      'gain',
      'gain',
      'biquad',
      'biquad',
      'gain',
      'destination',
    ]);
    expect(nodes[1]).toBe(weak.gate);
    const [low, high] = nodes.slice(2, 4) as FakeFilter[];
    expect([WEAK_LOW, WEAK_HIGH]).toEqual([450, 3200]);
    expect([low?.type, low?.frequency.value]).toEqual(['highpass', WEAK_LOW]);
    expect([high?.type, high?.frequency.value]).toEqual(['lowpass', WEAK_HIGH]);
    for (const filter of [low, high]) {
      expect(filter && linearQ(filter)).toBeCloseTo(Math.SQRT1_2, 9);
    }
    expect((nodes[4] as FakeGain).gain.value).toBe(0.1);
    expect(ctx.all('shaper')).toEqual([]);
  });

  it('drop out where a loose contact would, never into a line’s last quarter second', () => {
    const gate = new FakeParam(1);
    dropOut(gate as unknown as AudioParam, 10, 3.1);
    // A line of 3.1 s takes the three dropouts that end before 2.85 s: 0.7, 1.6 and 2.2.
    const falls = gate.ramps().filter(([level]) => level === DROPOUT_LEVEL);
    expect(falls.map(([, at]) => at)).toEqual(
      [10.7, 11.6, 12.2].map((at) => expect.closeTo(at + 0.008, 9)),
    );
    const backs = gate.ramps().filter(([level]) => level === 1);
    expect(backs.map(([, at]) => at)).toEqual(
      [10.79, 11.73, 12.26].map((at) => expect.closeTo(at + 0.008, 9)),
    );
    expect(DROPOUTS.every(([at, length]) => at > 0 && length >= 0.06 && length <= 0.13)).toBe(
      true,
    );
    expect(20 * Math.log10(DROPOUT_LEVEL)).toBeLessThan(-20);
    // A short line keeps its words whole.
    const short = new FakeParam(1);
    dropOut(short as unknown as AudioParam, 0, 0.9);
    expect(short.ramps()).toEqual([]);
  });
});

/** A fake lab for each test of the group: its sounds, its clock, the recordings served. */
function onTheLoudspeakers(): void {
  beforeEach(() => {
    fakeGraph();
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        const json = (): Promise<VoiceManifest> => Promise.resolve(MANIFEST);
        const arrayBuffer = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(8));
        return Promise.resolve({ ok: true, status: 200, json, arrayBuffer });
      }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
}

/** The voice and the loudspeakers, fresh, the mission's recordings loaded. */
async function loudspeakers() {
  vi.resetModules();
  const radio = await import('../src/world/radioVoice.js');
  const pa = await import('../src/world/pa.js');
  const audio = await import('../src/world/audio.js');
  const memory = await import('../src/world/audioMemory.js');
  audio.sharedAudio(); // the lab's context, made as a world makes it
  radio.voiceForRun();
  await vi.advanceTimersByTimeAsync(0);
  return { radio, pa, memory };
}

/** The recordings started so far on the lab's context. */
const spoken = (): FakeBufferSource[] =>
  lastContext()
    .all<FakeBufferSource>('buffer')
    .filter((source) => source.startedAt !== null);

describe('the announcement over the loudspeakers', () => {
  onTheLoudspeakers();

  it('speaks each line as its moment comes, through the loudspeakers, not the radio', async () => {
    const { pa } = await loudspeakers();
    pa.startAnnouncement([FIRST, SECOND], Date.now());
    await vi.advanceTimersByTimeAsync(PA_FROM_MS - 1);
    expect(spoken()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const [first] = spoken();
    expect(first?.startedAt).toBeCloseTo(10.01, 9);
    const after = [...downstream(first as unknown as FakeNode)];
    const filters = after.filter((node) => node.kind === 'biquad') as FakeFilter[];
    expect(filters.map((filter) => filter.frequency.value)).toEqual(
      expect.arrayContaining([PA_LOW, PA_HIGH]),
    );
    expect(filters.some((filter) => filter.frequency.value === 3400)).toBe(false);
    expect(after.some((node) => node.kind === 'shaper')).toBe(false);
    // Through the loudspeakers' bus, whose send the room's reverb answers (reverb.ts).
    const engine = (await import('../src/world/audio.js')).audioEngine();
    const { announce, sends } = engine as unknown as { announce: FakeNode; sends: FakeNode };
    expect(after.includes(announce) && after.includes(sends)).toBe(true);
    // Nothing else plays with it: no static bed, no squelch, no Leitstelle opening.
    expect(spoken()).toHaveLength(1);
    expect(pa.paProbe()).toEqual({
      playing: true,
      lastLine: FIRST.text,
      played: 1,
      cut: false,
      announced: 0,
    });
    // The second line 0.8 s after the first has ended, by the manifest's 2 s.
    await vi.advanceTimersByTimeAsync(2000 + PA_GAP_MS - 1);
    expect(spoken()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spoken()).toHaveLength(2);
    expect(pa.paProbe().lastLine).toBe(SECOND.text);
  });

  it('decodes its lines as it starts, and lets each go once it has been said', async () => {
    const { pa, radio, memory } = await loudspeakers();
    expect(radio.clipOf(FIRST)).toBeNull(); // nothing decoded before the announcement starts
    pa.startAnnouncement([FIRST, SECOND], Date.now());
    await vi.advanceTimersByTimeAsync(0);
    expect(radio.clipOf(FIRST)).not.toBeNull();
    expect(radio.clipOf(SECOND)).not.toBeNull();
    expect(memory.decodedBytes().voice).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(PA_FROM_MS);
    const [first] = spoken();
    first?.end();
    expect(radio.clipOf(FIRST)).toBeNull(); // said: let go
    expect(radio.clipOf(SECOND)).not.toBeNull();
    pa.cutAnnouncement(); // the power goes: the rest let go with it
    expect(radio.clipOf(SECOND)).toBeNull();
    expect(memory.decodedBytes().voice).toBe(0);
  });

  it('leaves out a line without a recording, and every one whose moment long passed', async () => {
    const { pa } = await loudspeakers();
    pa.startAnnouncement([plant('Eine Zeile ohne Aufnahme.')], Date.now());
    await vi.advanceTimersByTimeAsync(PA_FROM_MS);
    expect(spoken()).toEqual([]);
    expect(pa.paProbe().lastLine).toBe('Eine Zeile ohne Aufnahme.');
    // A screen that came in 20 s late: every line's moment long gone.
    pa.startAnnouncement([FIRST, SECOND], Date.now() - 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(spoken()).toEqual([]);
    expect(pa.paProbe().played).toBe(0);
  });
});

describe('the announcement cut short', () => {
  onTheLoudspeakers();

  it('as the power goes, mid-line, saying nothing more', async () => {
    const { pa } = await loudspeakers();
    pa.startAnnouncement([FIRST, SECOND], Date.now());
    await vi.advanceTimersByTimeAsync(PA_FROM_MS + 500);
    const ctx = lastContext();
    ctx.currentTime = 10.6;
    pa.cutAnnouncement();
    const [first] = spoken();
    expect(first?.stoppedAt).toBeGreaterThan(10.6);
    expect(first?.stoppedAt).toBeLessThan(10.7);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spoken()).toHaveLength(1);
    expect(pa.paProbe()).toMatchObject({ playing: false, cut: true });
  });

  it('with the screen: what was laid out never comes', async () => {
    const { pa } = await loudspeakers();
    pa.startAnnouncement([FIRST, SECOND], Date.now());
    await vi.advanceTimersByTimeAsync(100);
    pa.stopAnnouncement();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spoken()).toEqual([]);
    expect(pa.paProbe()).toEqual({
      playing: false,
      lastLine: null,
      played: 0,
      cut: false,
      announced: 0,
    });
  });
});

describe('the plant’s message over the loudspeakers', () => {
  onTheLoudspeakers();

  it('sounds on the emergency power: the weak band, into the loudspeakers', async () => {
    const { pa, radio } = await loudspeakers();
    expect(radio.clipOf(ALERT)).toBeNull(); // not fetched before it is asked for
    // As it sounds it tells how long it speaks: by its recording, which the fake decodes to 1.5 s.
    const saying = pa.announce(ALERT);
    await vi.advanceTimersByTimeAsync(0);
    expect(await saying).toBe(1500);
    const [said] = spoken();
    expect(said?.startedAt).toBeCloseTo(10.01, 9);
    const after = [...downstream(said as unknown as FakeNode)];
    const filters = after.filter((node) => node.kind === 'biquad') as FakeFilter[];
    expect(filters.map((filter) => filter.frequency.value)).toEqual([WEAK_LOW, WEAK_HIGH]);
    const engine = (await import('../src/world/audio.js')).audioEngine();
    const { announce, sends } = engine as unknown as { announce: FakeNode; sends: FakeNode };
    expect(after.includes(announce) && after.includes(sends)).toBe(true);
    // The gate drops the decoded 1.5 s out once, at 0.7 s.
    const gains = after.filter((node) => node.kind === 'gain') as FakeGain[];
    const gate = gains.find((node) => node.gain.ramps().length > 0);
    expect(gate?.gain.ramps()).toEqual([
      [DROPOUT_LEVEL, expect.closeTo(10.718, 9)],
      [1, expect.closeTo(10.808, 9)],
    ]);
    expect(pa.paProbe().announced).toBe(1);
    // Asked again, decoded now: it sounds at once and cuts the one still speaking short.
    lastContext().currentTime = 11;
    expect(await pa.announce(ALERT)).toBe(1500);
    expect(said?.stoppedAt).toBeCloseTo(11.06, 9);
    expect(spoken()).toHaveLength(2);
  });

  it('stays silent without a recording, and stops with the screen, its line let go', async () => {
    const { pa, radio } = await loudspeakers();
    expect(await pa.announce(plant('Eine Durchsage ohne Aufnahme.'))).toBeNull();
    // Nor in a voice that has no recording of it: the plant's words are the plant's.
    expect(await pa.announce({ text: ALERT.text, person: 'helmut' })).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(spoken()).toEqual([]);
    void pa.announce(ALERT);
    await vi.advanceTimersByTimeAsync(0);
    lastContext().currentTime = 10.5;
    pa.stopAnnounce();
    const [said] = spoken();
    expect(said?.stoppedAt).toBeGreaterThan(10.5);
    expect(said?.stoppedAt).toBeLessThan(10.6);
    said?.end();
    expect(radio.clipOf(ALERT)).toBeNull();
    // Stopped before its decoding came in, a message never sounds, and keeps nothing decoded.
    const stopped = pa.announce(ALERT);
    pa.stopAnnounce();
    await vi.advanceTimersByTimeAsync(0);
    expect(await stopped).toBeNull();
    expect(spoken()).toHaveLength(1);
    expect(radio.clipOf(ALERT)).toBeNull();
  });

  it('says a message asked for twice while it decodes once, for the newer ask', async () => {
    const { pa, radio } = await loudspeakers();
    const asks = [pa.announce(ALERT), pa.announce(ALERT)];
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.all(asks)).toEqual([null, 1500]);
    expect(spoken()).toHaveLength(1);
    expect(radio.clipOf(ALERT)).not.toBeNull(); // kept for the one that speaks
  });
});

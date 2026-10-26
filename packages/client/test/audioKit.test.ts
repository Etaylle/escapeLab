import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  endAll,
  fakeGraph,
  FakeBuffer,
  FakeContext,
  FakeNode,
  FakeParam,
  lastContext,
  type FakeBufferSource,
  type FakeOscillator,
} from './fakeGraph.js';

describe('the budget of the beds, the music and the placed sounds', () => {
  beforeEach(() => {
    fakeGraph();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The audio module afresh, its engine made on the fake context. */
  async function freshAudio() {
    vi.resetModules();
    const module = await import('../src/world/audio.js');
    module.sharedAudio();
    return { audio: module, ctx: lastContext() };
  }

  it('gives out at most 12 voices, 4 noises and 6 loops, and takes them back', async () => {
    const { audio } = await freshAudio();
    expect(audio.CAPS).toEqual({ voice: 12, noise: 4, loop: 6 });
    expect(audio.claim({ voice: 10, noise: 4 })).toBe(true);
    expect(audio.claim({ voice: 3 })).toBe(false); // over by one: nothing taken
    expect(audio.claim({ noise: 1 })).toBe(false);
    expect(audio.inUse()).toEqual({ voice: 10, noise: 4, loop: 0 });
    audio.release({ voice: 10, noise: 4 });
    expect(audio.claim({ voice: 12, loop: 6 })).toBe(true);
  });

  it('lets a capped sound go once it has ended: its outlet unwired, its share back', async () => {
    const { audio, ctx } = await freshAudio();
    const master = ctx.all('gain')[0] as FakeNode;
    const live = ctx as unknown as BaseAudioContext;
    const into = master as unknown as AudioNode;
    let made: FakeOscillator | undefined;
    const played = audio.capped(live, into, { voice: 1 }, (out) => {
      const osc = ctx.createOscillator();
      osc.connect(out as unknown as FakeNode);
      osc.start(10);
      made = osc;
      return [osc as unknown as AudioScheduledSourceNode];
    });
    expect(played).toBe(true);
    const outlet = made?.outputs[0] as FakeNode;
    expect(outlet.outputs).toContain(master);
    expect(audio.inUse().voice).toBe(1);
    endAll(ctx);
    expect(outlet.disconnected).toBe(true);
    expect(audio.inUse().voice).toBe(0);
    expect(audio.claim({ voice: 12 })).toBe(true);
    const refused = audio.capped(live, into, { voice: 1 }, () => {
      throw new Error('never built');
    });
    expect(refused).toBe(false);
  });

  it('plays a recording once, a source within the budget from where its sound starts', async () => {
    const { audio, ctx } = await freshAudio();
    const live = ctx as unknown as BaseAudioContext;
    const into = ctx.destination as unknown as AudioNode;
    const buffer = new FakeBuffer(800, 8000);
    const click = { buffer: buffer as unknown as AudioBuffer, start: 0.04 };
    expect(audio.playSample(live, click, into, 10.5, 1.05)).toBe(true);
    const [source] = ctx.all<FakeBufferSource>('buffer');
    expect(source?.buffer).toBe(buffer);
    expect(source?.startedAt).toBe(10.5);
    expect(source?.offset).toBe(0.04); // past the silence before its sound
    expect(source?.playbackRate.value).toBe(1.05);
    expect(audio.inUse().voice).toBe(1);
    source?.end();
    expect(source?.disconnected).toBe(true); // nothing of it stays wired
    expect(audio.inUse().voice).toBe(0);
    expect(audio.playSample(live, null, into, 11)).toBe(false); // not loaded: no sound
    expect(audio.claim({ voice: audio.CAPS.voice })).toBe(true);
    expect(audio.playSample(live, click, into, 11)).toBe(false); // no room: no sound
    expect(ctx.all('buffer')).toHaveLength(1);
  });

  it('plays a loop round and round, all of it, and a capped sound at its level', async () => {
    const { audio, ctx } = await freshAudio();
    const live = ctx as unknown as BaseAudioContext;
    const into = ctx.destination as unknown as AudioNode;
    const hum = new FakeBuffer(4000, 8000);
    const loop = audio.playLoop(live, hum as unknown as AudioBuffer, into, 10.2);
    const source = loop as unknown as FakeBufferSource;
    expect([source.loop, source.startedAt, source.offset]).toEqual([true, 10.2, 0]);
    let outlet: FakeNode | undefined;
    audio.capped(live, into, { voice: 1 }, (out) => {
      outlet = out as unknown as FakeNode;
      return [];
    }, 0.4);
    expect((outlet as unknown as { gain: FakeParam }).gain.value).toBe(0.4);
  });
});

describe('the census of what the audio thread renders', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioNode', FakeNode);
    vi.stubGlobal('AudioParam', FakeParam);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts nodes wired into the output, through parameters too, not those let go', async () => {
    vi.resetModules();
    const { censusOf, countGraph } = await import('../src/world/audioCount.js');
    const ctx = new FakeContext();
    countGraph(ctx as unknown as BaseAudioContext);
    const osc = ctx.createOscillator();
    const level = ctx.createGain();
    const wobble = ctx.createOscillator();
    osc.connect(level);
    level.connect(ctx.destination);
    wobble.connect(level.gain); // a modulator feeds the gain it moves
    osc.start(0);
    const destination = ctx.destination as unknown as AudioNode;
    expect(censusOf(destination)).toEqual({
      playing: { oscillator: 1, buffer: 0 },
      wired: { gain: 1, oscillator: 2 },
      total: 3,
    });
    level.disconnect();
    expect(censusOf(destination).total).toBe(0);
    osc.end();
    expect(censusOf(destination).playing.oscillator).toBe(0);
  });
});

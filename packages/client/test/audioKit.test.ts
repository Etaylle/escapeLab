import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  endAll,
  fakeGraph,
  FakeBuffer,
  FakeContext,
  FakeNode,
  FakeOfflineContext,
  FakeParam,
  flush,
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

  it('renders a loop from the second of two periods, where the filters have settled', async () => {
    const { audio } = await freshAudio();
    class Ramp extends FakeOfflineContext {
      override startRendering(): Promise<FakeBuffer> {
        const out = new FakeBuffer(this.length, this.sampleRate);
        out.data.forEach((_, i) => (out.data[i] = i));
        return Promise.resolve(out);
      }
    }
    vi.stubGlobal('OfflineAudioContext', Ramp);
    let built = 0;
    const loop = await audio.renderLoop(() => (built += 1), 1000, 2);
    expect(built).toBe(1);
    expect(loop.length).toBe(2000);
    expect(loop.getChannelData(0)[0]).toBe(2000); // the second period's first sample
    expect(loop.getChannelData(0)[1999]).toBe(3999);
  });

  it('keeps a sound whose render failed silent, and does not render it again', async () => {
    const { audio } = await freshAudio();
    let tries = 0;
    class Failing extends FakeOfflineContext {
      override startRendering(): Promise<FakeBuffer> {
        tries += 1;
        return Promise.reject(new Error('no rendering here'));
      }
    }
    vi.stubGlobal('OfflineAudioContext', Failing);
    const build = (): void => undefined;
    for (let round = 0; round < 3; round++) {
      expect(audio.sampleOf('broken', build, 0.1, 4000)).toBeNull();
      expect(audio.loopOf('broken', build, 1, 4000)).toBeNull();
      await flush();
    }
    expect(tries).toBe(2); // each once, never again
  });

  it('renders a sample once, and plays it as one source within the budget', async () => {
    const { audio, ctx } = await freshAudio();
    const live = ctx as unknown as BaseAudioContext;
    const into = ctx.destination as unknown as AudioNode;
    let built = 0;
    const build = (): void => {
      built += 1;
    };
    expect(audio.sampleOf('click', build, 0.1, 4000)).toBeNull(); // still rendering
    await flush();
    const sample = audio.sampleOf('click', build, 0.1, 4000);
    expect(sample?.duration).toBe(0.1);
    expect(built).toBe(1);
    expect(audio.playSample(live, sample, into, 10.5, 1.05)).toBe(true);
    const [source] = ctx.all<FakeBufferSource>('buffer');
    expect(source?.startedAt).toBe(10.5);
    expect(source?.playbackRate.value).toBe(1.05);
    expect(audio.inUse().voice).toBe(1);
    source?.end();
    expect(source?.disconnected).toBe(true); // nothing of it stays wired
    expect(audio.inUse().voice).toBe(0);
    expect(audio.playSample(live, null, into, 11)).toBe(false); // no sample yet: no sound
    expect(audio.claim({ voice: audio.CAPS.voice })).toBe(true);
    expect(audio.playSample(live, sample, into, 11)).toBe(false); // no room: no sound
    expect(ctx.all('buffer')).toHaveLength(1);
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

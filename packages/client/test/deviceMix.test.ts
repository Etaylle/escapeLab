import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chainFrom,
  fakeGraph,
  lastContext,
  reaches,
  type FakeBufferSource,
  type FakeNode,
  type FakeOscillator,
} from './fakeGraph.js';
import { loadedSamples } from './fakeSamples.js';

/**
 * The devices' sounds (puzzles/sounds.ts) in the game's real mix (world/mix.ts), on the fake
 * graph: they go into the effects' bus like every other effect, and from there on through the
 * mute and the brickwall to the output, and by the bus's send into the room's reverb.
 */
describe('the devices’ sounds in the mix', () => {
  beforeEach(() => {
    fakeGraph();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function mixed() {
    vi.resetModules();
    await loadedSamples();
    const audio = await import('../src/world/audio.js');
    const sounds = await import('../src/puzzles/sounds.js');
    const engine = audio.audioEngine();
    if (engine === null) {
      throw new Error('the fake graph made no engine');
    }
    const node = (it: unknown): FakeNode => it as FakeNode;
    return { sounds, ctx: lastContext(), node, engine };
  }

  it('ends a recording’s chain at the effects’ bus, the mix taking it on from there', async () => {
    const { sounds, ctx, node, engine } = await mixed();
    sounds.keyClick();
    const [click] = ctx.all<FakeBufferSource>('buffer').filter((s) => s.buffer?.tag === 'key-click');
    expect(click).toBeDefined();
    const chain = chainFrom(click as FakeNode);
    // The click, its outlet, the bus — which feeds the master and its send into the reverb.
    expect(chain).toHaveLength(3);
    expect(chain.at(-1)).toBe(node(engine.sfx));
    expect(reaches(click as FakeNode, node(engine.limiter))).toBe(true);
    expect(reaches(click as FakeNode, node(engine.sends))).toBe(true);
    expect(reaches(click as FakeNode, ctx.destination)).toBe(true);
    expect(click?.outputs.includes(ctx.destination)).toBe(false);
  });

  it('ends the tones the game pitches and the device hum there too', async () => {
    const { sounds, ctx, node, engine } = await mixed();
    sounds.simonTone('rot', 0.3);
    const [tone] = ctx.all<FakeOscillator>('oscillator');
    expect(chainFrom(tone as FakeNode).at(-1)).toBe(node(engine.sfx));
    const hum = sounds.startHum();
    const [loop] = ctx.all<FakeBufferSource>('buffer').filter((s) => s.buffer?.tag === 'mains-hum');
    expect(chainFrom(loop as FakeNode).at(-1)).toBe(node(engine.sfx));
    hum.stop();
  });
});

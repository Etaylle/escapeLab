import { describe, expect, it } from 'vitest';
import {
  dropPath,
  INTERCOM_HIGH,
  INTERCOM_LOW,
  INTERCOM_SEND_DB,
  LINK_RAMP_S,
  switchPath,
  voicePath,
  type VoicePath,
} from '../src/voice/intercom.js';
import {
  downstream,
  FakeContext,
  reaches,
  type FakeFilter,
  type FakeGain,
  type FakeNode,
} from './fakeGraph.js';

/** One voice's path as the fake context keeps it, and as the code takes it (`path`). */
interface Built {
  ctx: FakeContext;
  voice: FakeNode;
  reverb: FakeNode | null;
  path: VoicePath;
  volume: FakeGain;
  plain: FakeGain;
  filters: readonly FakeFilter[];
  speaker: FakeGain;
  send: FakeGain | null;
}

const asNode = (node: FakeNode): AudioNode => node as unknown as AudioNode;

/** A voice's path on a context of its own, at `level`, over the intercom or plain. */
function built(level: number, linked: boolean, withReverb = true): Built {
  const ctx = new FakeContext();
  const voice = ctx.createGain();
  const reverb = withReverb ? ctx.createGain() : null;
  const path = voicePath(
    ctx as unknown as BaseAudioContext,
    asNode(voice),
    asNode(ctx.destination),
    reverb === null ? null : asNode(reverb),
    level,
    linked,
  );
  const nodes = path as unknown as Pick<Built, 'volume' | 'plain' | 'filters' | 'speaker' | 'send'>;
  return { ctx, voice, reverb, path, ...nodes };
}

/** A filter's Q as Web Audio takes it for a high- or low-pass, in dB, back to linear. */
const linearQ = (filter: FakeFilter): number => 10 ** (filter.Q.value / 20);

describe('a crew voice’s path', () => {
  it('plays a voice plain under the proximity rule, the speaker’s way shut', () => {
    const { voice, volume, plain, speaker, ctx } = built(0.3, false);
    expect(voice.outputs).toEqual([volume]);
    expect(volume.gain.value).toBe(0.3);
    expect([plain.gain.value, speaker.gain.value]).toEqual([1, 0]);
    expect(plain.outputs).toEqual([ctx.destination]);
  });

  it('plays it over the intercom through a speaker’s band, 400 Hz to 4 kHz, second order', () => {
    const { volume, plain, filters, speaker, ctx } = built(1, true);
    expect([INTERCOM_LOW, INTERCOM_HIGH]).toEqual([400, 4000]);
    expect([plain.gain.value, speaker.gain.value]).toEqual([0, 1]);
    const [low, high] = filters;
    expect(volume.outputs).toEqual([plain, low]);
    expect([low?.type, low?.frequency.value]).toEqual(['highpass', INTERCOM_LOW]);
    expect([high?.type, high?.frequency.value]).toEqual(['lowpass', INTERCOM_HIGH]);
    for (const filter of filters) {
      expect(linearQ(filter)).toBeCloseTo(Math.SQRT1_2, 9);
    }
    expect(low?.outputs).toEqual([high]);
    expect(high?.outputs).toEqual([speaker]);
    expect(reaches(speaker, ctx.destination)).toBe(true);
    // A speaker, not the radio: no squelch, no static, no shaper.
    for (const kind of ['buffer', 'oscillator', 'shaper', 'delay']) {
      expect(ctx.all(kind)).toEqual([]);
    }
  });

  it('gives the speaker alone a touch of the room’s reverb, 14 dB under the voice', () => {
    const { plain, speaker, send, reverb } = built(1, true);
    expect(INTERCOM_SEND_DB).toBe(-14);
    expect(send?.gain.value).toBeCloseTo(10 ** (-14 / 20), 9);
    expect(speaker.outputs).toContain(send);
    expect(send?.outputs).toEqual([reverb]);
    expect(reverb !== null && downstream(plain).has(reverb)).toBe(false);
    const dry = built(1, true, false);
    expect(dry.send).toBeNull();
    expect(dry.speaker.outputs).toEqual([dry.ctx.destination]);
  });

  it('goes on the intercom over 150 ms, in straight lines from where it stands, and back', () => {
    const { path, volume, plain, speaker } = built(0.05, false);
    expect(LINK_RAMP_S).toBe(0.15);
    switchPath(path, 1, true, 10);
    expect(volume.gain.events).toEqual([
      ['cancel', 10],
      ['set', 0.05, 10],
      ['linear', 1, 10 + LINK_RAMP_S],
    ]);
    expect(plain.gain.ramps()).toEqual([[0, 10 + LINK_RAMP_S]]);
    expect(speaker.gain.ramps()).toEqual([[1, 10 + LINK_RAMP_S]]);

    switchPath(path, 0.05, false, 12);
    expect(volume.gain.ramps().at(-1)).toEqual([0.05, 12 + LINK_RAMP_S]);
    expect(plain.gain.ramps().at(-1)).toEqual([1, 12 + LINK_RAMP_S]);
    expect(speaker.gain.ramps().at(-1)).toEqual([0, 12 + LINK_RAMP_S]);
    // Each move sets out from where its parameter stands as it starts: no jump, no click.
    for (const param of [volume.gain, plain.gain, speaker.gain]) {
      const sets = param.events.filter((event) => event[0] === 'set');
      expect(sets.map((event) => event[2])).toEqual([10, 12]);
      expect(sets.map((event) => event[1])).toEqual([param.value, param.value]);
    }
  });

  it('unwires every stage once the voice is gone', () => {
    const { path, volume, plain, speaker, send } = built(1, true);
    dropPath(path);
    for (const node of [volume, plain, speaker, send]) {
      expect(node?.disconnected).toBe(true);
    }
  });
});

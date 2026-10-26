import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeOfflineContext } from './fakeGraph.js';
import { loadedSamples } from './fakeSamples.js';

/**
 * What the device sounds get from world/audio.ts: the shared context, the sound switch and
 * the effects' volume the settings set. Their recordings come through the real loader, from a
 * fetch the tests serve (fakeSamples.ts).
 */
const audio = vi.hoisted(() => ({ ctx: null as unknown, muted: false, volume: 1 }));

vi.mock('../src/world/audio.js', () => ({
  sharedAudio: () => audio.ctx,
  isMuted: () => audio.muted,
  effectsVolume: () => audio.volume,
}));

const {
  alarmKlaxon,
  ARC_S,
  BUZZ_S,
  buttonThunk,
  dialDetent,
  HUM_LEVEL,
  holdTick,
  keyClick,
  lampPop,
  leverPull,
  leverSpring,
  mushroomStomp,
  okChime,
  pliersSnip,
  probeClick,
  rejectBuzz,
  relayClick,
  shortArc,
  SIMON_TONES,
  simonTone,
  solvedChord,
  solvedChunk,
  sparkCrackle,
  spinUp,
  stageChime,
  startHum,
  stepTick,
  toggleClack,
  typeBlip,
  voltageHum,
  voltagePitch,
  wallThud,
} = await import('../src/puzzles/sounds.js');

/** Times on the audio clock must be finite and not negative, as Web Audio insists. */
function when(t: number): number {
  if (!Number.isFinite(t) || t < 0) {
    throw new RangeError(`bad time ${t}`);
  }
  return t;
}

/** An AudioParam that keeps what was scheduled on it and refuses what Web Audio refuses. */
class FakeParam {
  value = 0;
  readonly events: [string, number, number][] = [];
  setValueAtTime(value: number, at: number): this {
    this.events.push(['set', value, when(at)]);
    return this;
  }
  linearRampToValueAtTime(value: number, at: number): this {
    this.events.push(['linear', value, when(at)]);
    return this;
  }
  exponentialRampToValueAtTime(value: number, at: number): this {
    if (!(value > 0)) {
      throw new RangeError('an exponential ramp has to end above 0');
    }
    this.events.push(['exponential', value, when(at)]);
    return this;
  }
  setTargetAtTime(value: number, at: number, constant: number): this {
    if (!(constant > 0)) {
      throw new RangeError('a time constant has to be above 0');
    }
    this.events.push(['target', value, when(at)]);
    return this;
  }
  cancelScheduledValues(at: number): this {
    this.events.push(['cancel', 0, when(at)]);
    return this;
  }
}

class FakeNode {
  connections: FakeNode[] = [];
  connect(dest: FakeNode | FakeParam): FakeNode | FakeParam {
    if (dest instanceof FakeNode) {
      this.connections.push(dest);
    }
    return dest;
  }
  disconnect(): void {
    this.connections = [];
  }
}

class FakeSource extends FakeNode {
  started: number | null = null;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  start(at = 0): void {
    if (this.started !== null) {
      throw new Error('a source starts once');
    }
    this.started = when(at);
  }
  stop(at = 0): void {
    this.stopped = when(at);
  }
}

class FakeOscillator extends FakeSource {
  type = 'sine';
  readonly frequency = new FakeParam();
}

class FakeBufferSource extends FakeSource {
  buffer: { tag?: string | null } | null = null;
  loop = false;
  offset = 0;
  override start(at = 0, offset = 0): void {
    if (this.buffer === null || offset < 0) {
      throw new RangeError('a buffer source needs its buffer and a place in it');
    }
    super.start(at);
    this.offset = offset;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

/** A context that keeps every node it makes; each a little later on its clock than the last. */
class FakeContext {
  static clock = 0;
  state = 'running';
  readonly currentTime = (FakeContext.clock += 100);
  readonly sampleRate = 8000;
  readonly destination = new FakeNode();
  readonly nodes: FakeNode[] = [];
  private made<N extends FakeNode>(node: N): N {
    this.nodes.push(node);
    return node;
  }
  createOscillator(): FakeOscillator {
    return this.made(new FakeOscillator());
  }
  createGain(): FakeGain {
    return this.made(new FakeGain());
  }
  createBiquadFilter(): FakeFilter {
    return this.made(new FakeFilter());
  }
  createBufferSource(): FakeBufferSource {
    return this.made(new FakeBufferSource());
  }
  get sources(): FakeSource[] {
    return this.nodes.filter((node): node is FakeSource => node instanceof FakeSource);
  }
  /** The recordings played: each buffer source's id. */
  get played(): string[] {
    return this.nodes.flatMap((node) =>
      node instanceof FakeBufferSource ? [node.buffer?.tag ?? '?'] : [],
    );
  }
  /** The sound's outlet: the one node it wired to the destination. */
  get outlets(): FakeNode[] {
    return this.nodes.filter((node) => node.connections.includes(this.destination));
  }
}

let ctx: FakeContext;

beforeAll(async () => {
  vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
  await loadedSamples();
});

beforeEach(() => {
  ctx = new FakeContext();
  audio.ctx = ctx;
  audio.muted = false;
  audio.volume = 1;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Every recorded sound of the devices, and the recording it plays. */
const RECORDED: [string, () => void, string][] = [
  ['keyClick', keyClick, 'key-click'],
  ['rejectBuzz', rejectBuzz, 'reject-buzz'],
  ['alarmKlaxon', alarmKlaxon, 'klaxon'],
  ['solvedChunk', solvedChunk, 'solved-chunk'],
  ['solvedChord', solvedChord, 'solved-chord'],
  ['relayClick', relayClick, 'relay-click'],
  ['toggleClack', toggleClack, 'toggle-clack'],
  ['buttonThunk', buttonThunk, 'button-thunk'],
  ['mushroomStomp', mushroomStomp, 'mushroom-stomp'],
  ['leverPull', leverPull, 'lever-pull'],
  ['leverSpring', leverSpring, 'lever-spring'],
  ['pliersSnip', pliersSnip, 'wire-snip'],
  ['sparkCrackle', sparkCrackle, 'spark'],
  ['shortArc', shortArc, 'short-arc'],
  ['probeClick', probeClick, 'probe-click'],
  ['stageChime', stageChime, 'stage-chime'],
  ['dialDetent', dialDetent, 'dial-detent'],
  ['stepTick', stepTick, 'step-tick'],
  ['wallThud', wallThud, 'wall-thud'],
  ['lampPop', lampPop, 'lamp-pop'],
  ['typeBlip', typeBlip, 'type-blip'],
  ['holdTick', holdTick, 'hold-tick'],
  ['okChime', okChime, 'ok-beeps'],
  ['spinUp', spinUp, 'server-spinup'],
];

/** The sounds still made here, whose pitch the game sets. */
const MADE: [string, () => void][] = [
  ['voltageHum at 180 V', () => voltageHum(180)],
  ['simonTone', () => simonTone('gruen', 0.4)],
];

/** The effects' volume `sound` plays at, read off its outlet at a volume of `volume`. */
function levelAt(sound: () => void, volume: number): number {
  ctx = new FakeContext();
  audio.ctx = ctx;
  audio.volume = volume;
  sound();
  const [outlet] = ctx.outlets;
  return outlet instanceof FakeGain ? outlet.gain.value : NaN;
}

describe.each([...RECORDED.map(([name, sound]) => [name, sound] as const), ...MADE])(
  '%s',
  (_, sound) => {
    it('plays into one outlet, starts every source, and lets go once they end', () => {
      sound();
      expect(ctx.sources.length).toBeGreaterThan(0);
      for (const source of ctx.sources) {
        expect(source.started).toBeGreaterThanOrEqual(ctx.currentTime);
        expect(source.onended).toBeTypeOf('function');
        if (source instanceof FakeOscillator) {
          expect(source.stopped).toBeGreaterThan(source.started ?? Infinity);
        }
      }
      const [outlet, ...more] = ctx.outlets;
      expect(more).toEqual([]);
      for (const source of ctx.sources) {
        expect(outlet?.connections).toEqual([ctx.destination]);
        source.onended?.();
      }
      expect(outlet?.connections).toEqual([]);
    });

    it('makes nothing with the sound off', () => {
      audio.muted = true;
      sound();
      expect(ctx.nodes).toEqual([]);
    });

    it('plays at the effects’ volume the settings set', () => {
      const full = levelAt(sound, 1);
      expect(full).toBeGreaterThan(0);
      expect(levelAt(sound, 0.25)).toBeCloseTo(full * 0.25, 12);
      expect(levelAt(sound, 0)).toBe(0);
    });

    it('makes nothing while the browser still holds the context back', () => {
      ctx.state = 'suspended';
      sound();
      expect(ctx.nodes).toEqual([]);
    });

    it('makes nothing, and throws nothing, without Web Audio', () => {
      audio.ctx = null;
      expect(sound).not.toThrow();
    });
  },
);

describe('the recordings of the devices', () => {
  it.each(RECORDED)('%s plays its recording, „%s", and makes no tone', (_, sound, id) => {
    sound();
    expect(ctx.played).toEqual([id]);
    expect(ctx.nodes.some((node) => node instanceof FakeOscillator)).toBe(false);
  });

  it('strums the solved chord just after the chunk, as a lock going home and then done', () => {
    solvedChunk();
    solvedChord();
    const [chunk, chord] = ctx.sources;
    expect((chord?.started ?? 0) - (chunk?.started ?? 0)).toBeCloseTo(0.14, 9);
  });
});

describe('the sounds of a mistake', () => {
  /** The earliest start among the sources made since `from`. */
  const firstStart = (from: number): number =>
    Math.min(...ctx.sources.slice(from).map((source) => source.started ?? Infinity));

  it('let an alarm’s klaxon wait for the buzz of a refused press before it', () => {
    rejectBuzz();
    const made = ctx.sources.length;
    alarmKlaxon();
    expect(BUZZ_S).toBe(0.16);
    expect(firstStart(made)).toBeGreaterThanOrEqual(ctx.currentTime + BUZZ_S);
  });

  it('let it wait for a short’s arc, longer still', () => {
    shortArc();
    const made = ctx.sources.length;
    alarmKlaxon();
    expect(ARC_S).toBe(0.28);
    expect(firstStart(made)).toBeGreaterThanOrEqual(ctx.currentTime + ARC_S);
  });

  it('sound an alarm at once where nothing came before it', () => {
    alarmKlaxon();
    expect(firstStart(0)).toBeLessThan(ctx.currentTime + 0.05);
  });
});

describe('the meter’s hum', () => {
  /** The pitch the first oscillator glides to, from what was scheduled on it. */
  const pitch = (): number | undefined =>
    ctx.nodes
      .find((node): node is FakeOscillator => node instanceof FakeOscillator)
      ?.frequency.events.find(([kind]) => kind === 'exponential')?.[1];

  it('rises with the voltage, holds at the top of the scale, and is silent at 0 V', () => {
    expect(voltagePitch(0)).toBeNull();
    expect(voltagePitch(-5)).toBeNull();
    expect(voltagePitch(50)).toBeLessThan(voltagePitch(200) ?? 0);
    expect(voltagePitch(400)).toBe(voltagePitch(250));
    voltageHum(0);
    expect(ctx.nodes).toEqual([]);
    voltageHum(200);
    expect(pitch()).toBeCloseTo(voltagePitch(200) ?? 0);
  });
});

describe('the colour tones', () => {
  it('play the classic game’s chord, one tone a colour, low blue to high green', () => {
    expect(SIMON_TONES.blau).toBeLessThan(SIMON_TONES.rot);
    expect(SIMON_TONES.rot).toBe(440);
    expect(SIMON_TONES.gelb).toBeLessThan(SIMON_TONES.gruen);
    expect(SIMON_TONES.gruen / SIMON_TONES.blau).toBeCloseTo(2, 2);
    simonTone('rot', 0.3);
    const tone = ctx.nodes.find((node) => node instanceof FakeOscillator) as FakeOscillator;
    expect(tone.frequency.events[0]?.[1]).toBe(440);
  });
});

describe('the device hum', () => {
  const loops = (): FakeBufferSource[] =>
    ctx.nodes.filter((node): node is FakeBufferSource => node instanceof FakeBufferSource);

  /** The hum's outlet, the one gain it wires to the destination. */
  function outletOf(): FakeGain {
    const [outlet] = ctx.outlets;
    if (!(outlet instanceof FakeGain)) {
      throw new Error('the hum wired no gain to the destination');
    }
    return outlet;
  }

  /** What was last scheduled on the outlet's gain: the kind and the value. */
  const lastLevel = (): unknown[] => outletOf().gain.events.at(-1)?.slice(0, 2) ?? [];

  it('fades in to its level, the mains hum’s recording going round and round', () => {
    startHum();
    const [loop] = loops();
    expect([loop?.buffer?.tag, loop?.loop, loop?.stopped]).toEqual(['mains-hum', true, null]);
    expect(outletOf().gain.events).toContainEqual(['linear', HUM_LEVEL, ctx.currentTime + 0.15]);
  });

  it('falls silent with the sound switch while it runs, and comes back with it', () => {
    vi.useFakeTimers();
    startHum();
    audio.muted = true;
    vi.advanceTimersByTime(250);
    expect(lastLevel()).toEqual(['target', 0]);
    audio.muted = false;
    vi.advanceTimersByTime(250);
    expect(lastLevel()).toEqual(['target', HUM_LEVEL]);
  });

  it('fades in at the effects’ volume, and follows it as the slider moves', () => {
    vi.useFakeTimers();
    audio.volume = 0.5;
    startHum();
    expect(outletOf().gain.events).toContainEqual([
      'linear',
      HUM_LEVEL * 0.5,
      ctx.currentTime + 0.15,
    ]);
    audio.volume = 0.2;
    vi.advanceTimersByTime(250);
    expect(lastLevel()).toEqual(['target', HUM_LEVEL * 0.2]);
    audio.volume = 0;
    vi.advanceTimersByTime(250);
    expect(lastLevel()).toEqual(['target', 0]);
  });

  it('fades out on stop, once, lets go once its loop ends, and watches no switch after', () => {
    vi.useFakeTimers();
    const hum = startHum();
    const outlet = outletOf();
    hum.stop();
    hum.stop();
    const [loop] = loops();
    expect(loop?.stopped).toBeCloseTo(ctx.currentTime + 0.17, 9);
    loop?.onended?.();
    expect(outlet.connections).toEqual([]);
    const scheduled = outlet.gain.events.length;
    audio.muted = true;
    vi.advanceTimersByTime(1000);
    expect(outlet.gain.events.length).toBe(scheduled);
  });

  it('is built while the browser holds the context back, to sound once it runs', () => {
    ctx.state = 'suspended';
    startHum().stop();
    expect(loops()).toHaveLength(1);
  });

  it('makes nothing with the sound off, or without Web Audio; stopping that harms nothing', () => {
    audio.muted = true;
    expect(() => startHum().stop()).not.toThrow();
    expect(ctx.nodes).toEqual([]);
    audio.muted = false;
    audio.ctx = null;
    expect(() => startHum().stop()).not.toThrow();
  });
});

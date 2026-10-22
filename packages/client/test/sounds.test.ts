import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** What the device sounds get from world/audio.ts: the shared context, and the sound switch. */
const audio = vi.hoisted(() => ({ ctx: null as unknown, muted: false }));

vi.mock('../src/world/audio.js', () => ({
  sharedAudio: () => audio.ctx,
  isMuted: () => audio.muted,
}));

const {
  alarmKlaxon,
  BUZZ_HZ,
  BUZZ_LOWPASS_HZ,
  buttonThunk,
  dialDetent,
  HUM_LEVEL,
  holdTick,
  keyClick,
  lampPop,
  leverPull,
  leverSpring,
  MID_BAND,
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

class FakeBuffer {
  private readonly data: Float32Array;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  override start(at = 0, offset = 0, duration?: number): void {
    if (this.buffer === null || offset < 0 || (duration !== undefined && duration <= 0)) {
      throw new RangeError('a buffer source needs its buffer and a slice of it');
    }
    super.start(at);
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
  createBuffer(channels: number, length: number, rate: number): FakeBuffer {
    return new FakeBuffer(channels, length, rate);
  }
  get sources(): FakeSource[] {
    return this.nodes.filter((node): node is FakeSource => node instanceof FakeSource);
  }
  /** The sound's outlet: the one node it wired to the destination. */
  get outlets(): FakeNode[] {
    return this.nodes.filter((node) => node.connections.includes(this.destination));
  }
}

let ctx: FakeContext;

beforeEach(() => {
  ctx = new FakeContext();
  audio.ctx = ctx;
  audio.muted = false;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Every one-shot sound of the devices, with what it needs to sound. */
const ONE_SHOTS: [string, () => void][] = [
  ['keyClick', keyClick],
  ['rejectBuzz', rejectBuzz],
  ['alarmKlaxon', alarmKlaxon],
  ['solvedChunk', solvedChunk],
  ['solvedChord', solvedChord],
  ['relayClick', relayClick],
  ['toggleClack', toggleClack],
  ['buttonThunk', buttonThunk],
  ['mushroomStomp', mushroomStomp],
  ['leverPull', leverPull],
  ['leverSpring', leverSpring],
  ['pliersSnip', pliersSnip],
  ['sparkCrackle', sparkCrackle],
  ['shortArc', shortArc],
  ['probeClick', probeClick],
  ['voltageHum at 180 V', () => voltageHum(180)],
  ['stageChime', stageChime],
  ['dialDetent', dialDetent],
  ['stepTick', stepTick],
  ['wallThud', wallThud],
  ['simonTone', () => simonTone('gruen', 0.4)],
  ['lampPop', lampPop],
  ['typeBlip', typeBlip],
  ['holdTick', holdTick],
  ['okChime', okChime],
  ['spinUp', spinUp],
];

describe.each(ONE_SHOTS)('%s', (_, sound) => {
  it('builds its nodes into one outlet, starts every source, and lets go once they end', () => {
    sound();
    expect(ctx.sources.length).toBeGreaterThan(0);
    for (const source of ctx.sources) {
      expect(source.started).toBeGreaterThanOrEqual(ctx.currentTime);
      // Every source counts towards the outlet's release: the sound was built to its end.
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

  it('makes nothing while the browser still holds the context back', () => {
    ctx.state = 'suspended';
    sound();
    expect(ctx.nodes).toEqual([]);
  });

  it('makes nothing, and throws nothing, without Web Audio', () => {
    audio.ctx = null;
    expect(sound).not.toThrow();
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
    expect(firstStart(made)).toBeGreaterThanOrEqual(ctx.currentTime + 0.16);
  });

  it('let it wait for a short’s arc, longer still', () => {
    shortArc();
    const made = ctx.sources.length;
    alarmKlaxon();
    expect(firstStart(made)).toBeGreaterThanOrEqual(ctx.currentTime + 0.28);
  });

  it('sound an alarm at once where nothing came before it', () => {
    alarmKlaxon();
    expect(firstStart(0)).toBeLessThan(ctx.currentTime + 0.05);
  });
});

describe('weight on a small speaker', () => {
  /** Whether the sound just made carries a band of noise in the mids, at MID_BAND. */
  const midLayer = (): boolean =>
    ctx.nodes.some(
      (node) =>
        node instanceof FakeFilter && node.type === 'bandpass' && node.frequency.value === MID_BAND,
    );

  it.each([
    ['solvedChunk', solvedChunk],
    ['mushroomStomp', mushroomStomp],
    ['buttonThunk', buttonThunk],
    ['wallThud', wallThud],
    ['leverPull', leverPull],
  ])('gives %s a mid layer between 300 and 900 Hz beside its thud', (_, hit) => {
    hit();
    expect(midLayer()).toBe(true);
    expect(MID_BAND).toBeGreaterThanOrEqual(300);
    expect(MID_BAND).toBeLessThanOrEqual(900);
  });

  it('pitches the buzzer an octave up, a square through a 1.2 kHz lowpass', () => {
    rejectBuzz();
    const filters = ctx.nodes.filter((node): node is FakeFilter => node instanceof FakeFilter);
    expect(filters.map((f) => [f.type, f.frequency.value])).toEqual([['lowpass', BUZZ_LOWPASS_HZ]]);
    expect(BUZZ_LOWPASS_HZ).toBe(1200);
    const pitches = ctx.nodes
      .filter((node): node is FakeOscillator => node instanceof FakeOscillator)
      .map((osc) => [osc.type, osc.frequency.events[0]?.[1]]);
    expect(pitches).toContainEqual(['square', BUZZ_HZ]);
    expect(BUZZ_HZ).toBe(184);
    expect(pitches.every(([, pitch]) => (pitch as number) >= 180)).toBe(true);
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
  const voices = (): FakeOscillator[] =>
    ctx.nodes.filter((node): node is FakeOscillator => node instanceof FakeOscillator);

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

  it('fades in to its level with its voices running', () => {
    startHum();
    expect(voices().length).toBeGreaterThan(1);
    expect(voices().every((voice) => voice.started !== null && voice.stopped === null)).toBe(true);
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

  it('fades out on stop, once, lets go once its voices end, and watches no switch after', () => {
    vi.useFakeTimers();
    const hum = startHum();
    const outlet = outletOf();
    hum.stop();
    hum.stop();
    expect(voices().every((voice) => voice.stopped !== null)).toBe(true);
    for (const voice of voices()) {
      voice.onended?.();
    }
    expect(outlet.connections).toEqual([]);
    const scheduled = outlet.gain.events.length;
    audio.muted = true;
    vi.advanceTimersByTime(1000);
    expect(outlet.gain.events.length).toBe(scheduled);
  });

  it('is built while the browser holds the context back, to sound once it runs', () => {
    ctx.state = 'suspended';
    startHum().stop();
    expect(voices().length).toBeGreaterThan(1);
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

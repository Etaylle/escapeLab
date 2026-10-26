import { vi } from 'vitest';
import { serveSamples, type Served } from './fakeSamples.js';

/**
 * Just enough of an AudioContext for the lab's sounds (world/audio.ts), its clock at 10 s:
 * every source it is told to start is kept in `started`, by what it is — a recording by its
 * id (fakeSamples.ts), the radio's noise as 'noise' — and when, with its speed; every
 * exponential ramp in `ramps`, every filter in `filters` and every node wired straight to the
 * output in `toOutput`. Recordings decode on a fake OfflineAudioContext.
 */

export const started: { kind: string; at: number; rate: number }[] = [];
export const ramps: { to: number; at: number }[] = [];
/** Every filter made, as it was set up: its type and its frequency. */
export const filters: { type: string; frequency: FakeParam }[] = [];
/** Every node wired straight to a context's output — the lab's master gain, and nothing else. */
export const toOutput: { gain?: FakeParam }[] = [];

class FakeParam {
  value = 0;
  setValueAtTime(): this {
    return this;
  }
  linearRampToValueAtTime(): this {
    return this;
  }
  exponentialRampToValueAtTime(to: number, at: number): this {
    ramps.push({ to, at });
    return this;
  }
  setTargetAtTime(): this {
    return this;
  }
  setValueCurveAtTime(): this {
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  connect<T>(next: T): T {
    if (next instanceof FakeOutput) {
      // A gain wired to the output carries its gain; whatever else, nothing is read off it.
      toOutput.push(this as { gain?: FakeParam });
    }
    return next;
  }
  disconnect(): void {}
}

/** A context's output. */
class FakeOutput extends FakeNode {}

/** A decoded recording, or the radio's noise: its samples, and the id it was served as. */
interface FakeAudioBuffer {
  readonly duration: number;
  readonly numberOfChannels: number;
  readonly tag?: string;
  getChannelData(): Float32Array;
}

class FakeBufferSource extends FakeNode {
  onended: (() => void) | null = null;
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam();
  start(at = 0): void {
    started.push({ kind: this.buffer?.tag ?? 'noise', at, rate: this.playbackRate.value });
  }
  stop(): void {}
}

export class FakeOscillator extends FakeNode {
  onended: (() => void) | null = null;
  type = 'sine';
  frequency = new FakeParam();
  start(at = 0): void {
    started.push({ kind: 'tone', at, rate: 1 });
  }
  stop(): void {}
}

export class FakeContext {
  state = 'running';
  currentTime = 10;
  sampleRate = 8000;
  destination = new FakeOutput();
  onstatechange: (() => void) | null = null;
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createOscillator() {
    return new FakeOscillator();
  }
  createBiquadFilter() {
    const filter = Object.assign(new FakeNode(), {
      type: '',
      frequency: new FakeParam(),
      Q: new FakeParam(),
    });
    filters.push(filter);
    return filter;
  }
  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    source.playbackRate.value = 1;
    return source;
  }
  createDelay() {
    return Object.assign(new FakeNode(), { delayTime: new FakeParam() });
  }
  createBuffer(_channels: number, length: number, rate: number): FakeAudioBuffer {
    const data = new Float32Array(length);
    return { duration: length / rate, numberOfChannels: 1, getChannelData: () => data };
  }
  resume() {
    return Promise.resolve();
  }
}

/** Where recordings are decoded: a served one ("sample:<id>:<seconds>") to a buffer tagged so. */
class FakeOfflineContext {
  decodeAudioData(bytes: ArrayBuffer): Promise<FakeAudioBuffer> {
    const served = /^sample:([\w-]+):([\d.]+)$/.exec(new TextDecoder().decode(bytes));
    const data = new Float32Array(Math.round(100 * Number(served?.[2] ?? 1))).fill(0.5);
    const tag = served?.[1] ?? 'clip';
    return Promise.resolve({
      duration: data.length / 100,
      numberOfChannels: 1,
      tag,
      getChannelData: () => data,
    });
  }
}

/** A context whose every source breaks: a sound must survive it. */
export class BrokenContext extends FakeContext {
  override createOscillator(): FakeOscillator {
    throw new Error('no oscillators here');
  }
  override createBufferSource(): FakeBufferSource {
    throw new Error('no buffer sources here');
  }
}

/** Forgets what was made and wired, and hands the next audio module the fake context. */
export function fakeAudio(): void {
  started.length = 0;
  ramps.length = 0;
  filters.length = 0;
  toOutput.length = 0;
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
}

/**
 * The audio module afresh, every recording served — as `served` changes them — and loaded, its
 * engine made on demand.
 */
export async function freshAudio(served: Readonly<Record<string, Served>> = {}) {
  vi.resetModules();
  serveSamples(served);
  const samples = await import('../src/world/samples.js');
  await samples.preloadSamples();
  return import('../src/world/audio.js');
}

/** Whether a source of `kind` was started at `at` on the fake clock, give or take a millisecond. */
export function startedAt(kind: string, at: number): boolean {
  return started.some((s) => s.kind === kind && Math.abs(s.at - at) < 0.002);
}

/** The sources of `kind` started, in order. */
export function startsOf(kind: string): { kind: string; at: number; rate: number }[] {
  return started.filter((s) => s.kind === kind);
}

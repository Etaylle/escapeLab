import { vi } from 'vitest';

/**
 * Just enough of an AudioContext for the lab's sounds (world/audio.ts), its
 * clock at 10 s: every source it is told to start is kept in `started`, by
 * what it is and when, and every exponential ramp in `ramps`.
 */

export const started: { kind: string; at: number }[] = [];
export const ramps: { to: number; at: number }[] = [];

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
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  connect<T>(next: T): T {
    return next;
  }
  disconnect(): void {}
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  constructor(readonly kind: string) {
    super();
  }
  start(at = 0): void {
    started.push({ kind: this.kind, at });
  }
  stop(): void {}
}

export class FakeOscillator extends FakeSource {
  type = 'sine';
  frequency = new FakeParam();
  constructor() {
    super('tone');
  }
}

export class FakeContext {
  state = 'running';
  currentTime = 10;
  sampleRate = 8000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createOscillator() {
    return new FakeOscillator();
  }
  createBiquadFilter() {
    const filter = { type: '', frequency: new FakeParam(), Q: new FakeParam() };
    return Object.assign(new FakeNode(), filter);
  }
  createBufferSource() {
    return Object.assign(new FakeSource('noise'), { buffer: null, loop: false });
  }
  createDelay() {
    return Object.assign(new FakeNode(), { delayTime: new FakeParam() });
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  resume() {
    return Promise.resolve();
  }
}

/** A context whose every oscillator breaks: a sound must survive it. */
export class BrokenContext extends FakeContext {
  override createOscillator(): FakeOscillator {
    throw new Error('no oscillators here');
  }
}

/** Forgets what was started and ramped, and hands the next audio module the fake context. */
export function fakeAudio(): void {
  started.length = 0;
  ramps.length = 0;
  vi.stubGlobal('AudioContext', FakeContext);
}

/** The audio module afresh, its engine made on whatever context is stubbed now. */
export async function freshAudio() {
  vi.resetModules();
  return import('../src/world/audio.js');
}

/** Whether a source of `kind` was started at `at` on the fake clock, give or take a millisecond. */
export function startedAt(kind: string, at: number): boolean {
  return started.some((s) => s.kind === kind && Math.abs(s.at - at) < 0.002);
}

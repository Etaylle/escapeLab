import { vi } from 'vitest';

/**
 * Just enough of an AudioContext for the lab's sounds (world/audio.ts), its
 * clock at 10 s: every source it is told to start is kept in `started`, by
 * what it is and when, every exponential ramp in `ramps`, every filter in
 * `filters` and every node wired straight to the output in `toOutput`.
 */

export const started: { kind: string; at: number }[] = [];
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

/** Forgets what was made and wired, and hands the next audio module the fake context. */
export function fakeAudio(): void {
  started.length = 0;
  ramps.length = 0;
  filters.length = 0;
  toOutput.length = 0;
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

/** Whether a heavy hit carried its mid layer: a bandpass at `hz`, in the 300–900 Hz band. */
export function midBand(hz: number): boolean {
  const inBand = hz >= 300 && hz <= 900;
  return inBand && filters.some((f) => f.type === 'bandpass' && f.frequency.value === hz);
}

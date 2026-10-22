import { vi } from 'vitest';

/**
 * A fake AudioContext that keeps the graph it is asked to build: every node by its kind,
 * what each is wired to, every value scheduled on every parameter — refusing what Web Audio
 * refuses (a time before 0, an exponential ramp to 0, a curve over no time) — and every source
 * started and stopped. The clock stands where a test puts it (`ctx.currentTime`).
 */

export type Event =
  | readonly ['set' | 'linear' | 'exponential', number, number]
  | readonly ['target', number, number, number]
  | readonly ['curve', Float32Array, number, number]
  | readonly ['cancel', number];

/** A time on the audio clock, as Web Audio insists: finite and not negative. */
function when(t: number): number {
  if (!Number.isFinite(t) || t < 0) {
    throw new RangeError(`bad time ${t}`);
  }
  return t;
}

export class FakeParam {
  readonly events: Event[] = [];
  constructor(public value = 0) {}
  setValueAtTime(value: number, at: number): this {
    this.events.push(['set', value, when(at)]);
    return this;
  }
  linearRampToValueAtTime(value: number, at: number): this {
    this.events.push(['linear', value, when(at)]);
    return this;
  }
  exponentialRampToValueAtTime(value: number, at: number): this {
    if (!(value > 0)) throw new RangeError('an exponential ramp has to end above 0');
    this.events.push(['exponential', value, when(at)]);
    return this;
  }
  setTargetAtTime(value: number, at: number, constant: number): this {
    if (!(constant > 0)) throw new RangeError('a time constant has to be above 0');
    this.events.push(['target', value, when(at), constant]);
    return this;
  }
  setValueCurveAtTime(curve: Float32Array, at: number, duration: number): this {
    if (curve.length < 2 || !(duration > 0)) throw new RangeError('a curve needs points and time');
    this.events.push(['curve', curve, when(at), duration]);
    return this;
  }
  cancelScheduledValues(at: number): this {
    this.events.push(['cancel', when(at)]);
    return this;
  }
  /** The ramps scheduled on it, linear or exponential: [to, at]. */
  ramps(): [number, number][] {
    return this.events
      .filter((e) => e[0] === 'linear' || e[0] === 'exponential')
      .map((e) => [e[1] as number, e[2] as number]);
  }
}

export class FakeNode {
  readonly outputs: (FakeNode | FakeParam)[] = [];
  disconnected = false;
  constructor(
    readonly kind: string,
    readonly ctx: FakeContext,
  ) {
    ctx.nodes.push(this);
  }
  /** The context the node belongs to, as a real node names it. */
  get context(): FakeContext {
    return this.ctx;
  }
  connect<T extends FakeNode | FakeParam>(next: T): T {
    this.outputs.push(next);
    return next;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super('gain', ctx);
  }
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super('biquad', ctx);
  }
}

export class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  private readonly listeners: (() => void)[] = [];
  start(at = 0): void {
    this.startedAt = when(at);
  }
  stop(at = 0): void {
    this.stoppedAt = when(at);
  }
  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.listeners.push(listener);
  }
  /** The source has played out: what the audio thread would tell it. */
  end(): void {
    this.onended?.();
    for (const listener of this.listeners.splice(0)) listener();
  }
}

export class FakeOscillator extends FakeSource {
  type = 'sine';
  readonly frequency = new FakeParam(440);
  constructor(ctx: FakeContext) {
    super('oscillator', ctx);
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super('buffer', ctx);
  }
}

export class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
  constructor(ctx: FakeContext) {
    super('panner', ctx);
  }
}

export class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
  constructor(ctx: FakeContext) {
    super('shaper', ctx);
  }
}

export class FakeBuffer {
  readonly data: Float32Array;
  /** the offline context it was rendered on, whose graph tells what it holds */
  renderedBy: FakeOfflineContext | null = null;
  constructor(
    length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration(): number {
    return this.data.length / this.sampleRate;
  }
  get length(): number {
    return this.data.length;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeContext {
  /** every context made, the newest last */
  static made: FakeContext[] = [];
  readonly nodes: FakeNode[] = [];
  state = 'running';
  currentTime = 10;
  sampleRate = 8000;
  readonly destination: FakeNode;
  onstatechange: (() => void) | null = null;
  constructor() {
    this.destination = new FakeNode('destination', this);
    FakeContext.made.push(this);
  }
  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter(this);
  }
  createBufferSource(): FakeBufferSource {
    return new FakeBufferSource(this);
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this);
  }
  createWaveShaper(): FakeShaper {
    return new FakeShaper(this);
  }
  createDelay(): FakeNode & { delayTime: FakeParam } {
    return Object.assign(new FakeNode('delay', this), { delayTime: new FakeParam(0) });
  }
  createBuffer(_channels: number, length: number, rate: number): FakeBuffer {
    return new FakeBuffer(length, rate);
  }
  /** Any recording decodes to 1.5 s, its peak 0.45 — unlike the 2 s of the shared noise. */
  decodeAudioData(): Promise<FakeBuffer> {
    const clip = new FakeBuffer(8000 * 1.5, 8000);
    clip.data[100] = 0.45;
    return Promise.resolve(clip);
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  /** The nodes of `kind` made so far. */
  all<T extends FakeNode>(kind: string): T[] {
    return this.nodes.filter((node) => node.kind === kind) as T[];
  }
}

/** An offline context: what is built on it renders into a buffer of its length, all zeros. */
export class FakeOfflineContext extends FakeContext {
  /** every offline context made, the newest last */
  static rendered: FakeOfflineContext[] = [];
  constructor(
    readonly channels: number,
    readonly length: number,
    rate: number,
  ) {
    super();
    FakeContext.made.pop();
    this.sampleRate = rate;
    FakeOfflineContext.rendered.push(this);
  }
  startRendering(): Promise<FakeBuffer> {
    const rendered = new FakeBuffer(this.length, this.sampleRate);
    rendered.renderedBy = this;
    return Promise.resolve(rendered);
  }
}

/** Ends every source of `ctx` that was started: as if they had all played out. */
export function endAll(ctx: FakeContext): void {
  for (const node of ctx.nodes) {
    if (node instanceof FakeSource && node.startedAt !== null) node.end();
  }
}

/** Lets the renders and the fetches settle (a timer's turn: not under fake timers). */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Lets promises already settled run on: the offline renders, under fake timers too. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** The context the audio modules made last. */
export function lastContext(): FakeContext {
  const ctx = FakeContext.made.at(-1);
  if (ctx === undefined) throw new Error('no context was made');
  return ctx;
}

/** Every node `from` feeds, directly or further on; parameters left out. */
export function downstream(from: FakeNode): Set<FakeNode> {
  const seen = new Set<FakeNode>();
  const next = [from];
  for (let node = next.pop(); node !== undefined; node = next.pop()) {
    for (const out of node.outputs) {
      if (out instanceof FakeNode && !seen.has(out)) {
        seen.add(out);
        next.push(out);
      }
    }
  }
  return seen;
}

/** Whether `from` reaches `to` along its wires. */
export function reaches(from: FakeNode, to: FakeNode): boolean {
  return downstream(from).has(to);
}

/** The single chain from `from` on, while every node feeds exactly one node: its nodes. */
export function chainFrom(from: FakeNode): FakeNode[] {
  const nodes: FakeNode[] = [];
  let node: FakeNode | undefined = from;
  while (node !== undefined) {
    nodes.push(node);
    const outs: FakeNode[] = node.outputs.filter((out): out is FakeNode => out instanceof FakeNode);
    node = outs.length === 1 ? outs[0] : undefined;
  }
  return nodes;
}

/** Hands the next audio module a fresh fake context class, and forgets the contexts made. */
export function fakeGraph(): void {
  FakeContext.made = [];
  FakeOfflineContext.rendered = [];
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
}

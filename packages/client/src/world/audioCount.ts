/**
 * audioCount.ts: what the audio thread renders, counted for the walkthrough — only on a page
 * it probes (`?trace=1`): every source from its start until it has ended, and every node still
 * wired, directly or through others, into the context's output, by kind. Chrome renders each
 * wired node every 128 samples, silent or not, so a sound that leaves its last stage wired
 * after it ended keeps costing the audio thread until it is disconnected. For it, the
 * context's factories are wrapped, and with them each node's connect and disconnect; nothing
 * of this runs on a page that is not probed.
 */

/** What a node is, as the census counts it. */
export type NodeKind = 'oscillator' | 'buffer' | 'gain' | 'filter' | 'panner' | 'delay' | 'shaper';

/** The census of a context's graph. */
export interface GraphCensus {
  /** sources started and not yet ended */
  playing: { oscillator: number; buffer: number };
  /** nodes wired into the output now, by kind */
  wired: Partial<Record<NodeKind, number>>;
  /** all of them */
  total: number;
}

type Target = AudioNode | AudioParam;

const FACTORIES: readonly (readonly [keyof BaseAudioContext, NodeKind])[] = [
  ['createOscillator', 'oscillator'],
  ['createBufferSource', 'buffer'],
  ['createGain', 'gain'],
  ['createBiquadFilter', 'filter'],
  ['createStereoPanner', 'panner'],
  ['createDelay', 'delay'],
  ['createWaveShaper', 'shaper'],
];
const PARAMS = ['gain', 'frequency', 'detune', 'Q', 'pan', 'delayTime', 'playbackRate'] as const;

const kinds = new WeakMap<AudioNode, NodeKind>();
/** the node each parameter belongs to: a modulator wired into it feeds that node */
const owners = new WeakMap<AudioParam, AudioNode>();
/**
 * what feeds each node: the nodes wired into it or into one of its parameters — weakly held,
 * so that a sound let go is collected as it would be on a page that is not probed
 */
const feeds = new WeakMap<AudioNode, Set<AudioNode>>();
const playing = { oscillator: 0, buffer: 0 };

/** The node `target` stands for in the graph: itself, or the node a parameter belongs to. */
function nodeOf(target: Target): AudioNode | undefined {
  return target instanceof AudioNode ? target : owners.get(target);
}

/** Wraps `node`'s connect and disconnect so that the census knows what it feeds. */
function wire(node: AudioNode): void {
  const outs = new Set<AudioNode>();
  const connect = node.connect.bind(node) as (...args: unknown[]) => unknown;
  const disconnect = node.disconnect.bind(node) as (...args: unknown[]) => unknown;
  const unhook = (into: AudioNode): void => {
    outs.delete(into);
    const fed = feeds.get(into);
    fed?.delete(node);
    if (fed?.size === 0) feeds.delete(into);
  };
  Object.assign(node, {
    connect: (target: Target, ...rest: unknown[]) => {
      const into = nodeOf(target);
      if (into !== undefined) {
        outs.add(into);
        feeds.set(into, (feeds.get(into) ?? new Set()).add(node));
      }
      return connect(target, ...rest);
    },
    disconnect: (...args: unknown[]) => {
      const [target] = args;
      const named = target instanceof AudioNode || target instanceof AudioParam;
      const from = named ? [nodeOf(target)] : [...outs];
      for (const into of from) if (into !== undefined) unhook(into);
      return disconnect(...args);
    },
  });
}

/** Counts a source from its first start until it has ended. */
function countPlaying(node: AudioScheduledSourceNode, kind: 'oscillator' | 'buffer'): void {
  const start = node.start.bind(node) as (...args: unknown[]) => void;
  let started = false;
  Object.assign(node, {
    start: (...args: unknown[]) => {
      if (!started) {
        started = true;
        playing[kind] += 1;
        node.addEventListener('ended', () => (playing[kind] -= 1), { once: true });
      }
      start(...args);
    },
  });
}

/** Makes every node `ctx` creates from now on count in the census. */
export function countGraph(ctx: BaseAudioContext): void {
  for (const [factory, kind] of FACTORIES) {
    const make = (ctx[factory] as (...args: unknown[]) => AudioNode).bind(ctx);
    Object.assign(ctx, {
      [factory]: (...args: unknown[]) => {
        const node = make(...args);
        kinds.set(node, kind);
        for (const name of PARAMS) {
          const param: unknown = Reflect.get(node, name);
          if (param instanceof AudioParam) owners.set(param, node);
        }
        wire(node);
        if (kind === 'oscillator' || kind === 'buffer') {
          countPlaying(node as AudioScheduledSourceNode, kind);
        }
        return node;
      },
    });
  }
}

/** What the audio thread renders into `output` now: the sources playing, the nodes wired. */
export function censusOf(output: AudioNode): GraphCensus {
  const wired: Partial<Record<NodeKind, number>> = {};
  const seen = new Set<AudioNode>([output]);
  const next = [output];
  for (let node = next.pop(); node !== undefined; node = next.pop()) {
    for (const feeder of feeds.get(node) ?? []) {
      if (!seen.has(feeder)) {
        seen.add(feeder);
        next.push(feeder);
        const kind = kinds.get(feeder);
        if (kind !== undefined) wired[kind] = (wired[kind] ?? 0) + 1;
      }
    }
  }
  return { playing: { ...playing }, wired, total: seen.size - 1 };
}

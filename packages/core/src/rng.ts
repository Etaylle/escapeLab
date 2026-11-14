/**
 * Deterministic PRNG (mulberry32). The seed travels in the start-mission
 * action, so puzzle layouts are random per game yet fully reproducible —
 * same seed, same game.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One of `items` for `seed` at `key` — a place in the mission, `solved:<station>`, or a role of
 * the cast, `cast:operator` — the `occurrence`-th time it is asked for: the first from the seed
 * and the key, an FNV-1a hash of the key mixed into the seed, so that one seed always picks the
 * same and another most often another; each later occurrence the next in turn. Undefined for
 * no items.
 */
export function pickOf<T>(
  items: readonly T[],
  seed: number,
  key: string,
  occurrence = 0,
): T | undefined {
  let hash = 0x811c9dc5;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  const first = Math.floor(mulberry32((seed ^ hash) >>> 0)() * items.length);
  return items[(first + occurrence) % items.length];
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
  return arr;
}

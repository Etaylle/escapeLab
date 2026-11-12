import { afterEach, describe, expect, it, vi } from 'vitest';
import { crewPassSchema } from '@escapelab/core';
import type { NoteStore } from '../src/notes.js';
import type * as PassModule from '../src/pass.js';

/** A browser's local storage, kept in a map; `broken` makes every access throw. */
function storage(broken = false): NoteStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  const guard = (): void => {
    if (broken) {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    }
  };
  return {
    items,
    getItem: (key) => {
      guard();
      return items.get(key) ?? null;
    },
    setItem: (key, value) => {
      guard();
      items.set(key, value);
    },
    removeItem: (key) => {
      guard();
      items.delete(key);
    },
  };
}

/** pass.ts as a page loads it afresh: a new tab, a relaunched app, a restarted browser. */
async function freshPage(): Promise<typeof PassModule> {
  vi.resetModules();
  return import('../src/pass.js');
}

describe('the crew pass', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is minted once per browser and shown again by every page after', async () => {
    const store = storage();
    const first = await freshPage();
    const minted = first.crewPass(store);
    expect(crewPassSchema.safeParse(minted).success).toBe(true);
    expect(first.crewPass(store)).toEqual(minted);
    const again = await freshPage();
    expect(again.crewPass(store)).toEqual(minted);
    expect([...store.items.keys()]).toEqual([again.PASS_KEY]);
  });

  it('gives two browsers two passes', async () => {
    const pass = await freshPage();
    const anna = pass.crewPass(storage());
    const ben = pass.crewPass(storage());
    expect(anna.id).not.toBe(ben.id);
    expect(anna.secret).not.toBe(ben.secret);
  });

  it('keeps the name with it, and a blank name as none', async () => {
    const store = storage();
    const pass = await freshPage();
    const minted = pass.crewPass(store);
    expect(pass.lastName(store)).toBe('');
    pass.keepName('Ben', store);
    expect((await freshPage()).lastName(store)).toBe('Ben');
    expect(pass.crewPass(store)).toEqual(minted);
    expect(pass.crewPass(store)).not.toHaveProperty('name');
    pass.keepName('   ', store);
    expect(pass.lastName(store)).toBe('');
  });

  it('mints anew over whatever kept is no pass', async () => {
    const store = storage();
    store.setItem('escapelab-pass', JSON.stringify({ id: 'kurz', secret: 'auch' }));
    const pass = await freshPage();
    const minted = pass.crewPass(store);
    expect(minted.id).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(store.items.get(pass.PASS_KEY) ?? '{}')).toMatchObject(minted);
    store.setItem(pass.PASS_KEY, '{nicht json');
    expect((await freshPage()).crewPass(store).id).not.toBe(minted.id);
  });

  it('holds one pass for the page’s life where the browser keeps nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = storage(true);
    const pass = await freshPage();
    const minted = pass.crewPass(store);
    expect(pass.crewPass(store)).toEqual(minted);
    expect(pass.crewPass(null)).toEqual(minted);
    pass.keepName('Anna', store);
    expect(pass.lastName(store)).toBe('Anna');
    expect(pass.crewPass(store)).toEqual(minted);
  });
});

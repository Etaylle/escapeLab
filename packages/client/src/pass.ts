import { crewPassSchema, type CrewPass } from '@escapelab/core';
import { localStore, type NoteStore } from './notes.js';

/**
 * The browser's crew pass (Dienstausweis, core protocol.ts `CrewPass`): an id and a secret
 * minted once per browser profile and kept in its local storage, so that every tab, a
 * relaunched home-screen app and a restarted browser show the same pass — and with it the name
 * last typed on the join screen. Rooms are joined, opened and resumed with it; the server binds
 * each seat to it, so a seat comes back to whichever socket shows it.
 */

/** Where the browser keeps its pass. */
export const PASS_KEY = 'escapelab-pass';

/** The pass as the browser keeps it: the pass itself, and the name last typed with it. */
export interface KeptPass extends CrewPass {
  name: string;
}

/** `bytes` random bytes as hex, from the browser's own source of randomness. */
function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The pass kept under PASS_KEY in `store`; null for none, or for anything that is no pass. */
function keptIn(store: NoteStore | null): KeptPass | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(PASS_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    const pass = crewPassSchema.safeParse(value);
    const name = (value as { name?: unknown }).name;
    return pass.success ? { ...pass.data, name: typeof name === 'string' ? name : '' } : null;
  } catch {
    return null;
  }
}

/**
 * Keeps `pass` in `store`; whether it was kept. Where the browser refuses, the page goes on
 * with it all the same.
 */
function keep(store: NoteStore | null, pass: KeptPass): boolean {
  if (store === null) {
    return false;
  }
  try {
    store.setItem(PASS_KEY, JSON.stringify(pass));
    return true;
  } catch (err) {
    console.warn(`[escapelab] the crew pass is not kept: ${String(err)}`);
    return false;
  }
}

/** The pass this page minted where its storage could not keep it: one for the page's life. */
let unkept: KeptPass | null = null;

/**
 * The browser's pass: the one `store` keeps, else minted now and kept there. Where the browser
 * keeps nothing, the page keeps the pass it minted for as long as it lives.
 */
export function keptPass(store: NoteStore | null = localStore()): KeptPass {
  const kept = keptIn(store) ?? unkept;
  if (kept !== null) {
    return kept;
  }
  const minted = { id: randomHex(16), secret: randomHex(32), name: '' };
  if (!keep(store, minted)) {
    unkept = minted;
  }
  return minted;
}

/** The pass as it goes over the line: its id and its secret, never the name. */
export function crewPass(store: NoteStore | null = localStore()): CrewPass {
  const { id, secret } = keptPass(store);
  return { id, secret };
}

/** The name last typed on the join screen, kept with the pass; '' where there is none. */
export function lastName(store: NoteStore | null = localStore()): string {
  return keptPass(store).name;
}

/** Keeps `name` with the pass for next time; a blank one keeps none. */
export function keepName(name: string, store: NoteStore | null = localStore()): void {
  const next = { ...keptPass(store), name: name.trim() === '' ? '' : name };
  if (!keep(store, next)) {
    unkept = next;
  }
}

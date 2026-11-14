import { crewPassSchema, type AccountView, type CrewPass } from '@escapelab/core';
import { localStore, type NoteStore } from './notes.js';

/**
 * The browser's crew pass (Dienstausweis, core protocol.ts `CrewPass`): an id and a secret
 * minted once per browser profile and kept in its local storage, so that every tab, a
 * relaunched home-screen app and a restarted browser show the same pass. Rooms are joined,
 * opened and resumed with it; the server binds each seat to it, so a seat comes back to whichever
 * socket shows it, and keeps an account for it (core protocol.ts `AccountView`), whose name and
 * colour the pass keeps beside it, as the menu's profile last showed them.
 */

/** Where the browser keeps its pass. */
export const PASS_KEY = 'escapelab-pass';

/**
 * The pass as the browser keeps it: the pass itself, the name last typed with it, and the crew
 * colour its account wears — the top bar's account shows it (screens/BarAccount.tsx); null
 * before one was chosen.
 */
export interface KeptPass extends CrewPass {
  name: string;
  color: string | null;
}

/** A crew colour as the server hands them out (core state.ts CREW_COLORS): `#` and six digits. */
const COLOR = /^#[0-9a-f]{6}$/i;

/** `bytes` random bytes as hex, from the browser's own source of randomness. */
function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The name and the colour kept beside the pass in `value`: '' and null where none is kept. */
function keptBeside(value: unknown): Pick<KeptPass, 'name' | 'color'> {
  const { name, color } = value as { name?: unknown; color?: unknown };
  return {
    name: typeof name === 'string' ? name : '',
    color: typeof color === 'string' && COLOR.test(color) ? color : null,
  };
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
    return pass.success ? { ...pass.data, ...keptBeside(value) } : null;
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
  const minted = { id: randomHex(16), secret: randomHex(32), name: '', color: null };
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
  keepOrHold(store, { ...keptPass(store), name: name.trim() === '' ? '' : name });
}

/** The crew colour the pass's account wears, kept with the pass; null before one was chosen. */
export function lastColor(store: NoteStore | null = localStore()): string | null {
  return keptPass(store).color;
}

/** Keeps `next` as the browser's pass, or for the page's life where the browser refuses. */
function keepOrHold(store: NoteStore | null, next: KeptPass): void {
  if (!keep(store, next)) {
    unkept = next;
  }
}

/**
 * Keeps what the server says of the pass's account (`account`) with the pass, for the menu's
 * profile to start from next time: its name, and its colour once it has one — anything but a
 * crew colour keeps the one there was.
 */
export function keepProfile(
  account: Pick<AccountView, 'name' | 'color'>,
  store: NoteStore | null = localStore(),
): void {
  const kept = keptPass(store);
  const color = account.color !== null && COLOR.test(account.color) ? account.color : kept.color;
  keepOrHold(store, { ...kept, name: account.name, color });
}

/** The account deleted: the pass keeps no name and no colour any more, and stays the key here. */
export function forgetProfile(store: NoteStore | null = localStore()): void {
  keepOrHold(store, { ...keptPass(store), name: '', color: null });
}

/** A new pass, minted now and kept nowhere yet: a switch of accounts sends it (`adoptPass`). */
export function mintPass(): CrewPass {
  return { id: randomHex(16), secret: randomHex(32) };
}

/**
 * `pass` the browser's pass from now on, in place of the one it had — the device signed out, or
 * switched accounts — with the name and the colour of `account` beside it, none for a guest.
 */
export function adoptPass(
  pass: CrewPass,
  account: Pick<AccountView, 'name' | 'color'> | null,
  store: NoteStore | null = localStore(),
): void {
  const color = account?.color ?? null;
  const worn = color !== null && COLOR.test(color) ? color : null;
  keepOrHold(store, { ...pass, name: account?.name ?? '', color: worn });
}

/**
 * Calls `reload` once another tab of the browser has put another pass in place of the one this
 * page started on (`adoptPass`): signed out, or switched — this page's line speaks for a pass the
 * browser holds no more. Returns how to stop.
 */
export function followPass(
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  reload: () => void,
  store: NoteStore | null = localStore(),
): () => void {
  const started = keptPass(store).id;
  const changed = (event: StorageEvent): void => {
    if (event.key === PASS_KEY && keptPass(store).id !== started) {
      reload();
    }
  };
  win.addEventListener('storage', changed);
  return () => win.removeEventListener('storage', changed);
}

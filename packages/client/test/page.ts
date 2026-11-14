import type { AccountView, LoginDone, Seat, SpectatorView } from '@escapelab/core';
import type { Loaded } from '../src/runStats.js';
import type { MyRuns, Page, Restoring, Takeover } from '../src/ws.js';

/** A storage kept in a map, as the browser's local and session storage are. */
export function storage(items: Map<string, string>) {
  return {
    get length(): number {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

/** The page as the connection keeps it, its setters noting what they were last given. */
export function page() {
  const got = {
    code: null as string | null,
    audience: null as SpectatorView | null,
    takeover: null as Takeover | null,
    restoring: null as Restoring | null,
    seat: null as Seat | null,
    account: undefined as AccountView | null | undefined,
    myRuns: null as Loaded<MyRuns> | null,
    /** how many watch the room, as the page last heard it */
    watching: null as number | null,
    /** the banner's words, as the page last set them */
    banner: null as string | null,
    /** what each answer to an ask of a login said was done, in order */
    logins: [] as LoginDone[],
    /** how often the page loaded anew */
    startedOver: 0,
  };
  const nothing = (): void => undefined;
  const kept: Page = {
    setRoomCode: (code) => {
      got.code = code;
    },
    setView: nothing,
    setSpectatorView: (view) => {
      got.audience = view;
    },
    setRooms: nothing,
    setSeat: (seat) => {
      got.seat = seat;
    },
    setAccount: (account) => {
      got.account = account;
    },
    setMyRuns: (runs) => {
      got.myRuns = runs;
    },
    setTakeover: (takeover) => {
      got.takeover = takeover;
    },
    setRestoring: (restoring) => {
      got.restoring = restoring;
    },
    setWatching: (count) => {
      got.watching = count;
    },
    setError: (message) => {
      got.banner = message;
    },
    refuse: nothing,
    noteLogin: (done) => {
      got.logins.push(done);
    },
    nextPass: { current: null },
    startOver: () => {
      got.startedOver += 1;
    },
    resuming: { current: false },
    resumed: { current: null },
    seen: { current: null },
    positions: { current: { run: null, players: {} } },
    drones: { current: {} },
    pings: { current: [] },
    chats: { current: [] },
  };
  return { kept, got };
}

import type { SpectatorView } from '@escapelab/core';
import type { Page, Takeover } from '../src/ws.js';

/** A storage kept in a map, as the browser's local and session storage are. */
export function storage(items: Map<string, string>) {
  return {
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
    setSeat: nothing,
    setTakeover: (takeover) => {
      got.takeover = takeover;
    },
    setError: nothing,
    refuse: nothing,
    resuming: { current: false },
    you: { current: null },
    positions: { current: { run: null, players: {} } },
    drones: { current: {} },
    pings: { current: [] },
    chats: { current: [] },
  };
  return { kept, got };
}

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ClientMessage, Phase, PlayerView } from '@escapelab/core';

/**
 * The menus over the screens (App.tsx): the pause menu over a room — a run, a lobby, the
 * audience's screen (screens/PauseMenu.tsx) —, a mission's booklet opened from it, and the
 * settings over everything. In a room the gear in the top bar, a controller's Start, Esc with
 * nothing else open and the HUD's menu button open the pause menu; off any room and on the end
 * screen, which keeps its own ways out, the gear and Start open the settings at once, as they
 * always did. Opening the pause menu over a run stands nothing still for the crew: the run goes
 * on, and the crew sees the player at the menu (`useMenuMark`).
 */

/** Where the pause menu stands over a room: a run on, a lobby, the audience's screen. */
export type PausePhase = 'run' | 'lobby' | 'audience';

/**
 * The pause menu's place for a connection: a run on — not its end, which the world plays and
 * the end screen follows —, a lobby, the audience; null off any room and on the end screen.
 */
export function pausePhaseOf(conn: {
  view: { phase: Phase } | null;
  spectatorView: object | null;
}): PausePhase | null {
  if (conn.spectatorView !== null) {
    return 'audience';
  }
  if (conn.view?.phase === 'playing') {
    return 'run';
  }
  return conn.view?.phase === 'lobby' ? 'lobby' : null;
}

/** What stands open over the screens. */
export interface Layers {
  pause: boolean;
  settings: boolean;
  /** the mission whose booklet lies over the room, opened from the pause menu, by id; or null */
  handbook: string | null;
}

export const NOTHING_OPEN: Layers = { pause: false, settings: false, handbook: null };

/** The gear in the top bar: in a room the pause menu, off any room the settings. */
export function gearOpens(layers: Layers, phase: PausePhase | null): Layers {
  return phase === null ? { ...layers, settings: true } : { ...layers, pause: true };
}

/**
 * Whether a menu stands over the screens — the pause menu, the settings, the booklet: then the
 * screens under it, the top bar and the room, take nothing (App.tsx `inert`), and a controller
 * and the Tab key stay in the menu.
 */
export function anyOpen(layers: Layers): boolean {
  return layers.pause || layers.settings || layers.handbook !== null;
}

/**
 * A controller's Start: whatever menu stands open closes, and the run goes on; with none open,
 * the room's pause menu opens — off any room, the settings.
 */
export function startPressed(layers: Layers, phase: PausePhase | null): Layers {
  return anyOpen(layers) ? NOTHING_OPEN : gearOpens(NOTHING_OPEN, phase);
}

/** The menus over the screens, and the ways to open and close them. */
export interface MenuLayer extends Layers {
  /** where the pause menu stands; null where the gear opens the settings */
  phase: PausePhase | null;
  /** the gear in the top bar (`gearOpens`) */
  gear: () => void;
  /** a controller's Start (`startPressed`) */
  start: () => void;
  /** opens the pause menu, in a room */
  openPause: () => void;
  /** closes the pause menu, and whatever was opened from it */
  closePause: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openHandbook: (missionId: string) => void;
  closeHandbook: () => void;
}

/** A control the focus can go back to: one still on the page. */
interface Focusable {
  readonly isConnected: boolean;
  focus(options?: FocusOptions): void;
}

/**
 * Where the focus goes once the menus over the screens are all closed: back to the control that
 * had it as the first came (`opener`), still on the page — but in a run it stays with the world,
 * whose keys a button in the focus would take: Space would press it again.
 */
export function focusBackTo(opener: Focusable | null, phase: PausePhase | null): Focusable | null {
  return opener !== null && opener.isConnected && phase !== 'run' ? opener : null;
}

/** The control in the focus now; null without one, or without a page. */
function focusedNow(): HTMLElement | null {
  const active = typeof document === 'undefined' ? null : document.activeElement;
  return active instanceof HTMLElement ? active : null;
}

/**
 * The menus over the screens at `phase` (`pausePhaseOf`). The room changing under the pause
 * menu — a run started or over, a lobby left — takes it down, with the booklet opened from it;
 * the settings stay where they were opened. The control that had the focus as the first menu
 * came gets it back once the last goes (`focusBackTo`).
 */
export function useMenuLayer(phase: PausePhase | null): MenuLayer {
  const [layers, setLayers] = useState<Layers>(NOTHING_OPEN);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setLayers((now) => ({ ...now, pause: false, handbook: null }));
  }, [phase]);
  const open = anyOpen(layers);
  useEffect(() => {
    if (!open) {
      focusBackTo(opener.current, phase)?.focus({ preventScroll: true });
      opener.current = null;
    }
  }, [open, phase]);
  const change = (to: (now: Layers) => Layers): void => {
    if (!open) {
      opener.current = focusedNow();
    }
    setLayers(to);
  };
  const patch = (part: Partial<Layers>): void => change((now) => ({ ...now, ...part }));
  return {
    ...layers,
    phase,
    gear: () => change((now) => gearOpens(now, phase)),
    start: () => change((now) => startPressed(now, phase)),
    openPause: () => patch({ pause: phase !== null }),
    closePause: () => setLayers(NOTHING_OPEN),
    openSettings: () => patch({ settings: true }),
    closeSettings: () => patch({ settings: false }),
    openHandbook: (missionId) => patch({ handbook: missionId }),
    closeHandbook: () => patch({ handbook: null }),
  };
}

/** Whether the pause menu stands open, and how the game screen opens it: Esc, the HUD's button. */
export interface PauseHand {
  open: boolean;
  show: () => void;
}

/** No menu layer around: nothing stands open, and nothing opens. */
const NO_PAUSE: PauseHand = { open: false, show: () => undefined };

/** The pause menu as the screens under it reach it. */
export const PauseContext = createContext<PauseHand>(NO_PAUSE);

/** The pause menu as the screens under it reach it (`PauseContext`). */
export function usePause(): PauseHand {
  return useContext(PauseContext);
}

/** What Esc does over a lobby or the audience's screen: opens the menu, where nothing took it. */
export function escapeOpensMenu(
  open: () => void,
): (e: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'preventDefault'>) => void {
  return (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      open();
    }
  };
}

/**
 * Esc opens the pause menu over a lobby or the audience's screen, wherever nothing took it
 * first (`defaultPrevented`, MenuPanels.tsx `escapeHandler`); in a run the game screen opens it
 * once nothing else of its own stands open (Game.tsx `escapeStep`).
 */
export function useEscapeOpensMenu(layer: Pick<MenuLayer, 'phase' | 'pause' | 'openPause'>): void {
  const on = (layer.phase === 'lobby' || layer.phase === 'audience') && !layer.pause;
  const open = useRef(layer.openPause);
  open.current = layer.openPause;
  useEffect(() => {
    if (!on) {
      return undefined;
    }
    const onKey = escapeOpensMenu(() => open.current());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on]);
}

/** Whether `view` says its own player stands at the pause menu over a run. */
export function markedAtMenu(view: Pick<PlayerView, 'phase' | 'players' | 'you'> | null): boolean {
  return view?.players.find((p) => p.id === view.you.id)?.menu === 'pause';
}

/**
 * What the server is to be told of the pause menu over a run, if anything: whether it stands
 * open, where that is not what the latest view says; null where they agree, or outside a run.
 * A line that dropped took the mark with it: back on the line, it is said again.
 */
export function menuNews(
  view: Pick<PlayerView, 'phase' | 'players' | 'you'> | null,
  open: boolean,
): ClientMessage | null {
  if (view?.phase !== 'playing' || open === markedAtMenu(view)) {
    return null;
  }
  return { kind: 'pause-menu', open };
}

/**
 * The crew sees this player at the menu while the pause menu stands open over a run: the server
 * is told whenever its latest view says otherwise (`menuNews`) — said again with each view until
 * one agrees, so that a word lost to a line that dropped is said once it is back; the server
 * takes a word that changes nothing as nothing.
 */
export function useMenuMark(
  view: Pick<PlayerView, 'phase' | 'players' | 'you'> | null,
  open: boolean,
  send: (msg: ClientMessage) => void,
): void {
  const say = useRef(send);
  say.current = send;
  useEffect(() => {
    const news = menuNews(view, open);
    if (news !== null) {
      say.current(news);
    }
  }, [view, open]);
}

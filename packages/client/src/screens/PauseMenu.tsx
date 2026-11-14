import { useEffect, useRef, type RefObject } from 'react';
import type { PausePhase } from '../menuLayer.js';
import { getSettings } from '../settings.js';
import { uiSound } from '../world/menuSound.js';
import { menuStep } from './MainMenu.js';

/**
 * The pause menu over a room (menuLayer.ts), as the main menu stands (styles/menu.css): the
 * mission's name in the title's face over a vertical list in it, over the dark of the lab's doors
 * — no blur, the world drawing on beneath it. „Weiter" stands first and lit, then the settings and
 * the booklet, then the room's ways out (`WAYS_OUT`). The arrows, a controller's D-pad, Enter and
 * A take an item; Esc, B or Start — or a click beside the list — close it. While it stands open,
 * the keys are its own: nothing walks, works or opens under it, but the voice keeps its key. Over
 * a run one line under the list says that nothing stands still for it.
 */

/** What the pause menu offers, item by item. */
export type PauseItem =
  | 'resume'
  | 'settings'
  | 'handbook'
  | 'main-menu'
  | 'give-up'
  | 'leave'
  | 'stop-watching';

/** What each item says. */
export const PAUSE_LABELS: Readonly<Record<PauseItem, string>> = {
  resume: 'Weiter',
  settings: 'Einstellungen',
  handbook: 'Handbuch',
  'main-menu': 'Zum Hauptmenü',
  'give-up': 'Einsatz aufgeben',
  leave: 'Raum verlassen',
  'stop-watching': 'Zuschauen beenden',
};

/**
 * The room's ways out of it, by where the menu stands: from a run or a lobby to the main menu,
 * the seat kept, and then the seat given up — the run's after asking once —; the audience simply
 * goes, which is its way to the main menu.
 */
const WAYS_OUT: Readonly<Record<PausePhase, readonly PauseItem[]>> = {
  run: ['main-menu', 'give-up'],
  lobby: ['main-menu', 'leave'],
  audience: ['stop-watching'],
};

/** The menu's items in order, top to bottom, where it stands at `phase`. */
export function pauseItems(phase: PausePhase): PauseItem[] {
  return ['resume', 'settings', 'handbook', ...WAYS_OUT[phase]];
}

// voice: interface — the menu over the run names the crew, who sees its player at it
export const RUN_GOES_ON = 'Die Uhr läuft weiter; bei der Crew steht „im Menü“ am Namen.';

/** What a key pressed over the open menu does: close it, step, talk, or nothing of the world's. */
export type MenuKey = 'close' | 'step' | 'voice' | 'kept';

/**
 * What `key` does over the open menu: Esc closes it, the arrows, Home and End step between its
 * items, the voice's key (`talk`) talks on; every other key — Enter and Space press an item — is
 * kept from the world under it.
 */
export function menuKeyOf(key: string, talk: string): MenuKey {
  if (key === 'Escape') {
    return 'close';
  }
  if (/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(key)) {
    return 'step';
  }
  return key.toLowerCase() === talk ? 'voice' : 'kept';
}

/** A key going down, as far as the menu reads it. */
type MenuKeyEvent = Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>;

/** The menu's list as its keys reach it: its items, and which of them has the focus. */
export interface MenuNav {
  items: () => readonly { focus: () => void }[];
  focused: () => number;
}

/** An arrow, Home or End over the menu: the focus goes to the item it points at. */
function stepIn(nav: MenuNav, e: MenuKeyEvent): void {
  const items = nav.items();
  const next = menuStep(nav.focused(), e.key, items.length);
  if (next !== null) {
    e.preventDefault();
    items[next]?.focus();
  }
}

/** What the menu's keys reach as one goes down: its list, whether it is covered, how it closes. */
export interface MenuKeys {
  nav: MenuNav | null;
  /** the settings or the booklet lie over it: the keys are theirs */
  covered: boolean;
  close: () => void;
  /** the voice's key, which talks on (settings.ts) */
  talk: string;
}

/**
 * The menu's keys, before anything under it hears them (capturing): Esc closes it, the arrows
 * step, the voice's key goes on to the voice, and no other key reaches the world. While the
 * settings or the booklet lie over it (`covered`), the keys are theirs.
 */
export function menuKeyHandler(keys: () => MenuKeys): (e: MenuKeyEvent) => void {
  return (e) => {
    const { nav, covered, close, talk } = keys();
    const what = menuKeyOf(e.key, talk);
    if (nav === null || covered || what === 'voice') {
      return;
    }
    e.stopPropagation();
    if (what === 'close') {
      e.preventDefault();
      close();
    } else if (what === 'step') {
      stepIn(nav, e);
    }
  };
}

/** The list `root` as its keys reach it: its enabled buttons, the focused one among them. */
function navOf(root: HTMLElement | null): MenuNav | null {
  if (root === null) {
    return null;
  }
  const items = (): HTMLButtonElement[] => [
    ...root.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
  ];
  return { items, focused: () => items().findIndex((item) => item === document.activeElement) };
}

/** The menu's keys on the window, capturing (`menuKeyHandler`). */
function useMenuKeys(nav: RefObject<HTMLElement | null>, covered: boolean, close: () => void) {
  const latest = useRef({ covered, close });
  latest.current = { covered, close };
  useEffect(() => {
    const onKey = menuKeyHandler(() => ({
      nav: navOf(nav.current),
      ...latest.current,
      talk: getSettings().keys.talk,
    }));
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [nav]);
}

/**
 * Where the focus stands in the menu: on „Weiter" as it opens, and back on the item that opened
 * the settings or the booklet once they are put away.
 */
function useMenuFocus(nav: RefObject<HTMLElement | null>, covered: boolean, last: PauseItem) {
  useEffect(() => {
    if (!covered) {
      nav.current
        ?.querySelector<HTMLButtonElement>(`[data-item="${last}"]`)
        ?.focus({ preventScroll: true });
    }
  }, [nav, covered, last]);
}

interface PauseMenuProps {
  phase: PausePhase;
  missionTitle: string;
  /** the settings or the booklet lie over it: it waits, inert, its keys theirs */
  covered: boolean;
  /** the item last taken, where the focus goes back to; „Weiter" as it opens */
  last: PauseItem;
  onPick: (item: PauseItem) => void;
  onClose: () => void;
}

/** The pause menu over a room: the mission's name, the items, and over a run the line under it. */
export function PauseMenu({ phase, missionTitle, covered, last, onPick, onClose }: PauseMenuProps) {
  const nav = useRef<HTMLElement>(null);
  useMenuKeys(nav, covered, onClose);
  useMenuFocus(nav, covered, last);
  return (
    <div
      className="overlay pause-menu"
      role="dialog"
      aria-modal="true"
      aria-label="Menü"
      inert={covered}
      onClick={onClose}
    >
      <nav ref={nav} className="pause-menu-panel menu-list" onClick={(e) => e.stopPropagation()}>
        <span className="kicker pause-menu-kicker">Menü</span>
        <h2 className="pause-menu-title">{missionTitle}</h2>
        <ul>
          {pauseItems(phase).map((item) => (
            <li key={item}>
              <button
                className="menu-item"
                data-item={item}
                onClick={() => {
                  uiSound('select');
                  onPick(item);
                }}
                onFocus={() => uiSound('hover')}
                onPointerEnter={() => uiSound('hover')}
              >
                <span className="menu-label">{PAUSE_LABELS[item]}</span>
              </button>
            </li>
          ))}
        </ul>
        {phase === 'run' && <p className="pause-menu-line">{RUN_GOES_ON}</p>}
      </nav>
    </div>
  );
}

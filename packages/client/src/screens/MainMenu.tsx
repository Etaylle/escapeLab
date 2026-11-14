import type { KeyboardEvent, ReactNode } from 'react';
import { uiSound } from '../world/menuSound.js';
import { stepTo } from './Lobby.js';

/** What the menu offers, item by item. */
export type MenuItemId =
  | 'missions'
  | 'join'
  | 'rounds'
  | 'handbook'
  | 'history'
  | 'myruns'
  | 'editor'
  | 'settings';

/** What each item says. */
export const MENU_LABELS: Readonly<Record<MenuItemId, string>> = {
  missions: 'Einsatz starten',
  join: 'Beitreten',
  rounds: 'Offene Runden',
  handbook: 'Handbuch',
  history: 'Bestenliste',
  myruns: 'Meine Einsätze',
  editor: 'Editor',
  settings: 'Einstellungen',
};

/** The items that open a panel of the menu's own (screens/MenuPanels.tsx), the rest a page. */
export type PanelId = Extract<MenuItemId, 'missions' | 'join' | 'rounds'>;

/** Whether `item` opens a panel over the menu. */
export function opensPanel(item: MenuItemId): item is PanelId {
  return item === 'missions' || item === 'join' || item === 'rounds';
}

/**
 * The menu's items in order, top to bottom: the account's runs beside the Bestenliste, the
 * editor where the page offers one.
 */
export function menuItems(editor: boolean): MenuItemId[] {
  return [
    'missions',
    'join',
    'rounds',
    'handbook',
    'history',
    'myruns',
    ...(editor ? (['editor'] as const) : []),
    'settings',
  ];
}

/**
 * Where an arrow key moves the focus among the menu's `count` controls from the one at `at`:
 * down and right to the next, up and left to the one before, round from the last to the first;
 * Home and End to the ends (Lobby.tsx `stepTo`). Null for any other key.
 */
export function menuStep(at: number, key: string, count: number): number | null {
  return count === 0 ? null : stepTo(Math.max(0, at), key, count);
}

/**
 * The controls an arrow key moves between in the menu: its buttons, the card's included — but
 * none the layout hides (menu.css, a phone held sideways).
 */
export function controlsIn(nav: Pick<HTMLElement, 'querySelectorAll'>): HTMLButtonElement[] {
  const buttons = [...nav.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  return buttons.filter((button) => button.getClientRects().length > 0);
}

/** An arrow key in the menu: the focus goes to the control it points at. */
function onArrow(e: KeyboardEvent<HTMLElement>): void {
  const controls = controlsIn(e.currentTarget);
  const at = controls.indexOf(e.target as HTMLButtonElement);
  const next = menuStep(at, e.key, controls.length);
  if (next === null) {
    return;
  }
  e.preventDefault();
  controls[next]?.focus();
}

interface MenuProps {
  items: readonly MenuItemId[];
  /** the card of where the browser's pass sits, the menu's first item and lit; null for none */
  card: ReactNode;
  /** a run binds the pass: every item but the card stands dimmed */
  dimmed: boolean;
  /** the rooms open or running now, counted beside „Offene Runden" */
  rooms: number;
  onPick: (item: MenuItemId) => void;
}

/**
 * The game's menu, one item under the next as a game's main menu stands: the card of a run that
 * binds the pass first, then every way on from here. The arrow keys move the focus between them
 * — a controller's D-pad does through the page (input/focus.ts) —, Enter, A or a click takes one.
 * A pointer over an item only glows it and ticks: the focus stays where it is, in the name being
 * typed as well, so that no Space or Enter meant for the name takes an item. An item focused
 * ticks, one taken clacks (world/menuSound.ts).
 */
export function MainMenu({ items, card, dimmed, rooms, onPick }: MenuProps) {
  return (
    <nav
      className={dimmed ? 'menu-list menu-list--bound' : 'menu-list'}
      aria-label="Hauptmenü"
      onKeyDown={onArrow}
    >
      {card}
      <ul>
        {items.map((id) => (
          <li key={id}>
            <button
              className="menu-item"
              data-item={id}
              onClick={() => {
                uiSound('select');
                onPick(id);
              }}
              onFocus={() => uiSound('hover')}
              onPointerEnter={() => uiSound('hover')}
            >
              <span className="menu-label">{MENU_LABELS[id]}</span>
              {id === 'rounds' && rooms > 0 && <span className="menu-count">{rooms}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

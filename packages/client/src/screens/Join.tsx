import { useEffect, useRef, useState, type RefObject } from 'react';
import type {
  AccountView,
  ClientMessage,
  CrewPass,
  MissionInfo,
  MissionStats,
  RoomSummary,
  Seat,
} from '@escapelab/core';
import { formatLeft } from '../clock.js';
import { useNow } from '../hooks.js';
import { crewPass, keepName, lastColor, lastName } from '../pass.js';
import { dropSnapshot, resumeOf } from '../snapshots.js';
import type { Restoring, Takeover } from '../ws.js';
import { GiveUpButton } from './GiveUp.js';
import { HttpsHint } from './HttpsHint.js';
import { InstallOffer } from './Install.js';
import { RESTORING_LINE, RESTORING_TITLE } from './Line.js';
import { MainMenu, menuItems, opensPanel, type MenuItemId, type PanelId } from './MainMenu.js';
import {
  arrivesOnInvite,
  inviteArrived,
  JoinPanel,
  MissionPanel,
  pickedMission,
  RoundsPanel,
  type SectionProps,
} from './MenuPanels.js';
import { MenuHero } from './MenuHero.js';
import { useComesOn } from './phosphor.js';
import { FIRST_COLOR, nameFromAccount, ProfileChip, WAVE_SETTLE_MS } from './ProfileChip.js';

interface Props {
  send: (msg: ClientMessage) => void;
  connected: boolean;
  missions: MissionInfo[];
  rooms: RoomSummary[];
  /**
   * where the browser's pass sits (`whereami`): its card stands first in the menu, and a run on
   * blocks every other room; null for nowhere
   */
  seat?: Seat | null;
  /** this device's ask for a seat by its name, waiting for the crew; null or left out for none */
  takeover?: Takeover | null;
  /** the pass's account as the server told it (ws.ts); null or left out before it did */
  account?: AccountView | null;
  /**
   * the room the card went back to, while the server waits to take it up again (ws.ts
   * `Restoring`); null or left out for none
   */
  restoring?: Restoring | null;
  /**
   * gives the seat up while the tab's own comeback waits for its room (`Restoring.comeback`), on
   * a socket of its own (ws.ts `Connection.giveUp`); the card gives it up on the line otherwise
   */
  giveUp?: () => void;
  /** the Bestenliste's runs, by mission */
  stats: MissionStats[];
  /** the mission picked to open a round for; null for none picked yet (`pickedMission`) */
  picked: string | null;
  /** picks a mission: its card is marked, and the scene behind the screen shows its lab */
  onPick: (missionId: string) => void;
  openHandbook: (missionId: string) => void;
  openHistory: (missionId: string) => void;
  /** opens „Meine Einsätze"; without it the menu's item leads nowhere */
  openMyRuns?: () => void;
  /** opens the mission editor; without it the menu offers none */
  openEditor?: () => void;
  /** opens the settings, as the gear in the top bar does; without it the menu offers none */
  openSettings?: () => void;
  /** opens the settings on „Konto"'s sign-in: the profile offers it without a Kennwort */
  openSignIn?: () => void;
  /** the menu goes for the lobby, the doors closing over it (DoorWipe.tsx); false by default */
  leaving?: boolean;
}

const REFRESH_MS = 2500;

/** The line under the game's title, in the world's voice: the sign at the plant's gate. */
export const MENU_SUBTITLE = 'Forschungsanlage Kaltenbrunn · Zutritt nur mit Dienstausweis';
/**
 * The line under the menu's items: how the game is played, in the plant's words — the machine
 * at the console, the rules in the book, and nothing solved but together, by voice.
 */
export const MENU_LEAD =
  'Am Pult die Maschine, im Buch die Regeln — gelöst wird nur gemeinsam, per Stimme, ' +
  'ein Gerät je Kopf, Rücken an Rücken.';

/** How long a typed name stands still before the account takes it, ms: as the figure waits. */
export const NAME_SETTLE_MS = WAVE_SETTLE_MS;

/**
 * The name field's text: starting with the name the pass keeps, kept again as it is typed, and
 * the account's name where nothing was typed yet (`nameFromAccount`). A name typed goes to the
 * account (`profile`) once it has stood still NAME_SETTLE_MS, where the line is up and the
 * account goes by another.
 */
function useProfileName(
  account: AccountView | null,
  send: Props['send'],
  connected: boolean,
): [string, (name: string) => void] {
  const [name, setName] = useState(() => lastName());
  const typed = useRef(false);
  const told = useRef<AccountView | null>(null);
  useEffect(() => {
    const next = nameFromAccount(account, told.current, typed.current);
    told.current = account;
    if (next !== null) {
      typed.current = false;
      setName(next);
    }
  }, [account]);
  useEffect(() => {
    const wanted = name.trim();
    if (!typed.current || !connected || account?.name === wanted) {
      return undefined;
    }
    const timer = setTimeout(
      () => send({ kind: 'profile', pass: crewPass(), name: wanted }),
      NAME_SETTLE_MS,
    );
    return () => clearTimeout(timer);
    // `send` is stable for the lifetime of the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, connected, account]);
  const type = (next: string): void => {
    typed.current = true;
    setName(next);
    keepName(next);
  };
  return [name, type];
}

/** What the device kept of its account: the name and the colour its next account starts with. */
export interface KeptProfile {
  name: string;
  color: string | null;
}

/**
 * What the join screen asks as it comes up, and again whenever the line is back: the rooms
 * there are, and where the browser's pass sits (`whereami`) — a run on binds it — with what the
 * device kept of its account, which an account made now starts with.
 */
export function doorAsks(pass: CrewPass, kept: KeptProfile): ClientMessage[] {
  const name = kept.name.trim();
  const whereami: ClientMessage = {
    kind: 'whereami',
    pass,
    ...(name === '' ? {} : { name }),
    ...(kept.color === null ? {} : { color: kept.color }),
  };
  return [{ kind: 'list-rooms' }, whereami];
}

/** The one line that says a run on holds the pass: no other room until it is over. */
export function boundLine(seat: Pick<Seat, 'missionTitle' | 'code'>): string {
  return `Gebunden an „${seat.missionTitle}“ in Raum ${seat.code} — neue Runden erst danach.`;
}

/**
 * What the card says over where the pass sits: its room on the way back (`onItsWay`), a run on,
 * or standing paused, or a lobby.
 */
function kickerOf(seat: Seat, onItsWay: boolean): string {
  if (onItsWay) {
    return RESTORING_TITLE;
  }
  if (seat.phase === 'lobby') {
    return 'IM RAUM';
  }
  return seat.paused ? 'EINSATZ PAUSIERT' : 'EINSATZ LÄUFT';
}

/** What the card says at `now` while its way back has waited for the room since `since`, ms. */
export function restoringLine(since: number, now: number): string {
  const waited = Math.max(0, Math.floor((now - since) / 1000));
  return `${RESTORING_LINE} · seit ${waited} s`;
}

/** The card's line while its way back waits for the room, the seconds counting up. */
function RestoringLine({ since }: { since: number }) {
  const now = useNow(250);
  return (
    <p className="bound-restoring" role="status">
      {restoringLine(since, now)}
    </p>
  );
}

/**
 * How the card gives its seat up: on the line, the snapshot kept of the room going with it — and
 * a card the server's word replaces — or as `instead` gives it up, where it is given.
 */
function wayOut(seat: Seat, send: Props['send'], instead: (() => void) | null): () => void {
  if (instead !== null) {
    return instead;
  }
  return () => {
    dropSnapshot(seat.code);
    send({ kind: 'abandon', code: seat.code, pass: crewPass() });
    send({ kind: 'whereami', pass: crewPass() });
  };
}

/**
 * Where the browser's pass sits, the menu's first item and lit (`Seat`): the mission, the room's
 * code, the crew and the clock as the server showed it, the way back and the way out — from a
 * run on „Einsatz aufgeben" at a second press, from a lobby as free as leaving it always was.
 * While the way back waits for the room (`waiting`), the card says for how long, and only the
 * way out is open — `giveUp`, where it is given; the game opens once the room is back.
 */
export function BoundCard({
  seat,
  send,
  waiting = null,
  giveUp = null,
}: {
  seat: Seat;
  send: Props['send'];
  waiting?: Restoring | null;
  giveUp?: (() => void) | null;
}) {
  const run = seat.phase === 'playing';
  const clock = seat.leftMs === null ? '' : ` · noch ${formatLeft(seat.leftMs)}`;
  const leave = wayOut(seat, send, giveUp);
  return (
    <section className={`bound${run ? ' bound--run' : ''}`}>
      <span className="kicker bound-kicker">{kickerOf(seat, waiting !== null)}</span>
      <h2 className="bound-title">{seat.missionTitle}</h2>
      <p className="bound-facts">
        Raum {seat.code}
        {clock} · {seat.crew.join(', ')}
      </p>
      {waiting !== null && <RestoringLine since={waiting.since} />}
      <div className="bound-actions">
        <button
          className="primary bound-back"
          disabled={waiting !== null}
          onClick={() => send(resumeOf(seat.code))}
        >
          {run ? 'Zurück zum Einsatz' : 'Zurück in den Raum'}
        </button>
        {run ? (
          <GiveUpButton onGiveUp={leave} />
        ) : (
          <button className="bound-leave" onClick={leave}>
            Raum verlassen
          </button>
        )}
      </div>
    </section>
  );
}

/** The card's way back waiting for its room: `restoring`, where it is of the card's room. */
function waitingOf(seat: Seat | null, restoring: Restoring | null): Restoring | null {
  return seat !== null && restoring?.code === seat.code ? restoring : null;
}

/**
 * The room the join screen is bound to: a run on binds the pass, and so does a room on its way
 * back to the card (`waiting`) — the card stands first, no other room opens; null for neither.
 */
export function boundTo(seat: Seat | null, waiting: Restoring | null): Seat | null {
  return seat?.phase === 'playing' || waiting !== null ? seat : null;
}

/**
 * How the card's seat is given up while the tab's own comeback waits for its room
 * (`Restoring.comeback`): by `giveUp`, on a socket of its own; null for the line as it is.
 */
function giveUpOf(
  waiting: Restoring | null,
  giveUp: (() => void) | undefined,
): (() => void) | null {
  return waiting?.comeback === true && giveUp !== undefined ? giveUp : null;
}

/**
 * Keeps the room browser fresh while nobody has joined anything yet; where the pass sits is
 * asked as the screen comes up, and again whenever the line is back.
 */
function useDoor(send: Props['send'], connected: boolean): void {
  useEffect(() => {
    if (!connected) {
      return undefined;
    }
    for (const ask of doorAsks(crewPass(), { name: lastName(), color: lastColor() })) {
      send(ask);
    }
    const timer = setInterval(() => send({ kind: 'list-rooms' }), REFRESH_MS);
    return () => clearInterval(timer);
    // `send` is stable for the lifetime of the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);
}

/**
 * The panel the menu opens on as it comes up: „Beitreten" for the page's invite, its code
 * filled in — the first menu of the page alone (MenuPanels.tsx `arrivesOnInvite`).
 */
export function panelOnArrival(): PanelId | null {
  return arrivesOnInvite() ? 'join' : null;
}

/**
 * Where the focus goes in the menu: on the name while there is none to sit down under; else on
 * the item last taken — the run's way back or the first item where none was.
 */
export function focusMenu(
  root: Pick<HTMLElement, 'querySelector'> | null,
  item: MenuItemId | null,
  named: boolean,
): void {
  const at = item === null ? '.bound-back:not([disabled]), .menu-item' : `[data-item="${item}"]`;
  root?.querySelector<HTMLElement>(named ? at : '.profile-name')?.focus({ preventScroll: true });
}

/**
 * The menu's panel (screens/MenuPanels.tsx): the one open, opened from its item, and closed
 * again with the focus back on that item. As the menu comes up — the page loaded, the
 * Bestenliste or the booklet put away — the focus stands where `focusMenu` says.
 */
function usePanel(root: RefObject<HTMLElement | null>, named: boolean) {
  const [panel, setPanel] = useState<PanelId | null>(panelOnArrival);
  // The menu has come up on the invite: no other menu of this page opens on it again.
  useEffect(() => inviteArrived(), []);
  const last = useRef<MenuItemId | null>(null);
  const isNamed = useRef(named);
  isNamed.current = named;
  useEffect(() => {
    if (panel === null) {
      focusMenu(root.current, last.current, isNamed.current);
    }
  }, [panel, root]);
  return {
    panel,
    take: (item: MenuItemId): void => {
      last.current = item;
      if (opensPanel(item)) {
        setPanel(item);
      }
    },
    close: (): void => setPanel(null),
  };
}

/**
 * The ways the menu's items lead off it to a page of its own: the booklet and the Bestenliste of
 * the mission `selected`, the account's runs, the editor, the settings.
 */
export function pagesOf(
  props: Pick<
    Props,
    'openHandbook' | 'openHistory' | 'openMyRuns' | 'openEditor' | 'openSettings'
  >,
  selected: string | null,
): Partial<Record<MenuItemId, () => void>> {
  const { openHandbook, openHistory, openMyRuns, openEditor, openSettings } = props;
  return {
    ...(selected === null
      ? {}
      : { handbook: () => openHandbook(selected), history: () => openHistory(selected) }),
    ...(openMyRuns === undefined ? {} : { myruns: openMyRuns }),
    ...(openEditor === undefined ? {} : { editor: openEditor }),
    ...(openSettings === undefined ? {} : { settings: openSettings }),
  };
}

/** The panel open over the menu, if any. */
function Panels({
  panel,
  close,
  section,
  props,
  waiting,
}: {
  panel: PanelId | null;
  close: () => void;
  section: SectionProps;
  props: Props;
  waiting: boolean;
}) {
  if (panel === 'missions') {
    const { missions, stats, picked, onPick } = props;
    const missionProps = { missions, stats, picked, onPick };
    return <MissionPanel {...section} {...missionProps} onClose={close} />;
  }
  if (panel === 'join') {
    const takeover = props.takeover ?? null;
    return <JoinPanel {...section} takeover={takeover} waiting={waiting} onClose={close} />;
  }
  if (panel === 'rounds') {
    return (
      <RoundsPanel {...section} rooms={props.rooms} missions={props.missions} onClose={close} />
    );
  }
  return null;
}

/**
 * The colour the profile shows (ProfileChip.tsx), which the hero wears: the account's, the one
 * the pass kept from a lobby before the server told one, the crew's first before any.
 */
function profileColor(account: AccountView | null): string {
  return account?.color ?? lastColor() ?? FIRST_COLOR;
}

/**
 * The start screen as a game's main menu: the game's title over the living scene of the
 * mission picked (screens/MenuScene.tsx) and a line of the world under it, the profile at the
 * top right, the player's own figure standing large at the right (screens/MenuHero.tsx), and
 * the menu — the card of where the pass sits first, then „Einsatz starten", „Beitreten",
 * „Offene Runden", the booklet, the Bestenliste, „Meine Einsätze", the editor and the settings
 * — the install offer and the HTTPS hint as quiet lines under it. An item with a panel opens it
 * over the menu (MenuPanels.tsx), the rest open their page. A run that binds the pass dims every
 * item but its card, and one line says why no other room opens.
 */
export function JoinScreen(props: Props) {
  const { send, connected, missions, rooms, seat = null, restoring = null } = props;
  const account = props.account ?? null;
  const [name, setName] = useProfileName(account, send, connected);
  const root = useRef<HTMLDivElement>(null);
  const { panel, take, close } = usePanel(root, name.trim() !== '');
  const comesOn = useComesOn('start');
  const waiting = waitingOf(seat, restoring);
  const bound = boundTo(seat, waiting);
  useDoor(send, connected);
  const section = { send, connected, name: name.trim(), blocked: bound !== null };
  const pages = pagesOf(props, pickedMission(missions, props.picked));
  const card = seat !== null && (
    <BoundCard
      seat={seat}
      send={send}
      waiting={waiting}
      giveUp={giveUpOf(waiting, props.giveUp)}
    />
  );
  return (
    <div className="menu" ref={root}>
      <header className="menu-head">
        <h1 className={comesOn ? 'menu-title phosphor-title' : 'menu-title'}>ESCAPELAB</h1>
        <p className="menu-sub">{MENU_SUBTITLE}</p>
      </header>
      <ProfileChip
        name={name}
        onName={setName}
        account={account}
        {...(props.openSignIn === undefined ? {} : { onSignIn: props.openSignIn })}
      />
      <MenuHero
        name={name}
        color={profileColor(account)}
        panel={panel !== null}
        card={seat !== null}
        leaving={props.leaving === true}
      />
      <div className="menu-body" inert={panel !== null}>
        <MainMenu
          items={menuItems(props.openEditor !== undefined)}
          card={card}
          dimmed={bound !== null}
          rooms={rooms.length}
          onPick={(item) => {
            take(item);
            pages[item]?.();
          }}
        />
        <p className="menu-lead">{MENU_LEAD}</p>
        {bound !== null && <p className="bound-line">{boundLine(bound)}</p>}
        <div className="menu-quiet">
          <InstallOffer />
          <HttpsHint />
        </div>
      </div>
      <Panels
        panel={panel}
        close={close}
        section={section}
        props={props}
        waiting={waiting !== null}
      />
    </div>
  );
}

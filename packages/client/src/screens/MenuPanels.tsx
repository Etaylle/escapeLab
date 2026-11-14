import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  SEED_MAX,
  type ClientMessage,
  type CrewPass,
  type Difficulty,
  type MissionInfo,
  type MissionStats,
  type RoomSummary,
} from '@escapelab/core';
import { sessionStore } from '../editor/session.js';
import { FIRST_RUN_HINT, firstDifficulty, isTutorial, useWon } from '../firstRun.js';
import { useServerNow } from '../hooks.js';
import { crewPass, lastColor } from '../pass.js';
import { recordLine } from '../runStats.js';
import { keepInvite, tabInvite } from '../tab.js';
import type { Takeover } from '../ws.js';
import { uiSound } from '../world/menuSound.js';
import { crewSizeText } from './Crew.js';
import { CrewFigure } from './CrewFigure.js';
import { Icon } from './Icon.js';
import { MapThumb } from './MapThumb.js';
import { pauseClock } from './Pause.js';

/**
 * The menu's panels (screens/Join.tsx): each slides over the menu as a dialog of its own, its
 * title over it and „Zurück" beside — Esc or a controller's B steps back out of it. „Einsatz
 * starten" picks a mission and opens a round for it, „Beitreten" joins or watches a round by
 * its code, „Offene Runden" lists every room somebody sits in, its crew standing there.
 */

/** The colour a seat is asked to wear: the account's, as the pass keeps it; none before one. */
const wearing = (color: string | null): { color?: string } => (color === null ? {} : { color });

/** The seed `?seed=<n>` in the page's address (`search`) pins: a whole number to SEED_MAX. */
function seedOf(search: string): number | null {
  const asked = new URLSearchParams(search).get('seed') ?? '';
  return /^\d{1,10}$/.test(asked) && Number(asked) <= SEED_MAX ? Number(asked) : null;
}

/**
 * The message that opens a room for `missionId`, or for the server's first
 * mission where none is picked, on `difficulty` where one is given — a first
 * run's „entspannt" (firstRun.ts) — and on normal where not, its seat bound to
 * `pass` and in `color`, the account's, where given. A tester pins the room to a
 * seed with `?seed=<n>` in the page's address (`search`), so that its runs
 * repeat; a value that is no whole number from 0 to SEED_MAX is left out, and
 * the lobby then shows no seed.
 */
export function createRoomMessage(
  pass: CrewPass,
  name: string,
  missionId: string | null,
  search: string,
  difficulty: Difficulty | null = null,
  color: string | null = null,
): ClientMessage {
  const seed = seedOf(search);
  return {
    kind: 'create-room',
    name,
    pass,
    ...wearing(color),
    ...(missionId === null ? {} : { missionId }),
    ...(seed === null ? {} : { seed }),
    ...(difficulty === null ? {} : { difficulty }),
  };
}

/**
 * The message that joins room `code` as `name`, its seat bound to the browser's pass and in the
 * colour its account wears.
 */
export function joinMessage(code: string, name: string): ClientMessage {
  return { kind: 'join-room', code, name, pass: crewPass(), ...wearing(lastColor()) };
}

/** The row the older maps wait behind on the mission panel. */
export const PROTOTYPES_ROW = 'Prototypen (ältere Karten)';

/** Whether a mission is an older map kept on (`Mission['stage']`). */
function isPrototype(mission: Pick<MissionInfo, 'stage'>): boolean {
  return mission.stage === 'prototype';
}

/**
 * The mission a round opens for: the one `picked` where the server has it, else the first
 * current mission — the panel's first card — else the first of all; null while there are none.
 */
export function pickedMission(
  missions: readonly Pick<MissionInfo, 'id' | 'stage'>[],
  picked: string | null,
): string | null {
  const known = missions.some((m) => m.id === picked) ? picked : null;
  return known ?? missions.find((m) => !isPrototype(m))?.id ?? missions[0]?.id ?? null;
}

/** Where the tab keeps the mission picked last. */
export const PICKED_KEY = 'escapelab.menu.picked';

/** The mission this tab picked last; null for none, or where the tab keeps nothing. */
export function keptPick(): string | null {
  try {
    return sessionStore()?.getItem(PICKED_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Keeps `missionId` as this tab's pick. */
function keepPick(missionId: string): void {
  try {
    sessionStore()?.setItem(PICKED_KEY, missionId);
  } catch {
    // Deliberately silent: without it the menu comes back on its first mission.
  }
}

/**
 * The mission picked on the join screen, kept in the tab — so that its card and its lab behind
 * the menu come back as leaving a lobby loads the page anew — and what picks another.
 */
export function usePicked(): [string | null, (missionId: string) => void] {
  const [picked, setPicked] = useState<string | null>(keptPick);
  const pick = useCallback((missionId: string): void => {
    keepPick(missionId);
    setPicked(missionId);
  }, []);
  return [picked, pick];
}

/** What a panel that seats the browser's pass needs of the menu. */
export interface SectionProps {
  send: (msg: ClientMessage) => void;
  connected: boolean;
  /** the name as typed, trimmed: nothing goes out under an empty one */
  name: string;
  /** a run on binds the pass: no room opens or takes it till it is over */
  blocked: boolean;
}

/** Whether a panel may sit the pass down: on the line, a name typed, no run binding it. */
function sitsDown({ connected, name, blocked }: SectionProps): boolean {
  return connected && name !== '' && !blocked;
}

/** The line a panel shows while no name is typed: where it goes. */
export const NAME_MISSING = 'Zum Beitreten einen Namen im Profil eintragen.';

/**
 * What Esc does to a panel (`keydown` on the window, as a controller's B sends it too): steps
 * back out of it — once, where nothing over it has taken the key already, as the settings do.
 */
export function escapeHandler(close: () => void): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      close();
    }
  };
}

/** Esc steps back out of the panel wherever the focus stands. */
function useEscape(close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    const onKey = escapeHandler(() => latest.current());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * A panel over the menu: a dialog with its title and the way back — Esc, B or „Zurück", a
 * detent's click as it goes (world/menuSound.ts). It takes the focus as it comes up: what it
 * marks `data-focus`, else the way back.
 */
export function MenuPanel({
  title,
  className,
  onClose,
  children,
}: {
  title: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const heading = useId();
  const panel = useRef<HTMLElement>(null);
  const back = (): void => {
    uiSound('back');
    onClose();
  };
  useEscape(back);
  useEffect(() => {
    const marked = panel.current?.querySelector<HTMLElement>('[data-focus]');
    (marked ?? panel.current?.querySelector<HTMLElement>('.menu-back'))?.focus({
      preventScroll: true,
    });
  }, []);
  return (
    <section
      ref={panel}
      className={`menu-panel ${className}`}
      role="dialog"
      aria-labelledby={heading}
    >
      <header className="menu-panel-head">
        <h2 id={heading}>{title}</h2>
        <button className="menu-back" onClick={back}>
          Zurück
        </button>
      </header>
      {children}
    </section>
  );
}

/**
 * One mission to pick: its map, its name and one line of facts; the picked
 * one spells out its subtitle too. Once the mission has been played, a line
 * says its best time and win rate. The tutorial's card says „Erster Einsatz?
 * Hier starten" in a line of its own while this device has seen no run won
 * (`first`).
 */
export function MissionCard({
  mission,
  stats,
  selected,
  first,
  onSelect,
}: {
  mission: MissionInfo;
  stats: MissionStats | undefined;
  selected: boolean;
  first: boolean;
  onSelect: () => void;
}) {
  const record = recordLine(stats?.difficulties ?? []);
  return (
    <button
      className={`mission ${selected ? 'mission-selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
      {...(selected ? { 'data-focus': true } : {})}
    >
      <MapThumb tiles={mission.tiles} height={64} />
      <span className="mission-text">
        {first && <span className="mission-first">{FIRST_RUN_HINT}</span>}
        <span className="mission-title">{mission.title}</span>
        <span className="mission-meta">
          {crewSizeText(mission.players)} · {Math.round(mission.timeLimitSec / 60)} min ·{' '}
          {mission.puzzleCount} Stationen
        </span>
        {selected && <span className="mission-sub">{mission.subtitle}</span>}
        {record !== null && <span className="mission-record">{record}</span>}
      </span>
    </button>
  );
}

/**
 * The older maps kept on, behind a row of their own after the mission cards, collapsed: one
 * muted line each — its name and its facts — the picked one marked. Nothing without any.
 */
export function Prototypes({
  missions,
  selected,
  onSelect,
}: {
  missions: MissionInfo[];
  selected: string | null;
  onSelect: (missionId: string) => void;
}) {
  if (missions.length === 0) {
    return null;
  }
  return (
    <details className="mission-prototypes">
      <summary>{PROTOTYPES_ROW}</summary>
      <ul>
        {missions.map((m) => {
          const picked = m.id === selected;
          return (
            <li key={m.id}>
              <button
                className={picked ? 'mission-proto mission-proto-selected' : 'mission-proto'}
                aria-pressed={picked}
                onClick={() => onSelect(m.id)}
              >
                <span className="mission-proto-title">{m.title}</span> ·{' '}
                {crewSizeText(m.players)} · {Math.round(m.timeLimitSec / 60)} min ·{' '}
                {m.puzzleCount} Stationen
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** What the mission panel needs beside the pass's section. */
interface MissionPanelProps extends SectionProps {
  missions: MissionInfo[];
  /** the Bestenliste's runs, by mission: each card says its record */
  stats: MissionStats[];
  picked: string | null;
  onPick: (missionId: string) => void;
  onClose: () => void;
}

/**
 * „Einsatz starten": every current mission as a card — the tutorial's pointing a first crew at
 * it — the prototypes in a collapsed row after them, and „Runde eröffnen" for the one picked
 * (the first card until another is), on the first-run difficulty where this device has won no
 * run yet (firstRun.ts); the difficulty itself is the lobby's to choose.
 */
export function MissionPanel({
  missions,
  stats,
  picked,
  onPick,
  onClose,
  ...section
}: MissionPanelProps) {
  const won = useWon();
  const current = missions.filter((m) => !isPrototype(m));
  const selected = pickedMission(missions, picked);
  const open = (): void =>
    section.send(
      createRoomMessage(
        crewPass(),
        section.name,
        selected,
        window.location.search,
        firstDifficulty(won),
        lastColor(),
      ),
    );
  return (
    <MenuPanel title="Einsatz starten" className="menu-panel--missions" onClose={onClose}>
      {missions.length > 0 ? (
        <>
          <div className="mission-grid">
            {current.map((m) => (
              <MissionCard
                key={m.id}
                mission={m}
                stats={stats.find((s) => s.missionId === m.id)}
                selected={selected === m.id}
                first={!won && isTutorial(m)}
                onSelect={() => onPick(m.id)}
              />
            ))}
          </div>
          <Prototypes
            missions={missions.filter(isPrototype)}
            selected={selected}
            onSelect={onPick}
          />
        </>
      ) : (
        <p className="muted">Lade Missionen …</p>
      )}
      <div className="menu-panel-actions">
        <button className="primary" disabled={!sitsDown(section)} onClick={open}>
          Runde eröffnen
        </button>
        {section.name === '' && <span className="muted">{NAME_MISSING}</span>}
      </div>
    </MenuPanel>
  );
}

/**
 * This device's ask for a seat, waiting for the crew on the line to let it in: on the clock,
 * and gone once its time is up — an ask whose answer never came, its line dropped, says no more.
 */
function TakeoverWait({ takeover }: { takeover: Takeover }) {
  const now = useServerNow(250);
  if (now > takeover.until) {
    return null;
  }
  return (
    <p className="takeover-wait" role="status">
      Warten, bis die Crew die Übernahme von {takeover.name} bestätigt ·{' '}
      <span className="pause-count">{pauseClock(takeover.until - now)}</span>
    </p>
  );
}

/** A room's code as typed: in capitals, nothing but its letters and digits. */
export function codeOf(typed: string): string {
  return typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** An invite's code as the page took it, and whether a menu has come up on it already. */
interface Invite {
  readonly code: string;
  arrived: boolean;
}

/** The invite each address was read for — one a page, its `location` the key. */
const invites = new WeakMap<object, Invite>();

/** Takes `?room=` off the address at once (history.replaceState), the rest of the query kept. */
function stripRoom(params: URLSearchParams): void {
  const { pathname, hash } = window.location;
  params.delete('room');
  const rest = params.toString();
  const address = `${pathname}${rest === '' ? '' : `?${rest}`}${hash}`;
  window.history.replaceState(window.history.state, '', address);
}

/**
 * The page's invite: the room an invite link names in `?room=`, taken off the address at once —
 * no address the page shows or is copied from carries it on — and kept in the tab until it has
 * joined a room (tab.ts `keepInvite`), so that a reload before joining finds it again; else the
 * one the tab kept. Once joined, a reload — leaving a lobby, a finished run — finds none.
 */
function readInvite(): Invite {
  const params = new URLSearchParams(window.location.search);
  const named = codeOf(params.get('room') ?? '');
  if (params.has('room')) {
    stripRoom(params);
  }
  if (named !== '') {
    keepInvite(named);
  }
  return { code: named === '' ? (tabInvite() ?? '') : named, arrived: false };
}

/** The invite this page came with: read once, the address cleaned as it is. */
function inviteOfPage(): Invite {
  const known = invites.get(window.location) ?? readInvite();
  invites.set(window.location, known);
  return known;
}

/** The code of the page's invite, as typed, for as long as the page lives; '' for none. */
function invitedCode(): string {
  return inviteOfPage().code;
}

/** Whether the menu comes up on the invite: the page has one, and no menu came up on it yet. */
export function arrivesOnInvite(): boolean {
  const invite = inviteOfPage();
  return invite.code !== '' && !invite.arrived;
}

/** A menu has come up on the invite: none does so again while the page lives. */
export function inviteArrived(): void {
  inviteOfPage().arrived = true;
}

/**
 * The code field: a room's code, typed in capitals, which no browser takes for a password or a
 * one-time code — no autofill, no password manager's key over it, no correction.
 */
function CodeField({ code, onCode }: { code: string; onCode: (code: string) => void }) {
  return (
    <input
      className="join-code"
      value={code}
      onChange={(e) => onCode(codeOf(e.target.value))}
      maxLength={10}
      placeholder="z. B. QX7R"
      aria-label="Raumcode"
      name="room"
      type="text"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="characters"
      spellCheck={false}
      enterKeyHint="go"
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
      data-focus
    />
  );
}

/** What the join panel needs beside the pass's section. */
interface JoinPanelProps extends SectionProps {
  /** this device's ask for a seat by its name, waiting for the crew; null for none */
  takeover: Takeover | null;
  /** the card's way back waits for its room: no other room is watched either */
  waiting: boolean;
  onClose: () => void;
}

/**
 * „Beitreten": a room's code to join or to watch it by. An invite link carries the room in
 * ?room=, so the field is already filled — each time the panel opens while the page lives — and
 * all that is left to do is the name. A join by the name of a seat in a run on waits for the
 * crew to let this device in (`takeover`). While the card's way back waits for its room
 * (`waiting`), no other room is watched either: the server seats the page once the room is back.
 */
export function JoinPanel({ takeover, waiting, onClose, ...section }: JoinPanelProps) {
  const { send, connected, name } = section;
  const [code, setCode] = useState(invitedCode);
  return (
    <MenuPanel title="Beitreten" className="menu-panel--join" onClose={onClose}>
      <p className="muted">Für eine verabredete Runde: der Code des Raums.</p>
      <div className="join-with-code">
        <CodeField code={code} onCode={setCode} />
        <button
          className="primary"
          disabled={!sitsDown(section) || code === ''}
          onClick={() => send(joinMessage(code, name))}
        >
          Beitreten
        </button>
        <button
          disabled={!connected || waiting || code === ''}
          onClick={() => send({ kind: 'spectate', code })}
        >
          <Icon name="eye" /> Zuschauen
        </button>
      </div>
      {takeover !== null && <TakeoverWait takeover={takeover} />}
      {name === '' && <p className="muted">{NAME_MISSING}</p>}
    </MenuPanel>
  );
}

/** One of a room's crew: their figure in their colour, idling, and their name under it. */
function Member({ code, member }: { code: string; member: RoomSummary['players'][number] }) {
  return (
    <span className={member.connected ? 'room-member' : 'room-member offline'}>
      <CrewFigure
        id={`${code}:${member.name}`}
        color={member.color}
        facing="front"
        isYou={false}
        connected={member.connected}
        mood="play"
      />
      <span className="room-member-name">{member.name}</span>
    </span>
  );
}

/** One open or running room in the list: its map, its facts, its crew standing, its ways in. */
function RoomRow({
  room,
  tiles,
  canJoin,
  onJoin,
  onWatch,
}: {
  room: RoomSummary;
  tiles: string[];
  canJoin: boolean;
  onJoin: () => void;
  onWatch: () => void;
}) {
  const running = room.phase !== 'lobby';
  return (
    <li className={`room ${running ? 'room-running' : ''}`}>
      <MapThumb tiles={tiles} height={48} />
      <div className="room-main">
        <span className="room-title">{room.missionTitle}</span>
        <span className="room-meta">
          <Icon name="crew" /> {room.players.length}/{room.capacity} ·{' '}
          {running && (
            <>
              <Icon name="play" /> läuft gerade ·{' '}
            </>
          )}
          {room.difficulty} · Code {room.code}
        </span>
        <span className="room-crew">
          {room.players.map((p) => (
            <Member key={p.name} code={room.code} member={p} />
          ))}
          {room.players.length === 0 && <span className="muted">noch niemand da</span>}
        </span>
      </div>
      {running || room.free === 0 ? (
        <button onClick={onWatch} disabled={!running}>
          <Icon name="eye" /> Zuschauen
        </button>
      ) : (
        <button className="primary" onClick={onJoin} disabled={!canJoin}>
          Beitreten
        </button>
      )}
    </li>
  );
}

/** What the open rounds' panel needs beside the pass's section. */
interface RoundsPanelProps extends SectionProps {
  rooms: RoomSummary[];
  missions: MissionInfo[];
  onClose: () => void;
}

/** „Offene Runden": every room somebody sits in, its crew standing there, to join or to watch. */
export function RoundsPanel({ rooms, missions, onClose, ...section }: RoundsPanelProps) {
  const { send, name } = section;
  return (
    <MenuPanel title="Offene Runden" className="menu-panel--rounds" onClose={onClose}>
      {rooms.length === 0 ? (
        <p className="muted">
          Gerade läuft nichts — eine Runde, die über „Einsatz starten“ eröffnet wird, taucht hier
          für alle auf.
        </p>
      ) : (
        <ul className="rooms">
          {rooms.map((room) => (
            <RoomRow
              key={room.code}
              room={room}
              tiles={missions.find((m) => m.id === room.missionId)?.tiles ?? []}
              canJoin={sitsDown(section)}
              onJoin={() => send(joinMessage(room.code, name))}
              onWatch={() => send({ kind: 'spectate', code: room.code })}
            />
          ))}
        </ul>
      )}
      {rooms.length > 0 && name === '' && <p className="muted">{NAME_MISSING}</p>}
    </MenuPanel>
  );
}

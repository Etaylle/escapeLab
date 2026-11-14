import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, MissionInfo, Seat } from '@escapelab/core';
import { PASS_KEY } from '../src/pass.js';
import { SNAPSHOT_KEY } from '../src/snapshots.js';
import { useGameConnection, type Restoring } from '../src/ws.js';
import { CONFIRM_MS, giveUpPress } from '../src/screens/GiveUp.js';
import {
  BoundCard,
  boundLine,
  boundTo,
  doorAsks,
  JoinScreen,
  restoringLine,
  seatLeft,
} from '../src/screens/Join.js';
import { MissionPanel } from '../src/screens/MenuPanels.js';
import { storage } from './page.js';
import { buttonsOf, elementsOf, press } from './probe.js';

const noop = (): void => undefined;

/** Ben's browser and its pass, his name kept with it. */
const PASS = { id: 'b3'.repeat(16), secret: '7e'.repeat(32) };

/**
 * Ben's browser, opened on an invite to room ABCD: the code field filled; it keeps `more` beside
 * his pass, by key, and what it keeps is handed back.
 */
function stubWindow(more: [string, string][] = []): Map<string, string> {
  const kept = new Map([[PASS_KEY, JSON.stringify({ ...PASS, name: 'Ben' })], ...more]);
  vi.stubGlobal('window', {
    location: { search: '?room=ABCD', pathname: '/', hash: '' },
    // The invite is taken off the address as the menu reads it.
    history: { state: null, replaceState: noop },
    localStorage: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: noop,
      removeItem: (key: string) => void kept.delete(key),
    },
  });
  return kept;
}

const blackout: MissionInfo = {
  id: 'blackout',
  title: 'Blackout im Labor',
  subtitle: 'Für zwei oder drei.',
  players: { min: 2, max: 3 },
  timeLimitSec: 900,
  puzzleCount: 6,
  tiles: ['###', '#.#', '###'],
};

/** Ben's seat in Blackout's run, its clock at 12:34. */
const RUN: Seat = {
  code: 'QX7R',
  missionTitle: 'Blackout im Labor',
  phase: 'playing',
  paused: false,
  crew: ['Anna', 'Ben', 'Cem'],
  leftMs: 754_000,
};

const LOBBY: Seat = { ...RUN, phase: 'lobby', leftMs: null };

const T0 = 1_700_000_000_000;

function joinScreen(
  seat: Seat | null,
  send: (msg: ClientMessage) => void = noop,
  restoring: Restoring | null = null,
  giveUp?: () => void,
) {
  return (
    <JoinScreen
      send={send}
      connected
      name="Ben"
      onName={noop}
      missions={[blackout]}
      rooms={[]}
      seat={seat}
      restoring={restoring}
      {...(giveUp === undefined ? {} : { giveUp })}
      stats={[]}
      picked={null}
      onPick={noop}
      openHandbook={noop}
      openHistory={noop}
    />
  );
}

/** Whether each button of `elements` labelled one of `labels` can be pressed, by label. */
function pressable(elements: ReturnType<typeof elementsOf>, labels: string[]) {
  return Object.fromEntries(
    labels.map((label) => {
      const button = elements.find(
        (element) =>
          element.type === 'button' &&
          renderToStaticMarkup(<>{element.props['children'] as never}</>).endsWith(label),
      );
      return [label, button === undefined ? 'missing' : button.props['disabled'] !== true];
    }),
  );
}

/** The ways into a room of the menu's „Beitreten", open on the invite's code. */
const ROOM_BUTTONS = ['Beitreten', 'Zuschauen'];

/** Whether „Runde eröffnen" can be pressed in the mission panel for the pass as `seat` binds it. */
function opensRound(seat: Seat | null, restoring: Restoring | null = null): boolean {
  const blocked = boundTo(seat, seat !== null && restoring?.code === seat.code ? restoring : null);
  const elements = elementsOf(() => (
    <MissionPanel
      send={noop}
      connected
      name="Ben"
      field={{ typed: 'Ben', onName: noop }}
      blocked={blocked !== null}
      missions={[blackout]}
      stats={[]}
      picked={null}
      onPick={noop}
      onClose={noop}
    />
  ));
  return pressable(elements, ['Runde eröffnen'])['Runde eröffnen'] === true;
}

describe('the join screen of a pass bound to a run', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens on the run’s card as the menu’s first item, every other item dimmed', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(RUN));
    expect(html).toContain('<span class="kicker bound-kicker">EINSATZ LÄUFT</span>');
    expect(html).toContain('<h2 class="bound-title">Blackout im Labor</h2>');
    expect(html).toContain('Raum QX7R · noch 12:34 · Anna, Ben, Cem');
    expect(html).toContain('Zurück zum Einsatz');
    expect(html).not.toContain('Raum verlassen');
    const menu = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    expect(menu).toMatch(/^<nav class="menu-list menu-list--bound" aria-label="Hauptmenü">/);
    expect(menu.indexOf('class="bound bound--run"')).toBeGreaterThan(-1);
    const firstItem = menu.indexOf('class="menu-item"');
    expect(menu.indexOf('class="bound bound--run"')).toBeLessThan(firstItem);
  });

  it('says a run standing still for the server’s maintenance so, and its clock as it stood', () => {
    const card = <BoundCard seat={{ ...RUN, paused: true }} send={noop} onBack={noop} />;
    const html = renderToStaticMarkup(card);
    expect(html).toContain('<span class="kicker bound-kicker">WARTUNG</span>');
    expect(html).toContain('noch 12:34');
  });

  it('says a run held for nobody on the line so: it goes on as the first is back', () => {
    const held = { ...RUN, paused: true, nobodyOnLine: true as const };
    const html = renderToStaticMarkup(<BoundCard seat={held} send={noop} onBack={noop} />);
    expect(html).toContain(
      '<span class="kicker bound-kicker">WARTUNG · NIEMAND AUF DER LEITUNG</span>',
    );
    expect(html).toContain('noch 12:34');
  });

  it('counts the clock down from the server’s answer as the run goes on, whoever is away', () => {
    expect(seatLeft(754_000, false, T0, T0)).toBe(754_000);
    expect(seatLeft(754_000, false, T0, T0 + 4_500)).toBe(749_500);
    expect(seatLeft(3_000, false, T0, T0 + 9_000)).toBe(0);
    // A clock read a millisecond before the answer was noted gives no time back.
    expect(seatLeft(754_000, false, T0 + 1, T0)).toBe(754_000);
    // Standing still for the server's maintenance, it stays where the server said.
    expect(seatLeft(754_000, true, T0, T0 + 4_500)).toBe(754_000);
  });

  it('shows the server’s clock however the page’s ticks between its two reads of it', () => {
    // Every read of the page's clock a millisecond after the one before: the card's clock is
    // read before the server's answer is noted.
    let tick = T0;
    const reads = vi.spyOn(Date, 'now').mockImplementation(() => tick++);
    const html = renderToStaticMarkup(<BoundCard seat={RUN} send={noop} onBack={noop} />);
    reads.mockRestore();
    expect(tick).toBeGreaterThan(T0 + 1);
    expect(html).toContain('Raum QX7R · noch 12:34 · Anna, Ben, Cem');
  });

  it('blocks every other room with one line that names the run', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(RUN));
    expect(boundLine(RUN)).toBe(
      'Gebunden an „Blackout im Labor“ in Raum QX7R — neue Runden erst danach.',
    );
    expect(html.split('class="bound-line"')).toHaveLength(2);
    expect(html).toContain('Gebunden an „Blackout im Labor“ in Raum QX7R');
    const elements = elementsOf(() => joinScreen(RUN));
    expect(pressable(elements, ROOM_BUTTONS)).toEqual({ Beitreten: false, Zuschauen: true });
    expect(opensRound(RUN)).toBe(false);
  });

  it('gives the run up only at a second press, the first asking', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(RUN));
    expect(html).toContain('<button class="danger give-up">Einsatz aufgeben</button>');
    expect(giveUpPress(null, T0)).toBe('ask');
    expect(giveUpPress(T0, T0 + CONFIRM_MS - 1)).toBe('confirm');
    expect(giveUpPress(T0, T0 + CONFIRM_MS)).toBe('ask');
  });

  it('takes the hero’s beat as it goes back, before the doors close for the room', () => {
    stubWindow();
    const sent: ClientMessage[] = [];
    const onBack = vi.fn();
    const elements = elementsOf(() => (
      <BoundCard seat={RUN} send={(msg) => sent.push(msg)} onBack={onBack} />
    ));
    press(buttonsOf(elements, 'bound-back')[0]);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ kind: 'resume', code: 'QX7R', pass: PASS }]);
  });

  it('goes back to the run on the browser’s pass', () => {
    stubWindow();
    const sent: ClientMessage[] = [];
    const elements = elementsOf(() => joinScreen(RUN, (msg) => sent.push(msg)));
    press(buttonsOf(elements, 'bound-back')[0]);
    expect(sent).toEqual([{ kind: 'resume', code: 'QX7R', pass: PASS }]);
  });

  it('goes back with the snapshot the browser keeps of the room', () => {
    const blob = 'v1.bm9uY2Vub25jZW5v.c2VhbGVk';
    stubWindow([[`${SNAPSHOT_KEY}QX7R`, JSON.stringify({ blob, seq: 7, at: T0, seat: RUN })]]);
    const sent: ClientMessage[] = [];
    const elements = elementsOf(() => joinScreen(RUN, (msg) => sent.push(msg)));
    press(buttonsOf(elements, 'bound-back')[0]);
    expect(sent).toEqual([{ kind: 'resume', code: 'QX7R', pass: PASS, blob }]);
  });
});

describe('the join screen of a pass in a lobby', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the lobby’s card first, the menu open as ever, and leaves it at a press', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(LOBBY));
    expect(html).toContain('IM RAUM');
    expect(html).toContain('Zurück in den Raum');
    expect(html).toContain('Raum QX7R · Anna, Ben, Cem');
    expect(html).toContain('placeholder="z. B. Anna"');
    expect(html).not.toContain('bound-line');
    expect(html).toContain('<nav class="menu-list" aria-label="Hauptmenü">');
    const sent: ClientMessage[] = [];
    const elements = elementsOf(() => joinScreen(LOBBY, (msg) => sent.push(msg)));
    expect(pressable(elements, ROOM_BUTTONS)).toEqual({ Beitreten: true, Zuschauen: true });
    expect(opensRound(LOBBY)).toBe(true);
    press(buttonsOf(elements, 'bound-leave')[0]);
    press(buttonsOf(elements, 'bound-back')[0]);
    expect(sent).toEqual([
      { kind: 'abandon', code: 'QX7R', pass: PASS },
      { kind: 'whereami', pass: PASS },
      { kind: 'resume', code: 'QX7R', pass: PASS },
    ]);
  });

  it('lets go of the snapshot kept of the room as it is left, and asks where the pass sits', () => {
    const key = `${SNAPSHOT_KEY}QX7R`;
    const snapshot = { blob: 'v1.a.b', seq: 3, at: T0, seat: LOBBY };
    const kept = stubWindow([[key, JSON.stringify(snapshot)]]);
    const sent: ClientMessage[] = [];
    const elements = elementsOf(() => joinScreen(LOBBY, (msg) => sent.push(msg)));
    press(buttonsOf(elements, 'bound-leave')[0]);
    expect(kept.has(key)).toBe(false);
    expect(sent.map((msg) => msg.kind)).toEqual(['abandon', 'whereami']);
  });

  it('is the plain menu where the pass sits nowhere', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(null));
    expect(html).not.toContain('class="bound');
    expect(html).toContain('placeholder="z. B. Anna"');
    expect(opensRound(null)).toBe(true);
  });
});

describe('the join screen while its card’s way back waits for the room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The card gone back to its room 12 s ago, the server waiting for the newest snapshot. */
  const WAITING: Restoring = { code: 'QX7R', since: T0 - 12_000 };

  it('says the room is on its way back and since when, only the way out open', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(RUN, noop, WAITING));
    expect(html).toContain(
      '<span class="kicker bound-kicker">EINSATZ WIRD WIEDERHERGESTELLT</span>',
    );
    expect(html).toContain(
      '<p class="bound-restoring" role="status">Der letzte Stand trifft gleich ein · seit 12 s</p>',
    );
    const elements = elementsOf(() => joinScreen(RUN, noop, WAITING));
    const card = ['Zurück zum Einsatz', 'Einsatz aufgeben'];
    expect(pressable(elements, [...card, ...ROOM_BUTTONS])).toEqual({
      'Zurück zum Einsatz': false,
      'Einsatz aufgeben': true,
      Beitreten: false,
      Zuschauen: false,
    });
    expect(opensRound(RUN, WAITING)).toBe(false);
  });

  it('binds the screen to a lobby on its way back as well, its way out open', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(LOBBY, noop, WAITING));
    expect(html).toContain('EINSATZ WIRD WIEDERHERGESTELLT');
    expect(html).toContain('<nav class="menu-list menu-list--bound"');
    expect(opensRound(LOBBY, WAITING)).toBe(false);
    const elements = elementsOf(() => joinScreen(LOBBY, noop, WAITING));
    expect(pressable(elements, ['Zurück in den Raum', 'Raum verlassen'])).toEqual({
      'Zurück in den Raum': false,
      'Raum verlassen': true,
    });
  });

  it('counts the seconds up from the server’s word, never below none', () => {
    expect(restoringLine(T0, T0)).toBe('Der letzte Stand trifft gleich ein · seit 0 s');
    expect(restoringLine(T0, T0 + 61_999)).toBe('Der letzte Stand trifft gleich ein · seit 61 s');
    expect(restoringLine(T0 + 500, T0)).toBe('Der letzte Stand trifft gleich ein · seit 0 s');
  });

  it('says the same of the tab’s own comeback, its seat given up on a socket of its own', () => {
    stubWindow();
    const held: Restoring = { ...WAITING, comeback: true };
    const html = renderToStaticMarkup(joinScreen(RUN, noop, held, noop));
    expect(html).toContain('EINSATZ WIRD WIEDERHERGESTELLT');
    expect(html).toContain('Der letzte Stand trifft gleich ein · seit 12 s');
    expect(html).toContain('Einsatz aufgeben');
    const sent: ClientMessage[] = [];
    const gaveUp = vi.fn();
    const tab = elementsOf(() => joinScreen(LOBBY, (msg) => sent.push(msg), held, gaveUp));
    press(buttonsOf(tab, 'bound-leave')[0]);
    expect(gaveUp).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    // The card's own way back waits on a line that is up: the seat goes on the line as ever.
    const card = elementsOf(() => joinScreen(LOBBY, (msg) => sent.push(msg), WAITING, gaveUp));
    press(buttonsOf(card, 'bound-leave')[0]);
    expect(gaveUp).toHaveBeenCalledTimes(1);
    expect(sent.map((msg) => msg.kind)).toEqual(['abandon', 'whereami']);
  });

  it('is the card as ever where another room is awaited', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(RUN, noop, { code: 'AB12', since: T0 }));
    expect(html).toContain('EINSATZ LÄUFT');
    expect(html).not.toContain('bound-restoring');
    const elements = elementsOf(() => joinScreen(RUN, noop, { code: 'AB12', since: T0 }));
    expect(pressable(elements, ['Zurück zum Einsatz', 'Zuschauen'])).toEqual({
      'Zurück zum Einsatz': true,
      Zuschauen: true,
    });
  });
});

describe('what the join screen asks as it comes up', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stands on the card of the newest snapshot kept from the start, not on the plain form', () => {
    const fresh = { blob: 'v1.a.b', seq: 7, at: Date.now(), seat: RUN };
    const local = new Map([[`${SNAPSHOT_KEY}QX7R`, JSON.stringify(fresh)]]);
    vi.stubGlobal('window', { localStorage: storage(local) });
    let seat: Seat | null = null;
    function Probe() {
      seat = useGameConnection().seat;
      return null;
    }
    renderToStaticMarkup(<Probe />);
    expect(seat).toEqual(RUN);
  });

  it('asks for the rooms and where the pass sits, with what the device kept of its account', () => {
    expect(doorAsks(PASS, { name: ' ', color: null })).toEqual([
      { kind: 'list-rooms' },
      { kind: 'whereami', pass: PASS },
    ]);
    expect(doorAsks(PASS, { name: ' Anna ', color: '#a78bfa' })).toEqual([
      { kind: 'list-rooms' },
      { kind: 'whereami', pass: PASS, name: 'Anna', color: '#a78bfa' },
    ]);
  });
});

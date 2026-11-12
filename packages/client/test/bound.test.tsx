import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, MissionInfo, Seat } from '@escapelab/core';
import { PASS_KEY } from '../src/pass.js';
import { CONFIRM_MS, giveUpPress } from '../src/screens/GiveUp.js';
import { BoundCard, boundLine, doorAsks, JoinScreen } from '../src/screens/Join.js';
import { buttonsOf, elementsOf, press } from './probe.js';

const noop = (): void => undefined;

/** Ben's browser and its pass, his name kept with it. */
const PASS = { id: 'b3'.repeat(16), secret: '7e'.repeat(32) };

/** Ben's browser, opened on an invite to room ABCD: the code field filled. */
function stubWindow(): void {
  const kept = new Map([[PASS_KEY, JSON.stringify({ ...PASS, name: 'Ben' })]]);
  vi.stubGlobal('window', {
    location: { search: '?room=ABCD' },
    localStorage: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: noop,
      removeItem: noop,
    },
  });
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

function joinScreen(seat: Seat | null, send: (msg: ClientMessage) => void = noop) {
  return (
    <JoinScreen
      send={send}
      connected
      missions={[blackout]}
      rooms={[]}
      seat={seat}
      stats={[]}
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

const ROOM_BUTTONS = ['Runde eröffnen', 'Beitreten', 'Mit Code zuschauen'];

describe('the join screen of a pass bound to a run', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens on the run’s card instead of the form: mission, room, clock and crew', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(RUN));
    expect(html).toContain('<span class="kicker bound-kicker">EINSATZ LÄUFT</span>');
    expect(html).toContain('<h2 class="bound-title">Blackout im Labor</h2>');
    expect(html).toContain('Raum QX7R · noch 12:34 · Anna, Ben, Cem');
    expect(html).toContain('Zurück zum Einsatz');
    expect(html).not.toContain('placeholder="z. B. Anna"');
    expect(html).not.toContain('Offene Runden');
    expect(html).not.toContain('Raum verlassen');
  });

  it('says a paused run is paused, and its clock as it stood', () => {
    const html = renderToStaticMarkup(<BoundCard seat={{ ...RUN, paused: true }} send={noop} />);
    expect(html).toContain('EINSATZ PAUSIERT');
    expect(html).toContain('noch 12:34');
  });

  it('blocks every other room with one line that names the run', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(RUN));
    expect(boundLine(RUN)).toBe(
      'Gebunden an „Blackout im Labor" in Raum QX7R — neue Runden erst danach.',
    );
    expect(html.split('class="bound-line"')).toHaveLength(2);
    expect(html).toContain('Gebunden an „Blackout im Labor&quot; in Raum QX7R');
    const elements = elementsOf(() => joinScreen(RUN));
    expect(pressable(elements, ROOM_BUTTONS)).toEqual({
      'Runde eröffnen': false,
      Beitreten: false,
      'Mit Code zuschauen': true,
    });
  });

  it('gives the run up only at a second press, the first asking', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(RUN));
    expect(html).toContain('<button class="danger give-up">Einsatz aufgeben</button>');
    expect(giveUpPress(null, T0)).toBe('ask');
    expect(giveUpPress(T0, T0 + CONFIRM_MS - 1)).toBe('confirm');
    expect(giveUpPress(T0, T0 + CONFIRM_MS)).toBe('ask');
  });

  it('goes back to the run on the browser’s pass', () => {
    stubWindow();
    const sent: ClientMessage[] = [];
    const elements = elementsOf(() => joinScreen(RUN, (msg) => sent.push(msg)));
    press(buttonsOf(elements, 'bound-back')[0]);
    expect(sent).toEqual([{ kind: 'resume', code: 'QX7R', pass: PASS }]);
  });
});

describe('the join screen of a pass in a lobby', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the lobby’s card over the form, which stays open, and leaves it at a press', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(LOBBY));
    expect(html).toContain('IM RAUM');
    expect(html).toContain('Zurück in den Raum');
    expect(html).toContain('Raum QX7R · Anna, Ben, Cem');
    expect(html).toContain('placeholder="z. B. Anna"');
    expect(html).not.toContain('bound-line');
    const sent: ClientMessage[] = [];
    const elements = elementsOf(() => joinScreen(LOBBY, (msg) => sent.push(msg)));
    expect(pressable(elements, ROOM_BUTTONS)).toEqual({
      'Runde eröffnen': true,
      Beitreten: true,
      'Mit Code zuschauen': true,
    });
    press(buttonsOf(elements, 'bound-leave')[0]);
    press(buttonsOf(elements, 'bound-back')[0]);
    expect(sent).toEqual([
      { kind: 'abandon', code: 'QX7R', pass: PASS },
      { kind: 'resume', code: 'QX7R', pass: PASS },
    ]);
  });

  it('is the plain form where the pass sits nowhere', () => {
    stubWindow();
    const html = renderToStaticMarkup(joinScreen(null));
    expect(html).not.toContain('class="bound');
    expect(html).toContain('placeholder="z. B. Anna"');
  });
});

describe('what the join screen asks as it comes up', () => {
  it('asks for the rooms and where the pass sits', () => {
    expect(doorAsks(PASS)).toEqual([
      { kind: 'list-rooms' },
      { kind: 'whereami', pass: PASS },
    ]);
  });
});

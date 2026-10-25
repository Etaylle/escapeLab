import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PuzzleView } from '@escapelab/core';
import { deviceCoach, firstSight } from '../src/puzzles/coach.js';
import { heldView, type DeviceRun } from '../src/puzzles/Device.js';
import { expiredLine, handlesOf, leverPlate, togetherWord } from '../src/puzzles/LeverPanel.js';
import { ownPressAt, secondsText, syncPress } from '../src/puzzles/syncPress.js';
import { PuzzlePanel } from '../src/screens/PuzzlePanel.js';

type SyncView = Extract<PuzzleView, { kind: 'button-sync' }>;

const T0 = 1_000_000;

/**
 * The Notlicht's main switch as a player at it sees it: alone at it until
 * told otherwise, a crew of two, its window 2 s, nothing thrown yet.
 */
function lever(fields: Partial<SyncView> = {}): SyncView {
  return {
    kind: 'button-sync',
    style: 'lever',
    windowMs: 2000,
    press: null,
    youPressed: false,
    partnerPressed: false,
    pressedCount: 0,
    requiredCount: 2,
    here: 1,
    lastResult: null,
    index: 0,
    total: 6,
    title: 'Notlicht',
    manual: null,
    console: 'a',
    backup: null,
    ...fields,
  };
}

const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf' };
const ben = { id: 'p2', name: 'Ben', color: '#f472b6' };

/** The run around the device: Anna's, Ben her partner, no alarm. */
function run(you: string | null = 'p1'): DeviceRun {
  return { alarms: 0, solved: 0, refusals: 0, crew: { you, mates: [anna, ben] }, alarm: null };
}

function panel(puzzle: PuzzleView, around: DeviceRun = run()): string {
  return renderToStaticMarkup(
    <PuzzlePanel puzzle={puzzle} run={around} send={() => undefined} deadlineAt={null} />,
  );
}

/** The levers as the markup draws them: somebody there (H) or not (-), up (^) or thrown down (v). */
function levers(html: string): string[] {
  return [...html.matchAll(/<div class="lever-unit([^"]*)">/g)].map(([, classes = '']) => {
    const here = classes.includes('lever-unit--here') ? 'H' : '-';
    return `${here}${classes.includes('lever-unit--down') ? 'v' : '^'}`;
  });
}

/** The names under the levers, each with its colour where it has one. */
function names(html: string): string[] {
  const name = /<span class="lever-name"(?: style="color:([^"]+)")?>([^<]*)<\/span>/g;
  return [...html.matchAll(name)].map(([, color, text = '']) =>
    color === undefined ? text : `${text} ${color}`,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the main switch’s panel', () => {
  it('sits in the station’s device under a plate: what it is, that it takes two, how fast', () => {
    const html = panel(lever({ windowMs: 2000 }));
    expect(html.startsWith('<div class="device device--button-sync">')).toBe(true);
    expect(html).toContain(
      '<div class="lever-plate">NOTLICHT · HAUPTSCHALTER · NUR ZU ZWEIT · 2 S</div>',
    );
    expect(html).not.toContain('sync-collar');
    // Without a window the plate says nothing of seconds.
    expect(leverPlate(lever({ windowMs: null }), null)).toBe(
      'NOTLICHT · HAUPTSCHALTER · NUR ZU ZWEIT',
    );
    expect(secondsText(2500)).toBe('2,5');
  });

  it('names every lever for its badge, the own one first, each in its holder’s colour', () => {
    expect(names(panel(lever({ here: 2 })))).toEqual(['Anna #2dd4bf', 'Ben #f472b6']);
    // Ben's screen: Ben's lever first, Anna's beside it.
    expect(names(panel(lever({ here: 2 }), run('p2')))).toEqual(['Ben #f472b6', 'Anna #2dd4bf']);
    // The plate says „du" to nobody.
    expect(panel(lever({ here: 2 }))).not.toMatch(/>DU</);
  });

  it('burns the lamp over every lever somebody stands at, the own one always', () => {
    expect(levers(panel(lever()))).toEqual(['H^', '-^']);
    expect(levers(panel(lever({ here: 2 })))).toEqual(['H^', 'H^']);
    expect(panel(lever({ here: 2 }))).toContain(
      '<span class="device-lamp device-lamp--green" aria-hidden="true"></span>',
    );
  });

  it('gives the player their own lever to throw with the lever’s press feel, and no other', () => {
    const html = panel(lever({ here: 2 }));
    expect(html.match(/<button class="big-button lever-grip" data-feel="pull"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Hebel umlegen"');
    expect(html.match(/<span class="lever-grip" aria-hidden="true">/g)).toHaveLength(1);
  });

  it('drains a ring round the grip of the own press, in step with it however late it opened', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 500);
    const press = { at: T0, expiresAt: T0 + 2000 };
    const html = panel(lever({ here: 2, youPressed: true, pressedCount: 1, press }));
    expect(levers(html)).toEqual(['Hv', 'H^']);
    expect(html).toContain('disabled="" aria-label="Eigener Hebel: unten"');
    const ring = /<svg class="lever-ring"[^>]*>.*<circle class="lever-ring-left"[^>]*style="([^"]*)"/;
    expect(ring.exec(html)?.[1]).toBe('--ring-ms:2000ms;--ring-delay:-500ms');
  });

  it('springs the own lever back once its window shut, and says the press ran out', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 2000);
    const press = { at: T0, expiresAt: T0 + 2000 };
    const ran = lever({ youPressed: true, pressedCount: 1, press });
    expect(ownPressAt(ran, syncPress(ran), T0 + 1999)).toEqual({
      down: true,
      ring: { at: T0, expiresAt: T0 + 2000 },
      expired: false,
    });
    expect(ownPressAt(ran, syncPress(ran), T0 + 2000)).toEqual({
      down: false,
      ring: null,
      expired: true,
    });
    // Whether or not the server has said so yet: up, no ring, to be pulled again.
    const html = panel(ran);
    expect(levers(html)).toEqual(['H^', '-^']);
    expect(html).not.toContain('lever-ring');
    expect(html).toContain('aria-label="Hebel umlegen"');
    expect(html).toContain('Zug verfallen — nur zu zweit zugleich');
  });

  it('tells only the owner of a dropped press: the server’s word, „Zug verfallen"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 500);
    const dropped = panel(lever({ lastResult: 'expired', press: null }));
    expect(dropped).toContain('Zug verfallen — nur zu zweit zugleich');
    // The partner whose late press opened a new window hears nothing of a miss.
    const press = { at: T0, expiresAt: T0 + 2000 };
    const presser = panel(lever({ youPressed: true, pressedCount: 1, press }));
    expect(presser).not.toContain('verfallen');
    expect(presser).not.toContain('Zeitfenster');
    expect(expiredLine(3)).toBe('Zug verfallen — nur zu dritt zugleich');
  });

  it('throws the partner’s lever while a partner’s press is in, and only then', () => {
    expect(levers(panel(lever({ here: 2, partnerPressed: true, pressedCount: 1 })))).toEqual([
      'H^',
      'Hv',
    ]);
    expect(levers(panel(lever({ here: 2, partnerPressed: false, pressedCount: 0 })))).toEqual([
      'H^',
      'H^',
    ]);
    // A crew of three: the view counts the partners' presses in.
    const three = lever({ requiredCount: 3, here: 3, partnerPressed: true, pressedCount: 2 });
    expect(levers(panel(three))).toEqual(['H^', 'Hv', 'Hv']);
  });

  it('drops every lever home once the crew has thrown them all', () => {
    const html = panel(lever({ here: 2, youPressed: true, pressedCount: 2 }));
    expect(levers(html)).toEqual(['Hv', 'Hv']);
    expect(html).toContain('<div class="lever lever--thrown">');
  });

  it('has a lever and a word for every crew, three as well', () => {
    const three = panel(lever({ requiredCount: 3, here: 3, partnerPressed: true, pressedCount: 1 }));
    expect(levers(three)).toEqual(['H^', 'Hv', 'H^']);
    expect(three).toContain('NUR ZU DRITT');
    expect([1, 2, 3, 4, 5].map(togetherWord)).toEqual([
      'ZWEIT',
      'ZWEIT',
      'DRITT',
      'VIERT',
      'VIERT',
    ]);
  });

  it('shows the audience every lever as the crew throws them, none its own, none named', () => {
    const watched = lever({ console: null, here: 2, pressedCount: 1 });
    expect(handlesOf(watched, null, null)).toEqual([
      { own: false, here: true, down: true, label: null },
      { own: false, here: true, down: false, label: null },
    ]);
    const html = panel(watched, run(null));
    expect(html).not.toContain('<button class="big-button lever-grip"');
    expect(html).not.toContain('lever-name');
  });

  it('leaves a sync station drawn as a button as it was', () => {
    const button = panel(lever({ style: 'button' }));
    expect(button).toContain('sync-collar');
    expect(button).not.toContain('lever');
  });
});

describe('the coach line at a sync station', () => {
  it('says at the main switch: a lever a badge, all at once, by E or a tap, once', () => {
    expect(deviceCoach(lever(), 'mouse')).toEqual({
      id: 'device:lever',
      text: 'Ein Hebel je Ausweis, alle zugleich — E drücken.',
    });
    expect(deviceCoach(lever(), 'touch')?.text).toBe(
      'Ein Hebel je Ausweis, alle zugleich — antippen.',
    );
    const shown = new Set(['device:lever']);
    expect(firstSight(deviceCoach(lever(), 'mouse'), shown)).toBeNull();
  });

  it('words the sync button’s line from its window: seconds where it has one, order free where not', () => {
    const timed = deviceCoach(lever({ style: 'button', windowMs: 2000 }), 'mouse');
    expect(timed).toEqual({
      id: 'device:button-sync:window',
      text: 'Ein Druck je Ausweis, alle binnen 2 s.',
    });
    const free = deviceCoach(lever({ style: 'button', windowMs: null }), 'touch');
    expect(free).toEqual({
      id: 'device:button-sync',
      text: 'Ein Druck je Ausweis — Reihenfolge egal.',
    });
    // Each rule its own mark: seeing the one does not hide the other.
    expect(firstSight(free, new Set([timed?.id ?? '']))).toEqual(free);
  });
});

describe('the main switch thrown home', () => {
  it('stays in view with every lever down once the crew has solved it, its last miss forgotten', () => {
    const last = lever({ here: 2, youPressed: true, pressedCount: 1, lastResult: 'expired' });
    const held = heldView(last, 1);
    expect(held).toMatchObject({
      youPressed: true,
      pressedCount: 2,
      requiredCount: 2,
      lastResult: null,
    });
    const html = panel(held ?? lever());
    expect(html).not.toContain('verfallen');
    expect(html).not.toContain('Zeitfenster');
  });

  it('goes at once where it was only closed or walked away from', () => {
    expect(heldView(lever(), 0)).toBeNull();
    expect(heldView(lever({ index: 3 }), 3)).toBeNull();
  });
});

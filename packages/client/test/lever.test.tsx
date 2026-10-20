import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PuzzleView } from '@escapelab/core';
import { deviceCoach, firstSight } from '../src/puzzles/coach.js';
import { heldView } from '../src/puzzles/Device.js';
import { handlesOf, togetherWord } from '../src/puzzles/LeverPanel.js';
import { PuzzlePanel } from '../src/screens/PuzzlePanel.js';

type SyncView = Extract<PuzzleView, { kind: 'button-sync' }>;

/**
 * The Notlicht's main switch as a player at it sees it: alone at it until
 * told otherwise, a crew of two, nothing thrown yet.
 */
function lever(fields: Partial<SyncView> = {}): SyncView {
  return {
    kind: 'button-sync',
    style: 'lever',
    youPressed: false,
    pressedCount: 0,
    requiredCount: 2,
    here: 1,
    attempts: 0,
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

function panel(puzzle: PuzzleView): string {
  return renderToStaticMarkup(
    <PuzzlePanel
      puzzle={puzzle}
      run={{ alarms: 0, solved: 0 }}
      send={() => undefined}
      deadlineAt={null}
    />,
  );
}

/** The levers as the markup draws them: lit (L) or dark (-), up (^) or thrown down (v). */
function levers(html: string): string[] {
  return [...html.matchAll(/<div class="lever-unit([^"]*)">/g)].map(([, classes = '']) => {
    const lit = classes.includes('lever-unit--lit') ? 'L' : '-';
    return `${lit}${classes.includes('lever-unit--down') ? 'v' : '^'}`;
  });
}

describe('the main switch’s panel', () => {
  it('sits in the station’s device under a plate: what it is, and that it takes two', () => {
    const html = panel(lever());
    expect(html.startsWith('<div class="device device--button-sync">')).toBe(true);
    expect(html).toContain(
      '<div class="lever-plate">NOTLICHT · HAUPTSCHALTER · NUR ZU ZWEIT</div>',
    );
    expect(html).not.toContain('sync-collar');
  });

  it('lights the player’s own lever, and the partner’s only while the partner stands there', () => {
    expect(levers(panel(lever()))).toEqual(['L^', '-^']);
    expect(levers(panel(lever({ here: 2 })))).toEqual(['L^', 'L^']);
    expect(panel(lever({ here: 2 }))).toContain(
      '<span class="device-lamp device-lamp--green" aria-hidden="true"></span>',
    );
  });

  it('gives the player their own lever to throw, and no other', () => {
    const html = panel(lever({ here: 2 }));
    expect(html.match(/<button class="big-button lever-grip"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Hebel umlegen"');
    expect(html.match(/<span class="lever-grip" aria-hidden="true">/g)).toHaveLength(1);
  });

  it('shows a thrown lever down, the own one no longer to be pulled', () => {
    const mine = panel(lever({ here: 2, youPressed: true, pressedCount: 1 }));
    expect(levers(mine)).toEqual(['Lv', 'L^']);
    expect(mine).toContain('disabled="" aria-label="Dein Hebel: unten"');
    expect(levers(panel(lever({ here: 2, pressedCount: 1 })))).toEqual(['L^', 'Lv']);
  });

  it('drops every lever home once the crew has thrown them all', () => {
    const html = panel(lever({ here: 2, youPressed: true, pressedCount: 2 }));
    expect(levers(html)).toEqual(['Lv', 'Lv']);
    expect(html).toContain('<div class="lever lever--thrown">');
  });

  it('says when the throws came too far apart, as the sync button does', () => {
    const html = panel(lever({ lastResult: 'missed-window', attempts: 1 }));
    expect(html).toContain('Zeitfenster verpasst — Versuch 1');
  });

  it('has a lever and a word for every crew, three as well', () => {
    const three = panel(lever({ requiredCount: 3, here: 3, pressedCount: 1 }));
    expect(levers(three)).toEqual(['L^', 'Lv', 'L^']);
    expect(three).toContain('NUR ZU DRITT');
    expect([1, 2, 3, 4, 5].map(togetherWord)).toEqual([
      'ZWEIT',
      'ZWEIT',
      'DRITT',
      'VIERT',
      'VIERT',
    ]);
  });

  it('shows the audience every lever as the crew throws them, none its own', () => {
    const watched = lever({ console: null, here: 2, pressedCount: 1 });
    expect(handlesOf(watched)).toEqual([
      { own: false, lit: true, down: true },
      { own: false, lit: true, down: false },
    ]);
    expect(panel(watched)).not.toContain('<button class="big-button lever-grip"');
  });

  it('leaves a sync station drawn as a button as it was', () => {
    const button = panel(lever({ style: 'button' }));
    expect(button).toContain('sync-collar');
    expect(button).not.toContain('lever');
  });
});

describe('the coach line at the main switch', () => {
  it('names E with a keyboard and the tap on a touch screen, once a session', () => {
    expect(deviceCoach(lever(), 'mouse')).toEqual({
      id: 'device:lever',
      text: 'Beide Hebel gleichzeitig: E drücken, wenn der Partner da ist.',
    });
    expect(deviceCoach(lever(), 'touch')?.text).toBe(
      'Beide Hebel gleichzeitig antippen, wenn der Partner da ist.',
    );
    const shown = new Set(['device:lever']);
    expect(firstSight(deviceCoach(lever(), 'mouse'), shown)).toBeNull();
    // The sync button is a device of its own.
    expect(deviceCoach(lever({ style: 'button' }), 'mouse')?.id).toBe('device:button-sync');
  });
});

describe('the main switch thrown home', () => {
  it('stays in view with every lever down once the crew has solved it', () => {
    expect(heldView(lever({ here: 2, youPressed: true, pressedCount: 1 }), 1)).toMatchObject({
      youPressed: true,
      pressedCount: 2,
      requiredCount: 2,
    });
  });

  it('goes at once where it was only closed or walked away from', () => {
    expect(heldView(lever(), 0)).toBeNull();
    expect(heldView(lever({ index: 3 }), 3)).toBeNull();
  });
});

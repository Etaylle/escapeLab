import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edgework, PlayerView, RunEvent } from '@escapelab/core';
import { MissionHud, tickerLine, withKey } from '../src/screens/MissionHud.js';
import { mapWith, PICTOGRAPH } from './fixtures.js';

/**
 * The HUD strip of a running mission whose report reads `events`; `onAir`
 * while a banner is up, `edgework` what the sign said, once it is read.
 */
function hud(events: RunEvent[], onAir = false, edgework: Edgework | null = null): string {
  const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: true, isHost: false };
  const view: PlayerView = {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    cast: { pa: 'anlage', operator: 'helmut', lead: null },
    crewSize: { min: 2, max: 3 },
    chat: [],
    you: ben,
    players: [{ ...ben, connected: true }],
    palette: [],
    deadlineAt: null,
    startedAt: null,
    finishedAt: null,
    timeLimitSec: 600,
    lights: { out: true, outAt: 0 },
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    away: [],
    pausedAt: null,
    events,
    grade: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    credits: {},
    edgework,
    presence: { stationId: null, console: null, manualId: null, signSeen: edgework !== null },
    sourcesHere: [],
    manualsHere: [],
    noteHere: null,
    puzzle: null,
    map: mapWith({}),
  };
  return renderToStaticMarkup(
    <MissionHud
      view={view}
      positionsRef={{ current: { run: null, players: {} } }}
      chatsRef={{ current: [] }}
      onAir={onAir}
      onOpenInfo={() => undefined}
      onOpenMenu={() => undefined}
      notesOpen={false}
      onToggleNotes={() => undefined}
    />,
  );
}

/** The radio strip as it reads: its icon by name, then its words; null where there is none. */
function strip(html: string): string | null {
  const icon = '<svg class="icon icon-([a-z-]+)"[^>]*>.*?</svg>';
  const m = new RegExp(`<span class="hud-radio">${icon} ([^<]*)</span>`).exec(html);
  return m === null ? null : `[${m[1] ?? ''}] ${m[2] ?? ''}`;
}

/** A HUD button's words after its icon, by the button's classes. */
function buttonWords(html: string, classes: string): string | undefined {
  const icon = '<svg [^>]*>.*?</svg>';
  return new RegExp(`<button class="${classes}"[^>]*>${icon} ([^<]*)</button>`).exec(html)?.[1];
}

const radio = (label: string, at = 1): RunEvent => ({ at, kind: 'radio', label, seconds: null });

describe('the HUD radio line', () => {
  it('reads out a find like a radio line, the newest line winning', () => {
    const html = hud([
      radio('Strom weg.'),
      { at: 2, kind: 'find', label: 'Spind durchsucht: KLEMMBRETT', seconds: null },
    ]);
    expect(strip(html)).toBe('[radio] Spind durchsucht: KLEMMBRETT');
    expect(html).not.toContain('Strom weg.');
  });

  it('names mission control on its lines', () => {
    expect(strip(hud([radio('Strom weg.')]))).toBe('[radio] Leitstelle: Strom weg.');
  });

  it('reads a revealed note as the last shift’s, not as mission control', () => {
    const html = hud([{ at: 1, kind: 'hint', label: 'Erst die Sicherung.', seconds: 20 }]);
    expect(strip(html)).toBe('[note] Notiz der letzten Schicht — Erst die Sicherung. (−20s)');
    expect(html).not.toContain('Leitstelle');
    expect(html).not.toContain('icon-radio');
  });

  it('draws its icons, never the platform’s emoji', () => {
    const html = hud([radio('Strom weg.')]);
    expect(html).toContain('class="icon icon-');
    expect(html).not.toMatch(PICTOGRAPH);
  });
});

describe('the radio strip while a line is on the air', () => {
  const chat = { at: 5, text: 'Anna: Hier!' };

  it('stays empty while the banner over the world carries a line', () => {
    expect(tickerLine(radio('Strom weg.'), undefined, true)).toBeNull();
    expect(tickerLine(radio('Strom weg.'), chat, true)).toBeNull();
    const html = hud([radio('Strom weg.')], true);
    expect(html).not.toContain('hud-radio');
    expect(html).not.toContain('Strom weg.');
    // The buttons beside it stay where they are.
    expect(html).toContain('class="hud-info hud-notes"');
  });

  it('carries the newest line again once the banner is gone', () => {
    expect(tickerLine(radio('Strom weg.'), undefined, false)).toEqual({
      icon: 'radio',
      text: 'Leitstelle: Strom weg.',
    });
    expect(tickerLine(radio('Strom weg.', 1), chat, false)).toEqual({
      icon: 'radio',
      text: 'Anna: Hier!',
    });
    expect(tickerLine(radio('Strom weg.', 9), chat, false)?.text).toBe('Leitstelle: Strom weg.');
    expect(tickerLine(undefined, undefined, false)).toBeNull();
  });

  it('says a note of the last shift was read under the note, never on the air', () => {
    const read = { at: 9, kind: 'note' as const, label: 'Notiz gelesen', seconds: null };
    expect(tickerLine(read, undefined, false)).toEqual({ icon: 'note', text: 'Notiz gelesen' });
  });
});

describe('the Laborkennung in a narrow strip', () => {
  const POLISH_CSS = readFileSync(new URL('../src/styles/polish.css', import.meta.url), 'utf8');
  const NARROW = '@media (820px < width < 1180px) {';
  const from = POLISH_CSS.indexOf(NARROW);
  const narrow = POLISH_CSS.slice(from, POLISH_CSS.indexOf('\n}\n', from));
  const edgework: Edgework = {
    serial: 'K7G3A-2',
    indicators: [
      { id: 'FRQ', lit: true },
      { id: 'SIG', lit: false },
      { id: 'CAR', lit: true },
    ],
    cells: 3,
  };

  it('stands before the buttons, Info and the menu last, and carries its value ready', () => {
    const html = hud([radio('Strom weg.')], false, edgework);
    const chip = html.indexOf('<div class="edgework"');
    expect(chip).toBeGreaterThan(html.indexOf('</ul>'));
    expect(html.indexOf('class="hud-info hud-notes"')).toBeGreaterThan(chip);
    const info = html.indexOf(' Info [I]</button>');
    expect(info).toBeGreaterThan(html.indexOf('class="hud-info hud-notes"'));
    expect(html.indexOf('<button class="hud-info hud-menu">')).toBeGreaterThan(info);
    expect(html.endsWith(' Menü [Esc]</button></div></section>')).toBe(true);
    expect(html).toContain('<span class="edgework-value" title="Laborkennung K7G3A-2; ');
  });

  it('shows the value alone under 1180 px, and the strip gives way before a button', () => {
    expect(from).toBeGreaterThan(0);
    // Everywhere else the whole chip, and its value hidden.
    expect(POLISH_CSS.slice(0, from)).toMatch(/\n\.edgework-value \{\s*display: none;\s*\}/);
    expect(narrow).toMatch(/\n {2}\.hud \.edgework-part \{\s*display: none;\s*\}/);
    expect(narrow).toMatch(/\n {2}\.hud \.edgework-value \{\s*display: block;/);
    const givesWay = /\n {2}\.hud-crew,\n {2}\.hud-radio,\n {2}\.hud \.edgework \{\s*min-width: 0;/;
    expect(narrow).toMatch(givesWay);
    // The chip's value stays whole, nothing lets it shrink.
    expect(narrow).not.toMatch(/\.edgework[^{]*\{[^}]*flex/);
    // Nothing in it touches the buttons: they keep their size and stay on the screen.
    expect(narrow).not.toMatch(/hud-info|hud-notes|hud-mic/);
  });
});

describe('the strip’s crew', () => {
  it('keeps its names as the radio line gives way first, at every width', () => {
    const ui = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');
    expect(ui).toMatch(/\n\.hud-radio \{\s*flex: 0 8 auto;\s*min-width: 80px;/);
    expect(ui).toMatch(/\n\.hud-crew \{\s*flex: 0 1 auto;/);
  });
});

describe('the strip under 820 px', () => {
  const UI_CSS = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');
  const from = UI_CSS.indexOf('@media (max-width: 820px) {\n  .hud {');
  const grid = UI_CSS.slice(from, UI_CSS.indexOf('\n}\n', from));

  it('keeps its three rows: the menu stays the gear’s in the bar, Info keeps its place', () => {
    expect(from).toBeGreaterThan(0);
    expect(grid).toMatch(/grid-template-rows: 20px 27px 40px;/);
    expect(grid).toMatch(/\n {2}\.hud-menu \{\s*display: none;\s*\}/);
    const info = /\n {2}\.hud-info:not\(\.hud-notes, \.hud-mic, \.hud-menu\) \{\s*grid-area: info;/;
    expect(grid).toMatch(info);
    expect(grid).not.toMatch(/last-child/);
  });
});

describe('the HUD buttons’ keys', () => {
  it('name the key on a keyboard', () => {
    expect(withKey('Notizen', 'N', false)).toBe('Notizen [N]');
    expect(withKey('Info', 'I', false)).toBe('Info [I]');
    const html = hud([]);
    expect(buttonWords(html, 'hud-info hud-notes')).toBe('Notizen [N]');
    expect(buttonWords(html, 'hud-info')).toBe('Info [I]');
  });

  it('leave it out on a touch screen, which has no keys to press', () => {
    expect(withKey('Notizen', 'N', true)).toBe('Notizen');
    expect(withKey('Info', 'I', true)).toBe('Info');
  });
});

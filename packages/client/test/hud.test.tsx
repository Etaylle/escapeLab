import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlayerView, RunEvent } from '@escapelab/core';
import { MissionHud, tickerLine, withKey } from '../src/screens/MissionHud.js';
import { iconsAsWords, mapWith, PICTOGRAPH } from './fixtures.js';

/**
 * The HUD strip of a running mission whose report reads `events`; `onAir`
 * while a banner is up, `parts` what the objective bar says is still to bring.
 */
function hud(events: RunEvent[], onAir = false, parts: string | null = null): string {
  const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: true, isHost: false };
  const view: PlayerView = {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    crewSize: { min: 2, max: 3 },
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
    pausedFor: null,
    events,
    grade: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    credits: {},
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: false },
    sourcesHere: [],
    manualsHere: [],
    puzzle: null,
    map: mapWith({}),
  };
  return renderToStaticMarkup(
    <MissionHud
      view={view}
      positionsRef={{ current: { run: null, players: {} } }}
      chatsRef={{ current: [] }}
      onAir={onAir}
      parts={parts}
      onOpenInfo={() => undefined}
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

  it('reads a revealed note as the last crew’s, not as mission control', () => {
    const html = hud([{ at: 1, kind: 'hint', label: 'Erst die Sicherung.', seconds: 20 }]);
    expect(strip(html)).toBe('[note] Notiz der letzten Crew — Erst die Sicherung. (−20s)');
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
});

describe('what the crew still has to bring, on a phone held sideways', () => {
  const PWA_CSS = readFileSync(new URL('../src/styles/pwa.css', import.meta.url), 'utf8');
  const SIDEWAYS = '@media (pointer: coarse) and (orientation: landscape) and (max-height: 500px) {';
  const from = PWA_CSS.indexOf(SIDEWAYS);
  /** The sheet's rules for every window, and its block for a phone held sideways. */
  const everywhere = PWA_CSS.slice(0, from);
  const sideways = PWA_CSS.slice(from, PWA_CSS.indexOf('\n}\n', from));
  const PARTS = '<span class="hud-parts">SICHERUNG mitnehmen</span>';

  it('rides in the radio strip in front of its line, and alone where there is none', () => {
    expect(iconsAsWords(hud([radio('Strom weg.')], false, 'SICHERUNG mitnehmen'))).toContain(
      `<span class="hud-radio">${PARTS}[radio] Leitstelle: Strom weg.</span>`,
    );
    for (const html of [
      hud([], false, 'SICHERUNG mitnehmen'),
      hud([radio('Strom weg.')], true, 'SICHERUNG mitnehmen'),
    ]) {
      expect(html).toContain(`<span class="hud-radio hud-radio--parts">${PARTS}</span>`);
      expect(html).not.toContain('Strom weg.');
    }
    expect(hud([])).not.toContain('hud-radio');
  });

  it('shows there only, by the query: the objective bar drops it, the banner keeps to one line', () => {
    expect(from).toBeGreaterThan(0);
    expect(everywhere).toMatch(/\n\.hud-parts,\n\.hud-radio--parts \{\s*display: none;/);
    expect(sideways).toMatch(/\n {2}\.stage-sub \{\s*display: none;/);
    expect(sideways).toMatch(/\n {2}\.hud-parts \{[^}]*display: inline;/);
    expect(sideways).toMatch(/\n {2}\.hud-radio--parts \{\s*display: block;/);
    expect(sideways).toMatch(
      /\n {2}\.radio-banner \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/,
    );
  });

  it('keeps the buttons at the right end while a strip of nothing but it is hidden', () => {
    // ui.css pushes the first thing after the crew to the right: hidden, it hands that on.
    expect(everywhere).toMatch(/\n\.hud-radio--parts:first-child \+ \* \{\s*margin-left: auto;/);
    expect(sideways).toMatch(/\n {2}\.hud-radio--parts:first-child \+ \* \{\s*margin-left: 0;/);
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

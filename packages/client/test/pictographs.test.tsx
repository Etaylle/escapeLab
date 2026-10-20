import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MissionManual, PlayerView, RunEvent, SpectatorView } from '@escapelab/core';
import { EndScreen } from '../src/screens/End.js';
import { Handbook, HandbookScreen } from '../src/screens/Handbook.js';
import { SpectateScreen } from '../src/screens/Spectate.js';
import { iconsAsWords, PICTOGRAPH } from './fixtures.js';

/**
 * The end screen, the audience's screen and the printable handbook draw the
 * game's own icons (screens/Icon.tsx), never a character the platform draws
 * as an emoji in a style of its own — in any state they can be in.
 */

/** A character a platform draws as an emoji. */
const EMOJI = /\p{Extended_Pictographic}/u;

const noop = (): void => undefined;

/** Every kind of line the run report knows; a kind added to RunEvent has to be added here. */
const KINDS: Record<RunEvent['kind'], string> = {
  puzzle: 'Notstrom läuft',
  penalty: 'Falsche Taste',
  sabotage: 'Notfall: Kühlung',
  item: 'SICHERUNG eingesetzt',
  escape: 'Notausgang offen',
  finish: 'Alle draußen.',
  hint: 'Erst die Sicherung.',
  radio: 'Strom weg.',
  find: 'Spind durchsucht: SPIND',
};

/** One line of every kind, a minute apart. */
const REPORT: RunEvent[] = Object.entries(KINDS).map(([kind, label], i) => ({
  at: 1_000 + i * 60_000,
  kind: kind as RunEvent['kind'],
  label,
  seconds: kind === 'penalty' || kind === 'hint' ? 20 : null,
}));

const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: false, isHost: true };
const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: true, isHost: false };

/** Anna's view of a run that is over: won unless `parts` says otherwise. */
function over(parts: Partial<PlayerView>): PlayerView {
  return {
    phase: 'won',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: 'Licht.',
    crewSize: { min: 2, max: 3 },
    you: anna,
    players: [
      { ...anna, connected: true },
      { ...ben, connected: true },
    ],
    palette: [],
    deadlineAt: 661_000,
    startedAt: 1_000,
    finishedAt: 541_000,
    timeLimitSec: 660,
    currentPuzzleIndex: 5,
    puzzleCount: 5,
    pausedFor: null,
    events: REPORT,
    grade: { rank: 'A', label: 'Starke Leistung' },
    penaltySeq: 1,
    lastPenaltySec: null,
    alarms: { count: 1, limit: 5 },
    hintsUsed: 1,
    credits: {},
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: false },
    sourcesHere: [],
    manualsHere: [],
    puzzle: null,
    map: null,
    ...parts,
  };
}

/** What the audience sees of the same run, in `phase`. */
function watched(parts: Partial<SpectatorView>): SpectatorView {
  return {
    phase: 'playing',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: 'Licht.',
    deadlineAt: 661_000,
    startedAt: 1_000,
    finishedAt: null,
    timeLimitSec: 660,
    currentPuzzleIndex: 2,
    puzzleCount: 5,
    penaltySeq: 1,
    alarms: { count: 1, limit: 5 },
    hintsUsed: 1,
    pausedFor: null,
    events: REPORT,
    grade: null,
    players: [anna, ben].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: true,
      presence: { stationId: null, console: null, manualId: null, signSeen: true },
    })),
    credits: {},
    map: null,
    puzzle: null,
    edgework: {
      serial: 'K7G3A-2',
      indicators: [
        { id: 'FRQ', lit: true },
        { id: 'SIG', lit: false },
        { id: 'CAR', lit: true },
      ],
      cells: 2,
    },
    panels: [],
    ...parts,
  };
}

const end = (view: PlayerView): string =>
  renderToStaticMarkup(<EndScreen view={view} send={noop} leaveRoom={noop} />);

const spectate = (view: SpectatorView): string =>
  renderToStaticMarkup(
    <SpectateScreen
      view={view}
      positionsRef={{ current: { run: null, players: {} } }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      leaveRoom={noop}
    />,
  );

const manual: MissionManual = {
  missionTitle: 'Blackout im Labor',
  hintCostSec: 30,
  stations: [
    {
      index: 0,
      title: 'Notstrom-Kasten',
      readAt: ['HANDBUCH'],
      usesEdgework: true,
      manual: [{ heading: 'Notstrom', blocks: [{ kind: 'p', text: 'Zwei Pulte.' }] }],
    },
  ],
};

describe('the screens around a run', () => {
  it('end a run under the game’s icons, every line of the report too', () => {
    const won = end(over({}));
    const lost = end(over({ phase: 'lost', grade: null, you: { ...anna, ready: true } }));
    for (const html of [won, lost]) {
      expect(html).not.toMatch(EMOJI);
      expect(html).not.toMatch(PICTOGRAPH);
    }
    expect(iconsAsWords(won)).toContain('<h1>[check] ENTKOMMEN</h1>');
    expect(iconsAsWords(lost)).toContain('<h1>[cross] GESCHEITERT</h1>');
    const icons = [...iconsAsWords(won).matchAll(/<span class="report-icon">\[([a-z-]+)\]/g)];
    expect(icons.map((m) => m[1])).toEqual([
      'check',
      'siren',
      'warning',
      'box',
      'exit',
      'flag',
      'note',
      'radio',
      'search',
    ]);
    expect(iconsAsWords(won)).toContain('>[replay] Nochmal — ich bin dabei</button>');
    expect(iconsAsWords(lost)).toContain('>[check] Bereit für nochmal</button>');
  });

  it('show the audience every state of a run under the game’s icons', () => {
    const states = {
      lobby: spectate(watched({ phase: 'lobby' })),
      paused: spectate(watched({ pausedFor: ['Ben'] })),
      won: spectate(watched({ phase: 'won', grade: { rank: 'A', label: 'Stark' } })),
      lost: spectate(watched({ phase: 'lost' })),
    };
    for (const html of Object.values(states)) {
      expect(html).not.toMatch(EMOJI);
      expect(html).not.toMatch(PICTOGRAPH);
    }
    expect(iconsAsWords(states.paused)).toContain(
      '<div class="banner-result">[pause] Pausiert — warten auf Ben</div>',
    );
    expect(iconsAsWords(states.won)).toContain('[check] Geschafft — Rang A</div>');
    expect(iconsAsWords(states.lost)).toContain('[cross] Gescheitert</div>');
    // The Laborkennung's lamps are lettering of the chip, no emoji.
    expect(states.paused).toContain('class="edgework"');
  });

  it('print the handbook under the game’s icons', () => {
    const screen = renderToStaticMarkup(
      <HandbookScreen missions={[]} missionId="blackout" selectMission={noop} back={noop} />,
    );
    const book = renderToStaticMarkup(<Handbook manual={manual} />);
    for (const html of [screen, book]) {
      expect(html).not.toMatch(EMOJI);
      expect(html).not.toMatch(PICTOGRAPH);
    }
    expect(iconsAsWords(screen)).toContain('>[printer] Drucken</button>');
  });

  it('would notice an emoji', () => {
    for (const emoji of ['🖨', '⏸', '✔', '✖', '🏁', '📦', '🔎', '💡', '📻', '🚪', '🚨', '⚠']) {
      expect(`<button>${emoji} Drucken</button>`, emoji).toMatch(EMOJI);
    }
  });
});

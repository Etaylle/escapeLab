import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AwayView, ClientMessage, PlayerView } from '@escapelab/core';
import { clock } from '../src/clock.js';
import { TitleCard, titleCardOf, type CardSource } from '../src/screens/End.js';
import { deviceRunOf, GameScreen } from '../src/screens/Game.js';
import { mateClass, tagsOf } from '../src/screens/MissionHud.js';
import {
  AwayOffer,
  awayWays,
  backLine,
  CLOCK_MARGIN_MS,
  missesSomebody,
  PauseCard,
  pauseClock,
  returnsOf,
} from '../src/screens/Pause.js';
import { endingOf } from '../src/world/finale.js';
import { mapWith } from './fixtures.js';
import { buttonsOf, elementsOf, press } from './probe.js';

const T0 = 1_700_000_000_000;

const mate = (id: string, name: string, connected = true): PlayerView['players'][number] => ({
  id,
  name,
  color: '#2dd4bf',
  ready: false,
  connected,
  isHost: id === 'p1',
});

/** Cem away since T0, the crew may go on without him a minute later. */
const CEM: AwayView = { id: 'p3', name: 'Cem', since: T0, waivableAt: T0 + 60_000 };

/** Anna's view of a run that goes on while Cem is away since T0, Ben still on the line with her. */
function away(parts: Partial<PlayerView> = {}): PlayerView {
  return {
    players: [mate('p1', 'Anna'), mate('p2', 'Ben'), mate('p3', 'Cem', false)],
    away: [CEM],
    pausedAt: null,
    ...parts,
  } as PlayerView;
}

/** The same run standing still since T0 for the server's maintenance, Cem not back yet. */
const restarted = (parts: Partial<PlayerView> = {}): PlayerView => away({ pausedAt: T0, ...parts });

/** Ben alone on the line, Anna away since T0. */
const alone = (parts: Partial<PlayerView> = {}): PlayerView =>
  away({
    players: [mate('p1', 'Anna', false), mate('p2', 'Ben')],
    away: [{ ...CEM, id: 'p1', name: 'Anna' }],
    ...parts,
  });

describe('the counter of time away', () => {
  it('counts in minutes and seconds, whole seconds down', () => {
    expect(pauseClock(0)).toBe('0:00');
    expect(pauseClock(42_999)).toBe('0:42');
    expect(pauseClock(60_000)).toBe('1:00');
    expect(pauseClock(754_500)).toBe('12:34');
    expect(pauseClock(-500)).toBe('0:00');
  });
});

describe('the ways on without somebody away', () => {
  it('says when the way on comes on the maintenance card’s counter, then offers it', () => {
    expect(awayWays(restarted(), T0 + 42_000)).toEqual([
      { kind: 'go-on-at', name: 'Cem', at: '1:00' },
    ]);
    expect(awayWays(restarted(), T0 + 60_000 + CLOCK_MARGIN_MS - 1)).toEqual([
      { kind: 'go-on-at', name: 'Cem', at: '1:00' },
    ]);
    expect(awayWays(restarted(), T0 + 60_000 + CLOCK_MARGIN_MS)).toEqual([
      { kind: 'go-on', id: 'p3', name: 'Cem' },
    ]);
    expect(awayWays(away(), T0 + 60_000 + CLOCK_MARGIN_MS)).toEqual([
      { kind: 'go-on', id: 'p3', name: 'Cem' },
    ]);
  });

  it('counts each of several away by their own drop, none the crew went on without', () => {
    const several = away({
      players: [
        mate('p1', 'Anna'),
        mate('p2', 'Ben'),
        mate('p3', 'Cem', false),
        mate('p4', 'Dora', false),
        mate('p5', 'Emil', false),
      ],
      away: [
        CEM,
        { id: 'p4', name: 'Dora', since: T0 + 30_000, waivableAt: T0 + 50_000 },
        { id: 'p5', name: 'Emil', since: T0, waivableAt: T0, waived: true },
      ],
      pausedAt: T0,
    });
    expect(awayWays(several, T0 + 55_000)).toEqual([
      { kind: 'go-on-at', name: 'Cem', at: '1:00' },
      { kind: 'go-on', id: 'p4', name: 'Dora' },
    ]);
  });

  it('offers one alone on the line never the way on, only the run called off', () => {
    expect(awayWays(alone({ pausedAt: T0 }), T0 + 10_000)).toEqual([
      { kind: 'call-off-at', at: '1:00' },
    ]);
    expect(awayWays(alone(), T0 + 61_000)).toEqual([{ kind: 'call-off' }]);
  });

  it('offers nothing where the crew misses nobody', () => {
    const back = away({ players: [mate('p1', 'Anna'), mate('p2', 'Ben')], away: [] });
    expect(awayWays(back, T0)).toEqual([]);
    expect(missesSomebody(back)).toBe(false);
    const waived = away({ away: [{ ...CEM, waived: true }] });
    expect(awayWays(waived, T0 + 61_000)).toEqual([]);
    expect(missesSomebody(waived)).toBe(false);
    expect(missesSomebody(away())).toBe(true);
  });
});

describe('the way on in the bar, as the run goes on', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const offer = (view: PlayerView, sent: ClientMessage[] = []) =>
    elementsOf(() => <AwayOffer view={view} send={(msg) => sent.push(msg)} />);

  it('stands not before the wait is over, then goes on without Cem at a press', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 42_000);
    expect(renderToStaticMarkup(<AwayOffer view={away()} send={() => undefined} />)).toBe('');
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 61_000);
    const sent: ClientMessage[] = [];
    const button = buttonsOf(offer(away(), sent), 'pause-go-on')[0];
    expect(renderToStaticMarkup(<>{button?.props['children'] as never}</>)).toBe('Ohne Cem weiter');
    press(button);
    expect(sent).toEqual([{ kind: 'continue-without', absentId: 'p3' }]);
  });

  it('calls the run off at a press for the one alone, and offers no way on there', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 61_000);
    const sent: ClientMessage[] = [];
    const elements = offer(alone(), sent);
    expect(buttonsOf(elements, 'pause-go-on')).toEqual([]);
    press(buttonsOf(elements, 'pause-call-off')[0]);
    expect(sent).toEqual([{ kind: 'call-off' }]);
  });

  it('leaves the ways to the card while the server’s maintenance stands the run still', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 61_000);
    expect(renderToStaticMarkup(<AwayOffer view={restarted()} send={() => undefined} />)).toBe('');
  });
});

describe('the maintenance card', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says the server’s maintenance stands the run still, whom it waits for and how long', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 42_000);
    const html = renderToStaticMarkup(<PauseCard view={restarted()} send={() => undefined} />);
    expect(html).toContain('<span class="kicker">WARTUNG</span>');
    expect(html).toContain('Warten auf Cem · <span class="pause-count">0:42</span>');
    expect(html).toContain('Uhr, Patrouillen und Notfälle stehen still.');
    expect(html).toContain('Ab 1:00 lässt sich ohne Cem weitermachen.');
    expect(html).not.toContain('pause-go-on');
  });

  it('goes on without them at a press once the wait is over', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 61_000);
    const sent: ClientMessage[] = [];
    const card = <PauseCard view={restarted()} send={(msg) => sent.push(msg)} />;
    const button = buttonsOf(elementsOf(() => card), 'pause-go-on')[0];
    press(button);
    expect(sent).toEqual([{ kind: 'continue-without', absentId: 'p3' }]);
  });

  it('calls the run off at a press for the one alone', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 61_000);
    const sent: ClientMessage[] = [];
    const card = () => <PauseCard view={alone({ pausedAt: T0 })} send={(msg) => sent.push(msg)} />;
    const elements = elementsOf(card);
    expect(buttonsOf(elements, 'pause-go-on')).toEqual([]);
    press(buttonsOf(elements, 'pause-call-off')[0]);
    expect(sent).toEqual([{ kind: 'call-off' }]);
  });
});

/** Anna's game screen of a run with `parts` of its view, the server's clock at `now`. */
function screen(parts: Partial<PlayerView>, now: number): string {
  vi.spyOn(clock, 'now').mockReturnValue(now);
  const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: false, isHost: true };
  const view: PlayerView = {
    ...away(),
    phase: 'playing',
    missionId: 'systemcheck',
    missionTitle: 'Tutorial: Systemcheck',
    difficulty: 'normal',
    storyText: 'Los.',
    crewSize: { min: 3, max: 3 },
    chat: [],
    you: anna,
    palette: [],
    deadlineAt: T0 + 300_000,
    startedAt: T0 - 60_000,
    finishedAt: null,
    timeLimitSec: 420,
    lights: { out: true, outAt: T0 - 60_000 },
    currentPuzzleIndex: 0,
    puzzleCount: 4,
    events: [],
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
    noteHere: null,
    puzzle: null,
    map: mapWith({}),
    ...parts,
  };
  const noop = (): void => undefined;
  return renderToStaticMarkup(
    <GameScreen
      view={view}
      roomCode="KX4P"
      positionsRef={{ current: { run: null, players: {} } }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      send={noop}
      listen={() => noop}
      refusal={null}
      finale={null}
      line={{ status: 'open', retry: null, wake: noop, giveUp: noop }}
    />,
  );
}

describe('the game screen of a run with somebody away', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lays no card over the world for a drop: the strip counts, the bar offers the way on', () => {
    const counting = screen({}, T0 + 12_000);
    expect(counting).not.toContain('overlay pause');
    expect(counting).not.toContain('WARTUNG');
    expect(counting).toContain('<li class="hud-away">');
    expect(counting).toContain('getrennt · 0:12');
    expect(counting).not.toContain('away-offer');
    const offered = screen({}, T0 + 61_000);
    expect(offered).toContain('<div class="away-offer">');
    expect(offered).toContain('Ohne Cem weiter');
  });

  it('lays the maintenance card over the world, and the bar offers nothing beside it', () => {
    const html = screen({ pausedAt: T0 }, T0 + 61_000);
    expect(html).toContain('<span class="kicker">WARTUNG</span>');
    expect(html).not.toContain('away-offer');
  });
});

describe('a station the whole crew works, with somebody away', () => {
  it('names a lever for each of the crew the run counts: Cem’s too, till it goes on without', () => {
    const run = { events: [], alarms: { count: 0, limit: 5 }, penaltySeq: 0, currentPuzzleIndex: 0 };
    const view = { ...away(), ...run, you: { ...mate('p1', 'Anna'), ready: false } } as PlayerView;
    const names = (v: PlayerView): string[] =>
      deviceRunOf(v, null).crew.mates.map((m) => m.name);
    expect(names(view)).toEqual(['Anna', 'Ben', 'Cem']);
    const waived = { ...view.players[2], waived: true as const } as PlayerView['players'][number];
    const without = { ...view, players: [...view.players.slice(0, 2), waived] };
    expect(names(without)).toEqual(['Anna', 'Ben']);
  });
});

describe('a crew member away in the crew strip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is greyed, gone since when on the server’s clock, or gone to the main menu', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 72_500);
    const view = { ...away(), you: { ...mate('p1', 'Anna'), ready: false }, map: null };
    const cem = view.players[2] ?? mate('p3', 'Cem', false);
    expect(tagsOf(view, cem, {})).toEqual([{ text: 'getrennt · 1:12', tone: 'away' }]);
    const menu = { ...cem, menu: 'main' as const };
    expect(tagsOf(view, menu, {})).toEqual([{ text: 'im Hauptmenü · 1:12', tone: 'away' }]);
    expect(mateClass(view, cem)).toBe('hud-away');
    expect(mateClass(view, view.players[0] ?? cem)).toBe('hud-me');
    expect(mateClass(view, view.players[1] ?? cem)).toBe('');
  });
});

describe('a return the run went on without', () => {
  it('is somebody waived in one view and on the line in the next', () => {
    const before = [mate('p1', 'Anna'), { ...mate('p3', 'Cem', false), waived: true as const }];
    expect(returnsOf(before, [mate('p1', 'Anna'), mate('p3', 'Cem')])).toEqual(['Cem']);
    expect(returnsOf(before, before)).toEqual([]);
    // A return the crew did not go on without is no news: whoever comes back simply plays on.
    expect(returnsOf([mate('p3', 'Cem', false)], [mate('p3', 'Cem')])).toEqual([]);
  });

  it('is said with the name', () => {
    expect(backLine(['Cem'])).toBe('Cem ist zurück');
    expect(backLine(['Ben', 'Cem'])).toBe('Ben und Cem sind zurück');
    expect(backLine(['Anna', 'Ben', 'Cem'])).toBe('Anna, Ben und Cem sind zurück');
  });
});

describe('a run called off', () => {
  it('ends on its own card, saying whom it was called off without', () => {
    const view: CardSource = {
      phase: 'lost',
      alarms: { count: 1, limit: 5 },
      calledOff: 'Abgebrochen ohne Ben.',
      missionTitle: 'Blackout im Labor',
      startedAt: T0,
      lights: { out: true, outAt: T0 },
      finishedAt: T0 + 300_000,
      grade: null,
      currentPuzzleIndex: 2,
      puzzleCount: 6,
      events: [],
      players: [mate('p1', 'Anna'), mate('p2', 'Ben', false)],
    };
    expect(endingOf(view)).toBe('lost:abandoned');
    expect(endingOf({ phase: view.phase, alarms: view.alarms })).toBe('lost:time');
    const html = renderToStaticMarkup(<TitleCard {...titleCardOf(view, 'p1', false)} />);
    expect(html).toContain('<h1 class="end-title-word">EINSATZ ABGEBROCHEN</h1>');
    expect(html).toContain('<span class="end-cause">Abgebrochen ohne Ben.</span>');
    expect(html).toContain('end-title--time');
  });
});

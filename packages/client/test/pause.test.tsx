import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, PlayerView } from '@escapelab/core';
import { clock } from '../src/clock.js';
import { TitleCard, titleCardOf, type CardSource } from '../src/screens/End.js';
import {
  backLine,
  CLOCK_MARGIN_MS,
  PauseCard,
  pauseClock,
  pauseWays,
  returnsOf,
} from '../src/screens/Pause.js';
import { endingOf } from '../src/world/finale.js';
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

/** Anna's view of a run that stands still since T0 for Cem, Ben still on the line with her. */
function waiting(parts: Partial<PlayerView> = {}): PlayerView {
  return {
    players: [mate('p1', 'Anna'), mate('p2', 'Ben'), mate('p3', 'Cem', false)],
    pausedFor: [{ id: 'p3', name: 'Cem', since: T0, waivableAt: T0 + 60_000 }],
    pausedAt: T0,
    ...parts,
  } as PlayerView;
}

describe('the pause card’s counter', () => {
  it('counts the pause in minutes and seconds, whole seconds down', () => {
    expect(pauseClock(0)).toBe('0:00');
    expect(pauseClock(42_999)).toBe('0:42');
    expect(pauseClock(60_000)).toBe('1:00');
    expect(pauseClock(754_500)).toBe('12:34');
    expect(pauseClock(-500)).toBe('0:00');
  });
});

describe('the ways on the pause card offers', () => {
  it('says when the way on without the one away comes, then offers it', () => {
    expect(pauseWays(waiting(), T0 + 42_000)).toEqual([
      { kind: 'go-on-at', name: 'Cem', at: '1:00' },
    ]);
    expect(pauseWays(waiting(), T0 + 60_000 + CLOCK_MARGIN_MS - 1)).toEqual([
      { kind: 'go-on-at', name: 'Cem', at: '1:00' },
    ]);
    expect(pauseWays(waiting(), T0 + 60_000 + CLOCK_MARGIN_MS)).toEqual([
      { kind: 'go-on', id: 'p3', name: 'Cem' },
    ]);
  });

  it('counts each of several away by their own drop', () => {
    const two = waiting({
      players: [
        mate('p1', 'Anna'),
        mate('p2', 'Ben'),
        mate('p3', 'Cem', false),
        mate('p4', 'Dora', false),
      ],
      pausedFor: [
        { id: 'p3', name: 'Cem', since: T0, waivableAt: T0 + 60_000 },
        { id: 'p4', name: 'Dora', since: T0 + 30_000, waivableAt: T0 + 50_000 },
      ],
    });
    expect(pauseWays(two, T0 + 55_000)).toEqual([
      { kind: 'go-on-at', name: 'Cem', at: '1:00' },
      { kind: 'go-on', id: 'p4', name: 'Dora' },
    ]);
  });

  it('offers one alone on the line never the way on, only the run called off', () => {
    const alone = waiting({ players: [mate('p1', 'Anna'), mate('p2', 'Ben', false)] });
    const ben = { id: 'p2', name: 'Ben', since: T0, waivableAt: T0 + 60_000 };
    const away = { ...alone, pausedFor: [ben] };
    expect(pauseWays(away, T0 + 10_000)).toEqual([{ kind: 'call-off-at', at: '1:00' }]);
    expect(pauseWays(away, T0 + 61_000)).toEqual([{ kind: 'call-off' }]);
  });

  it('offers nothing while the run runs on', () => {
    expect(pauseWays(waiting({ pausedFor: null, pausedAt: null }), T0)).toEqual([]);
  });
});

describe('the pause card', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for the one away and counts the pause on the server’s clock', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 42_000);
    const html = renderToStaticMarkup(<PauseCard view={waiting()} send={() => undefined} />);
    expect(html).toContain('MISSION PAUSIERT');
    expect(html).toContain('Warten auf Cem · <span class="pause-count">0:42</span>');
    expect(html).toContain('Ab 1:00 lässt sich ohne Cem weitermachen.');
    expect(html).not.toContain('pause-go-on');
  });

  it('says it is the server’s maintenance that stands the run still, after a restart', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 8000);
    const restarted = waiting({ maintenance: true });
    const html = renderToStaticMarkup(<PauseCard view={restarted} send={() => undefined} />);
    expect(html).toContain('<span class="kicker">WARTUNG</span>');
    expect(html).not.toContain('MISSION PAUSIERT');
    expect(html).toContain('Warten auf Cem · <span class="pause-count">0:08</span>');
  });

  it('goes on without them at a press once the wait is over', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 61_000);
    const sent: ClientMessage[] = [];
    const card = <PauseCard view={waiting()} send={(msg) => sent.push(msg)} />;
    const elements = elementsOf(() => card);
    const button = buttonsOf(elements, 'pause-go-on')[0];
    expect(renderToStaticMarkup(<>{button?.props['children'] as never}</>)).toBe('Ohne Cem weiter');
    press(button);
    expect(sent).toEqual([{ kind: 'continue-without', absentId: 'p3' }]);
  });

  it('calls the run off at a press for the one alone', () => {
    vi.spyOn(clock, 'now').mockReturnValue(T0 + 61_000);
    const alone = waiting({
      players: [mate('p1', 'Anna'), mate('p2', 'Ben', false)],
      pausedFor: [{ id: 'p2', name: 'Ben', since: T0, waivableAt: T0 + 60_000 }],
    });
    const sent: ClientMessage[] = [];
    const elements = elementsOf(() => <PauseCard view={alone} send={(msg) => sent.push(msg)} />);
    expect(buttonsOf(elements, 'pause-go-on')).toEqual([]);
    press(buttonsOf(elements, 'pause-call-off')[0]);
    expect(sent).toEqual([{ kind: 'call-off' }]);
  });
});

describe('a return the run went on without', () => {
  it('is somebody waived in one view and on the line in the next', () => {
    const before = [mate('p1', 'Anna'), { ...mate('p3', 'Cem', false), waived: true as const }];
    expect(returnsOf(before, [mate('p1', 'Anna'), mate('p3', 'Cem')])).toEqual(['Cem']);
    expect(returnsOf(before, before)).toEqual([]);
    // A return the run waited for is no news: the pause card simply goes.
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

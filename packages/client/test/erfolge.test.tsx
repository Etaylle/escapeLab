import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AchievementId, DailyStats, MissionInfo, PlayerView } from '@escapelab/core';
import {
  ACHIEVEMENTS_KEY,
  earnedCount,
  keepEarned,
  newOnes,
  readEarned,
} from '../src/achievements.js';
import { DailyDays } from '../src/screens/History.js';
import { EndScreen, shareCardOf, titleCardOf } from '../src/screens/End.js';
import { DAILY_NOTE, DailySwitch, LobbyScreen } from '../src/screens/Lobby.js';
import { Plaques } from '../src/screens/Plaques.js';
import {
  CREW_RIGHT,
  drawShareCard,
  saveShareCard,
  SHARE_SIZE,
  shareFileName,
  type ShareCard,
} from '../src/screens/shareCard.js';
import { callsOf, fakeCanvas } from './fakeCanvas.js';
import { buttonsOf, elementsOf, press } from './probe.js';

const noop = (): void => undefined;

/** The browser's storage, in memory. */
function memory(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

/** 31 October 2026, noon UTC: when the runs here end. */
const OCT_31 = Date.UTC(2026, 9, 31, 12);
const ANNA = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: false, isHost: true };
const BEN = { id: 'p2', name: 'Ben', color: '#f472b6', ready: false, isHost: false };

/** Blackout won as Anna sees it — 4:56 from the lights going out, rank A — unless told else. */
function blackoutOver(parts: Partial<PlayerView> = {}): PlayerView {
  const outAt = OCT_31 - 296_000;
  return {
    phase: 'won',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: 'Die Systeme erwachen.',
    cast: { pa: 'anlage', operator: 'helmut', lead: null },
    crewSize: { min: 2, max: 3 },
    chat: [],
    you: ANNA,
    players: [ANNA, BEN].map((p) => ({ ...p, connected: true })),
    palette: [],
    deadlineAt: outAt + 900_000,
    startedAt: outAt - 30_000,
    lights: { out: true, outAt },
    finishedAt: OCT_31,
    timeLimitSec: 900,
    currentPuzzleIndex: 6,
    puzzleCount: 6,
    away: [],
    pausedAt: null,
    events: [],
    grade: { rank: 'A', label: 'Sauber' },
    penaltySeq: 1,
    lastPenaltySec: null,
    alarms: { count: 1, limit: 5 },
    hintsUsed: 0,
    credits: {},
    edgework: null,
    presence: { stationId: null, console: null, manualId: null, signSeen: true },
    sourcesHere: [],
    manualsHere: [],
    noteHere: null,
    puzzle: null,
    map: null,
    daily: { on: false, day: null },
    achievements: ['unter-acht-minuten', 'ungesehen', 'stiller-serverraum', 'erste-schicht'],
    ...parts,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Erfolge kept on this device', () => {
  it('keeps each plaque with the day it was first earned, mission by mission', () => {
    const store = memory();
    expect(readEarned(store)).toEqual({});
    expect(keepEarned(store, 'blackout', ['ungesehen', 'erste-schicht'], OCT_31)).toBe(true);
    const nextDay = OCT_31 + 86_400_000;
    expect(keepEarned(store, 'blackout', ['erste-schicht', 'ohne-alarm'], nextDay)).toBe(true);
    const known = readEarned(store);
    expect(known['blackout']).toEqual({
      ungesehen: OCT_31,
      'erste-schicht': OCT_31,
      'ohne-alarm': nextDay,
    });
    expect(earnedCount(known, 'blackout')).toBe(3);
    expect(earnedCount(known, 'systemcheck')).toBe(0);
    expect(newOnes(known, 'blackout', ['erste-schicht', 'alle-notizen'])).toEqual(['alle-notizen']);
  });

  it('counts nothing it cannot read, and keeps nothing where the browser refuses', () => {
    const odd = memory({ [ACHIEVEMENTS_KEY]: '{"blackout":{"ungesehen":"gestern","neu":5}}' });
    expect(readEarned(odd)).toEqual({ blackout: {} });
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    expect(readEarned(memory({ [ACHIEVEMENTS_KEY]: 'kaputt{' }))).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(keepEarned(null, 'blackout', ['ungesehen'], OCT_31)).toBe(false);
    // A browser that refuses its storage is told of once for reading and once for keeping.
    const refusing = {
      getItem: (): string | null => {
        throw new Error('SecurityError: storage denied');
      },
      setItem: (): void => {
        throw new Error('QuotaExceededError: storage full');
      },
    };
    warn.mockClear();
    for (let i = 0; i < 2; i += 1) {
      expect(readEarned(refusing)).toEqual({});
      expect(keepEarned(refusing, 'blackout', ['ungesehen'], OCT_31)).toBe(false);
    }
    expect(warn.mock.calls.map(([what]) => String(what))).toEqual([
      '[escapelab] the browser keeps no Erfolge here: none are read',
      '[escapelab] the browser keeps no Erfolge here: the run’s stay on this screen',
    ]);
  });
});

describe('the plaques on the won card', () => {
  it('lets the ones new to this device come in 300 ms apart; the ones seen before stand', () => {
    const fresh = new Set<AchievementId>(['ungesehen', 'erste-schicht']);
    const html = renderToStaticMarkup(
      <Plaques
        earned={['unter-acht-minuten', 'ungesehen', 'erste-schicht']}
        fresh={fresh}
        since={{ 'unter-acht-minuten': OCT_31 - 86_400_000, ungesehen: OCT_31 }}
      />,
    );
    expect(html).toContain('aria-label="Erfolge: 3 von 7"');
    expect(html).toContain('<li class="plaque" data-achievement="unter-acht-minuten">');
    expect(html).toContain(
      '<li class="plaque plaque--new" style="--i:0" data-achievement="ungesehen">',
    );
    expect(html).toContain('style="--i:1" data-achievement="erste-schicht"');
    expect(html).toContain('<span class="plaque-title">Ungesehen</span>');
    expect(html).toContain('<span class="plaque-date">30.10.2026</span>');
    expect(renderToStaticMarkup(<Plaques earned={[]} fresh={fresh} since={{}} />)).toBe('');
  });

  it('shows the run’s plaques under the facts, new to a device that kept none', () => {
    vi.stubGlobal('window', { localStorage: memory() });
    const html = renderToStaticMarkup(
      <EndScreen view={blackoutOver()} fresh={false} send={noop} leaveRoom={noop} />,
    );
    const card = html.slice(0, html.indexOf('</section>'));
    expect(card.match(/class="plaque plaque--new"/g)).toHaveLength(4);
    expect(card).toContain('Stiller Serverraum');
    expect(card).toContain('Bild speichern');
  });

  it('shows plaques seen before standing, a lost card none — but its picture', () => {
    const kept = JSON.stringify({ blackout: { ungesehen: OCT_31 - 86_400_000 } });
    vi.stubGlobal('window', { localStorage: memory({ [ACHIEVEMENTS_KEY]: kept }) });
    const won = renderToStaticMarkup(
      <EndScreen view={blackoutOver()} fresh={false} send={noop} leaveRoom={noop} />,
    );
    expect(won).toContain('<li class="plaque" data-achievement="ungesehen">');
    expect(won.match(/plaque--new/g)).toHaveLength(3);
    const lost = renderToStaticMarkup(
      <EndScreen
        view={blackoutOver({ phase: 'lost', grade: null, achievements: [], currentPuzzleIndex: 3 })}
        fresh={false}
        send={noop}
        leaveRoom={noop}
      />,
    );
    expect(lost).not.toContain('class="plaque');
    expect(lost).toContain('Bild speichern');
  });
});

describe('the lobby', () => {
  const blackout: MissionInfo = {
    id: 'blackout',
    title: 'Blackout im Labor',
    subtitle: '',
    players: { min: 2, max: 3 },
    timeLimitSec: 900,
    puzzleCount: 6,
    tiles: [],
  };

  /** Anna's lobby as host (or as a guest), the Tagesschicht as `daily`. */
  function lobby(daily: PlayerView['daily'], isHost = true): string {
    const anna = { ...ANNA, isHost };
    const view = blackoutOver({
      phase: 'lobby',
      you: anna,
      players: [{ ...anna, connected: true }],
      ...(daily === undefined ? {} : { daily }),
    });
    if (daily === undefined) {
      delete view.daily;
    }
    return renderToStaticMarkup(
      <LobbyScreen view={view} send={noop} leaveRoom={noop} missions={[blackout]} stats={[]} />,
    );
  }

  it('counts the mission’s plaques this device holds: Erfolge 3/7', () => {
    const kept = JSON.stringify({
      blackout: { ungesehen: 1, 'ohne-alarm': 2, 'erste-schicht': 3 },
    });
    vi.stubGlobal('window', { localStorage: memory({ [ACHIEVEMENTS_KEY]: kept }) });
    expect(lobby({ on: false, day: null })).toContain('Erfolge 3/7');
  });

  it('offers the host the Tagesschicht, named by today, where the mission has one', () => {
    vi.useFakeTimers({ now: OCT_31 });
    const off = lobby({ on: false, day: null });
    expect(off).toContain('role="switch" aria-checked="false"');
    expect(off).toContain('Tagesschicht 31.10.');
    // A chip beside the difficulty's caption, what it is in its title.
    expect(off).toMatch(/<p class="lobby-caption">Schwierigkeit<\/p><button[^>]*role="switch"/);
    expect(off).toContain(`title="${DAILY_NOTE}"`);
    const on = lobby({ on: true, day: null });
    expect(on).toContain('class="daily-switch daily-switch--on" role="switch" aria-checked="true"');
    // Everyone else sees whether it is on.
    expect(lobby({ on: true, day: null }, false)).toContain('Tagesschicht 31.10. · an');
    expect(lobby({ on: false, day: null }, false)).not.toContain('role="switch"');
    // A mission without one offers none.
    expect(lobby(undefined)).not.toContain('Tagesschicht');
    // Past midnight (UTC) the switch names the new day, on or off: the run plays that one.
    vi.setSystemTime(Date.UTC(2026, 10, 1, 0, 5));
    expect(lobby({ on: true, day: null })).toContain('Tagesschicht 01.11.');
    vi.useRealTimers();
  });

  it('sends the host’s switch: on, then off — the lobby sends it on as set-daily', () => {
    const sent: boolean[] = [];
    const pick = (daily: boolean) => sent.push(daily);
    const off = <DailySwitch on={false} today="2026-10-31" pick={pick} />;
    press(buttonsOf(elementsOf(() => off), 'daily-switch')[0]);
    const on = <DailySwitch on today="2026-10-31" pick={pick} />;
    press(buttonsOf(elementsOf(() => on), 'daily-switch')[0]);
    expect(sent).toEqual([true, false]);
  });
});

describe('the Tagesschicht in the Bestenliste', () => {
  const day = (id: string, best: number): DailyStats => ({
    day: id,
    missions: [
      {
        missionId: 'blackout',
        difficulties: [
          {
            difficulty: 'normal',
            runs: 3,
            wins: 2,
            bestSeconds: best,
            medianSeconds: best + 20,
            top: [{ crew: ['Anna', 'Ben'], crewSize: 2, seconds: best, alarms: 0, finishedAt: 1 }],
          },
        ],
      },
    ],
  });
  const missions = [{ id: 'blackout', title: 'Blackout im Labor' } as MissionInfo];

  it('lists the days, the newest first and picked, and the day’s fastest crews', () => {
    const days = [day('2026-10-31', 296), day('2026-10-30', 340)];
    const html = renderToStaticMarkup(
      <DailyDays days={days} missions={missions} difficulty="normal" />,
    );
    expect(html).toContain('<button class="history-level" aria-pressed="true">31.10.</button>');
    expect(html).toContain('<button class="history-level" aria-pressed="false">30.10.</button>');
    expect(html).toContain('<h2>Blackout im Labor · Tagesschicht 31.10. · Normal</h2>');
    expect(html).toContain('Anna, Ben');
    expect(html).toContain('4:56');
  });

  it('says so before the first Tagesschicht, and where nobody ran that difficulty', () => {
    const none = <DailyDays days={[]} missions={missions} difficulty="normal" />;
    expect(renderToStaticMarkup(none)).toContain('Noch ist keine Tagesschicht gelaufen.');
    const hard = renderToStaticMarkup(
      <DailyDays days={[day('2026-10-31', 296)]} missions={missions} difficulty="hart" />,
    );
    expect(hard).toContain('Auf dieser Stufe ist an diesem Tag niemand gelaufen.');
  });
});

describe('the picture of a run', () => {
  /** What the card wrote, line by line. */
  const written = (card: ShareCard): string[] => {
    const { ctx, log } = fakeCanvas(SHARE_SIZE.width, SHARE_SIZE.height);
    drawShareCard(ctx, card);
    return callsOf(log, 'fillText').map(([words]) => String(words));
  };

  it('draws a won run: mission, word, time, rank, crew, Erfolge, day, the plant', () => {
    vi.stubGlobal('window', { localStorage: memory() });
    const view = blackoutOver({ daily: { on: true, day: '2026-10-31' } });
    const lines = written(shareCardOf(view, titleCardOf(view, 'p1', false)));
    for (const line of [
      'ESCAPELAB',
      '31.10.2026',
      'TAGESSCHICHT 31.10.',
      'BLACKOUT IM LABOR',
      'GESCHAFFT',
      '4:56',
      'A',
      'RANG',
      'Anna',
      'Ben',
      'UNTER ACHT MINUTEN',
      'STILLER SERVERRAUM',
      'FORSCHUNGSANLAGE KALTENBRUNN',
    ]) {
      expect(lines, line).toContain(line);
    }
    expect(SHARE_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it('draws a run lost with the stations it got through, no rank, no plaques', () => {
    const view = blackoutOver({
      phase: 'lost',
      grade: null,
      achievements: [],
      currentPuzzleIndex: 3,
    });
    const lines = written(shareCardOf(view, titleCardOf(view, 'p1', false)));
    expect(lines).toContain('ZEIT ABGELAUFEN');
    expect(lines).toContain('3/6');
    expect(lines).toContain('STATIONEN');
    expect(lines).not.toContain('RANG');
    expect(lines).not.toContain('TAGESSCHICHT 31.10.');
  });

  /** The card drawn with letters as wide as a monospace font's at its size: each line, its end. */
  const drawnLines = (card: ShareCard) => {
    const { ctx } = fakeCanvas(SHARE_SIZE.width, SHARE_SIZE.height);
    const sizeOf = (): number => Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 10);
    ctx.measureText = (words: string) => ({ width: words.length * sizeOf() * 0.6 }) as TextMetrics;
    const drawn: { words: string; right: number }[] = [];
    const fill = ctx.fillText.bind(ctx);
    ctx.fillText = (words: string, x: number, y: number) => {
      drawn.push({ words, right: x + ctx.measureText(words).width });
      fill(words, x, y);
    };
    drawShareCard(ctx, card);
    return drawn;
  };

  it('keeps the crew left of the plaques: smaller for long names, cut short for very long', () => {
    const view = blackoutOver({});
    const base = shareCardOf(view, titleCardOf(view, 'p1', false));
    const crewOf = (names: string[]) =>
      drawnLines({ ...base, crew: names.map((name) => ({ name, color: '#2dd4bf' })) }).filter(
        ({ words }) => names.some((name) => name.startsWith(words.replace('…', ''))),
      );
    const long = ['Maximiliane', 'Bartholomäus', 'Konstantinos'];
    const three = crewOf(long);
    expect(three.map(({ words }) => words)).toEqual(long);
    expect(Math.max(...three.map(({ right }) => right))).toBeLessThanOrEqual(CREW_RIGHT);
    const four = crewOf(['Maximiliane von Hohenberg', 'Bartholomäus Ziegler', 'Kunigunde', 'Ho']);
    expect(four.map(({ words }) => words.endsWith('…'))).toEqual([true, true, false, false]);
    expect(Math.max(...four.map(({ right }) => right))).toBeLessThanOrEqual(CREW_RIGHT);
  });

  it('says why where the browser draws or encodes no picture, its reason the cause', async () => {
    const view = blackoutOver({});
    const card = shareCardOf(view, titleCardOf(view, 'p1', false));
    const { ctx } = fakeCanvas(SHARE_SIZE.width, SHARE_SIZE.height);
    const page = (encoded: Blob | null) => ({
      createElement: () => ({
        getContext: () => ctx,
        toBlob: (done: (blob: Blob | null) => void) => done(encoded),
      }),
    });
    vi.stubGlobal('document', page(null));
    await expect(saveShareCard(card)).rejects.toThrow('Das Bild ließ sich nicht erzeugen.');
    const old = new TypeError('ctx.roundRect is not a function');
    ctx.roundRect = () => {
      throw old;
    };
    const refused = await saveShareCard(card).catch((err: unknown) => err);
    expect(refused).toEqual(new Error('Dieser Browser zeichnet das Bild nicht.'));
    expect((refused as Error).cause).toBe(old);
    vi.unstubAllGlobals();
  });

  it('is saved under the mission and the day', () => {
    expect(shareFileName({ missionTitle: 'Blackout im Labor', finishedAt: OCT_31 })).toBe(
      'escapelab-blackout-im-labor-2026-10-31.png',
    );
    expect(shareFileName({ missionTitle: 'Tutorial: Systemcheck', finishedAt: OCT_31 })).toBe(
      'escapelab-tutorial-systemcheck-2026-10-31.png',
    );
  });
});

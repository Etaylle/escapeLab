import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerView } from '@escapelab/core';
import { roomCrew } from '../src/App.js';
import { GUARD, guardHistory, guarded, SPENT, type GuardedWindow } from '../src/historyGuard.js';
import { crewTags } from '../src/screens/Crew.js';
import { GiveUpAsk, giveUpLines } from '../src/screens/GiveUp.js';
import { hostNews, startBlocker } from '../src/screens/Lobby.js';
import { PauseCard } from '../src/screens/Pause.js';
import { PAUSE_LABELS, pauseItems } from '../src/screens/PauseMenu.js';

const noop = (): void => undefined;

/** The items a menu at `phase` shows, by their words. */
const itemsSaid = (phase: 'run' | 'lobby' | 'audience'): string[] =>
  pauseItems(phase).map((item) => PAUSE_LABELS[item]);

/** A member of the crew as a view lists them. */
function mate(id: string, parts: Partial<PlayerView['players'][number]> = {}) {
  return { id, name: id, color: '#2dd4bf', ready: true, connected: true, isHost: false, ...parts };
}

describe('the ways out of a room on its menu', () => {
  it('lead from a run to the main menu, the seat kept, and then to giving the seat up', () => {
    expect(itemsSaid('run')).toEqual([
      'Weiter',
      'Einstellungen',
      'Handbuch',
      'Zum Hauptmenü',
      'Einsatz aufgeben',
    ]);
  });

  it('lead from a lobby to the main menu, and out of the room; the audience simply goes', () => {
    expect(itemsSaid('lobby').slice(3)).toEqual(['Zum Hauptmenü', 'Raum verlassen']);
    expect(itemsSaid('audience').slice(3)).toEqual(['Zuschauen beenden']);
  });
});

describe('giving a run’s seat up from the menu', () => {
  it('asks once, saying the seat goes for good and what becomes of the run', () => {
    expect(giveUpLines(3, 2)).toEqual([
      'Der Platz wird aufgegeben und lässt sich nicht zurückholen.',
      'Der Einsatz läuft mit 2 Plätzen weiter.',
    ]);
    expect(giveUpLines(2, 2)[1]).toBe(
      'Mit 1 Platz liegt der Einsatz unter seiner Mindestbesetzung von 2 und endet damit für alle.',
    );
  });

  it('stands as a card of its own over the menu, its way back beside the way out', () => {
    const html = renderToStaticMarkup(
      <GiveUpAsk taken={2} least={2} onGiveUp={noop} onBack={noop} />,
    );
    expect(html).toMatch(/^<div class="overlay give-up-ask" role="alertdialog" aria-modal="true"/);
    expect(html).toContain('<h2 id="give-up-title" class="give-up-title">Einsatz aufgeben?</h2>');
    expect(html).toContain('und endet damit für alle.</p>');
    expect(html).toContain('give-up-confirm">Einsatz aufgeben</button>');
    expect(html).toContain('<button class="give-up-back">Zurück</button>');
  });

  it('counts the run’s seats from the player’s view; the audience holds none', () => {
    const view = { players: [mate('p1'), mate('p2'), mate('p3')], crewSize: { min: 2, max: 3 } };
    expect(roomCrew({ view: view as PlayerView })).toEqual({ taken: 3, least: 2 });
    expect(roomCrew({ view: null })).toBeNull();
  });
});

describe('the crew’s word of who went to the main menu', () => {
  it('stands on no maintenance card: whoever went is not waited for there', () => {
    const away = [
      { id: 'p2', name: 'Ben', since: 1, waivableAt: 2, menu: true as const },
      { id: 'p3', name: 'Cem', since: 5, waivableAt: 6, maintenance: true as const },
    ];
    const view = {
      players: [
        mate('p1'),
        mate('p2', { connected: false, menu: 'main' }),
        mate('p3', { connected: false }),
      ],
      away,
      pausedAt: 5,
    } as unknown as PlayerView;
    const html = renderToStaticMarkup(<PauseCard view={view} send={noop} />);
    expect(html).toContain('Warten auf Cem · ');
    expect(html).not.toContain('Ben');
    expect(html).not.toContain('Hauptmenü');
  });

  it('marks them in the strip as in the main menu, not as a line down', () => {
    const at = { stationId: null, console: null, manualId: null, signSeen: false };
    const gone = { id: 'p2', connected: false, menu: 'main' as const };
    expect(crewTags(null, gone, at, undefined)).toEqual([{ text: 'im Hauptmenü', tone: 'away' }]);
    expect(crewTags(null, { id: 'p2', connected: false }, at, undefined)[0]?.text).toBe('getrennt');
  });

  it('holds a lobby’s start, naming who is in the main menu', () => {
    const ben = mate('Ben', { connected: false, menu: 'main' });
    const players = [mate('Anna', { isHost: true }), ben];
    expect(startBlocker({ crewSize: { min: 2, max: 3 }, players })).toBe('Ben ist im Hauptmenü');
  });
});

describe('the host’s part passed on in a lobby', () => {
  it('is said: who went, and who leads the room now', () => {
    const before = [mate('Anna', { isHost: true }), mate('Ben'), mate('Cem')];
    const after = [mate('Ben'), mate('Cem', { isHost: true })];
    expect(hostNews(before, after)).toBe('Anna ist gegangen · Cem leitet jetzt den Raum.');
  });

  it('is not said where the host stays, or another member goes', () => {
    const before = [mate('Anna', { isHost: true }), mate('Ben')];
    expect(hostNews(before, [mate('Anna', { isHost: true })])).toBeNull();
    expect(hostNews(before, before)).toBeNull();
  });
});

/** A window's history as the browser keeps it: its steps, the one it stands on, popstate. */
function browserHistory() {
  const steps: unknown[] = [null];
  let at = 0;
  const listeners = new Set<() => void>();
  const win: GuardedWindow = {
    history: {
      get state() {
        return steps[at];
      },
      pushState: (data) => {
        steps.splice(at + 1, steps.length, data);
        at += 1;
      },
      replaceState: (data) => {
        steps[at] = data;
      },
    },
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  };
  /** The browser's back button: a step back, and `popstate` told. */
  const back = (): void => {
    at = Math.max(0, at - 1);
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return { win, back, steps: () => steps.slice(0, at + 1), listeners };
}

describe('the browser’s back button in a run', () => {
  it('opens the run’s menu instead of leaving the page, each time it is pressed', () => {
    const { win, back, steps } = browserHistory();
    const opened = vi.fn();
    const letGo = guardHistory(win, opened);
    expect(steps()).toEqual([null, { [GUARD]: true }]);
    back();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(guarded(win.history.state)).toBe(true);
    back();
    expect(opened).toHaveBeenCalledTimes(2);
    expect(steps()).toEqual([null, { [GUARD]: true }]);
    letGo();
    expect(guarded(win.history.state)).toBe(false);
  });

  it('lets go with no step back, which would cancel the reload of a room left', () => {
    const { win, back, steps } = browserHistory();
    const opened = vi.fn();
    const letGo = guardHistory(win, opened);
    letGo();
    // The step stays where it stood, marked spent: the page goes nowhere.
    expect(steps()).toEqual([null, { [SPENT]: true }]);
    back();
    expect(opened).not.toHaveBeenCalled();
    expect(steps()).toEqual([null]);
  });

  it('takes the spent step of a run before again: three runs in a tab leave one step', () => {
    const { win, steps } = browserHistory();
    for (let run = 0; run < 3; run++) {
      guardHistory(win, noop)();
    }
    expect(steps()).toEqual([null, { [SPENT]: true }]);
    const letGo = guardHistory(win, noop);
    expect(steps()).toEqual([null, { [GUARD]: true }]);
    letGo();
  });

  it('takes no second step where a reload found the page on the run’s step already', () => {
    const { win, steps, listeners } = browserHistory();
    win.history.pushState({ [GUARD]: true }, '');
    const letGo = guardHistory(win, noop);
    expect(steps()).toHaveLength(2);
    letGo();
    expect(listeners.size).toBe(0);
    expect(guarded(win.history.state)).toBe(false);
  });
});

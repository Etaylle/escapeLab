import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MissionInfo } from '@escapelab/core';
import { FIRST_RUN_HINT } from '../src/firstRun.js';
import {
  HALL_HINT,
  isPracticeHall,
  MissionCard,
  MissionPanel,
} from '../src/screens/MenuPanels.js';

const noop = (): void => undefined;

const blackout: MissionInfo = {
  id: 'blackout',
  title: 'Blackout im Labor',
  subtitle: 'Der Klassiker.',
  players: { min: 2, max: 3 },
  timeLimitSec: 900,
  puzzleCount: 6,
  tiles: [],
};
const tutorial: MissionInfo = { ...blackout, id: 'systemcheck', title: 'Tutorial: Systemcheck' };
const hall: MissionInfo = {
  ...blackout,
  id: 'uebungshalle',
  title: 'Übungshalle',
  timeLimitSec: 0,
  puzzleCount: 12,
};

describe('the Übungshalle on the menu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is known by its id, not by a title another mission may take', () => {
    expect(isPracticeHall(hall)).toBe(true);
    expect(isPracticeHall(tutorial)).toBe(false);
    const namesake: MissionInfo = { ...blackout, id: 'custom-halle', title: 'Übungshalle Nord' };
    expect(isPracticeHall(namesake)).toBe(false);
  });

  it('says what it is for over its title, its facts naming no clock', () => {
    const card = renderToStaticMarkup(
      <MissionCard
        mission={hall}
        stats={undefined}
        selected={false}
        first={false}
        onSelect={noop}
      />,
    );
    expect(HALL_HINT).toBe('Jede Station zum Üben');
    const title = '<span class="mission-title">Übungshalle</span>';
    expect(card).toContain(`<span class="mission-hall">${HALL_HINT}</span>${title}`);
    expect(card).toContain('ohne Uhr · 12 Stationen');
  });

  it('leaves the tutorial the only first-run line, for a device without a won run', () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    });
    const panel = renderToStaticMarkup(
      <MissionPanel
        send={noop}
        connected
        name="Anna"
        field={{ typed: 'Anna', onName: noop }}
        blocked={false}
        missions={[blackout, tutorial, hall]}
        stats={[]}
        picked={null}
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(panel.match(/class="mission-first"/g)).toHaveLength(1);
    expect(panel.match(/class="mission-hall"/g)).toHaveLength(1);
    expect(panel).toContain(FIRST_RUN_HINT);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEED_MAX, type PlayerView } from '@escapelab/core';
import { RoomCode } from '../src/App.js';
import { EndScreen } from '../src/screens/End.js';
import { createRoomMessage } from '../src/screens/Join.js';

const noop = (): void => undefined;

/** Anna's view of a lost run of a room for two. */
function lostRun(parts: Partial<PlayerView> = {}): PlayerView {
  const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: false, isHost: true };
  return {
    phase: 'lost',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: 'Stromausfall.',
    crewSize: { min: 2, max: 3 },
    you: anna,
    players: [{ ...anna, connected: true }],
    palette: [],
    deadlineAt: 481_000,
    startedAt: 1_000,
    lights: { out: true, outAt: 1_000 },
    finishedAt: 481_000,
    timeLimitSec: 480,
    currentPuzzleIndex: 0,
    puzzleCount: 5,
    pausedFor: null,
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
    map: null,
    ...parts,
  };
}

describe('?seed= on the join screen', () => {
  it('pins the room it opens to the seed the address names', () => {
    expect(createRoomMessage('Anna', 'blackout', '?seed=12')).toEqual({
      kind: 'create-room',
      name: 'Anna',
      missionId: 'blackout',
      seed: 12,
    });
    expect(createRoomMessage('Anna', null, '?trace=1&seed=007')).toEqual({
      kind: 'create-room',
      name: 'Anna',
      seed: 7,
    });
    expect(createRoomMessage('Anna', null, `?seed=${SEED_MAX}`)).toMatchObject({ seed: SEED_MAX });
  });

  it('leaves the room to chance without a seed, or one no whole number up to the largest', () => {
    const asked = ['', '?seed=', '?seed=-1', '?seed=1.5', '?seed=abc', `?seed=${SEED_MAX + 1}`];
    for (const search of asked) {
      expect(createRoomMessage('Anna', 'blackout', search)).toEqual({
        kind: 'create-room',
        name: 'Anna',
        missionId: 'blackout',
      });
    }
  });
});

describe('the seed on screen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stands muted beside the room code', () => {
    vi.stubGlobal('window', { location: { origin: 'http://lab', pathname: '/' } });
    const html = renderToStaticMarkup(<RoomCode code="QXT4" seed={123} />);
    expect(html).toMatch(/<\/button><span class="muted room-seed">Seed 123<\/span>$/);
    expect(renderToStaticMarkup(<RoomCode code="QXT4" />)).not.toContain('Seed');
  });

  it("closes the end screen with the run's seed, muted, in a pinned room only", () => {
    const pinned = lostRun({ seed: { room: 40, run: 41 } });
    const html = renderToStaticMarkup(
      <EndScreen view={pinned} fresh={false} send={noop} leaveRoom={noop} />,
    );
    expect(html).toMatch(/<p class="muted run-seed">Seed 41<\/p><\/div><\/div>$/);
    const rolled = <EndScreen view={lostRun()} fresh={false} send={noop} leaveRoom={noop} />;
    expect(renderToStaticMarkup(rolled)).not.toContain('Seed');
  });
});

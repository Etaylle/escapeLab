import type { PlayerView } from '@escapelab/core';
import { mapWith } from './fixtures.js';

/**
 * A running mission as one of its crew sees it — Anna, beside Ben — with nothing open: `parts`
 * say what a test needs otherwise.
 */
export function playingView(parts: Partial<PlayerView> = {}): PlayerView {
  const you = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: true, isHost: true };
  const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: true, isHost: false };
  return {
    phase: 'playing',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    cast: { pa: 'anlage', operator: 'helmut', lead: null },
    crewSize: { min: 2, max: 3 },
    chat: [],
    you,
    players: [
      { ...you, connected: true },
      { ...ben, connected: true },
    ],
    palette: [],
    deadlineAt: null,
    startedAt: 1,
    lights: { out: true, outAt: 1 },
    finishedAt: null,
    timeLimitSec: 600,
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    away: [],
    pausedAt: null,
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
}

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlayerView, RunEvent } from '@escapelab/core';
import { MissionHud } from '../src/screens/MissionHud.js';
import { mapWith } from './fixtures.js';

/** The HUD strip of a running mission whose report reads `events`. */
function hud(events: RunEvent[]): string {
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
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    pausedFor: null,
    events,
    grade: null,
    penaltySeq: 0,
    lastPenaltySec: null,
    hintsUsed: 0,
    credits: {},
    edgework: null,
    presence: { stationId: null, manualId: null, signSeen: false },
    sourcesHere: [],
    manualsHere: [],
    puzzle: null,
    map: mapWith({}),
  };
  return renderToStaticMarkup(
    <MissionHud
      view={view}
      positionsRef={{ current: {} }}
      chatsRef={{ current: [] }}
      onOpenInfo={() => undefined}
        notesOpen={false}
        onToggleNotes={() => undefined}
      />,
  );
}

describe('the HUD radio line', () => {
  it('reads out a find like a radio line, the newest line winning', () => {
    const html = hud([
      { at: 1, kind: 'radio', label: 'Strom weg.', seconds: null },
      { at: 2, kind: 'find', label: 'Spind durchsucht: KLEMMBRETT', seconds: null },
    ]);
    expect(html).toMatch(/<section class="hud">.*📻 Spind durchsucht: KLEMMBRETT/s);
    expect(html).not.toContain('Strom weg.');
  });
});

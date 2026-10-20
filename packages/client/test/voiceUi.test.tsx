import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@escapelab/core';
import { CrewRoom } from '../src/screens/CrewRoom.js';
import { MissionHud } from '../src/screens/MissionHud.js';
import { MicSetup } from '../src/screens/Voice.js';
import type { VoiceMesh, VoiceState } from '../src/voice/mesh.js';
import { VoiceContext } from '../src/voice/useVoice.js';
import { GameWorld } from '../src/world/GameWorld.js';
import { iconsAsWords, mapWith, PICTOGRAPH } from './fixtures.js';

const noop = (): void => undefined;

/** A stand-in for the page's voice, as the screens read it: its state and nothing else. */
function voiceOf(state: Partial<VoiceState>): VoiceMesh {
  const full: VoiceState = {
    mic: 'on',
    open: false,
    held: false,
    listening: false,
    speaking: new Set(),
    ...state,
  };
  const stand: Pick<VoiceMesh, 'subscribe' | 'getState'> = {
    subscribe: () => noop,
    getState: () => full,
  };
  return stand as VoiceMesh;
}

function within(voice: VoiceMesh | null, node: ReactNode): string {
  return renderToStaticMarkup(<VoiceContext value={voice}>{node}</VoiceContext>);
}

const anna = { id: 'p1', name: 'Anna', color: '#2dd4bf', ready: true, isHost: true };
const ben = { id: 'p2', name: 'Ben', color: '#f472b6', ready: true, isHost: false };

/** Anna's view of a run with Ben, or of the lobby before it. */
function annaSees(phase: PlayerView['phase']): PlayerView {
  return {
    phase,
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    crewSize: { min: 2, max: 3 },
    you: anna,
    players: [
      { ...anna, connected: true },
      { ...ben, connected: true },
    ],
    palette: [],
    deadlineAt: null,
    startedAt: phase === 'lobby' ? null : 1,
    finishedAt: null,
    timeLimitSec: 600,
    currentPuzzleIndex: 0,
    puzzleCount: 1,
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
    puzzle: null,
    map: phase === 'lobby' ? null : mapWith({}),
  };
}

function hud(voice: VoiceMesh | null): string {
  return within(
    voice,
    <MissionHud
      view={annaSees('playing')}
      positionsRef={{ current: { run: null, players: {} } }}
      chatsRef={{ current: [] }}
      onAir={false}
      notesOpen={false}
      onToggleNotes={noop}
      onOpenInfo={noop}
    />,
  );
}

function world(voice: VoiceMesh | null, spectator = false): string {
  return within(
    voice,
    <GameWorld
      view={annaSees('playing')}
      positionsRef={{ current: { run: null, players: {} } }}
      dronesRef={{ current: {} }}
      pingsRef={{ current: [] }}
      chatsRef={{ current: [] }}
      inputLocked={false}
      spectator={spectator}
      holdTips={false}
      onToggleInfo={noop}
      onRead={noop}
      onOperate={noop}
      send={noop}
    />,
  );
}

/** A HUD button's words after its icon, by its classes. */
function buttonWords(html: string, classes: string): string | undefined {
  const icon = '<svg [^>]*>.*?</svg>';
  return new RegExp(`<button class="${classes}"[^>]*>${icon} ([^<]*)</button>`).exec(html)?.[1];
}

describe('the HUD with the crew on voice', () => {
  it('switches between the key and an open microphone, only while one is on', () => {
    const byKey = hud(voiceOf({}));
    expect(byKey).toContain('<section class="hud hud--voice">');
    expect(buttonWords(byKey, 'hud-info hud-mic')).toBe('Mikro: Taste [V]');
    expect(byKey).toContain('aria-pressed="false"');
    expect(buttonWords(hud(voiceOf({ open: true })), 'hud-info hud-mic')).toBe('Mikro: offen');
    for (const html of [hud(voiceOf({ mic: 'off' })), hud(voiceOf({ mic: 'denied' })), hud(null)]) {
      expect(html).toContain('<section class="hud">');
      expect(html).not.toContain('hud-mic');
    }
  });

  it('puts the switch before the notes, the buttons keeping their order', () => {
    const html = hud(voiceOf({}));
    const order = ['hud-mic', 'hud-notes', 'class="hud-info"'].map((part) => html.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('marks whoever speaks beside their name, with its own icon, never an emoji', () => {
    const html = hud(voiceOf({ speaking: new Set(['p2']) }));
    expect(iconsAsWords(html)).toContain(
      '<span class="hud-name">Ben</span><span class="voice-speaking" role="img" ' +
        'aria-label="spricht">[mic]</span>',
    );
    expect(html.match(/voice-speaking/g)).toHaveLength(1);
    expect(html).not.toMatch(PICTOGRAPH);
    expect(hud(voiceOf({}))).not.toContain('voice-speaking');
  });
});

describe('the microphone in the lobby', () => {
  const setup = (state: Partial<VoiceState>): string =>
    iconsAsWords(within(voiceOf(state), <MicSetup />));

  it('is asked for on a click, headphones recommended', () => {
    const html = setup({ mic: 'off' });
    expect(html).toContain('<button class="voice-ask">[mic] Mikrofon aktivieren</button>');
    expect(html).toContain('Kopfhörer empfohlen');
  });

  it('waits on the browser while it asks', () => {
    expect(setup({ mic: 'asking' })).toContain('<button class="voice-ask" disabled="">');
  });

  it('says once on how to talk, and how to switch it off', () => {
    const html = setup({ mic: 'on' });
    expect(html).toContain('[mic] Mikro an');
    expect(html).toContain('Zum Sprechen V halten');
    expect(html).toContain('<button class="link voice-off">aus</button>');
    expect(html).not.toContain('Mikrofon aktivieren');
  });

  it('says in one quiet line why there is none, the crew still heard', () => {
    expect(setup({ mic: 'denied' })).toContain(
      'Mikrofon nicht erlaubt — du hörst die Crew trotzdem.',
    );
    expect(setup({ mic: 'missing' })).toContain('Kein Mikrofon gefunden');
    // Asking again may work after a refusal, never without HTTPS or WebRTC.
    expect(setup({ mic: 'denied' })).toContain('Mikrofon aktivieren');
    const insecure = setup({ mic: 'insecure' });
    expect(insecure).toContain('Mikrofon nur über HTTPS — du hörst die Crew trotzdem.');
    expect(insecure).not.toContain('<button');
    expect(setup({ mic: 'unsupported' })).toContain('Sprechen geht in diesem Browser nicht.');
  });

  it('shows nothing outside the app, and no emoji in it', () => {
    expect(within(null, <MicSetup />)).toBe('');
    for (const mic of ['off', 'on', 'denied'] as const) {
      expect(within(voiceOf({ mic }), <MicSetup />)).not.toMatch(PICTOGRAPH);
    }
  });

  it('hangs on the crew room’s wall beside the sign, and lights the seat of whoever speaks', () => {
    const room = (speaking: string[]): string =>
      within(
        voiceOf({ mic: 'off', speaking: new Set(speaking) }),
        <CrewRoom view={annaSees('lobby')} send={noop} />,
      );
    expect(room([])).toMatch(/<p class="crew-room-sign">[^<]*<\/p><div class="voice-setup">/);
    expect(room(['p2']).match(/seat-speaking/g)).toHaveLength(1);
    expect(room(['p2'])).toMatch(/<li class="seat seat-speaking"><span class="seat-name">Ben/);
    expect(room([])).not.toContain('seat-speaking');
  });
});

describe('the talk button in the world', () => {
  const TALK = '<button class="world-talk" aria-label="Sprechen" aria-pressed="false">🎤</button>';

  it('joins the cluster after the chat with the microphone on, lit while held', () => {
    const html = world(voiceOf({}));
    expect(html).toContain(TALK);
    expect(html.indexOf('world-talk')).toBeGreaterThan(html.indexOf('world-chat-toggle'));
    expect(world(voiceOf({ held: true }))).toContain(
      '<button class="world-talk world-talk--on" aria-label="Sprechen" aria-pressed="true">',
    );
  });

  it('is not there without a microphone, nor for the audience', () => {
    expect(world(voiceOf({ mic: 'off' }))).not.toContain('world-talk');
    expect(world(null)).not.toContain('world-talk');
    expect(world(voiceOf({}), true)).not.toContain('world-talk');
  });

  it('shows on a touch screen only: a keyboard has V for it', () => {
    const css = readFileSync(new URL('../src/styles/voice.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\n\.world-talk \{\s*display: none;/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.world-talk \{[^}]*display: grid;/);
  });

  it('gets a place of its own in the HUD rows under 820 px, sideways too', () => {
    const css = readFileSync(new URL('../src/styles/voice.css', import.meta.url), 'utf8');
    expect(css).toContain("'radio mic notes info'");
    expect(css).toContain("'crew chip mic notes info'");
    expect(css).toMatch(/\.hud-mic \{\s*grid-area: mic;/);
  });
});

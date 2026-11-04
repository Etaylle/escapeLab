import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAction,
  canSee,
  initialState,
  parseMission,
  stationKey,
  viewFor,
  type Action,
  type GameState,
  type Mission,
  type PlayerView,
  type RtcSignal,
  type ServerMessage,
  type SpectatorView,
} from '@escapelab/core';
import { LINK_RAMP_S } from '../src/voice/intercom.js';
import { VoiceMesh } from '../src/voice/mesh.js';
import { gainBetween } from '../src/voice/rules.js';
import { chainFrom, fakeGraph, FakeGain, FakeNode, lastContext } from './fakeGraph.js';
import { fakeMedia } from './fakeMedia.js';

/**
 * The voice's links between real meshes, each standing for a page, over a
 * socket in memory. The browser's peer connection is the one thing stood in
 * for: it sets descriptions, hands out one candidate after its own, and
 * counts as connected once both ends are described — no sound, no network.
 */

interface Description {
  type: string;
  sdp: string;
}

interface Transceiver {
  direction: string;
  /** what goes out on it: every track put on, in order */
  sender: { sent: unknown[]; replaceTrack: (track: unknown) => Promise<void> };
}

class FakeConnection {
  static made: FakeConnection[] = [];
  readonly id = FakeConnection.made.length;
  onicecandidate: ((event: { candidate: object | null }) => void) | null = null;
  ontrack: ((event: { track: object; streams: object[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  signalingState = 'stable';
  connectionState = 'new';
  localDescription: Description | null = null;
  remoteDescription: Description | null = null;
  readonly transceivers: Transceiver[] = [];
  readonly candidates: object[] = [];

  constructor() {
    FakeConnection.made.push(this);
  }

  addTransceiver(_kind: string, init: { direction: string }): Transceiver {
    const sent: unknown[] = [];
    const replaceTrack = async (track: unknown): Promise<void> => {
      sent.push(track);
    };
    const transceiver = { direction: init.direction, sender: { sent, replaceTrack } };
    this.transceivers.push(transceiver);
    return transceiver;
  }

  getTransceivers(): Transceiver[] {
    return this.transceivers;
  }

  /** An offer or answer says who made it and the directions it asks for. */
  async createOffer(): Promise<Description> {
    return { type: 'offer', sdp: `offer of ${this.id}: ${this.directions()}` };
  }

  async createAnswer(): Promise<Description> {
    return { type: 'answer', sdp: `answer of ${this.id}: ${this.directions()}` };
  }

  async setLocalDescription(description: Description): Promise<void> {
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
    this.connectOnceDescribed();
    // A candidate comes once the description is set, in a task of its own.
    setTimeout(() => {
      const candidate = { candidate: `candidate of ${this.id}`, sdpMid: '0', sdpMLineIndex: 0 };
      this.onicecandidate?.({ candidate: { ...candidate, usernameFragment: `u${this.id}` } });
    }, 0);
  }

  async setRemoteDescription(description: Description): Promise<void> {
    if (description.type === 'answer' && this.signalingState !== 'have-local-offer') {
      throw new Error('InvalidStateError: no offer waits for this answer');
    }
    this.remoteDescription = description;
    if (description.type === 'offer') {
      this.signalingState = 'have-remote-offer';
      this.addTransceiver('audio', { direction: 'recvonly' });
    } else {
      this.signalingState = 'stable';
    }
    this.connectOnceDescribed();
  }

  async addIceCandidate(candidate: object): Promise<void> {
    if (this.remoteDescription === null) {
      throw new Error('InvalidStateError: a candidate before its description');
    }
    this.candidates.push(candidate);
  }

  close(): void {
    this.signalingState = 'closed';
    this.connectionState = 'closed';
  }

  /** What the network does to it: `failed`, say. */
  becomes(state: string): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  /** The other end's voice comes in on it, as `stream`. */
  plays(stream: object): void {
    this.ontrack?.({ track: {}, streams: [stream] });
  }

  private directions(): string {
    return this.transceivers.map((transceiver) => transceiver.direction).join(',');
  }

  private connectOnceDescribed(): void {
    const described = this.localDescription !== null && this.remoteDescription !== null;
    if (described && this.signalingState === 'stable' && this.connectionState === 'new') {
      this.becomes('connected');
    }
  }
}

interface Sent {
  from: string;
  to: string;
  signal: RtcSignal;
}

/**
 * The game's socket between the pages: a signal reaches the page it names, in the order sent.
 * Each page is a `Mesh`: the module's own, or a fresh one with a sound of its own.
 */
class Wire {
  readonly pages = new Map<string, VoiceMesh>();
  readonly sent: Sent[] = [];
  private queue: Sent[] = [];

  constructor(private readonly Mesh: typeof VoiceMesh = VoiceMesh) {}

  join(id: string): VoiceMesh {
    const mesh = new this.Mesh();
    mesh.attach((to, signal) => {
      this.sent.push({ from: id, to, signal });
      this.queue.push({ from: id, to, signal });
    }, '');
    this.pages.set(id, mesh);
    return mesh;
  }

  /** Delivers what was sent until nothing more comes, every page answering in between. */
  async settle(): Promise<void> {
    for (let round = 0; round < 40; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const batch = this.queue;
      this.queue = [];
      for (const { from, to, signal } of batch) {
        this.pages.get(to)?.receive({ kind: 'rtc', from, signal });
      }
      if (batch.length === 0 && round > 2) {
        return;
      }
    }
    throw new Error('the pages never stopped signalling');
  }

  /** The kinds of signal `from` sent, by kind: „offer", „answer", „ice". */
  kinds(from: string): string[] {
    return this.sent.filter((sent) => sent.from === from).map((sent) => sent.signal.type);
  }
}

/** The crew as a view gives it to the player `you`: ids, and whether each is connected. */
function crewView(you: string, crew: [string, boolean][]): ServerMessage {
  const member = (id: string) => ({ id, name: id, color: '#2dd4bf', ready: true, isHost: false });
  const view: PlayerView = {
    phase: 'lobby',
    missionId: 'blackout',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    crewSize: { min: 2, max: 4 },
    chat: [],
    you: member(you),
    players: crew.map(([id, connected]) => ({ ...member(id), connected })),
    palette: [],
    deadlineAt: null,
    startedAt: null,
    lights: { out: false, outAt: null },
    finishedAt: null,
    timeLimitSec: 600,
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    pausedFor: null,
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
    map: null,
  };
  return { kind: 'view', view, at: 0 };
}

/** The crew as the audience's view gives it. */
function audienceView(crew: [string, boolean][]): ServerMessage {
  const presence = { stationId: null, console: null, manualId: null, signSeen: false };
  const view: SpectatorView = {
    phase: 'playing',
    missionTitle: 'Blackout im Labor',
    difficulty: 'normal',
    storyText: '',
    deadlineAt: null,
    startedAt: 1,
    lights: { out: true, outAt: 1 },
    finishedAt: null,
    timeLimitSec: 600,
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    penaltySeq: 0,
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    pausedFor: null,
    pausedAt: null,
    events: [],
    grade: null,
    players: crew.map(([id, connected]) => ({
      id,
      name: id,
      color: '#2dd4bf',
      connected,
      presence,
    })),
    credits: {},
    map: null,
    puzzle: null,
    edgework: null,
    panels: [],
  };
  return { kind: 'spectator-view', view, code: 'TEST', at: 0 };
}

const BOTH: [string, boolean][] = [
  ['a', true],
  ['b', true],
];

describe('the voice links between the pages', () => {
  let wire: Wire;

  beforeEach(() => {
    vi.stubGlobal('RTCPeerConnection', FakeConnection);
    vi.stubGlobal('window', { isSecureContext: true });
    FakeConnection.made = [];
    wire = new Wire();
  });

  afterEach(() => {
    for (const page of wire.pages.values()) {
      page.detach();
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Anna („a") and Ben („b") in one room, their link up. */
  async function linked(): Promise<[VoiceMesh, VoiceMesh]> {
    const [anna, ben] = [wire.join('a'), wire.join('b')];
    anna.receive(crewView('a', BOTH));
    ben.receive(crewView('b', BOTH));
    await wire.settle();
    return [anna, ben];
  }

  it('link two players: the lower id offers, the other answers, a candidate each way', async () => {
    const [anna, ben] = await linked();
    expect(wire.kinds('a').sort()).toEqual(['ice', 'offer']);
    expect(wire.kinds('b').sort()).toEqual(['answer', 'ice']);
    expect(anna.probe()).toMatchObject({ links: ['b'], states: { b: 'connected' } });
    expect(ben.probe()).toMatchObject({ links: ['a'], states: { a: 'connected' } });
    const [annas, bens] = FakeConnection.made;
    // Both talk and listen; each end took the other's candidate after its description.
    expect(annas?.remoteDescription?.sdp).toMatch(/: sendrecv$/);
    expect(bens?.transceivers.map((t) => t.direction)).toEqual(['sendrecv']);
    expect(annas?.candidates).toHaveLength(1);
    expect(bens?.candidates).toHaveLength(1);
  });

  it('close the link when a player drops out, and make a fresh one once they are back', async () => {
    const [anna, ben] = await linked();
    anna.receive(crewView('a', [['a', true], ['b', false]]));
    ben.disconnected();
    await wire.settle();
    expect([anna.probe().links, ben.probe().links]).toEqual([[], []]);
    expect(FakeConnection.made.map((c) => c.connectionState)).toEqual(['closed', 'closed']);

    anna.receive(crewView('a', BOTH));
    ben.receive(crewView('b', BOTH));
    await wire.settle();
    expect(anna.probe().states).toEqual({ b: 'connected' });
    expect(ben.probe().states).toEqual({ a: 'connected' });
    expect(wire.kinds('a').filter((kind) => kind === 'offer')).toHaveLength(2);
    expect(wire.kinds('b')).not.toContain('offer');
  });

  it('rebuild the link of a player who came back before the others saw them go', async () => {
    // The voice's tick and clock go by the test; the pages' signals still take real turns.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    const [anna, ben] = await linked();
    // Ben's socket dropped and came back at once: Anna saw nothing, Ben starts afresh.
    ben.disconnected();
    ben.receive(crewView('b', BOTH));
    await wire.settle();
    // Anna owns the link and saw no change, so Ben waits: the link is down on one end only…
    expect(ben.probe().links).toEqual([]);
    // …until it fails on the other, which opens it again after a wait.
    FakeConnection.made[0]?.becomes('failed');
    expect(anna.probe().links).toEqual([]);
    vi.advanceTimersByTime(2900);
    expect(anna.probe().links).toEqual([]);
    vi.advanceTimersByTime(200);
    await wire.settle();
    expect(anna.probe().states).toEqual({ b: 'connected' });
    expect(ben.probe().states).toEqual({ a: 'connected' });
  });

  it('give up a link that never connects, and open it again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    const anna = wire.join('a');
    // Ben's page is not there to answer: the offer goes nowhere.
    anna.receive(crewView('a', BOTH));
    await wire.settle();
    expect(anna.probe().states).toEqual({ b: 'new' });
    vi.advanceTimersByTime(15_100);
    expect(anna.probe().links).toEqual([]);
    vi.advanceTimersByTime(3000);
    await wire.settle();
    expect(anna.probe().links).toEqual(['b']);
    expect(wire.kinds('a').filter((kind) => kind === 'offer')).toHaveLength(2);
  });

  it('close the link of a player who left the room', async () => {
    const [anna] = await linked();
    anna.receive(crewView('a', [['a', true]]));
    expect(anna.probe().links).toEqual([]);
  });

  it('let an answer that nobody waits for change nothing', async () => {
    const [anna] = await linked();
    anna.receive({ kind: 'rtc', from: 'b', signal: { type: 'answer', sdp: 'answer of nobody' } });
    await wire.settle();
    expect(anna.probe().states).toEqual({ b: 'connected' });
  });

  it('let a spectator listen in: receive-only offers, answered send-only, no way back', async () => {
    const [anna, ben] = await linked();
    const zoe = wire.join('audience-1');
    zoe.receive(audienceView(BOTH));
    await wire.settle();
    expect(zoe.probe().links).toEqual([]);

    zoe.setListening(true);
    await wire.settle();
    expect(zoe.probe().states).toEqual({ a: 'connected', b: 'connected' });
    const sdpOf = ({ signal }: Sent): string => (signal.type === 'ice' ? '' : signal.sdp);
    const offers = wire.sent.filter((s) => s.from === 'audience-1' && s.signal.type === 'offer');
    expect(offers.map((s) => s.to).sort()).toEqual(['a', 'b']);
    for (const sdp of offers.map(sdpOf)) {
      expect(sdp).toMatch(/: recvonly$/);
    }
    const answers = wire.sent.filter((s) => s.to === 'audience-1' && s.signal.type === 'answer');
    expect(answers).toHaveLength(2);
    for (const sdp of answers.map(sdpOf)) {
      expect(sdp).toMatch(/: sendonly$/);
    }
    expect(anna.probe().links.sort()).toEqual(['audience-1', 'b']);
    expect(ben.probe().links.sort()).toEqual(['a', 'audience-1']);

    zoe.setListening(false);
    expect(zoe.probe().links).toEqual([]);
  });

  it('send a voice to six spectators at most, and take no offer on a spectator’s page', async () => {
    const [anna] = await linked();
    for (let i = 1; i <= 7; i++) {
      const signal: RtcSignal = { type: 'offer', sdp: 'recvonly' };
      anna.receive({ kind: 'rtc', from: `audience-${i}`, signal });
    }
    await wire.settle();
    expect(anna.probe().links.filter((peer) => peer.startsWith('audience-'))).toHaveLength(6);

    const zoe = wire.join('audience-9');
    zoe.receive(audienceView(BOTH));
    zoe.receive({ kind: 'rtc', from: 'a', signal: { type: 'offer', sdp: 'sendrecv' } });
    await wire.settle();
    expect(zoe.probe().links).toEqual([]);
  });
});

describe('the microphone, switched on from a click', () => {
  let wire: Wire;

  beforeEach(() => {
    vi.stubGlobal('RTCPeerConnection', FakeConnection);
    vi.stubGlobal('window', { isSecureContext: true });
    FakeConnection.made = [];
    wire = new Wire();
  });

  afterEach(() => {
    for (const page of wire.pages.values()) {
      page.detach();
    }
    vi.unstubAllGlobals();
  });

  /** A browser that takes its time handing out the microphone. */
  interface SlowBrowser {
    getUserMedia: () => Promise<object>;
    /** answers the request: a stream, or an error to refuse it with */
    answer: (stream: object) => void;
  }

  /** The browser's getUserMedia, standing for one that takes its time: it answers when told. */
  function browserAsked(): SlowBrowser {
    let answer: (stream: object) => void = () => undefined;
    const getUserMedia = vi.fn(
      () =>
        new Promise<object>((resolve, reject) => {
          answer = (stream) => (stream instanceof Error ? reject(stream) : resolve(stream));
        }),
    );
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    return { getUserMedia, answer: (stream) => answer(stream) };
  }

  it('asks the browser first, then says so, and is on once the browser hands it out', async () => {
    const browser = browserAsked();
    const anna = wire.join('a');
    anna.receive(crewView('a', BOTH));
    await wire.settle();

    const switching = anna.switchMicOn();
    expect(browser.getUserMedia).toHaveBeenCalledTimes(1);
    expect(anna.probe()).toMatchObject({ mic: 'asking', micWaitMs: null });
    const track = { enabled: true, onended: null, stop: vi.fn() };
    browser.answer({ getAudioTracks: () => [track] });
    await switching;
    expect(anna.probe().mic).toBe('on');
    expect(anna.probe().micWaitMs).toBeGreaterThanOrEqual(0);
    // It goes out on the link that was there before it, silent until V is held.
    expect(FakeConnection.made[0]?.transceivers[0]?.sender.sent).toEqual([track]);
    expect(track.enabled).toBe(false);
    anna.setHeld(true);
    expect(track.enabled).toBe(true);
  });

  it('says why when the browser refuses, and how long that took', async () => {
    const browser = browserAsked();
    const anna = wire.join('a');
    const switching = anna.switchMicOn();
    browser.answer(Object.assign(new Error('refused'), { name: 'NotAllowedError' }));
    await switching;
    expect(anna.probe().mic).toBe('denied');
    expect(anna.probe().micWaitMs).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Two rooms, a wall between them and the way round it along the bottom row. The Signalkette's
 * consoles stand at the far ends of the top row, a book in the west room and a clipboard in the
 * east one cover it; the wiring box after it and the chart that covers that lie on the way.
 *
 *   0123456789012345678
 * 0 ###################
 * 1 #........#........#   console a (2,1); console b (16,1)
 * 2 #........#........#   at console a (2.5,2.5); at console b (16.5,2.5)
 * 3 #........#........#   at the book (2.5,3.5); at the clipboard (16.5,3.5)
 * 4 #........#........#   book (2,4); clipboard (16,4)
 * 5 #.................#   spawns (1,5) (2,5); box (5,5); chart (13,5); sign (17,5)
 * 6 ###################
 */
const twoRooms: Mission = parseMission({
  id: 'gegensprechanlage',
  title: 'Gegensprechanlage',
  players: { min: 2, max: 2 },
  story: { intro: 'i', win: 'w', lose: 'l' },
  timeLimitSec: 600,
  puzzles: [
    { type: 'signal', id: 'kette', title: 'Signalkette' },
    { type: 'wiring', id: 'kabel', title: 'Kabel' },
  ],
  map: {
    tiles: [
      '###################',
      '#........#........#',
      '#........#........#',
      '#........#........#',
      '#........#........#',
      '#.................#',
      '###################',
    ],
    spawns: [
      { x: 1, y: 5 },
      { x: 2, y: 5 },
    ],
    stations: [
      { puzzleId: 'kette', x: 2, y: 1, console: 'a' },
      { puzzleId: 'kette', x: 16, y: 1, console: 'b' },
      { puzzleId: 'kabel', x: 5, y: 5 },
    ],
    manuals: [
      { id: 'buch', kind: 'book', label: 'HANDBUCH', covers: 'kette', x: 2, y: 4 },
      { id: 'klemmbrett', kind: 'clipboard', label: 'KLEMMBRETT', covers: 'kette', x: 16, y: 4 },
      { id: 'tafel', kind: 'chart', label: 'TAFEL', covers: 'kabel', x: 13, y: 5 },
    ].map(({ covers, x, y, ...source }) => ({ ...source, puzzleIds: [covers], spots: [{ x, y }] })),
    edgeworkSign: { x: 17, y: 5 },
  },
});

const T0 = 1_000_000;
const CONSOLE_B = stationKey({ puzzleId: 'kette', console: 'b' });

interface Spot {
  x: number;
  y: number;
}

const AT_A: Spot = { x: 2.5, y: 2.5 };
const AT_B: Spot = { x: 16.5, y: 2.5 };
const AT_BOOK: Spot = { x: 2.5, y: 3.5 };
const AT_CLIPBOARD: Spot = { x: 16.5, y: 3.5 };
const IN_THE_GAP: Spot = { x: 9.5, y: 5.5 };
const AT_BOX: Spot = { x: 5.5, y: 4.5 };
const AT_CHART: Spot = { x: 13.5, y: 4.5 };

/** Where Anna („a") and Ben („b") stand: as the server counts them, and on the map. */
interface Standing {
  stations?: Record<string, string[]>;
  manuals?: Record<string, string[]>;
  a: Spot;
  b: Spot;
}

/** Anna and Ben in a run of the two rooms, counted at the places `standing` names. */
function runWith(standing: Pick<Standing, 'stations' | 'manuals'>): GameState {
  const actions: Action[] = [
    { type: 'player-join', playerId: 'a', name: 'Anna' },
    { type: 'player-join', playerId: 'b', name: 'Ben' },
    { type: 'set-ready', playerId: 'b', ready: true },
    { type: 'start-mission', playerId: 'a', at: T0, seed: 7 },
  ];
  return applyAction(actions.reduce(applyAction, initialState(twoRooms)), {
    type: 'set-presence',
    stations: standing.stations ?? {},
    manuals: standing.manuals ?? {},
    notes: {},
    signSeen: [],
    found: {},
    sight: {},
    exit: [],
    at: T0 + 100,
  });
}

/** The view of `playerId` with the two standing as `standing` says, as the server sends it. */
function viewAt(standing: Standing, playerId: string): ServerMessage {
  return { kind: 'view', view: viewFor(runWith(standing), playerId), at: 0 };
}

/** The positions message of the run: Anna and Ben where `standing` puts them. */
function positionsOf({ a, b }: Standing): ServerMessage {
  const at = (spot: Spot) => ({ ...spot, facing: 0, moving: false, t: null, rt: 0 });
  return { kind: 'positions', run: T0, players: { a: at(a), b: at(b) }, drones: {} };
}

/** The run's map, as every view of it has it. */
function theMap(): NonNullable<PlayerView['map']> {
  const map = viewFor(runWith({}), 'a').map;
  if (map === null) {
    throw new Error('expected the run’s map');
  }
  return map;
}

/** How loud Ben sounds to Anna by the distance and the walls alone: the rule without intercom. */
function byProximity({ a, b }: Standing): number {
  return gainBetween(theMap(), a, b, new Set());
}

/** The nodes Anna hears Ben's `stream` through, as the fake context keeps them. */
function pathOf(stream: object): { volume: FakeGain; plain: FakeGain; speaker: FakeGain } {
  const sources = lastContext().all<FakeNode & { mediaStream: unknown }>('stream');
  const volume = sources
    .find((node) => node.mediaStream === stream)
    ?.outputs.find((node): node is FakeGain => node instanceof FakeGain);
  const [plain, low] = volume?.outputs ?? [];
  const speaker = low instanceof FakeNode ? chainFrom(low).at(-1) : undefined;
  if (volume === undefined || !(plain instanceof FakeGain) || !(speaker instanceof FakeGain)) {
    throw new Error('expected Ben’s voice on its way to Anna');
  }
  return { volume, plain, speaker };
}

/** Each place of the armed station with each, 14 tiles apart or more and a wall between. */
const AT_THE_STATION: [string, Standing][] = [
  ['console and console', { stations: { kette: ['a'], [CONSOLE_B]: ['b'] }, a: AT_A, b: AT_B }],
  [
    'console and source',
    { stations: { kette: ['a'] }, manuals: { klemmbrett: ['b'] }, a: AT_A, b: AT_CLIPBOARD },
  ],
  ['source and source', { manuals: { buch: ['a'], klemmbrett: ['b'] }, a: AT_BOOK, b: AT_CLIPBOARD }],
];

/** Pairs the intercom leaves alone. */
const ELSEWHERE: [string, Standing][] = [
  ['Anna at console a, Ben at no place of it', { stations: { kette: ['a'] }, a: AT_A, b: IN_THE_GAP }],
  [
    'the box and the chart of the station after it',
    { stations: { kabel: ['a'] }, manuals: { tafel: ['b'] }, a: AT_BOX, b: AT_CHART },
  ],
];

describe('the station’s intercom on the crew’s voices', () => {
  let wire: Wire;

  beforeEach(async () => {
    fakeGraph();
    fakeMedia();
    vi.stubGlobal('RTCPeerConnection', FakeConnection);
    vi.stubGlobal('window', { isSecureContext: true });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    FakeConnection.made = [];
    // The voice's sound is made anew for every test: an engine of its own.
    vi.resetModules();
    wire = new Wire((await import('../src/voice/mesh.js')).VoiceMesh);
  });

  afterEach(() => {
    for (const page of wire.pages.values()) {
      page.detach();
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Anna and Ben linked and standing as `standing` says, Ben's voice in at Anna's page. */
  async function annaHearsBen(standing: Standing): Promise<{ anna: VoiceMesh; stream: object }> {
    const [anna, ben] = [wire.join('a'), wire.join('b')];
    anna.receive(viewAt(standing, 'a'));
    ben.receive(viewAt(standing, 'b'));
    await wire.settle();
    const stream = { id: 'Bens Stimme' };
    // Anna offered the link: hers is the first connection made.
    FakeConnection.made[0]?.plays(stream);
    anna.receive(positionsOf(standing));
    vi.advanceTimersByTime(60);
    return { anna, stream };
  }

  it.each(AT_THE_STATION)('plays %s in full through a wall 14 tiles off', async (_, standing) => {
    const { a, b } = standing;
    expect(canSee(theMap(), a, b, new Set())).toBe(false);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(14);
    // By the distance and the walls Ben comes through at 5 %, −25.6 dB.
    expect(20 * Math.log10(byProximity(standing))).toBeCloseTo(-25.6, 1);

    const { anna, stream } = await annaHearsBen(standing);
    expect(anna.probe().gains).toEqual({ b: 1 });
    expect(anna.probe().intercom).toEqual(['b']);
    const { volume, plain, speaker } = pathOf(stream);
    expect(volume.gain.value).toBe(1);
    expect([plain.gain.value, speaker.gain.value]).toEqual([0, 1]);
  });

  it.each(ELSEWHERE)('leaves %s to the distance and the walls, plain', async (_, standing) => {
    const { anna, stream } = await annaHearsBen(standing);
    expect(anna.probe().gains.b).toBeCloseTo(byProximity(standing), 9);
    expect(anna.probe().gains.b).toBeLessThan(0.5);
    expect(anna.probe().intercom).toEqual([]);
    const { plain, speaker } = pathOf(stream);
    expect([plain.gain.value, speaker.gain.value]).toEqual([1, 0]);
    expect(speaker.gain.events).toEqual([]);
  });

  it('goes on the intercom and off it in 150 ms ramps, gliding by distance only after', async () => {
    const away: Standing = { stations: { kette: ['a'] }, a: AT_A, b: IN_THE_GAP };
    const { anna, stream } = await annaHearsBen(away);
    const ctx = lastContext();
    const { volume, plain, speaker } = pathOf(stream);
    const far = anna.probe().gains.b ?? 1;
    volume.gain.events.length = 0;

    // Ben steps up to console b: the view puts him on the intercom with Anna.
    const manned: Standing = { stations: { kette: ['a'], [CONSOLE_B]: ['b'] }, a: AT_A, b: AT_B };
    anna.receive(viewAt(manned, 'a'));
    anna.receive(positionsOf(manned));
    vi.advanceTimersByTime(50);
    const on = ctx.currentTime;
    expect(volume.gain.events).toEqual([
      ['cancel', on],
      ['set', volume.gain.value, on],
      ['linear', 1, on + LINK_RAMP_S],
    ]);
    expect(plain.gain.ramps()).toEqual([[0, on + LINK_RAMP_S]]);
    expect(speaker.gain.ramps()).toEqual([[1, on + LINK_RAMP_S]]);

    // He walks off again: back to the distance and the walls, the speaker shut.
    anna.receive(viewAt(away, 'a'));
    anna.receive(positionsOf(away));
    ctx.currentTime = on + 1;
    vi.advanceTimersByTime(50);
    const off = on + 1 + LINK_RAMP_S;
    expect(volume.gain.ramps().at(-1)).toEqual([far, off]);
    expect(plain.gain.ramps().at(-1)).toEqual([1, off]);
    expect(speaker.gain.ramps().at(-1)).toEqual([0, off]);

    // While that ramp runs a step changes nothing; once it is through, the volume glides.
    const laid = volume.gain.events.length;
    anna.receive(positionsOf({ ...away, b: AT_BOX }));
    ctx.currentTime = on + 1.1;
    vi.advanceTimersByTime(50);
    expect(volume.gain.events).toHaveLength(laid);
    ctx.currentTime = on + 1.2;
    vi.advanceTimersByTime(50);
    expect(volume.gain.events.at(-1)?.slice(0, 2)).toEqual(['target', 1]);
    expect(speaker.gain.events.at(-1)).toEqual(['linear', 0, off]);
  });

  it('tells the screens of the intercom only while the link is up', async () => {
    const manned: Standing = { stations: { kette: ['a'], [CONSOLE_B]: ['b'] }, a: AT_A, b: AT_B };
    const [anna, ben] = [wire.join('a'), wire.join('b')];
    anna.receive(viewAt(manned, 'a'));
    ben.receive(viewAt(manned, 'b'));
    // On the intercom by the view, but no signal has gone over yet: the link is not up.
    expect([anna.getState().intercom.size, ben.getState().intercom.size]).toEqual([0, 0]);
    await wire.settle();
    expect([...anna.getState().intercom]).toEqual(['b']);
    expect([...ben.getState().intercom]).toEqual(['a']);
    FakeConnection.made[0]?.becomes('failed');
    expect(anna.getState().intercom.size).toBe(0);
  });
});

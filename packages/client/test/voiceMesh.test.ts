import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerView, RtcSignal, ServerMessage, SpectatorView } from '@escapelab/core';
import { VoiceMesh } from '../src/voice/mesh.js';

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
  ontrack: (() => void) | null = null;
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

/** The game's socket between the pages: a signal reaches the page it names, in the order sent. */
class Wire {
  readonly pages = new Map<string, VoiceMesh>();
  readonly sent: Sent[] = [];
  private queue: Sent[] = [];

  join(id: string): VoiceMesh {
    const mesh = new VoiceMesh();
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
    you: member(you),
    players: crew.map(([id, connected]) => ({ ...member(id), connected })),
    palette: [],
    deadlineAt: null,
    startedAt: null,
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
    map: null,
  };
  return { kind: 'view', view };
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
    finishedAt: null,
    timeLimitSec: 600,
    currentPuzzleIndex: 0,
    puzzleCount: 1,
    penaltySeq: 0,
    alarms: { count: 0, limit: 5 },
    hintsUsed: 0,
    pausedFor: null,
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
  return { kind: 'spectator-view', view, code: 'TEST' };
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

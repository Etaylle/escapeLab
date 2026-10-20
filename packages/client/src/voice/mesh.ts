import type { MapView, PlayerPosition, RtcSignal, ServerMessage } from '@escapelab/core';
import { sharedAudio } from '../world/audio.js';
import { doorsShut } from '../world/light.js';
import {
  gainBetween,
  heard,
  linkPlan,
  ownsLink,
  peakOf,
  SILENT,
  type Peer,
  type Speech,
} from './rules.js';

/**
 * The crew's push-to-talk: one WebRTC link between every two players in the
 * room, the lower id making the offer (voice/rules.ts), the signals going over
 * the game's socket and the voices straight from browser to browser — the
 * server never carries sound. Each voice plays through the one shared
 * AudioContext at a volume set by how far apart the two avatars stand and
 * whether a wall stands between them; a level meter on every voice, this
 * player's own included, says who speaks. A spectator who listens in opens a
 * receive-only link to each player and hears everyone in full; nothing comes
 * back over it. The microphone is asked for on a click only; until then, and
 * without one, a player still hears the crew.
 */

/** Sends a voice signal to one member of the room. */
export type SendSignal = (to: string, signal: RtcSignal) => void;

/** Why there is no microphone: no WebRTC, no HTTPS, refused, none there, in use, gone. */
export type MicTrouble = 'unsupported' | 'insecure' | 'denied' | 'missing' | 'busy' | 'broken';

/** Where the microphone stands: never asked for, being asked for, on, or why not. */
export type MicState = 'off' | 'asking' | 'on' | MicTrouble;

/** The voice as the screens show it. */
export interface VoiceState {
  readonly mic: MicState;
  /** the microphone stays open instead of going by the key */
  readonly open: boolean;
  /** V or a talk button is held down */
  readonly held: boolean;
  /** a spectator listening in to the crew */
  readonly listening: boolean;
  /** who speaks right now, by player id, this player included */
  readonly speaking: ReadonlySet<string>;
}

/** What the walkthrough reads off a traced page (probes.ts). */
export interface VoiceProbe {
  readonly mic: MicState;
  readonly held: boolean;
  /** the peers this page has a link with */
  readonly links: string[];
  /** each link's connection state, by peer */
  readonly states: Record<string, RTCPeerConnectionState>;
  /** who speaks, by player id */
  readonly speaking: string[];
}

/**
 * What a link is for: two players talking (`crew`), this spectator listening
 * to a player (`listen`), or a spectator listening to this player
 * (`audience`). A crew link is opened by the pair's owner, a listening link
 * by the spectator; what comes in over an audience link is never played.
 */
type LinkKind = 'crew' | 'listen' | 'audience';

/** One peer's voice as this end plays it. */
interface Hearing {
  /** Chrome hands a remote stream to Web Audio only while a media element plays it too */
  readonly element: HTMLAudioElement;
  readonly source: MediaStreamAudioSourceNode;
  readonly meter: AnalyserNode;
  readonly volume: GainNode;
  /** the volume last set */
  set: number;
}

interface Link {
  readonly peer: string;
  readonly kind: LinkKind;
  readonly pc: RTCPeerConnection;
  /** whether this end made the offer */
  readonly offering: boolean;
  /** when it was made (performance.now()), to give one up that never connects */
  readonly since: number;
  connected: boolean;
  /** what this end sends on: the microphone goes there once it is on */
  sender: RTCRtpSender | null;
  hearing: Hearing | null;
  /** signals are taken one at a time, in order: a candidate waits for the description before it */
  queue: Promise<void>;
  closed: boolean;
}

type IceCandidate = Extract<RtcSignal, { type: 'ice' }>['candidate'];

interface Positions {
  run: number | null;
  players: Record<string, PlayerPosition>;
}

/** How often levels are read and volumes set, in ms. */
const TICK_MS = 50;
/** A link not connected this long after it was made is given up, in ms. */
const CONNECT_WITHIN_MS = 15_000;
/** How long the opener waits before opening a link again after one failed, in ms. */
const RETRY_AFTER_MS = 3000;
/** The most spectators one player's voice goes to at once. */
const MAX_AUDIENCE = 6;
/** Samples a level is read from: some 40 ms at 48 kHz, more than the gap between two reads. */
const LEVEL_SAMPLES = 2048;
/** How fast a volume follows the avatars, in s: the time constant of its glide. */
const VOLUME_GLIDE = 0.12;
/** A public STUN server for play over the internet, asked for with `?stun=1`. */
const STUN: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
/** What a voice wants of the microphone: the browser's echo, noise and level handling. */
const VOICE_INPUT: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
/** This tab had its microphone on: after a reload it comes back where the browser allows. */
const MIC_KEY = 'escapelab-voice-mic';
/** This tab keeps its microphone open. */
const OPEN_KEY = 'escapelab-voice-open';

/** Why this page cannot have a microphone at all, or null when it may ask for one. */
function micBlocker(): MicTrouble | null {
  if (typeof RTCPeerConnection === 'undefined') {
    return 'unsupported';
  }
  if (!window.isSecureContext) {
    return 'insecure';
  }
  // Undefined outside a secure context, and in browsers too old for it.
  return navigator.mediaDevices?.getUserMedia === undefined ? 'unsupported' : null;
}

/** What a refused getUserMedia means for the player. */
function troubleOf(err: unknown): MicTrouble {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'denied';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'missing';
  }
  return name === 'NotReadableError' || name === 'AbortError' ? 'busy' : 'broken';
}

function recall(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    // Storage blocked: nothing was kept.
    return null;
  }
}

function remember(key: string, value: string | null): void {
  try {
    if (value === null) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, value);
    }
  } catch {
    // Storage blocked: the choice lasts until the page goes.
  }
}

/** A candidate as it goes over the socket. */
function candidateOf(candidate: RTCIceCandidate): IceCandidate {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}

/** A candidate as it came over the socket, for the browser. */
function candidateInit(candidate: IceCandidate): RTCIceCandidateInit {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? null,
    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    usernameFragment: candidate.usernameFragment ?? null,
  };
}

/**
 * The page's voice. `attach` starts it with a way to send signals, `receive`
 * takes every server message in the order it came — a signal must never
 * overtake the view before it — and `disconnected` the socket dropping.
 * The screens read `getState` and `subscribe` to its changes.
 */
export class VoiceMesh {
  private sendSignal: SendSignal | null = null;
  /** this player's id; null on a spectator's page and before the first view */
  private self: string | null = null;
  /** whether this page watches as a spectator */
  private audience = false;
  /** the other members of the room, as the last view had them */
  private peers: readonly Peer[] = [];
  /** who of them was connected in the view before */
  private seen: ReadonlySet<string> = new Set();
  private readonly links = new Map<string, Link>();
  /** when a link that failed may be opened again (performance.now()), by peer */
  private readonly retryAt = new Map<string, number>();
  /** the map of the run, its shut doors and the run, for how loud each voice sounds */
  private room: { map: MapView; shut: ReadonlySet<string>; run: number | null } | null = null;
  private positions: Positions = { run: null, players: {} };
  private mic: MediaStreamTrack | null = null;
  /** this player's own voice, metered: a speaking ring of their own */
  private own: { source: MediaStreamAudioSourceNode; meter: AnalyserNode } | null = null;
  private readonly speech = new Map<string, Speech>();
  private readonly samples = new Float32Array(LEVEL_SAMPLES);
  private timer: ReturnType<typeof setInterval> | null = null;
  private iceServers: RTCIceServer[] = [];
  private state: VoiceState = {
    mic: 'off',
    open: false,
    held: false,
    listening: false,
    speaking: new Set(),
  };
  private readonly subscribers = new Set<() => void>();

  /** For useSyncExternalStore: hears every change of the state. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  };

  /** For useSyncExternalStore: the state now, the same object until it changes. */
  readonly getState = (): VoiceState => this.state;

  /**
   * Starts the voice for this page: signals go out by `send`, `?stun=1` in
   * `search` adds a public STUN server, and a microphone this tab had on
   * before a reload comes back — where the browser allows it without asking.
   */
  attach(send: SendSignal, search: string): void {
    this.sendSignal = send;
    this.iceServers = new URLSearchParams(search).get('stun') === '1' ? STUN : [];
    this.update({ mic: micBlocker() ?? 'off', open: recall(OPEN_KEY) === '1' });
    if (recall(MIC_KEY) === '1') {
      this.micAgain();
    }
  }

  /** Ends the voice for this page: every link closes and the microphone goes off. */
  detach(): void {
    this.sendSignal = null;
    this.closeAll();
    this.releaseMic();
    this.seen = new Set();
    const asked = this.state.mic === 'on' || this.state.mic === 'asking';
    this.update({ mic: asked ? 'off' : this.state.mic, held: false });
  }

  /** Takes in a server message: the views, the positions and the signals matter. */
  receive(msg: ServerMessage): void {
    this.guarded(() => this.handle(msg));
  }

  /**
   * Runs `step` so that the voice never breaks the game: what goes wrong is
   * logged, and a link it cost is made again by the next view or tick.
   */
  private guarded(step: () => void): void {
    try {
      step();
    } catch (err) {
      console.warn('[escapelab] voice: something went wrong here, the game goes on', err);
    }
  }

  private handle(msg: ServerMessage): void {
    switch (msg.kind) {
      case 'view': {
        const { you, players, map, startedAt } = msg.view;
        this.audience = false;
        this.self = you.id;
        this.peers = players.filter((player) => player.id !== you.id);
        this.room = map === null ? null : { map, shut: doorsShut(map), run: startedAt };
        this.replan();
        break;
      }
      case 'spectator-view':
        this.audience = true;
        this.self = null;
        this.peers = msg.view.players;
        this.room = null;
        this.replan();
        break;
      case 'positions':
        this.positions = { run: msg.run, players: msg.players };
        break;
      case 'rtc':
        this.take(msg.from, msg.signal);
        break;
      default:
        break;
    }
  }

  /** The socket dropped: the links go with it, and every peer is new once views come again. */
  disconnected(): void {
    this.closeAll();
    this.seen = new Set();
  }

  /** Asks for the microphone, from a click; talking then goes by the key until opened. */
  async switchMicOn(): Promise<void> {
    if (this.state.mic === 'asking' || this.state.mic === 'on') {
      return;
    }
    const blocked = micBlocker();
    if (blocked !== null) {
      this.update({ mic: blocked });
      return;
    }
    this.update({ mic: 'asking' });
    // The click that asks wakes the shared context, which then plays the crew too.
    sharedAudio();
    try {
      const input = { audio: VOICE_INPUT, video: false };
      const [track] = (await navigator.mediaDevices.getUserMedia(input)).getAudioTracks();
      if (track === undefined) {
        throw new DOMException('the stream has no audio track', 'NotFoundError');
      }
      if (this.sendSignal === null) {
        track.stop();
        return;
      }
      this.useMic(track);
      remember(MIC_KEY, '1');
      this.update({ mic: 'on' });
    } catch (err) {
      this.update({ mic: troubleOf(err) });
    }
  }

  /** Switches the microphone off until it is asked for again. */
  switchMicOff(): void {
    this.releaseMic();
    remember(MIC_KEY, null);
    this.update({ mic: 'off' });
  }

  /** V or a talk button went down or up. */
  setHeld(held: boolean): void {
    if (held !== this.state.held) {
      this.update({ held });
      this.applyTalk();
    }
  }

  /** The HUD's switch: the microphone stays open, or goes by the key. */
  setOpen(open: boolean): void {
    if (open !== this.state.open) {
      remember(OPEN_KEY, open ? '1' : null);
      this.update({ open });
      this.applyTalk();
    }
  }

  /** A spectator's switch: listen to the crew, or no longer. */
  setListening(listening: boolean): void {
    if (listening !== this.state.listening) {
      if (listening) {
        sharedAudio();
      }
      this.update({ listening });
      this.guarded(() => this.replan());
    }
  }

  /** What the walkthrough reads: the links, their states, who speaks. */
  probe(): VoiceProbe {
    const links = [...this.links.values()];
    return {
      mic: this.state.mic,
      held: this.state.held,
      links: links.map((link) => link.peer),
      states: Object.fromEntries(links.map((link) => [link.peer, link.pc.connectionState])),
      speaking: [...this.state.speaking],
    };
  }

  private update(change: Partial<VoiceState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.subscribers) {
      listener();
    }
  }

  /**
   * Brings the links in line with the room: closes what the plan closes and
   * opens what it opens (rules.ts), a peer whose link failed only once its
   * wait is over. A spectator's page links to every player while it
   * listens, and to nobody otherwise.
   */
  private replan(): void {
    const kind: LinkKind = this.audience ? 'listen' : 'crew';
    const self = this.self;
    if (!this.audience && self === null) {
      return;
    }
    const peers = this.audience && !this.state.listening ? [] : this.peers;
    const linked = new Set(
      [...this.links.values()].filter((link) => link.kind === kind).map((link) => link.peer),
    );
    const owns = (peer: string): boolean => self === null || ownsLink(self, peer);
    const plan = linkPlan(peers, this.seen, linked, owns);
    for (const peer of plan.close) {
      this.close(peer);
    }
    const now = performance.now();
    for (const peer of plan.open) {
      // Somebody new, or back, is linked at once: a failure before says nothing about them.
      if (!this.seen.has(peer) || (this.retryAt.get(peer) ?? 0) <= now) {
        this.retryAt.delete(peer);
        this.open(peer, kind === 'crew' ? 'crew' : 'listen');
      }
    }
    this.seen = new Set(peers.filter((peer) => peer.connected).map((peer) => peer.id));
    // Nobody waits to link again with somebody who is gone.
    for (const peer of [...this.retryAt.keys()].filter((id) => !this.seen.has(id))) {
      this.retryAt.delete(peer);
    }
    this.keepTicking();
  }

  /** Makes a link to `peer` and its offer: to talk with a crew member, or to listen to one. */
  private open(peer: string, kind: 'crew' | 'listen'): void {
    const link = this.makeLink(peer, kind, true);
    if (link === null) {
      return;
    }
    const direction = kind === 'crew' ? 'sendrecv' : 'recvonly';
    const transceiver = link.pc.addTransceiver('audio', { direction });
    if (kind === 'crew') {
      this.sendOn(link, transceiver.sender);
    }
    this.enqueue(link, async () => {
      const offer = await link.pc.createOffer();
      await link.pc.setLocalDescription(offer);
      if (offer.sdp !== undefined) {
        this.emit(link, { type: 'offer', sdp: offer.sdp });
      }
    });
  }

  /**
   * An offer from `from`: a crew member opening the link between the two of
   * them, or a spectator who wants to listen in. It starts the link afresh.
   * A spectator only listens: this end sends to them, and what might come
   * back is never played. A spectator's own page takes no offers.
   */
  private answer(from: string, sdp: string): void {
    if (this.audience || this.self === null) {
      return;
    }
    const kind: LinkKind = this.peers.some((peer) => peer.id === from) ? 'crew' : 'audience';
    this.close(from);
    const audience = [...this.links.values()].filter((link) => link.kind === 'audience');
    if (kind === 'audience' && audience.length >= MAX_AUDIENCE) {
      return;
    }
    const link = this.makeLink(from, kind, false);
    if (link === null) {
      return;
    }
    this.enqueue(link, async () => {
      await link.pc.setRemoteDescription({ type: 'offer', sdp });
      const [transceiver] = link.pc.getTransceivers();
      if (transceiver !== undefined) {
        transceiver.direction = kind === 'crew' ? 'sendrecv' : 'sendonly';
        this.sendOn(link, transceiver.sender);
      }
      const answer = await link.pc.createAnswer();
      await link.pc.setLocalDescription(answer);
      if (answer.sdp !== undefined) {
        this.emit(link, { type: 'answer', sdp: answer.sdp });
      }
    });
  }

  /** A signal from another member of the room. */
  private take(from: string, signal: RtcSignal): void {
    if (signal.type === 'offer') {
      this.answer(from, signal.sdp);
      return;
    }
    const link = this.links.get(from);
    if (link === undefined) {
      return;
    }
    if (signal.type === 'answer') {
      this.enqueue(link, async () => {
        // An answer to an offer this end no longer waits for changes nothing.
        if (link.pc.signalingState === 'have-local-offer') {
          await link.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        }
      });
      return;
    }
    // A candidate of a description gone by is no reason to give the link up.
    const candidate = candidateInit(signal.candidate);
    this.enqueue(link, () => link.pc.addIceCandidate(candidate).catch(() => undefined));
  }

  private makeLink(peer: string, kind: LinkKind, offering: boolean): Link | null {
    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers: this.iceServers });
    } catch {
      // The browser will not make another connection now: the opener tries again later.
      if (offering) {
        this.retryAt.set(peer, performance.now() + RETRY_AFTER_MS);
        this.keepTicking();
      }
      return null;
    }
    const link: Link = {
      peer,
      kind,
      pc,
      offering,
      since: performance.now(),
      connected: false,
      sender: null,
      hearing: null,
      queue: Promise.resolve(),
      closed: false,
    };
    this.links.set(peer, link);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate !== null) {
        this.emit(link, { type: 'ice', candidate: candidateOf(candidate) });
      }
    };
    pc.ontrack = ({ track, streams }) => {
      if (kind !== 'audience') {
        this.guarded(() => this.hear(link, streams[0] ?? new MediaStream([track])));
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        link.connected = true;
      } else if (pc.connectionState === 'failed') {
        this.fail(link);
      }
    };
    this.keepTicking();
    return link;
  }

  /** Sends a signal for `link`, unless it was closed or replaced meanwhile. */
  private emit(link: Link, signal: RtcSignal): void {
    if (!link.closed && this.links.get(link.peer) === link) {
      this.sendSignal?.(link.peer, signal);
    }
  }

  /** Runs `step` once the steps before it on `link` are done; a step that throws fails the link. */
  private enqueue(link: Link, step: () => Promise<void>): void {
    link.queue = link.queue
      .then(() => (link.closed ? undefined : step()))
      .catch(() => this.fail(link));
  }

  /** A link that broke down closes; whoever opened it tries again after a wait. */
  private fail(link: Link): void {
    if (link.closed) {
      return;
    }
    this.close(link.peer);
    if (link.offering) {
      this.retryAt.set(link.peer, performance.now() + RETRY_AFTER_MS);
    }
    this.keepTicking();
  }

  /** The microphone goes out on `sender`: now, or once it is on. */
  private sendOn(link: Link, sender: RTCRtpSender): void {
    link.sender = sender;
    if (this.mic !== null) {
      sender.replaceTrack(this.mic).catch(() => this.fail(link));
    }
  }

  /** Plays a peer's voice: metered for who speaks, at the volume their distance gives it. */
  private hear(link: Link, stream: MediaStream): void {
    const ctx = sharedAudio();
    if (ctx === null || link.hearing !== null || link.closed) {
      return;
    }
    const element = new Audio();
    element.muted = true;
    element.srcObject = stream;
    // A muted element may always play; should it not, Web Audio may still get the sound.
    element.play().catch(() => undefined);
    const source = ctx.createMediaStreamSource(stream);
    const meter = ctx.createAnalyser();
    meter.fftSize = LEVEL_SAMPLES;
    const volume = ctx.createGain();
    const set = this.volumeOf(link);
    volume.gain.value = set;
    source.connect(meter);
    source.connect(volume);
    volume.connect(ctx.destination);
    link.hearing = { element, source, meter, volume, set };
  }

  /**
   * How loud a link's voice plays: a crew member's by the distance between
   * the two avatars in this run and the walls between them; in full in the
   * lobby, before the positions come, and to a spectator.
   */
  private volumeOf(link: Link): number {
    const room = this.room;
    if (link.kind !== 'crew' || room === null || this.self === null) {
      return 1;
    }
    const players = this.positions.run === room.run ? this.positions.players : {};
    const from = players[this.self];
    const to = players[link.peer];
    return from === undefined || to === undefined ? 1 : gainBetween(room.map, from, to, room.shut);
  }

  private close(peer: string): void {
    const link = this.links.get(peer);
    if (link === undefined) {
      return;
    }
    this.links.delete(peer);
    link.closed = true;
    link.pc.onicecandidate = null;
    link.pc.ontrack = null;
    link.pc.onconnectionstatechange = null;
    link.pc.close();
    if (link.hearing !== null) {
      link.hearing.source.disconnect();
      link.hearing.volume.disconnect();
      link.hearing.element.srcObject = null;
    }
  }

  private closeAll(): void {
    for (const peer of [...this.links.keys()]) {
      this.close(peer);
    }
    this.retryAt.clear();
    this.keepTicking();
  }

  /** The microphone is on: out on every link, metered, open as the key or the switch says. */
  private useMic(track: MediaStreamTrack): void {
    this.mic = track;
    this.applyTalk();
    track.onended = () => {
      // Unplugged, or taken by the system.
      if (this.mic === track) {
        this.releaseMic();
        this.update({ mic: 'broken' });
      }
    };
    for (const link of this.links.values()) {
      if (link.sender !== null) {
        link.sender.replaceTrack(track).catch(() => this.fail(link));
      }
    }
    // Without a meter the microphone still talks; only its own ring is lost.
    this.guarded(() => {
      const ctx = sharedAudio();
      if (ctx !== null) {
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        const meter = ctx.createAnalyser();
        meter.fftSize = LEVEL_SAMPLES;
        source.connect(meter);
        this.own = { source, meter };
      }
    });
    this.keepTicking();
  }

  private releaseMic(): void {
    const track = this.mic;
    if (track === null) {
      return;
    }
    this.mic = null;
    track.onended = null;
    track.stop();
    for (const link of this.links.values()) {
      link.sender?.replaceTrack(null).catch(() => undefined);
    }
    this.own?.source.disconnect();
    this.own = null;
    this.keepTicking();
  }

  /** The microphone sends while the key is held or the switch keeps it open: silence otherwise. */
  private applyTalk(): void {
    if (this.mic !== null) {
      this.mic.enabled = this.state.open || this.state.held;
    }
  }

  /**
   * After a reload: the microphone comes back if the browser lets it without
   * asking. A browser that cannot tell keeps it off — asking would be a
   * prompt nobody clicked for.
   */
  private micAgain(): void {
    // Older Safari has no Permissions API at all.
    const permissions = navigator.permissions as Permissions | undefined;
    if (permissions === undefined) {
      return;
    }
    permissions
      .query({ name: 'microphone' })
      .then((status) => {
        if (status.state === 'granted') {
          void this.switchMicOn();
        }
      })
      // Firefox knows no microphone permission to ask about.
      .catch(() => undefined);
  }

  /** The tick runs while there is a link, a microphone or a link to try again. */
  private keepTicking(): void {
    const busy = this.links.size > 0 || this.mic !== null || this.retryAt.size > 0;
    if (busy && this.timer === null) {
      this.timer = setInterval(() => this.guarded(() => this.tick()), TICK_MS);
    } else if (!busy && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.hearLevels(new Map(), performance.now());
    }
  }

  /** Gives up links that never came up, opens failed ones again, then levels and volumes. */
  private tick(): void {
    const now = performance.now();
    for (const link of [...this.links.values()]) {
      if (!link.connected && now - link.since > CONNECT_WITHIN_MS) {
        this.fail(link);
      }
    }
    if (this.retryAt.size > 0) {
      this.replan();
    }
    const levels = new Map<string, number>();
    for (const link of this.links.values()) {
      if (link.hearing !== null) {
        levels.set(link.peer, this.levelOf(link.hearing.meter));
        this.glide(link, link.hearing);
      }
    }
    if (this.own !== null && this.self !== null) {
      levels.set(this.self, this.levelOf(this.own.meter));
    }
    this.hearLevels(levels, now);
  }

  /** Moves a voice's volume toward where the avatars stand now, once it is worth a ramp. */
  private glide(link: Link, hearing: Hearing): void {
    const target = this.volumeOf(link);
    if (Math.abs(target - hearing.set) > 0.01) {
      hearing.set = target;
      hearing.volume.gain.setTargetAtTime(target, hearing.volume.context.currentTime, VOLUME_GLIDE);
    }
  }

  private levelOf(meter: AnalyserNode): number {
    meter.getFloatTimeDomainData(this.samples);
    return peakOf(this.samples);
  }

  /** Who speaks after these levels (rules.ts); somebody no longer heard has stopped. */
  private hearLevels(levels: ReadonlyMap<string, number>, now: number): void {
    let changed = false;
    for (const [id, was] of [...this.speech]) {
      if (!levels.has(id)) {
        this.speech.delete(id);
        changed ||= was.speaking;
      }
    }
    for (const [id, level] of levels) {
      const was = this.speech.get(id) ?? SILENT;
      const next = heard(was, level, now);
      this.speech.set(id, next);
      changed ||= next.speaking !== was.speaking;
    }
    if (changed) {
      const speaking = [...this.speech].filter(([, speech]) => speech.speaking).map(([id]) => id);
      this.update({ speaking: new Set(speaking) });
    }
  }
}

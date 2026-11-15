import type { ReactNode } from 'react';
import { useMedia } from '../hooks.js';
import { useGlyph } from '../input/glyphs.js';
import type { MicTrouble } from '../voice/mesh.js';
import { useVoice } from '../voice/useVoice.js';
import { Icon } from './Icon.js';

/** The primary pointer is a finger: no V to hold, a button instead. */
const TOUCH = '(pointer: coarse)';

/**
 * One quiet line for every reason there is no microphone. Without one the
 * crew is still heard, and the quick chat stays — except where the browser
 * has no WebRTC at all.
 */
export const MIC_TROUBLE: Readonly<Record<MicTrouble, string>> = {
  unsupported: 'Sprechen geht in diesem Browser nicht.',
  insecure: 'Mikrofon nur über HTTPS — Mithören geht trotzdem.',
  denied: 'Mikrofon nicht erlaubt — Mithören geht trotzdem.',
  missing: 'Kein Mikrofon gefunden — Mithören geht trotzdem.',
  busy: 'Mikrofon belegt — Mithören geht trotzdem.',
  broken: 'Mikrofon ausgefallen — Mithören geht trotzdem.',
};

/**
 * A button held down to talk, for a touch screen: the microphone sends while
 * a finger rests on it, and it lights while it does — from V as well. There
 * only while the microphone is on.
 */
export function TalkButton({ className, children }: { className: string; children: ReactNode }) {
  const voice = useVoice();
  if (voice === null || voice.state.mic !== 'on') {
    return null;
  }
  const { mesh, state } = voice;
  const letGo = (): void => mesh.setHeld(false);
  return (
    <button
      className={state.held ? `${className} ${className}--on` : className}
      aria-label="Sprechen"
      aria-pressed={state.held}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        mesh.setHeld(true);
      }}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      onLostPointerCapture={letGo}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/**
 * The microphone in the lobby, a row of the mission panel: asked for on a
 * click, never by itself. Once on, a way to switch it off and how to talk —
 * the talk key (V unless the settings name another), or a button held on a
 * touch screen; without one, one quiet line why.
 */
export function MicSetup() {
  const voice = useVoice();
  const touch = useMedia(TOUCH);
  const talk = useGlyph('talk');
  if (voice === null) {
    return null;
  }
  const { mesh, state } = voice;
  if (state.mic === 'on') {
    return (
      <div className="voice-setup voice-setup-on">
        <span className="voice-on">
          <Icon name="mic" /> Mikro an
        </span>
        <button className="link voice-off" onClick={() => mesh.switchMicOff()}>
          aus
        </button>
        {touch ? (
          <TalkButton className="voice-talk">Halten zum Sprechen</TalkButton>
        ) : (
          <span className="voice-line">{`Zum Sprechen ${talk} halten`}</span>
        )}
      </div>
    );
  }
  // Where asking cannot work, the line says so and no button pretends otherwise.
  const askable = state.mic !== 'unsupported' && state.mic !== 'insecure';
  const asking = state.mic === 'asking';
  const trouble = state.mic === 'off' || asking ? null : state.mic;
  return (
    <div className="voice-setup">
      {askable && (
        <button className="voice-ask" disabled={asking} onClick={() => void mesh.switchMicOn()}>
          <Icon name="mic" /> Mikrofon aktivieren
        </button>
      )}
      <span className="voice-line" role="status">
        {trouble !== null
          ? MIC_TROUBLE[trouble]
          : asking
            ? 'Mikrofon wird geöffnet …'
            : 'Kopfhörer empfohlen'}
      </span>
    </div>
  );
}

/** The names in German order: „Ben", „Ben und Cara", „Ben, Cara und Dana". */
function listed(names: readonly string[]): string {
  const last = names.at(-1) ?? '';
  return names.length < 2 ? last : `${names.slice(0, -1).join(', ')} und ${last}`;
}

/**
 * The line for crew members no voice link reaches (mesh.ts `VoiceState.unreachable`), by
 * name: „Keine Sprechverbindung zu Ben"; null while every link is up or on its way.
 */
export function noLinkLine(names: readonly string[]): string | null {
  if (names.length === 0) {
    return null;
  }
  return `Keine Sprechverbindung zu ${listed(names)} — neuer Versuch läuft.`;
}

/**
 * Whom of `players` no voice link reaches, in one quiet line — apart from the microphone's
 * own: a link down is no microphone missing, and the voice keeps trying. Nothing otherwise.
 */
export function NoLink({ players }: { players: readonly { id: string; name: string }[] }) {
  const unreachable = useVoice()?.state.unreachable;
  const names = players.filter((p) => unreachable?.has(p.id) === true).map((p) => p.name);
  const line = noLinkLine(names);
  return line === null ? null : (
    <p className="voice-nolink" role="status">
      {line}
    </p>
  );
}

/** Who speaks: the microphone beside their name. */
export function SpeakingMark() {
  return (
    <span className="voice-speaking" role="img" aria-label="spricht">
      <Icon name="mic" />
    </span>
  );
}

/**
 * The audience's switch: listen in to the crew, everybody in full and with
 * no way to talk back, or not. Nothing where the browser has no WebRTC.
 */
export function ListenToggle() {
  const voice = useVoice();
  if (voice === null || voice.state.mic === 'unsupported') {
    return null;
  }
  const { mesh, state } = voice;
  return (
    <button
      className="link spectate-listen"
      aria-pressed={state.listening}
      onClick={() => mesh.setListening(!state.listening)}
    >
      <Icon name={state.listening ? 'speaker' : 'speaker-off'} /> Crew mithören
    </button>
  );
}

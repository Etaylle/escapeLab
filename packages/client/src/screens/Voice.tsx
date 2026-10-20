import type { ReactNode } from 'react';
import { useMedia } from '../hooks.js';
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
  insecure: 'Mikrofon nur über HTTPS — du hörst die Crew trotzdem.',
  denied: 'Mikrofon nicht erlaubt — du hörst die Crew trotzdem.',
  missing: 'Kein Mikrofon gefunden — du hörst die Crew trotzdem.',
  busy: 'Mikrofon belegt — du hörst die Crew trotzdem.',
  broken: 'Mikrofon ausgefallen — du hörst die Crew trotzdem.',
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
 * The microphone in the lobby, a plate on the crew room's wall: asked for on
 * a click, never by itself. Once on, a way to switch it off and how to talk —
 * V, or a button held on a touch screen; without one, one quiet line why.
 */
export function MicSetup() {
  const voice = useVoice();
  const touch = useMedia(TOUCH);
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
          <span className="voice-line">Zum Sprechen V halten</span>
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

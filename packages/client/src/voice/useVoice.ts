import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { typing } from '../hooks.js';
import { addProbes } from '../probes.js';
import { traceRequested } from '../world/frameTrace.js';
import type { Connection } from '../ws.js';
import { VoiceMesh, type VoiceState } from './mesh.js';

/** The page's voice, for every screen that shows or steers it; null outside the app. */
export const VoiceContext = createContext<VoiceMesh | null>(null);

/** The talk key, held down to talk. */
const TALK_KEY = 'v';

/**
 * Makes the page's voice once and keeps it fed: every server message in the
 * order it came, the socket dropping, V held down to talk. With `?trace=1`
 * the walkthrough reads it off `window.__escapelab.voice` (probes.ts).
 */
export function useVoiceMesh(conn: Pick<Connection, 'listen' | 'signal'>): VoiceMesh {
  const [mesh] = useState(() => new VoiceMesh());
  const { listen, signal } = conn;
  useEffect(() => {
    mesh.attach(signal, location.search);
    const stop = listen({ message: (msg) => mesh.receive(msg), closed: () => mesh.disconnected() });
    const dropProbe = traceRequested(location.search)
      ? addProbes({
          get voice() {
            return mesh.probe();
          },
        })
      : null;
    return () => {
      stop();
      dropProbe?.();
      mesh.detach();
    };
  }, [mesh, listen, signal]);
  usePushToTalk(mesh);
  return mesh;
}

/**
 * V held down talks, wherever the focus sits — the relay console keeps the
 * other keys to itself, but not this one — and never while typing. Losing
 * the window lets go, as a key let go there never comes back up here.
 */
function usePushToTalk(mesh: VoiceMesh): void {
  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat;
      if (e.key.toLowerCase() === TALK_KEY && plain && !typing()) {
        mesh.setHeld(true);
      }
    };
    const onUp = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === TALK_KEY) {
        mesh.setHeld(false);
      }
    };
    const letGo = (): void => mesh.setHeld(false);
    // Capturing: a dialog that stops the keys it handles still lets this one through first.
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', letGo);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', letGo);
    };
  }, [mesh]);
}

/** The voice and how it stands now. */
export interface Voice {
  readonly mesh: VoiceMesh;
  readonly state: VoiceState;
}

const NO_CHANGES = (): (() => void) => () => undefined;

/** The page's voice and its state, kept up to date; null outside the app, as in a test. */
export function useVoice(): Voice | null {
  const mesh = useContext(VoiceContext);
  const state = useSyncExternalStore(
    mesh?.subscribe ?? NO_CHANGES,
    () => mesh?.getState() ?? null,
    () => mesh?.getState() ?? null,
  );
  return mesh === null || state === null ? null : { mesh, state };
}

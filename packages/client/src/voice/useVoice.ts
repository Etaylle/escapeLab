import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { typing } from '../hooks.js';
import { addProbes } from '../probes.js';
import { getSettings, isRebinding } from '../settings.js';
import { traceRequested } from '../world/frameTrace.js';
import type { Connection } from '../ws.js';
import { VoiceMesh, type VoiceState } from './mesh.js';

/** The page's voice, for every screen that shows or steers it; null outside the app. */
export const VoiceContext = createContext<VoiceMesh | null>(null);

/**
 * Makes the page's voice once and keeps it fed: every server message in the
 * order it came, the socket dropping, the talk key (V unless the settings
 * name another) held down to talk. With `?trace=1` the walkthrough reads it
 * off `window.__escapelab.voice` (probes.ts).
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

/** A key going down or up, as far as talking cares. */
export type KeyLike = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'repeat'>;

/**
 * Whether a key going down starts talking: the talk key (`talkKey`, as the settings have it),
 * plain — no Strg, Alt or Cmd, no auto-repeat — and not while the keys are `busy`: typing,
 * or the settings waiting for a new talk key.
 */
export function talksOnDown(e: KeyLike, talkKey: string, busy: boolean): boolean {
  const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat;
  return plain && !busy && e.key.toLowerCase() === talkKey;
}

/** Whether a key going up stops talking: the talk key, however it came up. */
export function stopsOnUp(e: Pick<KeyboardEvent, 'key'>, talkKey: string): boolean {
  return e.key.toLowerCase() === talkKey;
}

/**
 * The talk key held down talks, wherever the focus sits — the relay console
 * keeps the other keys to itself, but not this one — and never while typing,
 * nor while the settings wait for a new talk key. Losing the window lets go,
 * as a key let go there never comes back up here. The key is read as it is
 * pressed: a key the settings change takes over at once.
 */
function usePushToTalk(mesh: VoiceMesh): void {
  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (talksOnDown(e, getSettings().talkKey, typing() || isRebinding())) {
        mesh.setHeld(true);
      }
    };
    const onUp = (e: KeyboardEvent): void => {
      if (stopsOnUp(e, getSettings().talkKey)) {
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

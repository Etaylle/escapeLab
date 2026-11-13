import { useState, useSyncExternalStore } from 'react';
import { isMuted, setMuted } from '../world/audio.js';
import { menuSoundState, subscribeMenuSound } from '../world/menuSound.js';
import { Icon } from './Icon.js';

/** What the sound switch says while the menu's sound waits for the first click or key. */
export const SOUND_WAITS = 'Ton kommt mit dem ersten Klick oder Tastendruck';

/** The sound switch's look and its words: off, on, or on and waiting for a gesture. */
function soundSwitch(on: boolean, waiting: boolean): { className: string; title: string } {
  if (on && waiting) {
    return { className: 'sound-toggle sound-toggle--waiting', title: SOUND_WAITS };
  }
  return { className: 'sound-toggle', title: on ? 'Ton ausschalten' : 'Ton einschalten' };
}

/**
 * The sound's quick switch: off or on — and on the menu (`menu`) lit while the menu's sound
 * waits for the first click or key (world/menuSound.ts).
 */
export function SoundSwitch({ menu }: { menu: boolean }) {
  const [sound, setSound] = useState(() => !isMuted());
  const state = useSyncExternalStore(subscribeMenuSound, menuSoundState, menuSoundState);
  const look = soundSwitch(sound, menu && state === 'waiting');
  return (
    <button
      className={look.className}
      title={look.title}
      aria-label="Ton"
      aria-pressed={sound}
      onClick={() => {
        setMuted(sound);
        setSound(!sound);
      }}
    >
      <Icon name={sound ? 'speaker' : 'speaker-off'} />
    </button>
  );
}

import { useEffect, useState } from 'react';
import { crewPass, lastColor } from '../pass.js';
import { CrewFigure } from './CrewFigure.js';
import { colorName } from './CrewRoom.js';

/** How long a name has to stand still before the figure waves at it, ms. */
export const WAVE_SETTLE_MS = 600;

/** The colour the profile wears before its player has worn one in a lobby: the crew's first. */
export const FIRST_COLOR = '#2dd4bf';

/** `value` once it has stood still for `ms`; as it was first, until then. */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * The player's profile at the top right of the menu's stage: their figure in the crew colour
 * last worn in a lobby (pass.ts `lastColor`) — breathing and glancing round as in the lobby,
 * waving once the name typed beside it has stood still a moment — the name, kept with the
 * browser's pass as it is typed, and the colour's name. The slot at its end is where an
 * account's sign-in will sit (docs/backlog.md K-1); today everybody is a guest there.
 */
export function ProfileChip({ name, onName }: { name: string; onName: (name: string) => void }) {
  const color = lastColor() ?? FIRST_COLOR;
  const settled = useSettled(name.trim(), WAVE_SETTLE_MS);
  return (
    <section className="profile-chip" aria-label="Profil">
      <CrewFigure
        id={crewPass().id}
        color={color}
        facing="front"
        isYou
        connected
        mood="play"
        wave={settled}
      />
      <div className="profile-who">
        <input
          className="profile-name"
          value={name}
          onChange={(e) => onName(e.target.value)}
          maxLength={40}
          placeholder="z. B. Anna"
          aria-label="Name"
          name="crew-name"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="profile-color">
          <span className="profile-dot" style={{ background: color }} aria-hidden="true" />
          {colorName(color)}
        </span>
      </div>
      <span className="profile-slot">Gast</span>
    </section>
  );
}

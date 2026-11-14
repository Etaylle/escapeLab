import { useEffect, useState } from 'react';
import type { AccountView } from '@escapelab/core';
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

/** How many runs an account played, in words: „noch kein Einsatz", „1 Einsatz", „3 Einsätze". */
export function runsText(runs: number): string {
  if (runs === 0) {
    return 'noch kein Einsatz';
  }
  return `${runs} ${runs === 1 ? 'Einsatz' : 'Einsätze'}`;
}

/**
 * What the profile says of the account at its end: how many runs it played — „Gast" where the
 * server told of none, the line down or the store away.
 */
export function accountLine(account: AccountView | null): string {
  return account === null ? 'Gast' : `Konto · ${runsText(account.runs)}`;
}

interface ChipProps {
  name: string;
  onName: (name: string) => void;
  /** the pass's account as the server told it; null before it did */
  account: AccountView | null;
}

/**
 * The name field's text as the account (`account`) changes from `before`, where it does: the
 * account's name while nothing was typed on this page — a name typed goes to the account
 * instead — another account's name once the device signed into it, typed or not, and none once
 * the account is deleted; null to leave the field as it is. Accounts are told apart by when each
 * was made.
 */
export function nameFromAccount(
  account: AccountView | null,
  before: AccountView | null,
  typed: boolean,
): string | null {
  if (account === null) {
    return before === null ? null : '';
  }
  if (before !== null && before.since !== account.since) {
    return account.name;
  }
  return typed || account.name === '' ? null : account.name;
}

/**
 * The player's profile at the top right of the menu's stage, the account of the browser's pass
 * (core protocol.ts `AccountView`): their figure in the colour the account wears — the one kept
 * with the pass before the server told it, the crew's first before any (pass.ts `lastColor`) —
 * breathing and glancing round as in the lobby, waving once the name typed beside it has stood
 * still a moment; the name, which the account takes once it stands still (Join.tsx), the
 * colour's name, and what the account holds (`accountLine`).
 */
export function ProfileChip({ name, onName, account }: ChipProps) {
  const color = account?.color ?? lastColor() ?? FIRST_COLOR;
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
      <span className="profile-slot">{accountLine(account)}</span>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { AccountView } from '@escapelab/core';
import { keepName, lastColor, lastName } from '../pass.js';
import { colorName } from './CrewRoom.js';
import { accountLine, FIRST_COLOR, nameFromAccount, WAVE_SETTLE_MS } from './ProfileChip.js';

/**
 * The name the account is to take from the field reading `name`: the name typed (`typed`),
 * trimmed — none while nothing was typed, where it is empty, or where the account goes by it.
 */
export function nameToTake(
  typed: boolean,
  name: string,
  account: AccountView | null,
): string | null {
  const wanted = name.trim();
  return !typed || wanted === '' || account?.name === wanted ? null : wanted;
}

/**
 * The profile in the settings' „Konto", as the menu's chip holds it (ProfileChip.tsx, Join.tsx):
 * the name the account goes by — kept with the pass as it is typed, and taken by the account
 * once it has stood still WAVE_SETTLE_MS (`onName`, the `profile` message), from the next room
 * on; the account's own as it comes (`nameFromAccount`), another's once the device signed into
 * it —, the colour the lobby chose, and what the account holds.
 */
export function ProfileFields({
  account,
  onName,
}: {
  account: AccountView | null;
  onName: (name: string) => void;
}) {
  const [name, setName] = useState(() => account?.name || lastName());
  const typed = useRef(false);
  const told = useRef(account);
  const tell = useRef(onName);
  tell.current = onName;
  useEffect(() => {
    const next = nameFromAccount(account, told.current, typed.current);
    told.current = account;
    if (next !== null) {
      typed.current = false;
      setName(next);
    }
  }, [account]);
  useEffect(() => {
    const wanted = nameToTake(typed.current, name, account);
    if (wanted === null) {
      return undefined;
    }
    const timer = setTimeout(() => tell.current(wanted), WAVE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [name, account]);
  const color = account?.color ?? lastColor() ?? FIRST_COLOR;
  return (
    <fieldset className="settings-group settings-profile">
      <legend>Profil</legend>
      <label className="settings-field">
        <span className="settings-label">Name</span>
        <input
          className="settings-name"
          value={name}
          maxLength={40}
          placeholder="z. B. Anna"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            typed.current = true;
            setName(e.target.value);
            keepName(e.target.value);
          }}
        />
      </label>
      <p className="settings-note">Gilt ab dem nächsten Raum.</p>
      <p className="settings-color">
        <span className="profile-dot" style={{ backgroundColor: color }} aria-hidden="true" />
        {colorName(color)} · gewählt in der Lobby
      </p>
      <p className="settings-account-line">{accountLine(account)}</p>
    </fieldset>
  );
}

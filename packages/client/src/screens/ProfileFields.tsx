import type { AccountView } from '@escapelab/core';
import { accountLine, profileColor } from './BarAccount.js';
import { colorName } from './CrewRoom.js';

/**
 * The profile in the settings' „Konto": the name the account goes by — the page's one name
 * (profileName.ts), which the menu's panels type as well and the top bar shows; the account takes
 * it once it has stood still, from the next room on —, the colour the lobby chose, and what the
 * account holds.
 */
export function ProfileFields({
  account,
  name,
  onName,
}: {
  account: AccountView | null;
  /** the profile's name as typed */
  name: string;
  /** the name typed anew */
  onName: (name: string) => void;
}) {
  const color = profileColor(account);
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
          onChange={(e) => onName(e.target.value)}
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

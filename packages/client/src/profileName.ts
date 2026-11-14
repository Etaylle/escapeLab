import { useEffect, useRef, useState } from 'react';
import type { AccountView, ClientMessage } from '@escapelab/core';
import { crewPass, keepName, lastName } from './pass.js';

/**
 * The profile's name as the page edits it (App.tsx): one name for the whole page — what the top
 * bar's account shows (screens/BarAccount.tsx), what the menu's panels seat the pass under and
 * type anew (screens/MenuPanels.tsx), and what the settings' „Konto" types (ProfileFields.tsx) —
 * kept with the pass as it is typed, and taken by the account once it has stood still.
 */

/** How long a typed name stands still before the account takes it, ms: the hero waves then. */
export const NAME_SETTLE_MS = 600;

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
 * The profile's name: starting with the name the pass keeps, kept again as it is typed, and the
 * account's name where nothing was typed yet — another account's once the device signed into it
 * (`nameFromAccount`). A name typed goes to the
 * account (`profile`) once it has stood still NAME_SETTLE_MS, where the line is up and the
 * account goes by another (`nameToTake`); an emptied field leaves the account its name.
 */
export function useProfileName(
  account: AccountView | null,
  send: (msg: ClientMessage) => void,
  connected: boolean,
): [string, (name: string) => void] {
  const [name, setName] = useState(() => lastName());
  const typed = useRef(false);
  const told = useRef<AccountView | null>(null);
  const say = useRef(send);
  say.current = send;
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
    if (wanted === null || !connected) {
      return undefined;
    }
    const timer = setTimeout(
      () => say.current({ kind: 'profile', pass: crewPass(), name: wanted }),
      NAME_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [name, connected, account]);
  const type = (next: string): void => {
    typed.current = true;
    setName(next);
    keepName(next);
  };
  return [name, type];
}

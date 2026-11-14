import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountView } from '@escapelab/core';
import { ACHIEVEMENTS_KEY, fillEarned, readEarned } from '../src/achievements.js';
import { lastColor, lastName, PASS_KEY } from '../src/pass.js';
import { nameFromAccount } from '../src/screens/Join.js';
import { createRoomMessage, joinMessage } from '../src/screens/MenuPanels.js';
import { accountLine, ProfileChip, runsText } from '../src/screens/ProfileChip.js';
import { nameToTake, ProfileFields } from '../src/screens/ProfileFields.js';
import {
  ACCOUNT_DELETED,
  AccountSection,
  deleteLine,
  deletionNow,
  SettingsPanel,
  type DeleteStep,
} from '../src/screens/Settings.js';
import { changeSettings, DEFAULT_SETTINGS } from '../src/settings.js';
import { takeIn, type Refusal } from '../src/ws.js';
import { page, storage } from './page.js';
import { elementsOf } from './probe.js';

const noop = (): void => undefined;

/** Anna's account as a server with a database tells it: three runs, two Erfolge of Blackout. */
const ANNA: AccountView = {
  name: 'Anna',
  color: '#a78bfa',
  since: Date.UTC(2026, 10, 1, 12),
  runs: 3,
  achievements: { blackout: { 'ohne-alarm': 1000, 'erste-schicht': 2000 } },
  store: 'database',
  login: null,
};

/** Anna's browser: her pass kept with `kept` beside it; what it keeps, by key. */
function browser(kept: Record<string, unknown> = {}): Map<string, string> {
  const pass = { id: 'a1'.repeat(16), secret: '0f'.repeat(32), name: '', color: null, ...kept };
  const local = new Map([[PASS_KEY, JSON.stringify(pass)]]);
  vi.stubGlobal('window', { localStorage: storage(local), location: { search: '' } });
  return local;
}

/** Every element of a tree as written, the elements in its children's too. */
function elementsIn(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child: ReactNode) => elementsIn(child));
  }
  if (!isValidElement(node)) {
    return [];
  }
  return [node, ...elementsIn((node.props as { children?: ReactNode }).children)];
}

/** The button of `tree` that says `text`; throws where there is none. */
function button(tree: ReactNode, text: string): { onClick: () => void; disabled?: boolean } {
  const found = elementsIn(tree).find(
    (el) => el.type === 'button' && (el.props as { children?: unknown }).children === text,
  );
  if (found === undefined) {
    throw new Error(`no button „${text}"`);
  }
  return found.props as { onClick: () => void; disabled?: boolean };
}

afterEach(() => {
  vi.unstubAllGlobals();
  changeSettings(DEFAULT_SETTINGS);
});

describe('the profile, as the account', () => {
  it('wears the account’s colour and says how many runs it played', () => {
    browser({ color: '#f472b6' });
    const html = renderToStaticMarkup(<ProfileChip name="Anna" onName={noop} account={ANNA} />);
    expect(html).toContain('style="background:#a78bfa"');
    expect(html).toContain('Violett</span>');
    expect(html).toContain('<span class="profile-slot">Konto · 3 Einsätze</span>');
  });

  it('counts the runs in words, and says „Gast" without an account', () => {
    expect([0, 1, 2].map(runsText)).toEqual(['noch kein Einsatz', '1 Einsatz', '2 Einsätze']);
    expect(accountLine(null)).toBe('Gast');
    expect(accountLine({ ...ANNA, runs: 1 })).toBe('Konto · 1 Einsatz');
  });

  it('follows the account’s name until one is typed, and empties once the account is gone', () => {
    expect(nameFromAccount(ANNA, null, false)).toBe('Anna');
    expect(nameFromAccount(ANNA, null, true)).toBeNull();
    expect(nameFromAccount({ ...ANNA, name: '' }, null, false)).toBeNull();
    expect(nameFromAccount(null, null, false)).toBeNull();
    expect(nameFromAccount(null, ANNA, true)).toBe('');
  });

  it('asks a seat in the account’s colour, opened or joined', () => {
    browser({ color: '#a78bfa' });
    const pass = { id: 'a1'.repeat(16), secret: '0f'.repeat(32) };
    const opened = createRoomMessage(pass, 'Anna', 'blackout', '', null, '#a78bfa');
    expect(opened).toMatchObject({ kind: 'create-room', color: '#a78bfa' });
    expect(createRoomMessage(pass, 'Anna', 'blackout', '')).not.toHaveProperty('color');
    expect(joinMessage('QX7R', 'Anna')).toMatchObject({ kind: 'join-room', color: '#a78bfa' });
    browser();
    expect(joinMessage('QX7R', 'Anna')).not.toHaveProperty('color');
  });
});

describe('the account on the line', () => {
  it('keeps the account’s name, colour and Erfolge with the pass, forgets them as it goes', () => {
    const local = browser({ name: 'Ann', color: '#f472b6' });
    local.set(ACHIEVEMENTS_KEY, JSON.stringify({ systemcheck: { 'erste-schicht': 50 } }));
    const { kept, got } = page();
    takeIn({ kind: 'account', account: ANNA }, kept);
    expect(got.account).toEqual(ANNA);
    expect([lastName(), lastColor()]).toEqual(['Anna', '#a78bfa']);
    expect(readEarned(storage(local))).toEqual({
      systemcheck: { 'erste-schicht': 50 },
      blackout: { 'ohne-alarm': 1000, 'erste-schicht': 2000 },
    });
    takeIn({ kind: 'account', account: null }, kept);
    expect(got.account).toBeNull();
    expect([lastName(), lastColor()]).toEqual(['', null]);
    expect(local.has(ACHIEVEMENTS_KEY)).toBe(false);
    expect(local.has(PASS_KEY)).toBe(true);
  });

  it('fills the Erfolge the server kept into the cache, each with the earlier date', () => {
    const local = new Map([
      [ACHIEVEMENTS_KEY, JSON.stringify({ blackout: { 'ohne-alarm': 500, ungesehen: 700 } })],
    ]);
    expect(fillEarned(storage(local), ANNA.achievements)).toBe(true);
    expect(readEarned(storage(local))).toEqual({
      blackout: { 'ohne-alarm': 500, ungesehen: 700, 'erste-schicht': 2000 },
    });
    expect(fillEarned(null, ANNA.achievements)).toBe(false);
  });
});

describe('„Konto löschen" in the settings', () => {
  /** The section at `step`, a refusal said where given, its steps and deletions noted. */
  function section(account: AccountView | null, step: DeleteStep, refused: string | null = null) {
    const steps: DeleteStep[] = [];
    const deleted: string[] = [];
    const tree = AccountSection({
      account,
      step,
      refused,
      onStep: (next) => steps.push(next),
      onDelete: () => deleted.push('delete-account'),
    });
    return { tree, steps, deleted, html: renderToStaticMarkup(<>{tree}</>) };
  }

  it('says what the account holds, and asks before it deletes anything', () => {
    const idle = section(ANNA, 'idle');
    expect(idle.html).toContain('<legend>Konto</legend>');
    expect(idle.html).toContain('Anna · seit 01.11.2026 · 3 Einsätze');
    expect(idle.html).not.toContain('Endgültig löschen');
    button(idle.tree, 'Konto löschen').onClick();
    expect(idle.steps).toEqual(['asked']);
    expect(idle.deleted).toEqual([]);
  });

  it('says what goes and what stays, then deletes at the second word or steps back', () => {
    const asked = section(ANNA, 'asked');
    expect(asked.html).toContain(deleteLine(ANNA));
    button(asked.tree, 'Abbrechen').onClick();
    expect(asked.steps).toEqual(['idle']);
    button(asked.tree, 'Endgültig löschen').onClick();
    expect(asked.steps).toEqual(['idle', 'sent']);
    expect(asked.deleted).toEqual(['delete-account']);
    // Sent off: it waits for the server, and deletes nothing twice.
    expect(button(section(ANNA, 'sent').tree, 'Endgültig löschen').disabled).toBe(true);
  });

  it('opens „Endgültig löschen" again where the server refused it, saying why there', () => {
    const away = 'Das Konto ist gerade nicht erreichbar.';
    const refusal = (seq: number, of: Refusal['of']): Refusal => ({ seq, message: away, of });
    expect(deletionNow('sent', 3, refusal(4, 'delete-account'))).toEqual({
      step: 'asked',
      refused: away,
    });
    // A refusal from before it was sent, or of something else, leaves it waiting.
    const waiting = { step: 'sent', refused: null };
    expect(deletionNow('sent', 4, refusal(4, 'delete-account'))).toEqual(waiting);
    expect(deletionNow('sent', 3, refusal(4, 'profile'))).toEqual(waiting);
    expect(deletionNow('idle', 3, refusal(4, 'delete-account'))).toEqual({
      step: 'idle',
      refused: null,
    });
    const asked = section(ANNA, 'asked', away);
    expect(asked.html).toContain(`role="alert">${away}</p>`);
    expect(button(asked.tree, 'Endgültig löschen').disabled).toBe(false);
    // The settings say it: the banner does not say it again.
    const { kept, got } = page();
    takeIn({ kind: 'error', message: away, of: 'delete-account' }, kept);
    expect(got.banner).toBeNull();
  });

  it('says the account is gone once it is, and shows nothing where there never was one', () => {
    expect(section(null, 'sent').html).toContain(ACCOUNT_DELETED);
    expect(section(null, 'idle').html).toBe('');
  });

  it('names what deleting takes and leaves, by the runs played', () => {
    const kept = { store: 'database' } as const;
    expect(deleteLine({ ...kept, runs: 0 })).toBe(
      'Löscht Name, Farbe und Erfolge des Kontos. Der Dienstausweis dieses Geräts bleibt.',
    );
    expect(deleteLine({ ...kept, runs: 1 })).toContain('nimmt den Namen aus seinem Einsatz;');
    expect(deleteLine({ ...kept, runs: 3 })).toContain('nimmt den Namen aus seinen 3 Einsätzen;');
  });

  it('says the run log keeps the name where the server keeps one, and no database', () => {
    const line = deleteLine({ runs: 3, store: 'run-log' });
    expect(line).toContain('nimmt den Namen aus der Bestenliste dieses Servers.');
    expect(line).toContain('Sein Laufprotokoll behält ihn und führt ihn nach einem Neustart');
    expect(line).not.toContain('Einsätzen');
    expect(deleteLine({ runs: 0, store: 'run-log' })).toBe(deleteLine({ ...ANNA, runs: 0 }));
    expect(section({ ...ANNA, store: 'run-log' }, 'asked').html).toContain('Laufprotokoll');
  });

  it('stands in the settings’ „Konto" where there is an account and a way to delete it', () => {
    const panel = renderToStaticMarkup(
      <SettingsPanel onClose={noop} account={ANNA} onDeleteAccount={noop} tab="konto" />,
    );
    expect(panel).toContain('<legend>Konto</legend>');
    expect(panel).toContain('>Konto löschen</button>');
    const none = renderToStaticMarkup(<SettingsPanel onClose={noop} tab="konto" />);
    expect(none).not.toContain('Konto');
    expect(none).toContain('<legend>Lautstärke</legend>');
  });
});

describe('the profile in the settings’ „Konto"', () => {
  it('shows the account’s name to change, its colour as the lobby chose it, and what it holds', () => {
    browser();
    const html = renderToStaticMarkup(<ProfileFields account={ANNA} onName={noop} />);
    expect(html).toContain('value="Anna"');
    expect(html).toContain('Violett · gewählt in der Lobby');
    expect(html).toContain('Konto · 3 Einsätze');
    expect(html).toContain('Gilt ab dem nächsten Raum.');
  });

  it('keeps a name typed with the pass at once', () => {
    browser();
    const field = elementsOf(() => <ProfileFields account={ANNA} onName={noop} />).find(
      (el) => el.type === 'input',
    );
    (field?.props['onChange'] as (e: { target: { value: string } }) => void)({
      target: { value: 'Annika' },
    });
    expect(lastName()).toBe('Annika');
  });

  it('hands the account a name once typed, trimmed — not an empty one, nor the one it has', () => {
    expect(nameToTake(true, '  Annika ', ANNA)).toBe('Annika');
    expect(nameToTake(true, 'Annika', null)).toBe('Annika');
    expect(nameToTake(false, 'Annika', ANNA)).toBeNull();
    expect(nameToTake(true, '   ', ANNA)).toBeNull();
    expect(nameToTake(true, ' Anna ', ANNA)).toBeNull();
  });
});

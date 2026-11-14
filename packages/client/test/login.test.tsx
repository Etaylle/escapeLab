import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD_SIZE, type AccountView } from '@escapelab/core';
import { ACHIEVEMENTS_KEY, readEarned } from '../src/achievements.js';
import { followPass, keptPass, PASS_KEY } from '../src/pass.js';
import {
  askOf,
  CHANGE_LINE,
  doneLine,
  leftBehind,
  LoginSection,
  loginNow,
  MISMATCH,
  NO_KENNWORT,
  NO_NUMBER,
  NO_OLD_KENNWORT,
  NO_RECOVERY,
  SIGN_OUT_LINE,
  SWITCH_LINE,
  WHY_KENNWORT,
  type Fields,
  type LoginState,
  type LoginStep,
} from '../src/screens/LoginSection.js';
import { offersSignIn, ProfileChip } from '../src/screens/ProfileChip.js';
import { SettingsPanel } from '../src/screens/Settings.js';
import { SNAPSHOT_KEY } from '../src/snapshots.js';
import { inBanner, replyTo, takeIn, type LoginAsk, type Refusal } from '../src/ws.js';
import { page, storage } from './page.js';
import { buttonsOf, elementsOf, press } from './probe.js';

const noop = (): void => undefined;

/** Anna's account, without a Kennwort: a guest of this device, three runs played. */
const GUEST: AccountView = {
  name: 'Anna',
  color: '#a78bfa',
  since: Date.UTC(2026, 10, 1, 12),
  runs: 3,
  achievements: { blackout: { 'ohne-alarm': 1000 } },
  store: 'database',
  login: null,
};

/** Anna's account with its Kennwort set: its Ausweisnummer. */
const SIGNED: AccountView = { ...GUEST, login: 'EL-7K3M-9Q2D' };

/** The fields of a form as typed. */
const typed = (fields: Partial<Fields>): Fields => ({
  number: '',
  old: '',
  password: '',
  again: '',
  ...fields,
});

/** The section opened on `step` for `account`, as markup; what it asked, noted. */
function section(account: AccountView | null, step: LoginStep = 'idle') {
  const asked: LoginAsk[] = [];
  const props = { account, news: null, refusal: null, ask: (a: LoginAsk) => asked.push(a) };
  const html = renderToStaticMarkup(<LoginSection {...props} opensOn={step} />);
  const elements = elementsOf(() => <LoginSection {...props} opensOn={step} />);
  return { html, elements, asked };
}

/** The browser's local and session storage, each a map of its own; the pass Anna's. */
function browser() {
  const local = new Map<string, string>([
    [PASS_KEY, JSON.stringify({ id: 'a1'.repeat(16), secret: '0f'.repeat(32), name: 'Anna' })],
  ]);
  const session = new Map<string, string>([['escapelab-session', '{"code":"QX7R"}']]);
  vi.stubGlobal('window', { localStorage: storage(local) });
  vi.stubGlobal('sessionStorage', storage(session));
  return { local, session };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('where the Ausweis stands', () => {
  const sent: LoginState = { step: 'sign-in', sent: { news: 2, refusals: 5 } };
  const refusal = (seq: number, of: Refusal['of']): Refusal => ({ seq, message: 'Nein.', of });

  it('stands at the step taken till its ask is sent, and waits for the answer then', () => {
    expect(loginNow({ step: 'set', sent: null }, null, null)).toEqual({
      step: 'set',
      waiting: false,
      refused: null,
      done: null,
    });
    expect(loginNow(sent, { seq: 2, done: 'signed-in' }, refusal(5, 'sign-in'))).toMatchObject({
      step: 'sign-in',
      waiting: true,
    });
  });

  it('shows the number minted after a first Kennwort, the ways after anything else', () => {
    const set: LoginState = { step: 'set', sent: { news: 0, refusals: 0 } };
    expect(loginNow(set, { seq: 1, done: 'set' }, null)).toMatchObject({
      step: 'minted',
      done: 'set',
    });
    expect(loginNow(sent, { seq: 3, done: 'signed-in' }, null)).toMatchObject({
      step: 'idle',
      waiting: false,
      done: 'signed-in',
    });
  });

  it('opens the form again on a refusal of its own ask, saying it, and on no other', () => {
    expect(loginNow(sent, null, refusal(6, 'sign-in'))).toMatchObject({
      step: 'sign-in',
      waiting: false,
      refused: 'Nein.',
    });
    expect(loginNow(sent, null, refusal(6, 'profile'))).toMatchObject({ waiting: true });
  });

  it('says what was done in a line where there is something to say', () => {
    const lines = [doneLine('changed'), doneLine('signed-in'), doneLine('set'), doneLine(null)];
    expect(lines).toEqual([
      'Kennwort geändert: Die anderen Geräte dieses Kontos sind abgemeldet.',
      'Angemeldet.',
      null,
      null,
    ]);
  });
});

describe('the asks of the Ausweis’s forms', () => {
  it('sign in with an Ausweisnummer as it is written, however it was typed', () => {
    const fields = typed({ number: ' el 7k3m 9q2d ', password: 'geheim' });
    expect(askOf('sign-in', fields)).toEqual({
      kind: 'sign-in',
      login: 'EL-7K3M-9Q2D',
      password: 'geheim',
    });
    expect(askOf('switch', fields)).toMatchObject({ kind: 'switch-account' });
    expect(askOf('sign-in', typed({ number: 'EL-0OOO-1III', password: 'x' }))).toEqual({
      problem: NO_NUMBER,
    });
    expect(askOf('sign-in', typed({ number: 'EL-7K3M-9Q2D' }))).toEqual({ problem: NO_KENNWORT });
  });

  it('set a new Kennwort of 8 to 128 characters, typed twice alike', () => {
    expect(askOf('set', typed({ password: 'Kaltenbrunn', again: 'Kaltenbrunn' }))).toEqual({
      kind: 'set-password',
      password: 'Kaltenbrunn',
    });
    expect(askOf('set', typed({ password: 'kurz', again: 'kurz' }))).toEqual({
      problem: PASSWORD_SIZE,
    });
    expect(askOf('set', typed({ password: 'Kaltenbrunn', again: 'Kaltenbrun' }))).toEqual({
      problem: MISMATCH,
    });
  });

  it('change one with the present one shown, and sign out without a field', () => {
    const fields = typed({ old: 'Bisher 1986', password: 'Kaltenbrunn', again: 'Kaltenbrunn' });
    expect(askOf('change', fields)).toEqual({
      kind: 'change-password',
      old: 'Bisher 1986',
      password: 'Kaltenbrunn',
    });
    expect(askOf('change', { ...fields, old: '' })).toEqual({ problem: NO_OLD_KENNWORT });
    expect(askOf('sign-out', typed({}))).toEqual({ kind: 'sign-out' });
  });
});

describe('the Ausweis in the settings’ „Konto"', () => {
  it('tells an account without a Kennwort what one gives, and offers one and a sign-in', () => {
    const { html } = section(GUEST);
    expect(html).toContain('<legend>Ausweis</legend>');
    expect(html).toContain(WHY_KENNWORT);
    expect(html).toContain('>Kennwort setzen</button>');
    expect(html).toContain('>Anmelden</button>');
    expect(html).not.toContain('Abmelden');
    expect(html).not.toContain(NO_RECOVERY);
  });

  it('shows an account its Ausweisnummer, that a lost Kennwort stays lost, its ways', () => {
    const { html } = section(SIGNED);
    expect(html).toContain('<code class="settings-login-code">EL-7K3M-9Q2D</code>');
    expect(html).toContain(NO_RECOVERY);
    for (const way of ['Kennwort ändern', 'Konto wechseln', 'Abmelden']) {
      expect(html).toContain(`>${way}</button>`);
    }
    expect(html).not.toContain(WHY_KENNWORT);
  });

  it('shows nothing before the server told the account', () => {
    expect(section(null).html).toBe('');
  });

  it('asks the number and the Kennwort to sign in, saying what a guest leaves behind', () => {
    const { html } = section(GUEST, 'sign-in');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain(leftBehind(GUEST) ?? '!!');
    expect(leftBehind(GUEST)).toBe(
      'Die 3 Einsätze dieses Gastkontos bleiben in der Bestenliste; das Gastkonto selbst ist ' +
        'danach nicht mehr erreichbar.',
    );
    expect(leftBehind({ login: null, runs: 1 })).toMatch(/^Der Einsatz dieses Gastkontos bleibt/);
    expect([leftBehind({ ...GUEST, runs: 0 }), leftBehind(SIGNED)]).toEqual([null, null]);
    expect(html).toContain('>Anmelden</button>');
  });

  it('asks a Kennwort twice to set one, the present and a new one twice to change it', () => {
    const set = section(GUEST, 'set').html;
    expect(set.match(/autoComplete="new-password"/g)).toHaveLength(2);
    const change = section(SIGNED, 'change').html;
    expect(change).toContain('Bisheriges Kennwort');
    expect(change.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(change.match(/autoComplete="current-password"/g)).toHaveLength(1);
  });

  it('says what a new Kennwort, a switch and a sign-out do before either is asked for', () => {
    expect(section(SIGNED, 'change').html).toContain(CHANGE_LINE);
    expect(section(SIGNED, 'switch').html).toContain(SWITCH_LINE);
    const out = section(SIGNED, 'sign-out');
    expect(out.html).toContain(SIGN_OUT_LINE);
    press(buttonsOf(out.elements, 'settings-login-send')[0]);
    expect(out.asked).toEqual([{ kind: 'sign-out' }]);
  });

  it('shows the Ausweisnummer just minted large, till it is noted', () => {
    const { html } = section(SIGNED, 'minted');
    expect(html).toContain('<code class="settings-login-big">EL-7K3M-9Q2D</code>');
    expect(html).toContain('>Notiert</button>');
  });

  it('sends nothing where the form’s fields are wrong', () => {
    const { elements, asked } = section(GUEST, 'sign-in');
    const form = elements.find((element) => element.type === 'form');
    (form?.props['onSubmit'] as (e: { preventDefault: () => void }) => void)({
      preventDefault: noop,
    });
    expect(asked).toEqual([]);
  });

  it('stands in „Konto" between profile and account, opened on a sign-in where asked', () => {
    const props = { onClose: noop, account: GUEST, onDeleteAccount: noop, askLogin: noop };
    const plain = renderToStaticMarkup(<SettingsPanel {...props} tab="konto" />);
    const order = ['<legend>Profil</legend>', '<legend>Ausweis</legend>', '<legend>Konto</legend>'];
    const at = order.map((legend) => plain.indexOf(legend));
    expect(at.every((where, i) => where > (at[i - 1] ?? -1))).toBe(true);
    const signIn = renderToStaticMarkup(
      <SettingsPanel {...props} tab="konto" loginStep="sign-in" />,
    );
    expect(signIn).toContain('autoComplete="username"');
    // Without a way to ask, no Ausweis.
    const none = renderToStaticMarkup(
      <SettingsPanel onClose={noop} account={GUEST} onDeleteAccount={noop} tab="konto" />,
    );
    expect(none).not.toContain('<legend>Ausweis</legend>');
  });
});

describe('the menu’s profile', () => {
  it('offers a sign-in to an account without a Kennwort, and to no other', () => {
    expect([offersSignIn(GUEST), offersSignIn(SIGNED), offersSignIn(null)]).toEqual([
      true,
      false,
      false,
    ]);
    browser();
    const opened: string[] = [];
    const onSignIn = (): void => {
      opened.push('sign-in');
    };
    const chip = (account: AccountView) =>
      elementsOf(() => (
        <ProfileChip name="Anna" onName={noop} account={account} onSignIn={onSignIn} />
      ));
    press(buttonsOf(chip(GUEST), 'profile-sign-in')[0]);
    expect(opened).toEqual(['sign-in']);
    expect(buttonsOf(chip(SIGNED), 'profile-sign-in')).toEqual([]);
    const without = renderToStaticMarkup(<ProfileChip name="Anna" onName={noop} account={GUEST} />);
    expect(without).not.toContain('Anmelden');
  });
});

describe('the answers to a login on the line', () => {
  it('keeps the account a Kennwort or a sign-in brings, and asks where it sits anew', () => {
    const { local } = browser();
    local.set(ACHIEVEMENTS_KEY, JSON.stringify({ systemcheck: { 'erste-schicht': 50 } }));
    const { kept, got } = page();
    takeIn({ kind: 'login', done: 'set', account: SIGNED }, kept);
    expect([got.account, got.logins]).toEqual([SIGNED, ['set']]);
    expect(readEarned(storage(local))).toHaveProperty('systemcheck');
    // Signed into another account: the Erfolge the device keeps are that one's alone.
    const other = { ...SIGNED, achievements: { blackout: { 'ohne-alarm': 9 } } };
    takeIn({ kind: 'login', done: 'signed-in', account: other }, kept);
    expect(readEarned(storage(local))).toEqual({ blackout: { 'ohne-alarm': 9 } });
    expect(replyTo({ kind: 'login', done: 'signed-in', account: other })).toEqual({
      kind: 'whereami',
      pass: { id: 'a1'.repeat(16), secret: '0f'.repeat(32) },
    });
    expect(replyTo({ kind: 'login', done: 'changed', account: other })).toBeNull();
  });

  it('starts the page anew on a new pass once signed out, keeping nothing of the old', () => {
    const { local, session } = browser();
    local.set(ACHIEVEMENTS_KEY, '{}');
    local.set(`${SNAPSHOT_KEY}QX7R`, '{}');
    const { kept, got } = page();
    takeIn({ kind: 'login', done: 'signed-out', account: null }, kept);
    const pass = keptPass(storage(local));
    expect(pass.id).not.toBe('a1'.repeat(16));
    expect(pass.id).toMatch(/^[0-9a-f]{32}$/);
    expect([pass.name, pass.color]).toEqual(['', null]);
    const left = [local.has(ACHIEVEMENTS_KEY), local.has(`${SNAPSHOT_KEY}QX7R`)];
    expect(left).toEqual([false, false]);
    expect(session.has('escapelab-session')).toBe(false);
    expect([got.logins, got.startedOver]).toEqual([['signed-out'], 1]);
  });

  it('starts the page anew on the pass a switch sent, in the account it switched to', () => {
    const { local } = browser();
    const { kept, got } = page();
    const next = { id: 'b2'.repeat(16), secret: '1e'.repeat(32) };
    kept.nextPass.current = next;
    takeIn({ kind: 'login', done: 'switched', account: { ...SIGNED, name: 'Dan' } }, kept);
    expect(keptPass(storage(local))).toEqual({ ...next, name: 'Dan', color: '#a78bfa' });
    expect(got.startedOver).toBe(1);
  });

  it('says a refusal of a login where it was asked, not in the banner', () => {
    const kinds = ['set-password', 'change-password', 'sign-in', 'sign-out', 'switch-account'];
    for (const of of kinds as Refusal['of'][]) {
      expect(inBanner(of ?? undefined), String(of)).toBe(false);
    }
  });

  it('loads a page anew once another tab put another pass in the browser, not before', () => {
    const { local } = browser();
    const listeners: ((event: StorageEvent) => void)[] = [];
    const win = {
      addEventListener: (_: string, listener: (event: StorageEvent) => void) => {
        listeners.push(listener);
      },
      removeEventListener: noop,
    } as unknown as Window;
    const reloads: number[] = [];
    const stop = followPass(win, () => reloads.push(1), storage(local));
    const fire = (key: string): void => listeners.forEach((l) => l({ key } as StorageEvent));
    // Another tab keeps a name with the same pass: nothing to do.
    const same = { id: 'a1'.repeat(16), secret: '0f'.repeat(32), name: 'A' };
    local.set(PASS_KEY, JSON.stringify(same));
    fire(PASS_KEY);
    expect(reloads).toEqual([]);
    local.set(PASS_KEY, JSON.stringify({ id: 'c3'.repeat(16), secret: '2d'.repeat(32) }));
    fire('escapelab.achievements');
    fire(PASS_KEY);
    expect(reloads).toEqual([1]);
    stop();
  });
});

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  numberOf,
  PASSWORD_SIZE,
  passwordFits,
  type AccountView,
  type LoginDone,
} from '@escapelab/core';
import type { LoginAsk, LoginNews, Refusal } from '../ws.js';

/**
 * The account's Ausweis in the settings' „Konto" (docs/accounts.md, „Sign in"): an account
 * without a Kennwort says what one gives it and offers „Kennwort setzen" — the server mints the
 * Ausweisnummer then, shown once large till „Notiert" — and „Anmelden"; an account with one shows
 * its Ausweisnummer, to copy, that a forgotten Kennwort is not recovered, and offers „Kennwort
 * ändern", „Konto wechseln" and „Abmelden". Each form says why the server refused it in place;
 * a sign-out or a switch loads the page anew on the device's next pass (ws.ts).
 */

/**
 * Where the section stands: its buttons; a form — a first Kennwort, a new one, a sign-in, a
 * switch — or the ask before a sign-out; the Ausweisnummer just minted, shown large.
 */
export type LoginStep = 'idle' | 'set' | 'change' | 'sign-in' | 'switch' | 'sign-out' | 'minted';

/** The steps that send an ask (`LoginAsk`), and the kind each sends. */
const ASKS = {
  set: 'set-password',
  change: 'change-password',
  'sign-in': 'sign-in',
  switch: 'switch-account',
  'sign-out': 'sign-out',
} as const satisfies Partial<Record<LoginStep, LoginAsk['kind']>>;

/** A step that sends an ask. */
export type AskStep = keyof typeof ASKS;

const isAskStep = (step: LoginStep): step is AskStep => step in ASKS;

/**
 * The section's own state: the step taken, and — once its ask went out — the count of the
 * server's answers and refusals as it did, so that only what comes after counts (`loginNow`).
 */
export interface LoginState {
  step: LoginStep;
  sent: { news: number; refusals: number } | null;
}

/** Where the section stands now (`loginNow`): its step, an ask on its way, why it was refused. */
export interface LoginShown {
  step: LoginStep;
  waiting: boolean;
  refused: string | null;
  /** what the server did at the last ask, once it answered; null before */
  done: LoginDone | null;
}

/**
 * Where the section stands now: at the step taken, until its ask is answered — the Ausweisnummer
 * minted shown large after a first Kennwort, the buttons after anything else — or refused, its
 * form open again with the refusal said there.
 */
export function loginNow(
  state: LoginState,
  news: LoginNews | null,
  refusal: Refusal | null,
): LoginShown {
  const { step, sent } = state;
  const shown = { step, waiting: false, refused: null, done: null };
  if (sent === null || !isAskStep(step)) {
    return shown;
  }
  const done = news !== null && news.seq > sent.news ? news.done : null;
  if (done !== null) {
    return { ...shown, step: done === 'set' ? 'minted' : 'idle', done };
  }
  const refused = refusedSince(refusal, sent.refusals, ASKS[step]);
  return refused === null ? { ...shown, waiting: true } : { ...shown, refused };
}

/** Why the server refused an ask of `kind` since its `seq`-th refusal; null where it did not. */
function refusedSince(refusal: Refusal | null, seq: number, kind: LoginAsk['kind']) {
  return refusal !== null && refusal.seq > seq && refusal.of === kind ? refusal.message : null;
}

/** What two Kennwort fields that differ are told. */
export const MISMATCH = 'Die beiden Kennwörter stimmen nicht überein.';

/** What an Ausweisnummer that is none is told. */
export const NO_NUMBER = 'Eine Ausweisnummer hat die Form EL-7K3M-9Q2D.';

/** What a form without the Kennwort it needs is told: the present one, or the one to sign in. */
export const NO_KENNWORT = 'Das Kennwort fehlt.';
export const NO_OLD_KENNWORT = 'Das bisherige Kennwort fehlt.';

/** What a form's fields hold as typed. */
export interface Fields {
  number: string;
  old: string;
  password: string;
  again: string;
}

const NO_FIELDS: Fields = { number: '', old: '', password: '', again: '' };

/** An ask a form sends, or what is wrong with its fields before it goes. */
export type Asked = LoginAsk | { problem: string };

/**
 * The ask the form of `step` sends with `fields`, or what is wrong with them before it goes: an
 * Ausweisnummer that is none, a Kennwort missing; a new Kennwort of the wrong length, or typed
 * twice two ways.
 */
export function askOf(step: AskStep, fields: Fields): Asked {
  switch (step) {
    case 'sign-out':
      return { kind: 'sign-out' };
    case 'sign-in':
    case 'switch':
      return signInAsk(ASKS[step], fields);
    case 'set':
    case 'change':
      return newKennwortAsk(step, fields);
  }
}

/** A sign-in or a switch with `fields` (`askOf`). */
function signInAsk(kind: 'sign-in' | 'switch-account', { number, password }: Fields): Asked {
  const login = numberOf(number);
  if (login === null) {
    return { problem: NO_NUMBER };
  }
  return password === '' ? { problem: NO_KENNWORT } : { kind, login, password };
}

/** A first Kennwort or a new one with `fields` (`askOf`). */
function newKennwortAsk(step: 'set' | 'change', { old, password, again }: Fields): Asked {
  if (step === 'change' && old === '') {
    return { problem: NO_OLD_KENNWORT };
  }
  if (!passwordFits(password)) {
    return { problem: PASSWORD_SIZE };
  }
  if (password !== again) {
    return { problem: MISMATCH };
  }
  return step === 'set' ? { kind: ASKS.set, password } : { kind: ASKS.change, old, password };
}

/** What the section says once the server did what was asked; null where nothing is to be said. */
export function doneLine(done: LoginDone | null): string | null {
  const lines: Partial<Record<LoginDone, string>> = {
    changed: 'Kennwort geändert: Die anderen Geräte dieses Kontos sind abgemeldet.',
    'signed-in': 'Angemeldet.',
  };
  return done === null ? null : (lines[done] ?? null);
}

/** What an account without a Kennwort is told it would gain from one (backlog K-1c). */
export const WHY_KENNWORT =
  'Mit Ausweisnummer und Kennwort holt dieses Konto seine Einsätze und Erfolge auf jedes Gerät.';

/** What an account with a Kennwort is told of losing it: there is no way back yet. */
export const NO_RECOVERY =
  'Ein vergessenes Kennwort lässt sich nicht wiederherstellen: Ohne Kennwort und ohne ein ' +
  'angemeldetes Gerät ist das Konto verloren.';

/**
 * What signing in from an account without a Kennwort leaves behind, said before: its runs stay in
 * the Bestenliste, the account out of reach; nothing where it played none.
 */
export function leftBehind(account: Pick<AccountView, 'login' | 'runs'>): string | null {
  if (account.login !== null || account.runs === 0) {
    return null;
  }
  const runs = account.runs === 1 ? 'Der Einsatz' : `Die ${account.runs} Einsätze`;
  const stay = account.runs === 1 ? 'bleibt' : 'bleiben';
  return (
    `${runs} dieses Gastkontos ${stay} in der Bestenliste; das Gastkonto selbst ist danach ` +
    'nicht mehr erreichbar.'
  );
}

/** What a switch says it does before it is asked for. */
export const SWITCH_LINE =
  'Dieses Gerät wechselt auf das Konto der Ausweisnummer; das bisherige bleibt mit seinem ' +
  'Kennwort erreichbar.';

/** What a new Kennwort says it does to the account's other devices before it is asked for. */
export const CHANGE_LINE =
  'Ein neues Kennwort meldet alle anderen Geräte dieses Kontos ab; ein Platz in einem laufenden ' +
  'Einsatz bleibt beim Konto.';

/** What a sign-out says it keeps before it is asked for. */
export const SIGN_OUT_LINE =
  'Das Konto bleibt mit Ausweisnummer und Kennwort erreichbar, ein Platz in einem laufenden ' +
  'Einsatz bleibt bei ihm. Dieses Gerät beginnt neu, als Gast.';

/** What a form says on a page reached without encryption, where a Kennwort crosses the net. */
export const PLAIN_LINE =
  'Diese Verbindung ist unverschlüsselt: Das Kennwort geht lesbar durchs Netz.';

/** Whether the page was reached without encryption (http on another machine than this one). */
function plainLine(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === false;
}

/** The props of the section. */
interface Props {
  /** the pass's account as the server told it; null before it did, and the section shows none */
  account: AccountView | null;
  /** the server's latest answer to an ask of a login (ws.ts) */
  news: LoginNews | null;
  /** the server's latest refusal on the line (ws.ts) */
  refusal: Refusal | null;
  /** sends an ask of a login (ws.ts `Connection.askLogin`) */
  ask: (ask: LoginAsk) => void;
  /** the step it opens on: the menu's profile opens it on the sign-in */
  opensOn?: LoginStep;
}

/** The account's Ausweis (see the module's comment); nothing before the server told the account. */
export function LoginSection(props: Props) {
  const { account, news, refusal, ask } = props;
  const [state, setState] = useState<LoginState>({ step: props.opensOn ?? 'idle', sent: null });
  if (account === null) {
    return null;
  }
  const now = loginNow(state, news, refusal);
  const go = { news: news?.seq ?? 0, refusals: refusal?.seq ?? 0 };
  const turn = {
    take: (step: LoginStep): void => setState({ step, sent: null }),
    send: (msg: LoginAsk): void => {
      setState({ step: now.step, sent: go });
      ask(msg);
    },
  };
  return (
    <fieldset className="settings-group settings-login">
      <legend>Ausweis</legend>
      <LoginBody account={account} now={now} turn={turn} />
    </fieldset>
  );
}

/** How the section's parts move it: to a step, or an ask sent from the step it stands at. */
interface Turn {
  take: (step: LoginStep) => void;
  send: (msg: LoginAsk) => void;
}

/** What the section holds at the step it stands at now (`LoginShown`). */
function LoginBody({ account, now, turn }: { account: AccountView; now: LoginShown; turn: Turn }) {
  const bodies: Record<LoginStep, () => ReactNode> = {
    idle: () => <LoginFacts account={account} done={now.done} take={turn.take} />,
    minted: () => <Minted number={account.login} onNoted={() => turn.take('idle')} />,
    set: () => <LoginForm step="set" account={account} now={now} turn={turn} />,
    change: () => <LoginForm step="change" account={account} now={now} turn={turn} />,
    'sign-in': () => <LoginForm step="sign-in" account={account} now={now} turn={turn} />,
    switch: () => <LoginForm step="switch" account={account} now={now} turn={turn} />,
    'sign-out': () => <SignOutAsk now={now} turn={turn} />,
  };
  return bodies[now.step]();
}

/**
 * The section at rest: for an account with a Kennwort its Ausweisnummer, to copy, that a forgotten
 * Kennwort is not recovered, and the ways to change it, switch and sign out; for one without, what
 * one gives it and the ways to set one and to sign in. What was done last stands under it.
 */
function LoginFacts(props: {
  account: AccountView;
  done: LoginDone | null;
  take: (step: LoginStep) => void;
}) {
  const { account, done, take } = props;
  const said = doneLine(done);
  const button = (step: LoginStep, text: string, danger = false): ReactNode => (
    <button
      type="button"
      className={danger ? 'danger settings-login-way' : 'settings-rebind settings-login-way'}
      data-login={step}
      onClick={() => take(step)}
    >
      {text}
    </button>
  );
  return (
    <>
      {account.login === null ? (
        <p className="settings-login-why">{WHY_KENNWORT}</p>
      ) : (
        <NumberLine number={account.login} />
      )}
      {account.login !== null && <p className="settings-note">{NO_RECOVERY}</p>}
      <div className="settings-login-actions">
        {account.login === null ? (
          <>
            {button('set', 'Kennwort setzen')}
            {button('sign-in', 'Anmelden')}
          </>
        ) : (
          <>
            {button('change', 'Kennwort ändern')}
            {button('switch', 'Konto wechseln')}
            {button('sign-out', 'Abmelden', true)}
          </>
        )}
      </div>
      {said !== null && (
        <p className="settings-note settings-login-done" role="status">
          {said}
        </p>
      )}
    </>
  );
}

/** The account's Ausweisnummer, on a line of its own, and the way to copy it. */
function NumberLine({ number }: { number: string }) {
  return (
    <p className="settings-login-number">
      <span className="settings-label">Ausweisnummer</span>
      <code className="settings-login-code">{number}</code>
      <CopyButton text={number} />
    </p>
  );
}

/** How a copy went: not tried yet, on the clipboard, or refused by the browser. */
type Copied = 'idle' | 'done' | 'refused';

/**
 * Copies `text` to the clipboard at a press, and says for two seconds how it went; nothing where
 * the browser has no clipboard to write to (a page reached without encryption).
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState<Copied>('idle');
  useEffect(() => {
    if (copied === 'idle') {
      return undefined;
    }
    const timer = setTimeout(() => setCopied('idle'), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    return null;
  }
  const words: Record<Copied, string> = {
    idle: 'Kopieren',
    done: 'Kopiert',
    refused: 'Nicht kopiert',
  };
  return (
    <button
      type="button"
      className="settings-rebind settings-login-copy"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied('done'),
          () => setCopied('refused'),
        );
      }}
    >
      {words[copied]}
    </button>
  );
}

/** The Ausweisnummer just minted, large, till its player has noted it. */
function Minted({ number, onNoted }: { number: string | null; onNoted: () => void }) {
  return (
    <div className="settings-login-minted" role="status">
      <span className="settings-label">Ausweisnummer</span>
      <code className="settings-login-big">{number ?? '—'}</code>
      <p className="settings-note">
        Diese Nummer und das Kennwort öffnen das Konto auf jedem Gerät; die Nummer steht auch
        hier im Ausweis. {NO_RECOVERY}
      </p>
      <div className="settings-login-actions">
        <button type="button" className="primary settings-login-noted" onClick={onNoted}>
          Notiert
        </button>
      </div>
    </div>
  );
}

/** A step with a form: all that send an ask but the sign-out, which asks once more instead. */
type FormStep = Exclude<AskStep, 'sign-out'>;

/** A form: what its button says, and what it says before it is sent — null for nothing. */
interface FormText {
  submit: string;
  line: (account: AccountView) => string | null;
}

const FORMS: Record<FormStep, FormText> = {
  set: { submit: 'Kennwort setzen', line: () => null },
  change: { submit: 'Kennwort ändern', line: () => CHANGE_LINE },
  'sign-in': { submit: 'Anmelden', line: leftBehind },
  switch: { submit: 'Konto wechseln', line: () => SWITCH_LINE },
};

/** A field of a form: its label, the part of `Fields` it fills, its input's kind. */
interface FieldSpec {
  label: string;
  name: keyof Fields;
  type: 'text' | 'password';
  autoComplete: 'username' | 'current-password' | 'new-password';
}

/** One field of a form: its label over its input. */
function Field(
  props: FieldSpec & { value: string; first?: boolean; onChange: (value: string) => void },
) {
  const { label, name, value, type, autoComplete, first = false, onChange } = props;
  return (
    <label className="settings-login-field">
      <span className="settings-label">{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        autoComplete={autoComplete}
        autoFocus={first}
        spellCheck={false}
        maxLength={type === 'password' ? 512 : 32}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** The Ausweisnummer's field: a password manager keeps it as the name. */
const NUMBER_FIELD: FieldSpec = {
  label: 'Ausweisnummer',
  name: 'number',
  type: 'text',
  autoComplete: 'username',
};

/** A Kennwort's field: one known (`current-password`), or a new one (`new-password`). */
const kennwortField = (label: string, name: keyof Fields, fresh: boolean): FieldSpec => ({
  label,
  name,
  type: 'password',
  autoComplete: fresh ? 'new-password' : 'current-password',
});

/** Each form's fields, in order. */
const FIELDS: Record<FormStep, readonly FieldSpec[]> = {
  set: [
    kennwortField('Kennwort', 'password', true),
    kennwortField('Kennwort wiederholen', 'again', true),
  ],
  change: [
    kennwortField('Bisheriges Kennwort', 'old', false),
    kennwortField('Neues Kennwort', 'password', true),
    kennwortField('Neues Kennwort wiederholen', 'again', true),
  ],
  'sign-in': [NUMBER_FIELD, kennwortField('Kennwort', 'password', false)],
  switch: [NUMBER_FIELD, kennwortField('Kennwort', 'password', false)],
};

/**
 * The form of `step` — a first Kennwort, a new one, a sign-in, a switch: its fields, what it says
 * before it is sent, and its way out; sent, it waits for the server, and says in place what is
 * wrong with what was typed, or why the server refused it.
 */
function LoginForm(props: {
  step: FormStep;
  account: AccountView;
  now: LoginShown;
  turn: Turn;
}) {
  const { step, account, now, turn } = props;
  const [fields, setFields] = useState<Fields>(NO_FIELDS);
  const [problem, setProblem] = useState<string | null>(null);
  const form = FORMS[step];
  const line = form.line(account);
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const asked = askOf(step, fields);
    setProblem('problem' in asked ? asked.problem : null);
    if (!('problem' in asked)) {
      turn.send(asked);
    }
  };
  const said = problem ?? now.refused;
  return (
    <form className="settings-login-form" onSubmit={submit} noValidate>
      {FIELDS[step].map((field, i) => (
        <Field
          key={field.name}
          {...field}
          first={i === 0}
          value={fields[field.name]}
          onChange={(value) => setFields({ ...fields, [field.name]: value })}
        />
      ))}
      {line !== null && <p className="settings-note">{line}</p>}
      {plainLine() && <p className="settings-note settings-login-plain">{PLAIN_LINE}</p>}
      {said !== null && (
        <p className="settings-note settings-login-refused" role="alert">
          {said}
        </p>
      )}
      <div className="settings-login-actions">
        <button type="submit" className="primary settings-login-send" disabled={now.waiting}>
          {form.submit}
        </button>
        <button type="button" className="settings-rebind" onClick={() => turn.take('idle')}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

/** The ask before a sign-out: what it keeps, „Abmelden" — sent, it waits — and „Abbrechen". */
function SignOutAsk({ now, turn }: { now: LoginShown; turn: Turn }) {
  return (
    <div className="settings-login-form settings-login-out">
      <p className="settings-note">{SIGN_OUT_LINE}</p>
      {now.refused !== null && (
        <p className="settings-note settings-login-refused" role="alert">
          {now.refused}
        </p>
      )}
      <div className="settings-login-actions">
        <button
          type="button"
          className="danger settings-login-send"
          disabled={now.waiting}
          onClick={() => turn.send({ kind: 'sign-out' })}
        >
          Abmelden
        </button>
        <button type="button" className="settings-rebind" onClick={() => turn.take('idle')}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

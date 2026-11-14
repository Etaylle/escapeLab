import {
  ACHIEVEMENT_IDS,
  GameError,
  numberOf,
  PASSWORD_SIZE,
  passwordFits,
  reportGrade,
  runSeconds,
  utcDay,
  type AccountRun,
  type AccountView,
  type AchievementId,
  type CrewPass,
} from '@escapelab/core';
import { hashPassword, mintNumber, passwordMatches } from './login.js';
import {
  HAS_LOGIN,
  LoginTaken,
  PASS_REFUSED,
  secretHashOf,
  type Account,
  type Login,
  type PassIdentity,
  type Profile,
  type SeatedRun,
  type Store,
  type Unlocked,
} from './store/store.js';

/**
 * The accounts as the sockets reach them (sockets.ts): the account of a crew pass — found, or
 * made the first time the pass asks where it sits, takes a seat or comes back to one — and what
 * its player changes of it: the name typed in the menu's profile, the colour chosen in a lobby,
 * the account deleted — and the runs it played („Meine Einsätze"). The pass stays the key on its
 * device; a Kennwort gives the account an Ausweisnummer besides (login.ts), with which any
 * device's pass signs into it. Each pass's requests are carried out one after the other, in the
 * order they came: an account is made once, and no answer overtakes the one before it.
 */

/**
 * What a socket may write to the accounts now, each asked only where that write would be made,
 * and counted if so: a new account (`mayMake`, by the socket's address) and a change to one — a
 * new name, another colour, a deletion (`mayChange`, by the socket). An account found and noted
 * as visited, or a name or colour it has already, changes nothing and asks nothing.
 */
export interface Gate {
  mayMake: () => boolean;
  mayChange: () => boolean;
}

/** A gate open to every write: where nothing limits them. */
export const OPEN: Gate = { mayMake: () => true, mayChange: () => true };

/** What a pass is told that has no account, where its address made too many this minute. */
export const TOO_MANY_NEW = 'Von dieser Adresse kommen in dieser Minute zu viele neue Konten.';

/** What a socket is told that changed its account too often this minute (`Gate.mayChange`). */
export const TOO_MANY_CHANGES = 'Zu viele Kontoänderungen über diese Verbindung in einer Minute.';

/** A change to a profile, made — or held back: no account may be made, or no change. */
type Changed = { view: AccountView } | { held: 'new' | 'change' };

/** What a sign-in is told whose Ausweisnummer or Kennwort does not match: never which. */
export const WRONG_LOGIN = 'Ausweisnummer oder Kennwort stimmen nicht.';

/** What a new Kennwort is told whose present one was shown wrong. */
export const OLD_WRONG = 'Das bisherige Kennwort stimmt nicht.';

/** What a new Kennwort is told for an account that has none to change. */
export const NO_LOGIN = 'Dieses Konto hat noch kein Kennwort.';

/** What a new Kennwort is told where the Kennwort was changed meanwhile, elsewhere. */
export const CHANGED_MEANWHILE = 'Das Kennwort wurde eben an anderer Stelle geändert.';

/** What a sign-out is told of an account without a Kennwort, which no device would reach again. */
export const SIGN_OUT_LOSES =
  'Ohne Kennwort wäre dieses Konto nach dem Abmelden nicht mehr erreichbar.';

/** A device switched to another account (`AccountDesk.switchAccount`). */
export interface Switched {
  /** the account the new pass leads into, as its owner sees it */
  arrival: Arrival;
  /** the account the pass signed out of; null where it led into none */
  left: string | null;
}

/** How often an Ausweisnummer is minted anew where the one minted is taken (`LoginTaken`). */
const MINT_TRIES = 5;

/**
 * What a socket's tries at a Kennwort may still do now, by its address (login.ts `SignInGuard`):
 * why a try on an Ausweisnummer — null for none readable — may not go ahead now, null where it
 * may; and each try counted, wrong or right.
 */
export interface Tries {
  refusal: (number: string | null) => string | null;
  wrong: (number: string | null) => void;
  right: (number: string) => void;
}

/** Tries nothing limits. */
export const UNLIMITED: Tries = {
  refusal: () => null,
  wrong: () => undefined,
  right: () => undefined,
};

/** The account a pass came to: its id, and the account as its owner sees it. */
export interface Arrival {
  id: string;
  view: AccountView;
}

/** How many of an account's runs „Meine Einsätze" lists: the newest. */
export const MY_RUNS = 50;

/** The identity a crew pass shows a store: its id, and the hash of its secret. */
export function identityOf(pass: CrewPass): PassIdentity {
  return { provider: 'pass', subject: pass.id, secretHash: secretHashOf(pass.secret) };
}

const isAchievement = (id: string): id is AchievementId => ACHIEVEMENT_IDS.some((a) => a === id);

/**
 * A run of an account's as „Meine Einsätze" lists it: the account's seat in it, its time on the
 * clock and its grade, both reckoned from its report as the end screen did from the run.
 */
export function accountRunOf({ run, seat }: SeatedRun): AccountRun {
  const daily = run.version === 2 && run.daily === true;
  return {
    missionId: run.missionId,
    difficulty: run.difficulty,
    daily: daily ? utcDay(run.startedAt) : null,
    outcome: run.outcome,
    finishedAt: run.finishedAt,
    seconds: runSeconds(run),
    crew: run.version === 1 ? [] : [...run.crew],
    seat,
    rank: reportGrade(run)?.rank ?? null,
  };
}

/** The Erfolge `unlocked` by mission, as an account's view has them („blackout:ohne-alarm"). */
export function byMission(unlocked: readonly Unlocked[]): AccountView['achievements'] {
  const missions: AccountView['achievements'] = {};
  for (const { key, unlockedAt } of unlocked) {
    const cut = key.indexOf(':');
    const [missionId, id] = [key.slice(0, cut), key.slice(cut + 1)];
    if (cut > 0 && isAchievement(id)) {
      missions[missionId] = { ...missions[missionId], [id]: unlockedAt };
    }
  }
  return missions;
}

export class AccountDesk {
  /** the last request of each pass under way, by the pass's id: the next waits for it */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly store: Store) {}

  /**
   * The account of `pass`, found — or made, starting with `profile`, where the gate lets one be
   * made — as its owner sees it, with its id; null where none may be made. Where a seat is taken
   * under the name `sitting`, the account goes by that name from now on, where the gate lets it
   * change.
   */
  arrive(
    pass: CrewPass,
    profile: Profile,
    sitting: string | null = null,
    gate: Gate = OPEN,
  ): Promise<Arrival | null> {
    return this.serial(pass, async () => {
      const account = await this.accountOf(pass, profile, gate);
      if (account === null) {
        return null;
      }
      const same = sitting === null || sitting === account.displayName;
      const renamed =
        same || !gate.mayChange()
          ? account
          : await this.store.updateProfile(account.id, { displayName: sitting });
      return { id: renamed.id, view: await this.viewOf(renamed) };
    });
  }

  /**
   * The first Kennwort of the account of `pass` — made where there was none, as `arrive` makes
   * one — and with it the account's Ausweisnummer, minted (login.ts): the account as its owner
   * sees it now. Refused, saying why, for a Kennwort too short or too long (PASSWORD_SIZE), for
   * an account with one already (HAS_LOGIN), and where the gate lets no account be made or none
   * change.
   */
  setPassword(pass: CrewPass, password: string, gate: Gate = OPEN): Promise<AccountView> {
    return this.serial(pass, async () => {
      if (!passwordFits(password)) {
        throw new GameError(PASSWORD_SIZE);
      }
      const account = await this.accountOf(pass, { displayName: '', colour: null }, gate);
      if (account === null) {
        throw new GameError(TOO_MANY_NEW);
      }
      if ((await this.store.loginOf(account.id)) !== null) {
        throw new GameError(HAS_LOGIN);
      }
      if (!gate.mayChange()) {
        throw new GameError(TOO_MANY_CHANGES);
      }
      await this.mint(account.id, await hashPassword(password));
      return this.viewOf(account);
    });
  }

  /**
   * A new Kennwort for the account of `pass`, its present one `old` shown — tried as a sign-in is
   * (`Tries`): the account as its owner sees it. Refused, saying why, for a Kennwort too short or
   * too long, an account without one (NO_LOGIN), `old` wrong (OLD_WRONG) or a try the limits
   * hold back, a gate that lets nothing change, and a Kennwort changed meanwhile elsewhere.
   */
  changePassword(
    pass: CrewPass,
    old: string,
    password: string,
    gate: Gate = OPEN,
    tries: Tries = UNLIMITED,
  ): Promise<AccountView> {
    return this.serial(pass, async () => {
      if (!passwordFits(password)) {
        throw new GameError(PASSWORD_SIZE);
      }
      const account = await this.store.findByIdentity(identityOf(pass));
      const login = account === null ? null : await this.store.loginOf(account.id);
      if (account === null || login === null) {
        throw new GameError(NO_LOGIN);
      }
      this.mayTry(login.subject, gate, tries);
      const kept = await this.tried(login.subject, old, login.secretHash, tries);
      if (kept === null) {
        throw new GameError(OLD_WRONG);
      }
      const next = await hashPassword(password);
      if (!(await this.store.replaceLoginSecret(account.id, kept, next))) {
        throw new GameError(CHANGED_MEANWHILE);
      }
      return this.viewOf(account);
    });
  }

  /**
   * `pass` signed into the account of the Ausweisnummer `typed`, its Kennwort `password` shown:
   * the account it leads into from now on, as its owner sees it, with its id. The account the
   * pass led into before is deleted where nothing is left of it (store.ts `signIn`); signed in
   * once more, nothing changes. Refused, saying why, for a number or a Kennwort that does not
   * match — in the same words for either (WRONG_LOGIN) — a try the limits hold back (`Tries`),
   * and a gate that lets nothing change.
   */
  signIn(
    pass: CrewPass,
    typed: string,
    password: string,
    gate: Gate = OPEN,
    tries: Tries = UNLIMITED,
  ): Promise<Arrival> {
    return this.serial(pass, async () => {
      const login = await this.verified(typed, password, gate, tries);
      const deleted = await this.store.signIn(identityOf(pass), login.accountId, null);
      const left = deleted.length > 0 ? ', the empty account it left deleted' : '';
      console.log(`[escapelab] a pass signed into an account${left}`);
      return this.arrivalOf(pass);
    });
  }

  /**
   * `pass` signed out of its account, which stays whole (store.ts `signOut`): where it holds a
   * seat, `parked` is the hash of a secret nobody holds that its way in keeps for that seat; else
   * null, and its way in is deleted. The id of the account it led into; null for none — nothing
   * to sign out of. Refused, saying why, for an account without a Kennwort (SIGN_OUT_LOSES) and
   * where the gate lets nothing change.
   */
  signOut(pass: CrewPass, parked: string | null, gate: Gate = OPEN): Promise<string | null> {
    return this.serial(pass, async () => {
      const account = await this.store.findByIdentity(identityOf(pass));
      if (account === null) {
        return null;
      }
      if ((await this.store.loginOf(account.id)) === null) {
        throw new GameError(SIGN_OUT_LOSES);
      }
      if (!gate.mayChange()) {
        throw new GameError(TOO_MANY_CHANGES);
      }
      await this.store.signOut({ pass: identityOf(pass), parked });
      console.log('[escapelab] a pass signed out of its account');
      return account.id;
    });
  }

  /**
   * The device switches accounts in one go (store.ts `signIn` with a pass leaving): the new pass
   * `next` signed into the account of the Ausweisnummer `typed`, its Kennwort shown — tried as
   * `signIn` tries it — and `pass` signed out, kept for its seat under `parked` where it holds one.
   * The account it signed out of is deleted where nothing is left of it. Nothing changes where the
   * try is refused, as `signIn` refuses it, or `next` is no new pass.
   */
  switchAccount(
    pass: CrewPass,
    next: CrewPass,
    login: { typed: string; password: string; parked: string | null },
    gate: Gate = OPEN,
    tries: Tries = UNLIMITED,
  ): Promise<Switched> {
    return this.serial(pass, async () => {
      if (next.id === pass.id) {
        throw new GameError(PASS_REFUSED);
      }
      const found = await this.verified(login.typed, login.password, gate, tries);
      const left = (await this.store.findByIdentity(identityOf(pass)))?.id ?? null;
      const leaving = { pass: identityOf(pass), parked: login.parked };
      await this.store.signIn(identityOf(next), found.accountId, leaving);
      console.log('[escapelab] a device switched accounts on a new pass');
      return { arrival: await this.arrivalOf(next), left };
    });
  }

  /**
   * The id of the account of `pass`, found and never made; null for none. Throws GameError for a
   * pass shown with the wrong secret.
   */
  accountIdOf(pass: CrewPass): Promise<string | null> {
    return this.serial(pass, async () => {
      const account = await this.store.findByIdentity(identityOf(pass));
      return account?.id ?? null;
    });
  }

  /**
   * The account of `pass` goes by `name` from now on; made with it where there was none. Refused,
   * saying why, where the gate lets no account be made (`TOO_MANY_NEW`) or none change
   * (`TOO_MANY_CHANGES`).
   */
  async rename(pass: CrewPass, name: string, gate: Gate = OPEN): Promise<AccountView> {
    const changed = await this.change(pass, { displayName: name }, gate);
    if ('held' in changed) {
      throw new GameError(changed.held === 'new' ? TOO_MANY_NEW : TOO_MANY_CHANGES);
    }
    return changed.view;
  }

  /**
   * The account of `pass` wears `color` from now on; made with it where there was none. Null
   * where the gate lets no account be made, or none change.
   */
  async recolour(pass: CrewPass, color: string, gate: Gate = OPEN): Promise<AccountView | null> {
    const changed = await this.change(pass, { colour: color.toLowerCase() }, gate);
    return 'held' in changed ? null : changed.view;
  }

  /**
   * The account of `pass` deleted, with its identities, its Erfolge and its seats in the runs;
   * nothing where the pass has none. Throws GameError for a pass shown with the wrong secret, and
   * where the gate lets no account change (`TOO_MANY_CHANGES`).
   */
  delete(pass: CrewPass, gate: Gate = OPEN): Promise<void> {
    return this.serial(pass, async () => {
      const account = await this.store.findByIdentity(identityOf(pass));
      if (account === null) {
        return;
      }
      if (!gate.mayChange()) {
        throw new GameError(TOO_MANY_CHANGES);
      }
      await this.store.deleteAccount(account.id);
    });
  }

  /**
   * The runs the account of `pass` played, the newest MY_RUNS of them, and how many in all; none
   * where the pass has no account. Throws GameError for a pass shown with the wrong secret.
   */
  runsOf(pass: CrewPass): Promise<{ runs: AccountRun[]; total: number }> {
    return this.serial(pass, async () => {
      const account = await this.store.findByIdentity(identityOf(pass));
      if (account === null) {
        return { runs: [], total: 0 };
      }
      const { total, runs } = await this.store.runsOfAccount(account.id, MY_RUNS);
      return { runs: runs.map(accountRunOf), total };
    });
  }

  /**
   * Resolves once every request under way has settled, however it went: the server going down
   * lets the store go only after (index.ts).
   */
  async settled(): Promise<void> {
    await Promise.all(this.queues.values());
  }

  /**
   * The account of `pass` with `change` made to its profile — made with it where there was none —
   * as its owner sees it; held back where the gate lets no account be made, or none change.
   */
  private change(pass: CrewPass, change: Partial<Profile>, gate: Gate): Promise<Changed> {
    return this.serial(pass, async (): Promise<Changed> => {
      const start = { displayName: '', colour: null, ...change };
      const account = await this.accountOf(pass, start, gate);
      if (account === null) {
        return { held: 'new' };
      }
      const same = Object.entries(change).every(
        ([field, value]) => account[field as keyof Profile] === value,
      );
      if (same) {
        return { view: await this.viewOf(account) };
      }
      if (!gate.mayChange()) {
        return { held: 'change' };
      }
      return { view: await this.viewOf(await this.store.updateProfile(account.id, change)) };
    });
  }

  /**
   * The account of `pass`, its visit noted — or a new one, starting with `profile`, where it has
   * none yet and the gate lets one be made (asked only then); null where none may be. Throws
   * GameError for a pass shown with the wrong secret.
   */
  private async accountOf(pass: CrewPass, profile: Profile, gate: Gate): Promise<Account | null> {
    const identity = identityOf(pass);
    if ((await this.store.findByIdentity(identity)) === null && !gate.mayMake()) {
      return null;
    }
    return this.store.getOrCreateByIdentity(identity, profile);
  }

  /**
   * The login of the Ausweisnummer `typed`, its Kennwort `password` tried (`tried`). Refused,
   * saying why, where either does not match — in the same words for either (WRONG_LOGIN) — and
   * where the try is held back.
   */
  private async verified(
    typed: string,
    password: string,
    gate: Gate,
    tries: Tries,
  ): Promise<Login> {
    const number = numberOf(typed);
    this.mayTry(number, gate, tries);
    const login = number === null ? null : await this.store.findLogin(number);
    const right = await this.tried(number, password, login?.secretHash ?? null, tries);
    if (right === null || login === null) {
      throw new GameError(WRONG_LOGIN);
    }
    return login;
  }

  /**
   * Throws, saying why, where a try at the Kennwort of the Ausweisnummer `number` (null for none
   * readable) may not go ahead now: the limits hold it back (`Tries`), or the gate lets nothing
   * change — a try counts as a change, so that a socket tries so many a minute. Asked before the
   * store is, and before any work is done.
   */
  private mayTry(number: string | null, gate: Gate, tries: Tries): void {
    const refusal = tries.refusal(number);
    if (refusal !== null) {
      throw new GameError(refusal);
    }
    if (!gate.mayChange()) {
      throw new GameError(TOO_MANY_CHANGES);
    }
  }

  /**
   * A try at the Kennwort `password` of the Ausweisnummer `number` (null for none readable), whose
   * hash `stored` keeps (null for no login), once `mayTry` let it go ahead: the hash it matched,
   * counted right; null, counted wrong, where it did not — after the same work either way (login.ts
   * `passwordMatches`).
   */
  private async tried(
    number: string | null,
    password: string,
    stored: string | null,
    tries: Tries,
  ): Promise<string | null> {
    const right = await passwordMatches(password, stored);
    if (!right || number === null || stored === null) {
      tries.wrong(number);
      return null;
    }
    tries.right(number);
    return stored;
  }

  /**
   * A login for `accountId`, its Kennwort's hash `secretHash`, under an Ausweisnummer minted
   * anew — again where the one minted is another login's (`LoginTaken`), MINT_TRIES times at
   * most.
   */
  private async mint(accountId: string, secretHash: string): Promise<void> {
    for (let tries = 1; ; tries += 1) {
      try {
        await this.store.addLogin(accountId, mintNumber(), secretHash);
        return;
      } catch (err) {
        if (!(err instanceof LoginTaken) || tries >= MINT_TRIES) {
          throw err;
        }
      }
    }
  }

  /** The account `pass` leads into now, as its owner sees it, with its id; throws for none. */
  private async arrivalOf(pass: CrewPass): Promise<Arrival> {
    const account = await this.store.findByIdentity(identityOf(pass));
    if (account === null) {
      throw new Error('the pass signed in leads into no account — deleted meanwhile?');
    }
    return { id: account.id, view: await this.viewOf(account) };
  }

  /**
   * `account` as its owner sees it: with its runs counted, its Erfolge by mission, and its
   * Ausweisnummer where it has a Kennwort.
   */
  private async viewOf(account: Account): Promise<AccountView> {
    const [runs, unlocked, login] = await Promise.all([
      this.store.runsOfAccount(account.id, 0),
      this.store.achievements(account.id),
      this.store.loginOf(account.id),
    ]);
    return {
      name: account.displayName,
      color: account.colour,
      since: account.createdAt,
      runs: runs.total,
      achievements: byMission(unlocked),
      store: this.store.kind,
      login: login?.subject ?? null,
    };
  }

  /** `job` for `pass` once every job of the same pass before it has settled, however. */
  private serial<T>(pass: CrewPass, job: () => Promise<T>): Promise<T> {
    const before = this.queues.get(pass.id) ?? Promise.resolve();
    const next = before.then(job, job);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(pass.id, settled);
    void settled.then(() => {
      if (this.queues.get(pass.id) === settled) {
        this.queues.delete(pass.id);
      }
    });
    return next;
  }
}

import {
  ACHIEVEMENT_IDS,
  GameError,
  reportGrade,
  runSeconds,
  utcDay,
  type AccountRun,
  type AccountView,
  type AchievementId,
  type CrewPass,
} from '@escapelab/core';
import {
  secretHashOf,
  type Account,
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
 * device. Each pass's requests are carried
 * out one after the other, in the order they came: an account is made once, and no answer
 * overtakes the one before it.
 */

/** Whether one more account may be made now: asked only where a pass has none yet. */
export type MayMake = () => boolean;

/** Any account may be made: where nothing limits them. */
const always: MayMake = () => true;

/** What a pass is told that has no account, where its address made too many this minute. */
export const TOO_MANY_NEW = 'Von dieser Adresse kommen in dieser Minute zu viele neue Konten.';

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
   * The account of `pass`, found — or made, starting with `profile`, where `mayMake` lets one be
   * made — as its owner sees it; null where none may be made. Where a seat is taken under the
   * name `sitting`, the account goes by that name from now on.
   */
  arrive(
    pass: CrewPass,
    profile: Profile,
    sitting: string | null = null,
    mayMake: MayMake = always,
  ): Promise<AccountView | null> {
    return this.serial(pass, async () => {
      const account = await this.accountOf(pass, profile, mayMake);
      if (account === null) {
        return null;
      }
      const changed =
        sitting === null || sitting === account.displayName
          ? account
          : await this.store.updateProfile(account.id, { displayName: sitting });
      return this.viewOf(changed);
    });
  }

  /**
   * The account of `pass` goes by `name` from now on; made with it where there was none and
   * `mayMake` lets it be — else refused, saying so (`TOO_MANY_NEW`).
   */
  async rename(pass: CrewPass, name: string, mayMake: MayMake = always): Promise<AccountView> {
    const account = await this.change(pass, { displayName: name }, mayMake);
    if (account === null) {
      throw new GameError(TOO_MANY_NEW);
    }
    return account;
  }

  /**
   * The account of `pass` wears `color` from now on; made with it where there was none and
   * `mayMake` lets it be; null where none may be made.
   */
  recolour(pass: CrewPass, color: string, mayMake: MayMake = always): Promise<AccountView | null> {
    return this.change(pass, { colour: color.toLowerCase() }, mayMake);
  }

  /**
   * The account of `pass` deleted, with its identities, its Erfolge and its seats in the runs;
   * nothing where the pass has none. Throws GameError for a pass shown with the wrong secret.
   */
  delete(pass: CrewPass): Promise<void> {
    return this.serial(pass, async () => {
      const account = await this.store.findByIdentity(identityOf(pass));
      if (account !== null) {
        await this.store.deleteAccount(account.id);
      }
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
   * The account of `pass` with `change` made to its profile; made with it where there was none
   * and `mayMake` lets it be, null where it may not.
   */
  private change(
    pass: CrewPass,
    change: Partial<Profile>,
    mayMake: MayMake,
  ): Promise<AccountView | null> {
    return this.serial(pass, async () => {
      const start = { displayName: '', colour: null, ...change };
      const account = await this.accountOf(pass, start, mayMake);
      if (account === null) {
        return null;
      }
      const same = Object.entries(change).every(
        ([field, value]) => account[field as keyof Profile] === value,
      );
      return this.viewOf(same ? account : await this.store.updateProfile(account.id, change));
    });
  }

  /**
   * The account of `pass`, its visit noted — or a new one, starting with `profile`, where it has
   * none yet and `mayMake` lets one be made (asked only then); null where none may be. Throws
   * GameError for a pass shown with the wrong secret.
   */
  private async accountOf(
    pass: CrewPass,
    profile: Profile,
    mayMake: MayMake,
  ): Promise<Account | null> {
    const identity = identityOf(pass);
    if ((await this.store.findByIdentity(identity)) === null && !mayMake()) {
      return null;
    }
    return this.store.getOrCreateByIdentity(identity, profile);
  }

  /** `account` as its owner sees it: with its runs counted and its Erfolge by mission. */
  private async viewOf(account: Account): Promise<AccountView> {
    const [runs, unlocked] = await Promise.all([
      this.store.runsOfAccount(account.id, 0),
      this.store.achievements(account.id),
    ]);
    return {
      name: account.displayName,
      color: account.colour,
      since: account.createdAt,
      runs: runs.total,
      achievements: byMission(unlocked),
      store: this.store.kind,
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

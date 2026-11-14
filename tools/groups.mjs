/**
 * The walkthrough's capture groups (tools/shots.mjs). Every capture the walkthrough takes or
 * skips belongs to exactly one group, by its file name or by the label its skip line carries;
 * a name the walkthrough builds from a value stands here as a pattern, `*` for the value.
 * SHOTS_ONLY and SHOTS_SKIP pick the groups a run plays (`planGroups`): a group that needs
 * another pulls it in, unless SHOTS_SKIP leaves that one out, which refuses the group. The
 * walkthrough goes only as far as the groups on reach (`reaches`), and the time each group took
 * is counted as it goes (`groupClock`). Each step runs under its group's gate (`stepGates`), and
 * a capture its step's group does not file fails the run (`misfiled`).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The walkthrough's stages in the order a run plays them: the drills, each in a room of its own
 * before the walkthrough; the menu and the lobby up to the started run; the mission's opening;
 * the run to its end.
 */
export const STAGES = ['drills', 'lobby', 'opening', 'run'];

/**
 * The groups in the order the walkthrough meets them: each with the stage it reaches to, the
 * groups it needs, and its captures and skip labels.
 */
export const GROUPS = [
  {
    name: 'editor',
    stage: 'drills',
    needs: [],
    captures: [
      'editor.png',
      'editor-1280.png',
      'editor-phone.png',
      'editor-play.png',
      'editor-shared.png',
    ],
  },
  {
    name: 'art',
    stage: 'drills',
    needs: [],
    captures: [
      'art-*.png',
      'room-archive.png',
      'room-machine.png',
      'decals-lab.png',
      'standby-dark.png',
    ],
  },
  { name: 'drones', stage: 'drills', needs: [], captures: ['danger-sense.png', 'drone-close.png'] },
  {
    name: 'reconnect',
    stage: 'drills',
    needs: [],
    captures: [
      'reconnect',
      'pause-waiting.png',
      'menu-bound.png',
      'continue-without.png',
      'reconnect-overlay.png',
      'back-toast.png',
      'menu-bound-after-leave.png',
      'rejoin-card.png',
      'leave-ask.png',
      'takeover-ask.png',
      'takeover.png',
    ],
  },
  {
    name: 'restart',
    stage: 'drills',
    needs: [],
    captures: ['restart', 'restart-maintenance.png', 'restart-recovered.png'],
  },
  {
    // The Zugangskontrolle's scratch mission, played in a Systemcheck run as the Serverraum's is.
    name: 'access',
    stage: 'drills',
    needs: [],
    captures: [
      'access (probe)',
      'access-list.png',
      'access-terminal.png',
      'access-token.png',
      'access-phone-932.png',
    ],
  },
  {
    // The music packs in the settings' „Ton", on a menu page of its own (client MusicSettings.tsx).
    name: 'music',
    stage: 'drills',
    needs: [],
    captures: ['settings-music.png'],
  },
  {
    name: 'screens',
    stage: 'lobby',
    needs: [],
    captures: [
      'menu.png',
      'menu-hero.png',
      'menu-hero-hover.png',
      'menu-1280.png',
      'menu-hero-1280.png',
      'menu-hero-1024.png',
      'menu-hero-entrance.png',
      'history.png',
      'menu-missions.png',
      'menu-hero-missions.png',
      'menu-to-lobby.png',
      'lobby-title.png',
      'lobby-first.png',
      'lobby-host.png',
      'daily.png',
      'menu-phone.png',
      'menu-phone-932.png',
      'history-phone.png',
      'lobby-filled.png',
      'menu-open-rounds.png',
      'lobby-chrome.png',
      'lobby-phone.png',
      'lobby-1280.png',
      'lobby-landscape.png',
      'settings-ton.png',
      'settings-steuerung.png',
      'pause-menu-phone-932.png',
      'settings-phone-932.png',
    ],
  },
  {
    name: 'intro',
    stage: 'opening',
    needs: [],
    captures: [
      'intro-*.png',
      'cold-open.png',
      'cold-open-dpr2.png',
      'blackout.png',
      'light-gl.png',
    ],
  },
  {
    name: 'run',
    stage: 'run',
    needs: [],
    captures: [
      'lit-flur.png',
      'light-gl-flur.png',
      'discover-*.png',
      'menu-join.png',
      'spectate.png',
      'lit-room.png',
      'escape.png',
      'pullback.png',
      'won.png',
      'achievements.png',
      'share-card.png',
      'end.png',
      'won-audience.png',
      'won-phone.png',
      'won-landscape.png',
      'next-mission.png',
      'my-runs.png',
      'account-delete.png',
    ],
  },
  {
    name: 'devices',
    stage: 'run',
    needs: ['run'],
    captures: [
      'servers (probe)',
      'servers-manual.png',
      'servers-a.png',
      'servers-b.png',
      'rack-diagram.png',
      'terminal-typing.png',
      'servers-solved.png',
      'lever.png',
      'lever-ring.png',
      'lever-countdown.png',
      'lever-countdown-partner.png',
      'device-phone-*.png',
      'device-phone-relay',
      'station',
      'station.png',
      'station-both.png',
      'console-*.png',
      'meter-swing.png',
      'device-solved.png',
      'signal-grey*.png',
    ],
  },
  {
    name: 'reading',
    stage: 'run',
    needs: ['run'],
    captures: [
      'sign.png',
      'note.png',
      'locker.png',
      'reading.png',
      'reading-page2.png',
      'notepad.png',
      'highlight.png',
      'reading-notepad.png',
      'notepad-captured.png',
      'notepad-captured-phone.png',
      'highlight-phone.png',
      'reading-notepad-phone.png',
      'reading-notepad-landscape.png',
      'device-notepad.png',
      'device-notepad-phone.png',
      'hint-*.png',
      'radio-banner.png',
      'book-morse-1.15.png',
      'book-phone-landscape.png',
      'book-phone-notepad.png',
    ],
  },
  {
    name: 'hud',
    stage: 'run',
    needs: ['run'],
    captures: [
      'game-*.png',
      'pad-left.png',
      'hud-chrome.png',
      'info-panel.png',
      'settings.png',
      'pause-menu.png',
      'settings-controller.png',
      'gamepad-prompts.png',
      'pad-quickchat.png',
      'chat-slot.png',
      'minimap-goal.png',
      'sprint.png',
    ],
  },
  {
    name: 'graphics',
    stage: 'run',
    needs: ['run'],
    captures: [
      'lobby-idle.png',
      'dust.png',
      'beacon-sweep-a.png',
      'beacon-sweep-b.png',
      'grade-blackout.png',
      'beam-core.png',
      'pose-console.png',
      'fuse-bob-*.png',
      'figure-carry.png',
      'depth-behind-shelf.png',
      'camera-1440.png',
      'camera-dpr2.png',
      'camera-1280.png',
      'camera-phone.png',
      'walk-cycle-a.png',
      'walk-cycle-b.png',
      'shadow-blob.png',
      'dpr2.png',
      'highlight-console.png',
      'panel-dpr2.png',
      'panel-close.png',
      'figure-flinch.png',
      'rack-leds.png',
      'pose-reading.png',
      'hatch-dust.png',
      'escape-dpr2.png',
      'figure-celebrate.png',
    ],
  },
  {
    name: 'audio',
    stage: 'run',
    needs: ['run'],
    captures: ['partner', 'nudge.png', 'nudge-phone.png'],
  },
  {
    name: 'voice',
    stage: 'run',
    needs: ['run'],
    captures: ['voice.png', 'voice-phone.png', 'partner-funk.png'],
  },
  { name: 'perf', stage: 'run', needs: ['run'], captures: ['frames'] },
];

/** Every group's name, in the table's order. */
export const GROUP_NAMES = GROUPS.map((group) => group.name);

/** Whether the table entry `entry` is a pattern: a name with `*` standing for a value. */
const isPattern = (entry) => entry.includes('*');

/** The pattern `entry` as a whole-name regex, `*` for any run of characters, `*` itself too. */
function patternOf(entry) {
  const parts = entry.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('.*')}$`);
}

/** Whether the table entry `entry` names `capture`: the same name, or a pattern matching it. */
function names(entry, capture) {
  return entry === capture || (isPattern(entry) && patternOf(entry).test(capture));
}

/**
 * Throws where `groups` lets a capture belong to two groups: an entry that names, or matches,
 * an entry of another group, or a group named twice. The walkthrough's own table is checked as
 * this module loads.
 */
export function checkGroups(groups) {
  const clashes = [];
  for (const [i, group] of groups.entries()) {
    for (const other of groups.slice(i + 1)) {
      const meets = (a, b) => names(a, b) || names(b, a);
      const shared = group.captures.filter((a) => other.captures.some((b) => meets(a, b)));
      clashes.push(...shared.map((a) => `${a} (${group.name} and ${other.name})`));
    }
  }
  const twice = groups.filter((g, i) => groups.findIndex((h) => h.name === g.name) !== i);
  if (twice.length > 0 || clashes.length > 0) {
    const said = [...twice.map((g) => `${g.name} named twice`), ...clashes];
    throw new Error(`capture groups overlap: ${said.join('; ')}`);
  }
}

checkGroups(GROUPS);

/**
 * The group `capture` belongs to — a file name or a skip line's label, a name spelled with `*`
 * for a value too, as long as one group's pattern matches it whole — or null for none.
 */
export function groupOf(capture) {
  const exact = GROUPS.find((group) => group.captures.includes(capture));
  const found = exact ?? GROUPS.find((group) => group.captures.some((e) => names(e, capture)));
  return found?.name ?? null;
}

/**
 * The gate of the step that runs now: `run(group, step)` runs `step` as that group's — and with
 * it all it awaits and all it starts — and `now` names the group of the innermost step running;
 * null outside every step.
 */
export function stepGates() {
  const store = new AsyncLocalStorage();
  return {
    run: (group, step) => store.run(group, step),
    now: () => store.getStore() ?? null,
  };
}

/**
 * What is wrong with `capture` — a file name or a skip line's label — taken in a step of the
 * group `step` (null outside every step): a name no group files, or one the table files under
 * another group than the step's. Null where it is its step's group's own.
 */
export function misfiled(capture, step) {
  const group = groupOf(capture);
  if (group === null) {
    return `${capture}: no capture group names it — add it to tools/groups.mjs`;
  }
  if (group === step) {
    return null;
  }
  const where = step === null ? 'outside every group' : `in a step of ${step}`;
  return (
    `${capture}: tools/groups.mjs files it under ${group}, but it was taken ${where} — ` +
    `gate the step by ${group}, or file the capture under the step's group`
  );
}

/**
 * The group names `text` lists for the variable `variable`, comma-separated, each trimmed; none
 * for an unset or empty one. Throws for a name no group has, naming those that are.
 */
export function groupNames(variable, text) {
  const listed = (text ?? '').split(',').map((name) => name.trim()).filter((n) => n !== '');
  const unknown = listed.find((name) => !GROUP_NAMES.includes(name));
  if (unknown !== undefined) {
    throw new Error(`${variable} names groups of ${GROUP_NAMES.join(', ')}, not "${unknown}"`);
  }
  return [...new Set(listed)];
}

/** The group named `name` (one the table has). */
const groupNamed = (name) => GROUPS.find((group) => group.name === name);

/**
 * Pulls into `on` every group a group in it needs, but no group of `left`; each pulled in once,
 * in `pulled`, by the first group that needed it.
 */
function pullIn(on, left, pulled) {
  for (let grew = true; grew; ) {
    grew = false;
    for (const name of GROUP_NAMES.filter((n) => on.has(n))) {
      const missing = groupNamed(name).needs.filter((need) => !on.has(need) && !left.has(need));
      missing.forEach((need) => pulled.set(need, name));
      missing.forEach((need) => on.add(need));
      grew ||= missing.length > 0;
    }
  }
}

/** Takes out of `on` every group that needs one not in it, in `refused` with the first it lacks. */
function refuse(on, refused) {
  for (let shrank = true; shrank; ) {
    shrank = false;
    for (const name of GROUP_NAMES.filter((n) => on.has(n))) {
      const lacking = groupNamed(name).needs.find((need) => !on.has(need));
      if (lacking !== undefined) {
        refused.set(name, lacking);
        on.delete(name);
        shrank = true;
      }
    }
  }
}

/** Pads a log line's label to the walkthrough's column, as its other lines are. */
const label = (name) => `group ${name}`.padEnd(18);

/**
 * The log's line for each group a plan leaves out or pulls in: skipped, as SHOTS_ONLY or
 * SHOTS_SKIP have it; refused, for want of a group SHOTS_SKIP leaves out; pulled in, by the
 * group that needs it.
 */
function planLines({ on, left, pulled, refused }) {
  return GROUP_NAMES.flatMap((name) => {
    if (refused.has(name)) {
      return [`${label(name)} refused: it needs ${refused.get(name)}, which SHOTS_SKIP leaves out`];
    }
    if (pulled.has(name)) {
      return [`${label(name)} pulled in: ${pulled.get(name)} needs it`];
    }
    if (on.has(name)) {
      return [];
    }
    const why = left.has(name) ? 'SHOTS_SKIP names it' : 'SHOTS_ONLY leaves it out';
    return [`${label(name)} skipped: ${why}`];
  });
}

/**
 * The groups a run plays: those SHOTS_ONLY names (`only`), or every group where it is unset,
 * less those SHOTS_SKIP names (`skip`); a group that needs another pulls it in, unless SHOTS_SKIP
 * names that one, which refuses the group. Returns the groups on and the log's lines, one for
 * each group skipped, refused or pulled in. Throws for a name no group has, and where nothing is
 * left to play — its message the plan's lines first, the refusals that emptied it among them.
 */
export function planGroups(only, skip) {
  const asked = groupNames('SHOTS_ONLY', only);
  const left = new Set(groupNames('SHOTS_SKIP', skip));
  const chosen = asked.length > 0 ? asked : GROUP_NAMES;
  const on = new Set(chosen.filter((name) => !left.has(name)));
  const pulled = new Map();
  const refused = new Map();
  pullIn(on, left, pulled);
  refuse(on, refused);
  const lines = planLines({ on, left, pulled, refused });
  if (on.size === 0) {
    const none =
      `SHOTS_ONLY "${only ?? ''}" and SHOTS_SKIP "${skip ?? ''}" leave no group to play: ` +
      `the groups are ${GROUP_NAMES.join(', ')}`;
    throw new Error([...lines, none].join('\n'));
  }
  return { on, lines };
}

/** Whether a group of `on` reaches `stage`: the walkthrough plays it, and the stages before. */
export function reaches(on, stage) {
  const at = STAGES.indexOf(stage);
  return GROUPS.some((group) => on.has(group.name) && STAGES.indexOf(group.stage) >= at);
}

/**
 * A clock of the time each group takes: `enter` a group as its step begins and `leave` it as the
 * step ends, a step within a step counting to the inner one; time spent in none counts to null.
 * `spent` gives ms by group so far. `now` reads the time in ms.
 */
export function groupClock(now = Date.now) {
  const spent = new Map();
  const open = [];
  let since = now();
  const charge = () => {
    const at = now();
    const group = open.at(-1) ?? null;
    spent.set(group, (spent.get(group) ?? 0) + (at - since));
    since = at;
  };
  return {
    enter(group) {
      charge();
      open.push(group);
    },
    leave() {
      charge();
      open.pop();
    },
    spent() {
      charge();
      return new Map(spent);
    },
  };
}

/**
 * The seconds each group of `on` took (`spent`, ms by group as `groupClock` gives them), in the
 * table's order, then the time spent in none of them: the setup and the walks between.
 */
export function spentText(spent, on) {
  const of = (group) => `${((spent.get(group) ?? 0) / 1000).toFixed(1)} s`;
  const groups = GROUP_NAMES.filter((name) => on.has(name)).map((name) => `${name} ${of(name)}`);
  return `${groups.join(', ')}; outside them ${of(null)}`;
}

/**
 * The summary's words: the captures taken, skipped and failed, the groups of `on` played, in the
 * table's order, and last what failed, so that a failing summary ends with its failures.
 */
export function summaryText({ taken, skipped, failures }, on) {
  const played = GROUP_NAMES.filter((name) => on.has(name)).join(', ');
  const failed = failures.length === 0 ? '' : ` — ${failures.join('; ')}`;
  const counts = `${taken} captures taken, ${skipped} skipped, ${failures.length} failed`;
  return `${counts} (groups ${played})${failed}`;
}

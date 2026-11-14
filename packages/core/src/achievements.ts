import { DRONE_ALARM } from './actions.js';
import { runSeconds, type RunReport } from './report.js';

/**
 * The Erfolge: seven plaques a crew can earn in a run it wins, each read off the run's report
 * alone (report.ts) — whether it is new to a device is the device's to keep (client
 * achievements.ts). A plaque says what happened, in the lab's words, and praises nobody.
 */

export const ACHIEVEMENT_IDS = [
  'ohne-alarm',
  'unter-acht-minuten',
  'alle-notizen',
  'erster-versuch',
  'ungesehen',
  'stiller-serverraum',
  'erste-schicht',
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** What a plaque says: its title, engraved, and one line under it. */
export interface Achievement {
  id: AchievementId;
  title: string;
  line: string;
}

/** A run this fast, from the lights going out to the last one out, earns „Unter acht Minuten". */
export const EIGHT_MINUTES_SEC = 8 * 60;

/** The module whose station „Stiller Serverraum" asks after. */
const SERVER_ROOM = 'servers';

/** Every plaque, in the order a card shows them. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'ohne-alarm', title: 'Ohne Alarm', line: 'Kein Alarm über die ganze Schicht.' },
  {
    id: 'unter-acht-minuten',
    title: 'Unter acht Minuten',
    line: 'Vom Ausfall bis zum Notausgang unter 8:00.',
  },
  {
    id: 'alle-notizen',
    title: 'Alle Notizen gelesen',
    line: 'Jede Notiz der letzten Schicht gelesen.',
  },
  {
    id: 'erster-versuch',
    title: 'Jede Station im ersten Versuch',
    line: 'Keine Station hat eine Fehlbedienung gemeldet.',
  },
  { id: 'ungesehen', title: 'Ungesehen', line: 'Keine Drohne hat jemanden erfasst.' },
  {
    id: 'stiller-serverraum',
    title: 'Stiller Serverraum',
    line: 'Kein Befehl im Serverraum abgewiesen.',
  },
  { id: 'erste-schicht', title: 'Erste Schicht', line: 'Das erste Mal durch den Notausgang.' },
];

/** What the predicates read of a report. */
type Read = Pick<
  RunReport,
  | 'outcome'
  | 'startedAt'
  | 'lightsOutAt'
  | 'finishedAt'
  | 'noHatch'
  | 'stations'
  | 'penalties'
  | 'notes'
  | 'drones'
>;

/** Every alarm of a run, whatever set it off. */
const alarmsOf = (report: Read): number =>
  report.penalties.reduce((sum, penalty) => sum + penalty.count, 0);

/** Whether the crew got out by the hatch: a run its last solve won had none to go through. */
const outByTheHatch = (report: Read): boolean => report.noHatch !== true;

/** The predicate of each plaque, for a won run. */
const EARNED: Readonly<Record<AchievementId, (report: Read) => boolean>> = {
  'ohne-alarm': (report) => alarmsOf(report) === 0,
  // To the hatch in under eight minutes: none where there was no hatch to reach.
  'unter-acht-minuten': (report) =>
    outByTheHatch(report) && runSeconds(report) < EIGHT_MINUTES_SEC,
  // A map without notes has nothing to read: no plaque for it.
  'alle-notizen': ({ notes }) =>
    notes !== undefined && notes.total > 0 && notes.read === notes.total,
  'erster-versuch': ({ stations }) =>
    stations.length > 0 && stations.every((station) => station.alarms === 0),
  // Unseen by drones only where drones patrol.
  ungesehen: ({ drones, penalties }) =>
    drones !== undefined && drones > 0 && !penalties.some((p) => p.cause === DRONE_ALARM),
  // Every failed command at the Serverraum is an alarm at its station.
  'stiller-serverraum': ({ stations }) => {
    const rooms = stations.filter((station) => station.type === SERVER_ROOM);
    return rooms.length > 0 && rooms.every((room) => room.alarms === 0);
  },
  // Through the hatch, the first time: none where the last solve won the run.
  'erste-schicht': outByTheHatch,
};

/**
 * The plaques the run of `report` earns, in the order of ACHIEVEMENTS: none for a run lost.
 * „Erste Schicht" comes with every won run that ended at the hatch; that it is a crew's first
 * is the device's to say.
 */
export function achievementsOf(report: Read): AchievementId[] {
  if (report.outcome !== 'won') {
    return [];
  }
  return ACHIEVEMENT_IDS.filter((id) => EARNED[id](report));
}

/** The plaque of `id`. */
export function achievement(id: AchievementId): Achievement {
  const found = ACHIEVEMENTS.find((plaque) => plaque.id === id);
  if (found === undefined) {
    throw new Error(`achievement: no plaque "${id}" — ACHIEVEMENTS lists every id once`);
  }
  return found;
}

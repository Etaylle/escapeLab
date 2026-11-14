import { liveEngine, outlet } from './audio.js';
import { DUCK_ATTACK_S, DUCK_RELEASE_S } from './mix.js';
import { sayLine, stopVoice, voiceReady, type VoiceLine } from './radioVoice.js';

/**
 * The operator's Funkprobe in the lobby: once every seat is ready and the host can start, the
 * line the view brings (core view.ts `radioCheck`, the mission's `radio.lobby`) comes over the
 * radio as a run's lines do (radioVoice.ts), said by the operator on duty for the next run (the
 * view's `cast`), so that the crew hears the one it then has — once while the lobby lasts,
 * however often the crew stands ready again; the next lobby, after a run, hears the mission's
 * next text. While anybody of the crew speaks it stands UNDER_CREW_DB down, under their voices,
 * as the menu's theme does
 * (menuSound.ts `crewSpeaks`); it is cut as the lobby goes. Silent while it has no recording, or
 * before a gesture woke the sound: it plays only on the audio context a gesture made and woke
 * (audio.ts `liveEngine`), never making one itself — a page reloaded into a ready lobby hears
 * nothing. Its level is a node of its own between the radio's chain and the radio's bus, there
 * only while the lobby lasts: a run's sound keeps what it had.
 */

/** How far the crew's voices pull the Funkprobe down, dB: under them, still to be made out. */
export const UNDER_CREW_DB = -10;

/** How long the Funkprobe's level outlives a cut, ms: the cut's own fade is over by then. */
export const LET_GO_MS = 250;

/** What the walkthrough reads of the lobby's radio (`window.__escapelab.radioCheck`). */
export interface RadioCheckProbe {
  /** the Funkprobe a lobby asked for last; null before any */
  readonly asked: string | null;
  /** the operator it was asked of, by their id in the cast; null before any */
  readonly by: string | null;
  /** whether it went on the air: not while it has no recording, nor before the sound woke */
  readonly aired: boolean;
}

let probe: RadioCheckProbe = { asked: null, by: null, aired: false };

export function radioCheckProbe(): RadioCheckProbe {
  return probe;
}

/** The lobby's radio: told how the crew stands, and that the lobby goes. */
export interface LobbyRadio {
  /**
   * The crew as it stands now: the Funkprobe once every seat is ready and the host can start —
   * its words, said by the operator on duty (undefined before) — and whether anybody of the crew
   * speaks.
   */
  update(line: VoiceLine | undefined, talking: boolean): void;
  /** The lobby goes: the Funkprobe cut where it speaks, its level let go, nothing asked left. */
  end(): void;
}

/** The Funkprobe's level for the crew speaking or not: UNDER_CREW_DB down, or whole. */
const levelFor = (talking: boolean): number => (talking ? 10 ** (UNDER_CREW_DB / 20) : 1);

/** `level` heads for where the crew speaking or not puts it: down quickly, back up slowly. */
function steer(level: GainNode, talking: boolean): void {
  const now = level.context.currentTime;
  const param = level.gain;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  const take = talking ? DUCK_ATTACK_S : DUCK_RELEASE_S;
  param.linearRampToValueAtTime(levelFor(talking), now + take);
}

/**
 * A lobby's radio, for the lobby screen to keep while it shows: it says the Funkprobe the first
 * time `update` brings it, once, and after `end` — React's own unmount and mount again included —
 * as a lobby of its own would.
 */
export function lobbyRadio(): LobbyRadio {
  let said = false;
  let talking = false;
  /** the Funkprobe asked for and not yet on the air, made moot by `end` */
  let asked: object | null = null;
  let level: GainNode | null = null;
  const say = (line: VoiceLine): void => {
    const ask = {};
    asked = ask;
    probe = { asked: line.text, by: line.person, aired: false };
    void voiceReady().then(() => {
      const engine = liveEngine();
      if (asked !== ask || engine === null) return;
      asked = null;
      // The level stands from the ask on, so that the lobby's end cuts a Funkprobe still decoding.
      const under = outlet(engine.ctx, engine.voice, levelFor(talking));
      level = under;
      void sayLine(line, under).then((aired) => {
        if (aired !== null) {
          probe = { asked: line.text, by: line.person, aired: true };
          return;
        }
        if (level === under) level = null;
        under.disconnect();
      });
    });
  };
  return {
    update(line, speaking) {
      if (speaking !== talking && level !== null) steer(level, speaking);
      talking = speaking;
      if (line === undefined || said) return;
      said = true;
      say(line);
    },
    end() {
      said = false;
      asked = null;
      if (level === null) return;
      stopVoice();
      const under = level;
      level = null;
      setTimeout(() => under.disconnect(), LET_GO_MS);
    },
  };
}

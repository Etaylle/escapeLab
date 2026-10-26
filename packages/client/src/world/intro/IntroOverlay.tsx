import type { PlayerView } from '@escapelab/core';
import { useMedia, useNow } from '../../hooks.js';
import { recordedMs } from '../radioVoice.js';
import {
  barsIn,
  blackAt,
  cardAt,
  hintShown,
  introPhase,
  paSchedule,
  subtitleAt,
  titleAt,
  type IntroCue,
  type IntroPhase,
} from './sequence.js';

/**
 * The run's opening over the world, as DOM over the canvas (intro.css): the black and the
 * location card, the two bars of the shot with the announcement's subtitle and the skip in the
 * lower one, and the title that lands as the lights die. Everything follows from the cue and
 * the clock (sequence.ts); the overlay draws itself anew ten times a second while it is up, and
 * its opacities glide between two draws. It takes a tap to skip where Space would, and lets the
 * world have the pointer once there is nothing to skip and nothing held.
 */

/** The plant the lab belongs to, as the location card names it (docs/art-bible.md). */
export const PLANT = 'Forschungsanlage Kaltenbrunn';

/** How often the overlay draws itself anew while it is up, ms. */
const DRAW_MS = 100;

/** Whether the overlay is up at `now`: until the opening is over and its title gone. */
export function overlayUp(cue: IntroCue, now: number): boolean {
  return introPhase(cue, now) !== 'done' || titleAt(cue, now) > 0;
}

/** The skip as the lower bar offers it: the key, or a tap, and how many of the crew have. */
export function skipLine(view: PlayerView, touch: boolean): string {
  const present = view.players.filter((player) => player.connected);
  const done = present.filter((player) => view.intro?.done.includes(player.id) === true).length;
  return `Überspringen · ${touch ? 'Tippen' : 'Leertaste'} (${done}/${present.length})`;
}

/** The location card: the plant, then the wing and the shift — or a mission's name for title. */
function Card({ cue, view, opacity }: { cue: IntroCue; view: PlayerView; opacity: number }) {
  const intro = view.intro;
  return (
    <div className="intro-card" style={{ opacity }}>
      <p className="intro-plant">{PLANT}</p>
      {cue.lightsSec === null ? (
        <h1 className="intro-name">{view.missionTitle}</h1>
      ) : (
        <>
          {intro !== undefined && intro.place !== '' && (
            <h1 className="intro-place">{intro.place}</h1>
          )}
          {intro !== undefined && intro.time !== '' && <p className="intro-time">{intro.time}</p>}
        </>
      )}
    </div>
  );
}

/** What the shot's bars show: whether they stand in the picture, the subtitle, the skip. */
interface BarsProps {
  shown: boolean;
  subtitle: string | null;
  hint: string | null;
}

/** The shot's bars: the lower one carries the announcement's subtitle and the skip. */
function Bars({ shown, subtitle, hint }: BarsProps) {
  const out = shown ? '' : ' intro-bar--out';
  return (
    <>
      <div className={`intro-bar intro-bar--top${out}`} />
      <div className={`intro-bar intro-bar--bottom${out}`}>
        {subtitle !== null && <p className="intro-subtitle">{subtitle}</p>}
        {hint !== null && <span className="intro-skip">{hint}</span>}
      </div>
    </>
  );
}

/** The overlay's classes: whether it takes the pointer — to skip, or to hold the world still. */
function classesOf(cue: IntroCue, phase: IntroPhase): string {
  const intro = cue.lightsSec !== null;
  const holds = intro && (phase === 'card' || phase === 'shot' || phase === 'beat');
  const card = !intro && phase === 'card';
  return ['intro', holds || card ? 'intro--holds' : '', card ? 'intro--name' : '']
    .filter((name) => name !== '')
    .join(' ');
}

/** The run's opening over the world on this screen; `skip` skips it where it can be skipped. */
export function IntroOverlay({
  cue,
  view,
  skip,
}: {
  cue: IntroCue;
  view: PlayerView;
  skip: () => void;
}) {
  const now = useNow(DRAW_MS);
  const touch = useMedia('(pointer: coarse)');
  if (!overlayUp(cue, now)) {
    return null;
  }
  const phase = introPhase(cue, now);
  const black = blackAt(cue, now);
  const title = titleAt(cue, now);
  const lines = (view.intro?.pa ?? []).map((text) => ({ text, ms: recordedMs(text) }));
  const watching = phase === 'shot';
  const subtitle = watching ? subtitleAt(paSchedule(lines), now - cue.since) : null;
  return (
    <div
      className={classesOf(cue, phase)}
      onPointerDown={(e) => {
        e.preventDefault();
        skip();
      }}
    >
      {black > 0 && <div className="intro-black" style={{ opacity: black }} />}
      {phase === 'card' && <Card cue={cue} view={view} opacity={cardAt(cue, now)} />}
      {cue.lightsSec !== null && (
        <Bars
          shown={barsIn(cue, now)}
          subtitle={subtitle}
          hint={hintShown(cue, now) ? skipLine(view, touch) : null}
        />
      )}
      {title > 0 && (
        <h1 className="intro-title" style={{ opacity: title }}>
          {view.missionTitle}
        </h1>
      )}
    </div>
  );
}

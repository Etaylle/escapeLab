import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FirewallBlip, FirewallHeader } from '@escapelab/core';
import { serverNow } from '../clock.js';
import { useKeys } from '../hooks.js';
import { useSettings } from '../settings.js';
import { TalkButton } from '../screens/Voice.js';
import { consoleName } from '../world/consoles.js';
import { cssVars, type Change } from './feel.js';
import {
  BURST_MS,
  cursorStep,
  fallKey,
  LINES,
  lowestOn,
  nextChange,
  onTheLines,
  progressOf,
  statusOf,
  waveMsAt,
  type FirewallPuzzle,
} from './firewallView.js';
import type { PanelProps } from './index.js';
import { Link } from './ServersPanel.js';
import { dialDetent, lampPop, stageChime, typeBlip } from './sounds.js';
import { useNowUntil } from './syncPress.js';
import './firewall.css';

/**
 * FirewallPanel.tsx: the Paketfilter at its two consoles, one scope each — five lines running
 * down into the Kern, the packets coming down them as the server's clock moves them. Console a,
 * the Sperrpult, shows each packet as a plain point, ringed and ticked where console b marked
 * it, a gate under the lines that steps from line to line and trips, and the Freigabe key that
 * starts a waiting wave; console b, the
 * Analysepult, shows the same packets as cards with their headers, each a key that sets or takes
 * back its mark. A packet glides down by a CSS animation timed from the view (`Falling`) — under
 * reduced motion it steps once a second, never ahead of the truth — and stands still while the
 * wave is held; a drop shows once the server has made it. The audience sees the Analysepult's
 * scope.
 */

type Send = PanelProps<'firewall'>['send'];
type Clock = NonNullable<FirewallPuzzle['clock']>;

/**
 * The keys that trip the gate — or give a waiting wave its Freigabe — and mark the packet under
 * the Analysepult's cursor.
 */
const PRESS = [' ', 'enter'];

/**
 * How often the page came back into view since the device opened: a hidden tab runs no CSS
 * animation, so each return starts every packet's fall anew (`fallKey`).
 */
function useShownAgain(): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const back = (): void => {
      if (document.visibilityState === 'visible') {
        setShown((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, []);
  return shown;
}

/**
 * The keys that step the gate and the Analysepult's cursor: the arrows, and the keys the
 * settings walk left and right with (A and D unless rebound).
 */
function useSteps(): { left: string[]; right: string[] } {
  const { keys } = useSettings();
  return { left: ['arrowleft', keys.left], right: ['arrowright', keys.right] };
}

// --- what a change sounds like ---------------------------------------------------------------

/**
 * What a change sounds like: a packet taken out of its line popping, a clean wave chiming; a
 * fault's klaxon is the kit's, and so is the solve's chord.
 */
export function firewallSounds(change: Change<FirewallPuzzle>): void {
  const { before, after } = change;
  if (after.event === null || after.event.n === before.event?.n) {
    return;
  }
  if (after.event.kind === 'drop') {
    lampPop();
  } else if (after.event.kind === 'cleared') {
    stageChime();
  }
}

/**
 * The render's moment on the server's clock, rendered anew as the device next shows something
 * of its own accord (`nextChange`); a blip each time a packet reaches the Kern, where `audible`.
 */
function useScopeNow(puzzle: FirewallPuzzle, audible: boolean): number {
  const now = useNowUntil(nextChange(puzzle, serverNow()));
  const seen = useRef<{ wave: number; ids: string[] }>({ wave: puzzle.wave, ids: [] });
  const onNow = onTheLines(puzzle, now)
    .map((blip) => blip.id)
    .join(' ');
  const { wave, packets } = puzzle;
  useEffect(() => {
    const ids = onNow === '' ? [] : onNow.split(' ');
    const was = seen.current;
    const through = (packets ?? []).filter(
      (blip) => was.ids.includes(blip.id) && !blip.dropped && !ids.includes(blip.id),
    );
    if (audible && was.wave === wave && through.length > 0) {
      typeBlip();
    }
    seen.current = { wave, ids };
  }, [onNow, audible, wave, packets]);
  return now;
}

// --- the scope -------------------------------------------------------------------------------

/**
 * A packet on its way down its line: a CSS animation from the top into the Kern over the fall,
 * timed as it mounts from where the wave stands — so that renders after it move nothing — and
 * paused where the wave is held. One per packet, wave clock and return to view (`fallKey`).
 */
function Falling(props: { blip: FirewallBlip; clock: Clock; fallMs: number; children: ReactNode }) {
  const { blip, clock, fallMs, children } = props;
  const [delay] = useState(() => blip.enterMs - waveMsAt(clock, serverNow()));
  const style = cssVars({
    '--fall-ms': `${fallMs}ms`,
    '--fall-delay': `${delay}ms`,
    '--fall-steps': Math.round(fallMs / 1000),
  });
  const held = clock.heldAt === null ? '' : ' firewall-track--held';
  return (
    <span className={`firewall-track${held}`} style={style}>
      {children}
    </span>
  );
}

/** A packet just taken out of its line, bursting where it was as the server dropped it. */
function Burst(props: { blip: FirewallBlip; clock: Clock; fallMs: number; at: number }) {
  const { blip, clock, fallMs, at } = props;
  const down = progressOf(blip, at - clock.startedAt, fallMs);
  return (
    <span className="firewall-burst" style={cssVars({ '--down': down.toFixed(3) })} aria-hidden />
  );
}

/**
 * The packets of `line` the scope draws at `now`: those on it, and the one the server just
 * dropped there — a burst only after a drop, never after any other report.
 */
export function onLine(
  puzzle: FirewallPuzzle,
  live: readonly FirewallBlip[],
  line: number,
  now: number,
) {
  const { event } = puzzle;
  const fresh = event?.kind === 'drop' && event.line === line && now < event.at + BURST_MS;
  const dropped = (puzzle.packets ?? []).find((blip) => blip.dropped && blip.line === line);
  return { falling: live.filter((blip) => blip.line === line), burst: fresh ? dropped : undefined };
}

/** What a line draws: its packets, each in what `face` makes of it, and the burst of a drop. */
function LineContents(props: {
  puzzle: FirewallPuzzle;
  live: readonly FirewallBlip[];
  line: number;
  now: number;
  shown: number;
  face: (blip: FirewallBlip) => ReactNode;
}) {
  const { puzzle, live, line, now, shown, face } = props;
  const { falling, burst } = onLine(puzzle, live, line, now);
  const { clock, event } = puzzle;
  if (clock === null) {
    return null;
  }
  return (
    <>
      {falling.map((blip) => (
        <Falling key={fallKey(blip, clock, shown)} blip={blip} clock={clock} fallMs={puzzle.fallMs}>
          {face(blip)}
        </Falling>
      ))}
      {burst !== undefined && event !== null && (
        <Burst blip={burst} clock={clock} fallMs={puzzle.fallMs} at={event.at} />
      )}
    </>
  );
}

/** The status line over the scope, in the lab's words; its own live region. */
function Status({ puzzle, now }: { puzzle: FirewallPuzzle; now: number }) {
  const held = puzzle.vacant.length > 0 || puzzle.waiting ? ' firewall-status--held' : '';
  return (
    <p className={`firewall-status${held}`} role="status">
      <span className="device-engraving">PF-5</span> {statusOf(puzzle, now)}
    </p>
  );
}

/** The word across a scope that stands still: HALT while a console is empty, BEREIT waiting. */
const bannerOf = (puzzle: FirewallPuzzle): string | null => {
  if (puzzle.vacant.length > 0) {
    return 'HALT';
  }
  return puzzle.waiting ? 'BEREIT' : null;
};

/**
 * The scope: the lines' numbers over five lines into the Kern, each line with what `lane` puts
 * on it. A line of the Sperrpult is a key that sets the gate there; the Analysepult's are plain.
 * While the wave stands still the packets dim where they stand under its word (`bannerOf`).
 */
function Scope({ lane, puzzle }: { lane: (line: number) => ReactNode; puzzle: FirewallPuzzle }) {
  const banner = bannerOf(puzzle);
  return (
    <div className={`firewall-scope${banner === null ? '' : ' firewall-scope--held'}`}>
      <div className="firewall-numbers" aria-hidden>
        {LINES.map((line) => (
          <span key={line} className="firewall-line-no">
            {line + 1}
          </span>
        ))}
      </div>
      <div className="firewall-lines">{LINES.map((line) => lane(line))}</div>
      {banner !== null && (
        <p className="firewall-held" aria-hidden>
          {banner}
        </p>
      )}
      <div className="firewall-kern" aria-hidden>
        KERN
      </div>
    </div>
  );
}

// --- console a: the Sperrpult -----------------------------------------------------------------

/** A packet as the Sperrpult shows it: a point; ringed and ticked where console b marked it. */
function Blip({ blip }: { blip: FirewallBlip }) {
  return (
    <span
      className={`firewall-blip${blip.marked ? ' firewall-blip--marked' : ''}`}
      data-packet={blip.id}
      data-marked={blip.marked}
    >
      {blip.marked && <span className="firewall-tick">✓</span>}
    </span>
  );
}

/** A line's key as it is named: its number, and whether its lowest packet wears a ring. */
function lineLabel(live: readonly FirewallBlip[], line: number): string {
  const ringed = lowestOn(live, line)?.marked === true;
  return `Leitung ${line + 1}${ringed ? ', unterstes Paket markiert' : ''}`;
}

/** One line of the Sperrpult: a key setting the gate on it, its packets, the gate where it is. */
function GateLine(props: {
  puzzle: FirewallPuzzle;
  live: readonly FirewallBlip[];
  line: number;
  gate: number;
  now: number;
  shown: number;
  onPick: (line: number) => void;
}) {
  const { live, line, gate, onPick } = props;
  const here = gate === line;
  return (
    <button
      type="button"
      className={`firewall-line${here ? ' firewall-line--gate' : ''}`}
      data-line={line}
      data-feel="detent"
      aria-label={lineLabel(live, line)}
      aria-pressed={here}
      onClick={() => onPick(line)}
    >
      <LineContents {...props} face={(blip) => <Blip blip={blip} />} />
      {here && <span className="firewall-gate" aria-hidden />}
    </button>
  );
}

/** The Sperrpult's keys under its scope: ◀, SPERREN, ▶, FREIGABE, the lamp and the talk key. */
function GateKeys(props: {
  puzzle: FirewallPuzzle;
  step: (by: number) => void;
  trip: () => void;
  arm: () => void;
}) {
  const { puzzle, step, trip, arm } = props;
  return (
    <div className="firewall-bezel">
      <button
        type="button"
        className="firewall-step"
        data-feel="detent"
        aria-label="Sperre nach links"
        onClick={() => step(-1)}
      >
        ◀
      </button>
      <button type="button" className="firewall-trip" data-feel="thunk" onClick={trip}>
        SPERREN
      </button>
      <button
        type="button"
        className="firewall-step"
        data-feel="detent"
        aria-label="Sperre nach rechts"
        onClick={() => step(1)}
      >
        ▶
      </button>
      <button
        type="button"
        className="firewall-arm"
        data-feel="thunk"
        disabled={!puzzle.waiting}
        onClick={arm}
      >
        FREIGABE
      </button>
      <Link name="ANALYSE" manned={puzzle.atOtherConsole !== null} />
      <TalkButton className="servers-talk firewall-talk">FUNK</TalkButton>
    </div>
  );
}

/**
 * Console a, the Sperrpult: the scope of points, the gate under its lines — set by a tap on a
 * line, stepped by ◀ ▶, ← → or the keys that walk left and right (`useSteps`) —, SPERREN, which
 * trips it, and FREIGABE, which starts a waiting wave; space or enter press the one of the two
 * the wave stands for. The gate is this console's own; only the trip goes to the server, with
 * its line.
 */
function Sperrpult({ puzzle, send }: { puzzle: FirewallPuzzle; send: Send }) {
  const now = useScopeNow(puzzle, true);
  const shown = useShownAgain();
  const live = onTheLines(puzzle, now);
  const [gate, setGate] = useState(2);
  const step = (by: number): void =>
    setGate((at) => Math.min(LINES.length - 1, Math.max(0, at + by)));
  const trip = (): void => send({ trip: gate });
  const arm = (): void => send({ start: true });
  const { left, right } = useSteps();
  useKeys([...left, ...right, ...PRESS], (key) => {
    if (PRESS.includes(key)) {
      (puzzle.waiting ? arm : trip)();
      return;
    }
    dialDetent();
    step(left.includes(key) ? -1 : 1);
  });
  return (
    <div className="firewall firewall--gate">
      <Status puzzle={puzzle} now={now} />
      <Scope
        puzzle={puzzle}
        lane={(line) => (
          <GateLine
            key={line}
            puzzle={puzzle}
            live={live}
            line={line}
            gate={gate}
            now={now}
            shown={shown}
            onPick={setGate}
          />
        )}
      />
      <GateKeys puzzle={puzzle} step={step} trip={trip} arm={arm} />
    </div>
  );
}

// --- console b: the Analysepult ---------------------------------------------------------------

/** A header as a card prints it, in two lines: the Quelle, then port and protocol, „67/UDP". */
function HeaderLines({ header }: { header: FirewallHeader }) {
  return (
    <>
      <span className="firewall-field firewall-source">{header.source}</span>
      <span className="firewall-field firewall-port">{`${header.port}/${header.protocol}`}</span>
    </>
  );
}

/** A packet as the Analysepult shows it: a card with its header, ringed and ticked once marked. */
function Card(props: { blip: FirewallBlip; cursor: boolean; onMark: (() => void) | null }) {
  const { blip, cursor, onMark } = props;
  const classes = [
    'firewall-card',
    blip.marked ? 'firewall-card--marked' : null,
    cursor ? 'firewall-card--cursor' : null,
  ].filter(Boolean);
  const header = blip.header;
  const said =
    header === null ? blip.id : `${header.source}, Port ${header.port}, ${header.protocol}`;
  const face = (
    <>
      {header !== null && <HeaderLines header={header} />}
      {blip.marked && <span className="firewall-tick">✓</span>}
    </>
  );
  if (onMark === null) {
    return (
      <span className={classes.join(' ')} data-packet={blip.id} data-marked={blip.marked}>
        {face}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={classes.join(' ')}
      data-packet={blip.id}
      data-marked={blip.marked}
      data-feel="blip"
      aria-label={`${said}${blip.marked ? ', markiert' : ''}`}
      aria-pressed={blip.marked}
      onClick={onMark}
    >
      {face}
    </button>
  );
}

/** One line of the Analysepult's scope: its packets as cards. */
function CardLine(props: {
  puzzle: FirewallPuzzle;
  live: readonly FirewallBlip[];
  line: number;
  now: number;
  shown: number;
  cursor: string | null;
  mark: ((id: string) => void) | null;
}) {
  const { line, cursor, mark } = props;
  const face = (blip: FirewallBlip): ReactNode => (
    <Card
      blip={blip}
      cursor={cursor === blip.id}
      onMark={mark === null ? null : () => mark(blip.id)}
    />
  );
  return (
    <div className="firewall-line firewall-line--cards" data-line={line}>
      <LineContents {...props} face={face} />
    </div>
  );
}

/**
 * Console b, the Analysepult: the scope of cards, each a key that sets or takes back its mark;
 * ← → step a cursor over them, space or enter marks the packet under it.
 */
function Analysepult({ puzzle, send }: { puzzle: FirewallPuzzle; send: Send }) {
  const now = useScopeNow(puzzle, true);
  const shownAgain = useShownAgain();
  const live = onTheLines(puzzle, now);
  const [cursor, setCursor] = useState<string | null>(null);
  const shown = live.some((blip) => blip.id === cursor) ? cursor : null;
  const mark = (id: string): void => send({ mark: id });
  const { left, right } = useSteps();
  useKeys([...left, ...right, ...PRESS], (key) => {
    if (PRESS.includes(key)) {
      if (shown !== null) {
        mark(shown);
      }
      return;
    }
    setCursor(cursorStep(live, shown, left.includes(key) ? -1 : 1));
  });
  return (
    <div className="firewall firewall--analysis">
      <Status puzzle={puzzle} now={now} />
      <Scope
        puzzle={puzzle}
        lane={(line) => (
          <CardLine
            key={line}
            puzzle={puzzle}
            live={live}
            line={line}
            now={now}
            shown={shownAgain}
            cursor={shown}
            mark={mark}
          />
        )}
      />
      <div className="firewall-bezel">
        <Link name="SPERRE" manned={puzzle.atOtherConsole !== null} />
        <TalkButton className="servers-talk firewall-talk">FUNK</TalkButton>
      </div>
    </div>
  );
}

// --- the audience ----------------------------------------------------------------------------

/**
 * The scope as the audience sees it: the Analysepult's cards with their headers and marks —
 * all the Sperrpult shows besides is its own gate.
 */
function Watched({ puzzle }: { puzzle: FirewallPuzzle }) {
  const now = useScopeNow(puzzle, false);
  const shown = useShownAgain();
  const live = onTheLines(puzzle, now);
  return (
    <section
      className="firewall firewall--analysis firewall--watched"
      aria-label={consoleName('b')}
    >
      <h4 className="servers-console-name">{consoleName('b')}</h4>
      <Status puzzle={puzzle} now={now} />
      <Scope
        puzzle={puzzle}
        lane={(line) => (
          <CardLine
            key={line}
            puzzle={puzzle}
            live={live}
            line={line}
            now={now}
            shown={shown}
            cursor={null}
            mark={null}
          />
        )}
      />
    </section>
  );
}

/**
 * Paketfilter at one console: the Sperrpult at a, the Analysepult at b; the audience sees the
 * cards with their marks (`Watched`). Away from them nothing of the instance stands here.
 */
export function FirewallPanel({ puzzle, send }: PanelProps<'firewall'>) {
  if (puzzle.role === 'gate') {
    return <Sperrpult puzzle={puzzle} send={send} />;
  }
  if (puzzle.role === 'analysis') {
    return <Analysepult puzzle={puzzle} send={send} />;
  }
  if (puzzle.packets !== null) {
    return <Watched puzzle={puzzle} />;
  }
  return <p className="muted">Dieses Pult ist nicht angeschlossen.</p>;
}

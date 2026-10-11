import { useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  DronePosition,
  PlayerPosition,
  PlayerView,
  PuzzleView,
} from '@escapelab/core';
import { play, simonTone } from '../sounds.js';
import { GameWorld, type ChatLine, type MapPing } from '../world/GameWorld.js';

interface Props {
  view: PlayerView;
  positionsRef: React.MutableRefObject<Record<string, PlayerPosition>>;
  dronesRef: React.MutableRefObject<Record<string, DronePosition>>;
  pingsRef: React.MutableRefObject<MapPing[]>;
  chatsRef: React.MutableRefObject<ChatLine[]>;
  send: (msg: ClientMessage) => void;
}

type Send = Props['send'];

const SIMON_COLOR_MAP: Record<string, { hex: string; label: string }> = {
  rot: { hex: '#ef4444', label: 'ROT' },
  gruen: { hex: '#22c55e', label: 'GRÜN' },
  blau: { hex: '#3b82f6', label: 'BLAU' },
  gelb: { hex: '#eab308', label: 'GELB' },
};

function formatRemaining(deadlineAt: number, now: number): string {
  const totalSec = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Full-width emergency banner: what broke, where to go, how long you have. */
function SabotageAlert({ sabotage }: { sabotage: NonNullable<PlayerView['map']>['sabotage'] }) {
  const now = useNow(200);
  if (sabotage === null) {
    return null;
  }
  const left = Math.max(0, Math.ceil((sabotage.endsAt - now) / 1000));
  const manned = sabotage.panels.filter((p) => p.occupied).length;
  return (
    <div className="sabotage" role="alert">
      <div className="sabotage-head">
        <span className="sabotage-label">🚨 {sabotage.label}</span>
        <span className="sabotage-clock">{left}s</span>
      </div>
      <p className="sabotage-hint">{sabotage.hint}</p>
      <div className="sabotage-panels">
        {sabotage.panels.map((panel) => (
          <span key={panel.id} className={`panel-pip ${panel.occupied ? 'panel-pip-on' : ''}`}>
            {panel.occupied ? '✓' : '○'}
          </span>
        ))}
        <span className="muted">
          {manned}/{sabotage.panels.length} besetzt
        </span>
      </div>
    </div>
  );
}

function Countdown({ deadlineAt }: { deadlineAt: number }) {
  const now = useNow(250);
  const critical = deadlineAt - now < 60_000;
  return (
    <div className={`countdown ${critical ? 'critical' : ''}`}>
      {formatRemaining(deadlineAt, now)}
    </div>
  );
}

/** Red edge glow while the clock runs out. */
function CriticalVignette({ deadlineAt }: { deadlineAt: number }) {
  const now = useNow(500);
  if (deadlineAt - now >= 60_000) {
    return null;
  }
  return <div className="vignette" aria-hidden="true" />;
}

/** Mission briefing shown for the first seconds after launch. */
function Briefing({ view }: { view: PlayerView }) {
  const now = useNow(200);
  const startedAt = view.startedAt ?? now;
  const msIn = now - startedAt;
  if (msIn > 3600) {
    return null;
  }
  const count = msIn < 1200 ? 3 : msIn < 2400 ? 2 : 1;
  return (
    <div className="overlay briefing">
      <span className="kicker">MISSION GESTARTET</span>
      <h1>{view.missionTitle}</h1>
      <p>Du bist: <strong>{view.players.find((p) => p.id === view.you.id)?.roleName}</strong></p>
      <div className="briefing-count">{count}</div>
    </div>
  );
}

/** Sounds, screen shake, alarm banner and the SYSTEM-ONLINE stamp. */
function useFeedback(view: PlayerView): { shaking: boolean; alarmVisible: boolean; stamp: boolean } {
  const [shaking, setShaking] = useState(false);
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [stamp, setStamp] = useState(false);
  const prevPenalty = useRef(view.penaltySeq);
  const prevPuzzle = useRef(view.puzzle?.index ?? 0);
  const started = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      play('start');
    }
  }, []);

  useEffect(() => {
    if (view.penaltySeq > prevPenalty.current) {
      prevPenalty.current = view.penaltySeq;
      if (view.map === null) {
        play('alarm'); // mapped missions get their alarm from the world audio layer
      }
      setShaking(true);
      setAlarmVisible(true);
      const shakeTimer = setTimeout(() => setShaking(false), 600);
      const alarmTimer = setTimeout(() => setAlarmVisible(false), 4000);
      return () => {
        clearTimeout(shakeTimer);
        clearTimeout(alarmTimer);
      };
    }
    prevPenalty.current = view.penaltySeq;
    return undefined;
  }, [view.penaltySeq, view.map]);

  useEffect(() => {
    const index = view.currentPuzzleIndex;
    if (index > prevPuzzle.current) {
      play('solved');
      setStamp(true);
      const timer = setTimeout(() => setStamp(false), 1400);
      prevPuzzle.current = index;
      return () => clearTimeout(timer);
    }
    prevPuzzle.current = index;
    return undefined;
  }, [view.currentPuzzleIndex]);

  return { shaking, alarmVisible, stamp };
}

// --- puzzle panels ---------------------------------------------------------

function WiringPanel({ puzzle, send }: { puzzle: PuzzleView & { kind: 'wiring' }; send: Send }) {
  if (puzzle.wires === null) {
    return (
      <div className="big-hint">
        <p className="muted">
          Du siehst den Sicherungskasten nicht — hier zählt dein Wissen. Frag, welche Zeichen auf
          den Kabeln stehen!
        </p>
        <div className="progress-line">
          Getrennt: {puzzle.cutsDone}/{puzzle.cutsNeeded}
        </div>
      </div>
    );
  }
  const n = puzzle.wires.length;
  const rowH = 46;
  return (
    <div>
      <svg
        className="wirebox"
        viewBox={`0 0 420 ${n * rowH + 20}`}
        role="group"
        aria-label="Sicherungskasten"
      >
        {puzzle.wires.map((wire, i) => {
          const y = 34 + i * rowH;
          const wrong = puzzle.lastWrongWireId === wire.id;
          return (
            <g
              key={wire.id}
              className={`wire ${wire.cut ? 'wire-cut' : ''} ${wrong ? 'wire-wrong' : ''}`}
              onClick={() => {
                if (!wire.cut) {
                  play('click');
                  send({ kind: 'cut-wire', wireId: wire.id });
                }
              }}
            >
              <text x={18} y={y + 6} className="wire-symbol" textAnchor="middle">
                {wire.left}
              </text>
              {wire.cut ? (
                <>
                  <path d={`M 40 ${y} C 110 ${y}, 150 ${y + 14}, 185 ${y + 18}`}
                    stroke={wire.color} />
                  <path d={`M 235 ${y + 18} C 270 ${y + 14}, 310 ${y}, 380 ${y}`}
                    stroke={wire.color} />
                  <text x={210} y={y + 16} className="wire-scissors" textAnchor="middle">
                    ✂
                  </text>
                </>
              ) : (
                <>
                  <path d={`M 40 ${y} C 150 ${y - 8}, 270 ${y + 8}, 380 ${y}`}
                    stroke={wire.color} />
                  <path
                    className="wire-hit"
                    d={`M 40 ${y} C 150 ${y - 8}, 270 ${y + 8}, 380 ${y}`}
                  />
                </>
              )}
              <text x={402} y={y + 6} className="wire-symbol" textAnchor="middle">
                {wire.right}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="muted">
        Kabel anklicken trennt es sofort — getrennt: {puzzle.cutsDone}/{puzzle.cutsNeeded}
      </p>
    </div>
  );
}

function Dots({ total, done }: { total: number; done: number }) {
  return (
    <div className="code-dots">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < done ? 'dot done' : 'dot'} />
      ))}
    </div>
  );
}

function KeypadPanel({ puzzle, send }: { puzzle: PuzzleView & { kind: 'keypad' }; send: Send }) {
  if (puzzle.grid === null) {
    return (
      <div className="big-hint">
        <p className="muted">
          Das Tastenfeld ist auf der anderen Seite — hier zählt der Code aus deinen Unterlagen.
        </p>
        <Dots total={puzzle.codeLength} done={puzzle.progress} />
      </div>
    );
  }
  return (
    <div>
      <Dots total={puzzle.codeLength} done={puzzle.progress} />
      <div className="keypad">
        {puzzle.grid.map((key, i) => (
          <button
            key={i}
            className={`key ${key.done ? 'key-done' : ''} ${
              puzzle.lastWrongIndex === i ? 'key-wrong' : ''
            }`}
            disabled={key.done}
            onClick={() => {
              play('click');
              send({ kind: 'press-key', keyIndex: i });
            }}
          >
            {key.symbol}
          </button>
        ))}
      </div>
    </div>
  );
}

function SwitchesPanel({ puzzle, send }: { puzzle: PuzzleView & { kind: 'switches' }; send: Send }) {
  if (puzzle.switches === null) {
    return (
      <div className="big-hint">
        {puzzle.target !== null ? (
          <>
            <p>Diese Schalter müssen nach <strong>OBEN</strong> — alle anderen nach unten:</p>
            <div className="target-symbols">
              {puzzle.target.map((s) => (
                <span key={s} className="target-symbol">
                  {s}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">
            Die Sollwerte stehen auf einer anderen Station — koordiniere, statt zu raten.
          </p>
        )}
        <p className="muted">Es müssen genau {puzzle.targetCount} Schalter oben sein.</p>
      </div>
    );
  }
  const upCount = puzzle.switches.filter((s) => s.on).length;
  return (
    <div>
      <div className="switchbank">
        {puzzle.switches.map((sw, i) => (
          <button
            key={i}
            className={`switch ${sw.on ? 'switch-on' : ''}`}
            onClick={() => {
              play('click');
              send({ kind: 'toggle-switch', switchIndex: i });
            }}
          >
            <span className="switch-state">{sw.on ? 'OBEN' : 'unten'}</span>
            <span className="switch-lever" aria-hidden="true">
              <span className="switch-knob" />
            </span>
            <span className="switch-symbol">{sw.symbol}</span>
          </button>
        ))}
      </div>
      <div className="commit-row">
        <span className="muted">
          {upCount}/{puzzle.targetCount} oben
        </span>
        <button className="primary" onClick={() => send({ kind: 'commit-switches' })}>
          ⏻ PRÜFEN
        </button>
      </div>
    </div>
  );
}

function SimonPanel({ puzzle, send }: { puzzle: PuzzleView & { kind: 'simon' }; send: Send }) {
  const [flashing, setFlashing] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (puzzle.legend !== null) {
    return (
      <div className="big-hint">
        <p>Deine Übersetzungslegende — Farbe → Steuerimpuls:</p>
        <div className="legend">
          {puzzle.legend.map((entry) => {
            const color = SIMON_COLOR_MAP[entry.color] ?? { hex: '#999', label: entry.color };
            return (
              <div key={entry.color} className="legend-row">
                <span className="legend-color" style={{ background: color.hex }}>
                  {color.label}
                </span>
                <span className="legend-arrow">→</span>
                <span className="legend-symbol">{entry.symbol}</span>
              </div>
            );
          })}
        </div>
        <Dots total={puzzle.seqLength} done={puzzle.progress} />
      </div>
    );
  }
  if (puzzle.sequence === null || puzzle.buttons === null) {
    return (
      <div className="big-hint">
        <p className="muted">Die Frequenzanzeige läuft an einer anderen Station.</p>
        <Dots total={puzzle.seqLength} done={puzzle.progress} />
      </div>
    );
  }

  const sequence = puzzle.sequence;
  function playSequence(): void {
    timers.current.forEach(clearTimeout);
    timers.current = sequence.map((color, i) => {
      const colorIdx = Object.keys(SIMON_COLOR_MAP).indexOf(color);
      return setTimeout(() => {
        setFlashing(i);
        simonTone(colorIdx);
        timers.current.push(setTimeout(() => setFlashing(null), 620));
      }, i * 800);
    });
  }

  const current = flashing !== null ? sequence[flashing] : undefined;
  const lamp = current !== undefined ? SIMON_COLOR_MAP[current] : undefined;
  return (
    <div>
      <div className="simon-lamp" style={lamp !== undefined ? { background: lamp.hex } : {}}>
        {lamp !== undefined ? (
          <span>
            {lamp.label} ({(flashing ?? 0) + 1}/{sequence.length})
          </span>
        ) : (
          <span className="muted">Signal bereit</span>
        )}
      </div>
      <div className="simon-controls">
        <button onClick={playSequence}>▶ FOLGE ABSPIELEN</button>
        <Dots total={puzzle.seqLength} done={puzzle.progress} />
      </div>
      <div className="simon-buttons">
        {puzzle.buttons.map((symbol, i) => (
          <button
            key={i}
            className={`key ${puzzle.lastWrongIndex === i ? 'key-wrong' : ''}`}
            onClick={() => {
              play('click');
              send({ kind: 'press-simon', buttonIndex: i });
            }}
          >
            {symbol}
          </button>
        ))}
      </div>
    </div>
  );
}

const COLS = 'ABCDEFGH';
const CELL = 34;

/** Shared grid chrome for both maze views: labels, goal flag, optional walls. */
function MazeGrid({ puzzle }: { puzzle: PuzzleView & { kind: 'maze' } }) {
  const n = puzzle.size;
  const pad = 18;
  const span = n * CELL;
  return (
    <svg
      className="maze"
      viewBox={`0 0 ${span + pad * 2} ${span + pad * 2}`}
      role="img"
      aria-label="Labyrinth"
    >
      {Array.from({ length: n }, (_, i) => (
        <g key={`label-${i}`} className="maze-label">
          <text x={pad + i * CELL + CELL / 2} y={pad - 5} textAnchor="middle">
            {COLS[i]}
          </text>
          <text x={pad - 6} y={pad + i * CELL + CELL / 2 + 4} textAnchor="end">
            {i + 1}
          </text>
        </g>
      ))}
      <rect x={pad} y={pad} width={span} height={span} className="maze-frame" />
      {puzzle.cells !== null &&
        Array.from({ length: n * n }, (_, i) => {
          const x = pad + (i % n) * CELL;
          const y = pad + Math.floor(i / n) * CELL;
          const open = puzzle.cells?.[i] ?? 0;
          return (
            <g key={`cell-${i}`} className="maze-wall">
              {(open & 1) === 0 && <line x1={x} y1={y} x2={x + CELL} y2={y} />}
              {(open & 2) === 0 && <line x1={x + CELL} y1={y} x2={x + CELL} y2={y + CELL} />}
              {(open & 4) === 0 && <line x1={x} y1={y + CELL} x2={x + CELL} y2={y + CELL} />}
              {(open & 8) === 0 && <line x1={x} y1={y} x2={x} y2={y + CELL} />}
            </g>
          );
        })}
      <g className="maze-goal">
        <rect
          x={pad + puzzle.goal.x * CELL + 7}
          y={pad + puzzle.goal.y * CELL + 7}
          width={CELL - 14}
          height={CELL - 14}
          rx={3}
        />
      </g>
      {puzzle.pos !== null && (
        <circle
          className={`maze-marker ${puzzle.lastResult === 'wall' ? 'maze-marker-bump' : ''}`}
          cx={pad + puzzle.pos.x * CELL + CELL / 2}
          cy={pad + puzzle.pos.y * CELL + CELL / 2}
          r={9}
        />
      )}
    </svg>
  );
}

function MazePanel({ puzzle, send }: { puzzle: PuzzleView & { kind: 'maze' }; send: Send }) {
  const goalName = `${COLS[puzzle.goal.x] ?? '?'}${puzzle.goal.y + 1}`;
  if (puzzle.pos === null) {
    return (
      <div>
        <p className="muted">
          Du siehst die Wände, aber nicht den Marker. Lass dir die Position ansagen (z. B. „C4")
          und gib Richtungen durch. Ziel: <strong>{goalName}</strong>.
        </p>
        <MazeGrid puzzle={puzzle} />
      </div>
    );
  }
  const here = `${COLS[puzzle.pos.x] ?? '?'}${puzzle.pos.y + 1}`;
  return (
    <div>
      <p className="muted">
        Du stehst auf <strong>{here}</strong>, das Ziel ist <strong>{goalName}</strong>. Die
        Wände sieht nur dein Team — frag nach jeder Richtung!
      </p>
      <MazeGrid puzzle={puzzle} />
      {puzzle.lastResult === 'wall' && <p className="warn">⚠ Gegen die Wand gelaufen!</p>}
      <div className="maze-pad">
        {(
          [
            [0, '↑', 'up'],
            [3, '←', 'left'],
            [1, '→', 'right'],
            [2, '↓', 'down'],
          ] as const
        ).map(([dir, glyph, area]) => (
          <button
            key={area}
            className={`maze-btn maze-btn--${area}`}
            onClick={() => {
              play('click');
              send({ kind: 'move-maze', dir });
            }}
            aria-label={area}
          >
            {glyph}
          </button>
        ))}
      </div>
    </div>
  );
}

function SyncPanel({ puzzle, send }: { puzzle: PuzzleView & { kind: 'button-sync' }; send: Send }) {
  return (
    <div>
      {puzzle.buttonLabel !== null ? (
        <button
          className="big-button"
          disabled={puzzle.youPressed}
          onClick={() => send({ kind: 'press-button' })}
        >
          {puzzle.youPressed ? '✓ GEDRÜCKT — WARTE AUFS TEAM' : `⏻ ${puzzle.buttonLabel}`}
        </button>
      ) : (
        <p className="muted">Du hast hier keinen Knopf — deine Aufgabe ist reden, nicht drücken.</p>
      )}
      <div className="puzzle-status">
        <span>
          {puzzle.pressedCount}/{puzzle.requiredCount} bestätigt
        </span>
        {puzzle.lastResult === 'missed-window' && (
          <span className="warn">
            ⚠ Zeitfenster verpasst (Versuch {puzzle.attempts}) — nochmal, diesmal gleichzeitig!
          </span>
        )}
      </div>
    </div>
  );
}

function PuzzlePanel({ puzzle, send }: { puzzle: PuzzleView; send: Send }) {
  switch (puzzle.kind) {
    case 'wiring':
      return <WiringPanel puzzle={puzzle} send={send} />;
    case 'keypad':
      return <KeypadPanel puzzle={puzzle} send={send} />;
    case 'switches':
      return <SwitchesPanel puzzle={puzzle} send={send} />;
    case 'simon':
      return <SimonPanel puzzle={puzzle} send={send} />;
    case 'maze':
      return <MazePanel puzzle={puzzle} send={send} />;
    case 'button-sync':
      return <SyncPanel puzzle={puzzle} send={send} />;
  }
}

// --- screen ------------------------------------------------------------------

export function GameScreen({ view, positionsRef, dronesRef, pingsRef, chatsRef, send }: Props) {
  const { shaking, alarmVisible, stamp } = useFeedback(view);
  const puzzle = view.puzzle;
  const map = view.map;
  if (puzzle === null && map === null) {
    return <p className="muted">Lade Mission …</p>;
  }
  const myRole = view.players.find((p) => p.id === view.you.id)?.roleName ?? '—';
  const armedTitle = map?.stations.find((s) => s.status === 'armed')?.title ?? null;
  const escaping = map?.exit?.open === true;
  const title =
    puzzle !== null
      ? puzzle.title
      : escaping
        ? '🏃 NOTAUSGANG — alle raus, JETZT!'
        : (armedTitle ?? 'Alle Stationen erledigt');

  return (
    <div className={`game ${shaking ? 'shake' : ''}`}>
      {view.deadlineAt !== null && <CriticalVignette deadlineAt={view.deadlineAt} />}
      <Briefing view={view} />
      {stamp && (
        <div className="overlay stamp" aria-hidden="true">
          <span>✔ SYSTEM ONLINE</span>
        </div>
      )}

      <div className="game-header">
        <div>
          <div
            className="led-strip"
            aria-label={`Rätsel ${view.currentPuzzleIndex + 1} von ${view.puzzleCount}`}
          >
            {Array.from({ length: view.puzzleCount }, (_, i) => (
              <span
                key={i}
                className={`led ${i < view.currentPuzzleIndex ? 'led-done' : ''} ${
                  i === view.currentPuzzleIndex ? 'led-active' : ''
                }`}
              />
            ))}
          </div>
          <h1>{puzzle === null && !escaping ? `Nächste Station: ${title}` : title}</h1>
        </div>
        {view.deadlineAt !== null && <Countdown deadlineAt={view.deadlineAt} />}
      </div>

      {puzzle !== null && map === null && <p className="story">{puzzle.prompt}</p>}

      {map !== null && <SabotageAlert sabotage={map.sabotage} />}

      {alarmVisible && view.lastPenaltySec !== null && (
        <div key={view.penaltySeq} className="alarm">
          🚨 ALARM — Fehlversuch! −{view.lastPenaltySec} Sekunden
        </div>
      )}

      {view.pausedFor !== null && (
        <div className="overlay pause" role="status">
          <span className="kicker">MISSION PAUSIERT</span>
          <h1>⏸ Verbindung verloren</h1>
          <p>
            {view.pausedFor.length > 0
              ? `Warten auf ${view.pausedFor.join(', ')} — Uhr, Patrouillen und Notfälle stehen still.`
              : 'Warten auf die Crew — Uhr, Patrouillen und Notfälle stehen still.'}
          </p>
          <p className="muted">
            Wer getrennt wurde, lädt einfach die Seite neu und ist wieder dabei.
          </p>
        </div>
      )}

      {map !== null && (
        <GameWorld
          view={view}
          positionsRef={positionsRef}
          dronesRef={dronesRef}
          pingsRef={pingsRef}
          chatsRef={chatsRef}
          inputLocked={puzzle !== null || view.pausedFor !== null}
          send={send}
        />
      )}

      {puzzle !== null &&
        (map !== null ? (
          <div className="puzzle-modal" role="dialog" aria-modal="true">
            <div className="panel">
              <div className="panel-label">// STATION: {myRole}</div>
              <p className="story">{puzzle.prompt}</p>
              {puzzle.info !== null && <div className="info-box">📖 {puzzle.info}</div>}
              <PuzzlePanel puzzle={puzzle} send={send} />
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="panel-label">// STATION: {myRole}</div>
            {puzzle.info !== null && <div className="info-box">📖 {puzzle.info}</div>}
            <PuzzlePanel puzzle={puzzle} send={send} />
          </div>
        ))}

      <ul className="players inline">
        {view.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'offline'}>
            {p.name} · {p.roleName ?? '—'}
            {p.connected ? '' : ' ⚠ getrennt'}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { difficultyInfos, type ClientMessage, type MissionInfo, type PlayerView } from '@escapelab/core';
import { crewSizeText } from './Crew.js';
import { CrewPreview } from './CrewPreview.js';
import { MapThumb } from './MapThumb.js';

interface Props {
  view: PlayerView;
  send: (msg: ClientMessage) => void;
  leaveRoom: () => void;
  missions: MissionInfo[];
}

/**
 * Why the host cannot start yet, or null: the connected crew must be a size
 * the mission takes and everyone but the host must have confirmed — the
 * server checks the same.
 */
export function startBlocker(view: Pick<PlayerView, 'crewSize' | 'players'>): string | null {
  const crew = view.players.filter((p) => p.connected);
  const missing = view.crewSize.min - crew.length;
  if (missing > 0) {
    return `Noch ${missing} ${missing === 1 ? 'Person' : 'Personen'} nötig`;
  }
  if (crew.length > view.crewSize.max) {
    return 'Zu viele für diese Mission';
  }
  const waiting = crew.filter((p) => !p.isHost && !p.ready);
  return waiting.length === 0 ? null : `Warten auf ${waiting.map((p) => p.name).join(', ')} …`;
}

/**
 * The crew so far, then one open row per seat left; the seats the mission
 * cannot do without say so.
 */
function Seats({ view }: { view: PlayerView }) {
  const { min, max } = view.crewSize;
  const open = Math.max(0, max - view.players.length);
  const needed = min - view.players.filter((p) => p.connected).length;
  return (
    <ul className="seats">
      {view.players.map((p) => {
        const mark = p.connected ? (p.id === view.you.id ? 'seat-you' : '') : 'seat-gone';
        return (
          <li key={p.id} className={`seat ${mark}`}>
            <span className="crew-dot" style={{ background: p.color }} aria-hidden="true" />
            <span className="seat-name">
              {p.isHost ? '★ ' : ''}
              {p.name}
            </span>
            {!p.connected ? (
              <span className="ready-tag">getrennt</span>
            ) : (
              !p.isHost && (
                <span className={`ready-tag ${p.ready ? 'ready-tag-on' : ''}`}>
                  {p.ready ? '✓ bereit' : 'noch nicht bereit'}
                </span>
              )
            )}
          </li>
        );
      })}
      {Array.from({ length: open }, (_, i) => (
        <li key={`open-${i}`} className="seat seat-open">
          <span className="seat-name">{i === 0 ? 'frei — Code oben teilen' : 'frei'}</span>
          {i < needed && <span className="ready-tag ready-tag-need">nötig</span>}
        </li>
      ))}
    </ul>
  );
}

export function LobbyScreen({ view, send, leaveRoom, missions }: Props) {
  const blocker = startBlocker(view);
  const currentLevel = difficultyInfos().find((l) => l.id === view.difficulty);
  const info = missions.find((m) => m.id === view.missionId);

  return (
    <div className="card lobby">
      <div className="lobby-cols">
        <section className="lobby-brief">
          <div className="lobby-head">
            <div>
              <span className="kicker">MISSION</span>
              <h1>{view.missionTitle}</h1>
              <span className="pill lobby-facts">
                ⏱ {Math.round(view.timeLimitSec / 60)} min · 👥 {crewSizeText(view.crewSize)}
                {info !== undefined && ` · 🧩 ${info.puzzleCount} Stationen`}
              </span>
            </div>
            {info !== undefined && info.tiles.length > 0 && (
              <MapThumb tiles={info.tiles} height={96} />
            )}
          </div>
          <p className="story">{view.storyText}</p>

          {view.you.isHost ? (
            <div className="host-controls">
              {missions.length > 1 && (
                <label>
                  Mission wechseln
                  <select
                    value={view.missionId}
                    onChange={(e) => send({ kind: 'switch-mission', missionId: e.target.value })}
                  >
                    {missions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} ({crewSizeText(m.players)})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="difficulty">
                <span className="difficulty-caption">Schwierigkeit</span>
                <div className="difficulty-row">
                  {difficultyInfos().map((level) => (
                    <button
                      key={level.id}
                      className={`difficulty-btn ${
                        view.difficulty === level.id ? 'difficulty-btn-on' : ''
                      }`}
                      title={level.description}
                      onClick={() => send({ kind: 'select-difficulty', difficulty: level.id })}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
                <p className="muted difficulty-desc">
                  {difficultyInfos().find((l) => l.id === view.difficulty)?.description}
                </p>
              </div>
            </div>
          ) : (
            <p className="muted">
              Schwierigkeit: <strong>{currentLevel?.label ?? view.difficulty}</strong> — der Host
              stellt sie ein.
            </p>
          )}
        </section>

        <section className="lobby-crew">
          <div className="lobby-crew-top">
            <div className="lobby-roster">
              <h2>Crew</h2>
              <Seats view={view} />
              <p className="muted lobby-draw">Startplätze werden beim Start verlost.</p>
            </div>
            <div className="lobby-look">
              <h2>Deine Farbe</h2>
              <div className="crew-picker">
                <CrewPreview color={view.you.color} name={view.you.name} />
                <div className="swatches">
                  {view.palette.map((entry) => {
                    const mine = entry.color === view.you.color;
                    const taken = entry.takenByName !== null && !mine;
                    return (
                      <button
                        key={entry.color}
                        className={`swatch ${mine ? 'swatch-mine' : ''}`}
                        style={{ background: entry.color }}
                        disabled={taken}
                        title={entry.takenByName ?? 'frei'}
                        aria-label={`Farbe ${entry.color}${taken ? ' (belegt)' : ''}`}
                        onClick={() => send({ kind: 'select-color', color: entry.color })}
                      >
                        {taken ? '×' : mine ? '✓' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="actions">
            {view.you.isHost ? (
              <button
                className="primary"
                disabled={blocker !== null}
                onClick={() => send({ kind: 'start-mission' })}
              >
                {blocker ?? '▶ Mission starten'}
              </button>
            ) : (
              <>
                <button
                  className={view.you.ready ? '' : 'primary'}
                  onClick={() => send({ kind: 'set-ready', ready: !view.you.ready })}
                >
                  {view.you.ready ? '✓ Bereit — doch nicht?' : 'Ich bin bereit'}
                </button>
                <p className="muted">
                  {view.you.ready
                    ? 'Der Host startet, sobald alle bereit sind.'
                    : 'Lies die Mission in Ruhe — dann melde dich bereit.'}
                </p>
              </>
            )}
            <button className="link" onClick={leaveRoom}>
              Raum verlassen
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

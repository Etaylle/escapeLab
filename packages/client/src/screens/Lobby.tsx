import { difficultyInfos, type ClientMessage, type MissionInfo, type PlayerView } from '@escapelab/core';
import { CrewPreview } from './CrewPreview.js';
import { MapThumb } from './MapThumb.js';

interface Props {
  view: PlayerView;
  send: (msg: ClientMessage) => void;
  leaveRoom: () => void;
  missions: MissionInfo[];
}

export function LobbyScreen({ view, send, leaveRoom, missions }: Props) {
  const { min, max } = view.crewSize;
  const crew = view.players.filter((p) => p.connected).length;
  const crewFits = min <= crew && crew <= max;
  const seatsLeft = max - view.players.length;
  const currentLevel = difficultyInfos().find((l) => l.id === view.difficulty);
  const waiting = view.players.filter((p) => p.connected && !p.isHost && !p.ready);
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
                ⏱ {Math.round(view.timeLimitSec / 60)} min · 👥 {min}–{max} Spieler
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
                        {m.title} ({m.players.min}–{m.players.max} Spieler)
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
          <h2>Deine Figur</h2>
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

          <p className="muted">Startplätze werden beim Start verlost.</p>

          <h2>Im Raum</h2>
          <ul className="players">
            {view.players.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'offline'}>
                <span className="crew-dot" style={{ background: p.color }} aria-hidden="true" />
                {p.isHost ? '★ ' : ''}
                {p.name}
                {p.connected ? '' : ' (getrennt)'}
                {!p.isHost && (
                  <span className={`ready-tag ${p.ready ? 'ready-tag-on' : ''}`}>
                    {p.ready ? '✓ bereit' : 'noch nicht bereit'}
                  </span>
                )}
              </li>
            ))}
            {seatsLeft > 0 && (
              <li className="muted">
                … noch {seatsLeft} {seatsLeft === 1 ? 'Platz' : 'Plätze'} frei — Code oben teilen
              </li>
            )}
          </ul>

          <div className="actions">
            {view.you.isHost ? (
              <button
                className="primary"
                disabled={!crewFits || waiting.length > 0}
                onClick={() => send({ kind: 'start-mission' })}
              >
                {!crewFits
                  ? `Für diese Mission ${min}–${max} Spieler …`
                  : waiting.length > 0
                    ? `Warten auf ${waiting.map((p) => p.name).join(', ')} …`
                    : '▶ Mission starten'}
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

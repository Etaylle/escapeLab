import type { ClientMessage, MissionInfo, PlayerView } from '@escapelab/core';
import { CrewPreview } from './CrewPreview.js';

interface Props {
  view: PlayerView;
  send: (msg: ClientMessage) => void;
  leaveRoom: () => void;
  missions: MissionInfo[];
}

export function LobbyScreen({ view, send, leaveRoom, missions }: Props) {
  const allRolesTaken = view.roles.every((r) => r.takenByName !== null);
  const seatsLeft = view.roles.length - view.players.length;

  return (
    <div className="card lobby">
      <div className="lobby-head">
        <div>
          <span className="kicker">MISSION</span>
          <h1>{view.missionTitle}</h1>
        </div>
        <span className="pill">
          ⏱ {Math.round(view.timeLimitSec / 60)} min · 👥 {view.roles.length} Rollen
        </span>
      </div>
      <p className="story">{view.storyText}</p>

      {view.you.isHost && missions.length > 1 && (
        <div className="mission-switch">
          <label>
            Mission wechseln
            <select
              value={view.missionId}
              onChange={(e) => send({ kind: 'switch-mission', missionId: e.target.value })}
            >
              {missions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ({m.roles.length} Rollen)
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

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

      <h2>Rollen — klick dir deine</h2>
      <div className="roles">
        {view.roles.map((role) => {
          const mine = view.you.roleId === role.id;
          const taken = role.takenByName !== null && !mine;
          return (
            <button
              key={role.id}
              className={`role ${mine ? 'role-mine' : ''}`}
              disabled={taken}
              onClick={() => send({ kind: 'select-role', roleId: role.id })}
            >
              <span className="role-name">{role.name}</span>
              <span className="role-desc">{role.description}</span>
              <span className="role-taken">
                {role.takenByName !== null ? `👤 ${role.takenByName}` : 'frei — klicken zum Wählen'}
              </span>
            </button>
          );
        })}
      </div>

      <h2>Im Raum</h2>
      <ul className="players">
        {view.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'offline'}>
            <span className="crew-dot" style={{ background: p.color }} aria-hidden="true" />
            {p.isHost ? '★ ' : ''}
            {p.name}
            {p.roleName !== null ? ` — ${p.roleName}` : ' — wählt noch …'}
            {p.connected ? '' : ' (getrennt)'}
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
            disabled={!allRolesTaken}
            onClick={() => send({ kind: 'start-mission' })}
          >
            {allRolesTaken ? '▶ Mission starten' : 'Warten, bis alle Rollen besetzt sind …'}
          </button>
        ) : (
          <p className="muted">Der Host startet die Mission, sobald alle bereit sind.</p>
        )}
        <button className="link" onClick={leaveRoom}>
          Raum verlassen
        </button>
      </div>
    </div>
  );
}

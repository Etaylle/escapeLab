import { useState } from 'react';
import type { ManualKind, MapView, PlayerView } from '@escapelab/core';

interface Props {
  view: PlayerView;
  onClose: () => void;
}

type Tab = 'auftrag' | 'karte' | 'steuerung';

const CONTROLS: readonly (readonly [string, string])[] = [
  ['W A S D / Pfeile', 'Laufen'],
  ['E', 'Bedienen, lesen, aufnehmen oder einsetzen'],
  ['Esc', 'Pult, Lesen oder Notizblock verlassen'],
  ['← → beim Lesen', 'Blättern'],
  ['Q', 'Getragenes Objekt ablegen — so sind Übergaben möglich'],
  ['Klick auf die Welt', 'Ping für alle setzen'],
  ['C, dann 1–8', 'Schnellchat'],
  ['N', 'Notizblock — bleibt für diesen Raum gespeichert'],
  ['M', 'Minikarte ein- und ausblenden'],
  ['I oder H', 'Dieses Info-Fenster'],
];

const KIND_NAMES: Record<ManualKind, string> = {
  book: 'Buch',
  terminal: 'Terminal',
  chart: 'Wandtafel',
  clipboard: 'Klemmbrett',
  locker: 'Spind',
  cabinet: 'Aktenschrank',
};

/** What the things in the lab are for, one line each; only what this map has. */
export function Legend({ map }: { map: MapView }) {
  const kinds = [...new Set(map.manuals.map((m) => KIND_NAMES[m.kind]))];
  const rows: [string, string, string][] = [];
  if (kinds.length > 0) {
    rows.push(['📖', kinds.join(' · '), 'Regeln der Stationen']);
  }
  if (map.edgeworkSign !== null) {
    rows.push(['🪧', 'Schild', 'Laborkennung']);
  }
  if (map.plates.some((p) => p.freezesDrone)) {
    rows.push(['📷', 'Kamera-Platte', 'hält die Drohne an']);
  }
  if (map.plates.some((p) => !p.freezesDrone)) {
    rows.push(['◉', 'HALTEN-Platte', 'hält eine Tür offen']);
  }
  return (
    <dl className="legend">
      {rows.map(([glyph, what, meaning]) => (
        <div key={what} className="legend-row">
          <dt>
            <span aria-hidden="true">{glyph}</span> {what}
          </dt>
          <dd>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Everything worth reading but not worth watching: briefing, what the
 * things on the map are for and the controls. Kept out of the permanent HUD
 * on purpose — that one only shows what changes.
 */
export function InfoPanel({ view, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('auftrag');
  const armed = view.map?.stations.find((s) => s.status === 'armed');
  const pending = view.map?.items.filter((i) => !i.delivered) ?? [];
  const escaping = view.map?.exit?.open === true;

  return (
    <div className="overlay info" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card info-card" onClick={(e) => e.stopPropagation()}>
        <div className="info-head">
          <div>
            <span className="kicker">{view.missionTitle}</span>
            <h2>Einsatzinfo</h2>
          </div>
          <button className="link" onClick={onClose}>
            Schließen [Esc]
          </button>
        </div>

        <div className="info-tabs" role="tablist">
          {(
            [
              ['auftrag', 'Auftrag'],
              ['karte', 'Karte'],
              ['steuerung', 'Steuerung'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'info-tab info-tab-on' : 'info-tab'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'auftrag' && (
          <div className="info-body">
            <p className="story">{view.storyText}</p>
            <dl className="info-facts">
              <div>
                <dt>Jetzt dran</dt>
                <dd>
                  {escaping
                    ? 'Notausgang — alle gemeinsam hin'
                    : (view.puzzle?.title ?? armed?.title ?? '—')}
                </dd>
              </div>
              <div>
                <dt>Fortschritt</dt>
                <dd>
                  {view.currentPuzzleIndex} von {view.puzzleCount} Stationen erledigt
                </dd>
              </div>
              {pending.length > 0 && (
                <div>
                  <dt>Noch zu bringen</dt>
                  <dd>{pending.map((i) => i.label).join(', ')}</dd>
                </div>
              )}
              <div>
                <dt>Schwierigkeit</dt>
                <dd>{view.difficulty}</dd>
              </div>
            </dl>
            <p className="muted">
              Neben den Regeln der offenen Station hat die letzte Crew Notizen hinterlassen: Wer
              dort liest, kann sie nach kurzer Wartezeit erbitten. Jede kostet Zeit — und schon
              eine kostet den Rang S.
            </p>
          </div>
        )}

        {tab === 'karte' && (
          <div className="info-body">{view.map !== null && <Legend map={view.map} />}</div>
        )}

        {tab === 'steuerung' && (
          <div className="info-body">
            <dl className="keylist">
              {CONTROLS.map(([keys, what]) => (
                <div key={keys} className="keyrow">
                  <dt>{keys}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              Im Dunkeln siehst du nur deinen Lichtkegel. Pfeile am Bildrand zeigen, wo das
              nächste Ziel liegt.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

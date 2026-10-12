import { useState } from 'react';
import type { PlayerView } from '@escapelab/core';

interface Props {
  view: PlayerView;
  onClose: () => void;
}

type Tab = 'auftrag' | 'rolle' | 'steuerung';

const CONTROLS: readonly (readonly [string, string])[] = [
  ['W A S D / Pfeile', 'Laufen'],
  ['E', 'Station aktivieren, Objekt aufnehmen oder einsetzen'],
  ['Q', 'Getragenes Objekt ablegen — so sind Übergaben möglich'],
  ['Klick auf die Welt', 'Ping für alle setzen'],
  ['C, dann 1–8', 'Schnellchat'],
  ['M', 'Minikarte ein- und ausblenden'],
  ['I oder H', 'Dieses Info-Fenster'],
];

/**
 * Everything worth reading but not worth watching: briefing, your own role
 * and the controls. Kept out of the permanent HUD on purpose — that one only
 * shows what changes.
 */
export function InfoPanel({ view, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('auftrag');
  const role = view.roles.find((r) => r.id === view.you.roleId);
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
              ['rolle', 'Deine Rolle'],
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
              Hat die Leitstelle Hinweise für eine Station, gibt es sie dort nach kurzer Wartezeit
              auf Anfrage. Jeder kostet Zeit — und schon einer kostet den Rang S.
            </p>
          </div>
        )}

        {tab === 'rolle' && (
          <div className="info-body">
            <h3 className="info-role">{role?.name ?? '—'}</h3>
            <p className="story">{role?.description ?? ''}</p>
            <p className="muted">
              Niemand sieht genug, um eine Station allein zu lösen — sag laut, was du siehst.
            </p>
          </div>
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

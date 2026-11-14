import { useState } from 'react';
import type { ManualKind, MapView, PlayerView } from '@escapelab/core';
import { useInputDevice } from '../input/device.js';
import { glyphOf, useGlyph, type GlyphSource, type Prompt } from '../input/glyphs.js';
import { PAD_GLYPHS, PAD_PING } from '../input/pad.js';
import { useSettings } from '../settings.js';
import { isArmed } from '../world/known.js';
import { toBring } from '../world/markers.js';
import { Icon, type IconName } from './Icon.js';

interface Props {
  view: PlayerView;
  onClose: () => void;
}

type Tab = 'auftrag' | 'karte' | 'steuerung';

/**
 * The ping and the quick chat: by the mouse and the digits on keys — a phrase with a slot,
 * „Kabel …", filled by a second digit; on a controller the D-pad's ◀ pings where the lamp
 * points, its ▶ opens the chat to pick a phrase from with the D-pad, and a slot's value too.
 */
function signalRows(
  source: GlyphSource,
  g: (prompt: Prompt) => string,
): (readonly [string, string])[] {
  if (source.device !== 'pad') {
    return [
      ['Klick auf die Welt', 'Ping für alle setzen'],
      [`${g('chat')}, dann 1–8, bei „…" noch 1–9`, 'Schnellchat'],
    ];
  }
  return [
    [PAD_GLYPHS[source.family][PAD_PING], 'Ping für alle setzen, wohin die Lampe zeigt'],
    [`${g('chat')}, dann Steuerkreuz und ${g('interact')}`, 'Schnellchat'],
  ];
}

/**
 * The controls and what they do, by the keys as the settings bind them — or by the
 * controller's buttons where one was used last (`source.device`).
 */
export function controlsOf(source: GlyphSource): (readonly [string, string])[] {
  const g = (prompt: Prompt): string => glyphOf(prompt, source);
  const pad = source.device === 'pad';
  const walk = `${g('up')} ${g('left')} ${g('down')} ${g('right')}`;
  const putDown = pad ? g('putDown') : `${g('putDown')} oder ein Schritt`;
  const panels: (readonly [string, string])[] = pad
    ? [[`Steuerkreuz, dann ${g('interact')}`, 'In Pulten und Fenstern wählen und drücken']]
    : [];
  return [
    [pad ? 'Stick' : `${walk} / Pfeile`, 'Laufen'],
    [`${g('sprint')} halten`, 'Sprinten — auf dem Touchscreen „Sprint" neben dem Steuerkreuz'],
    [g('interact'), 'Bedienen, lesen, durchsuchen, aufschließen, aufnehmen oder einsetzen'],
    [`${putDown} beim Lesen`, 'Weglegen, ein Buch zuklappen'],
    [g('close'), 'Zurücktreten, weglegen, Notizblock einstecken'],
    [`${g('pageBack')} ${g('pageOn')} beim Lesen`, 'Blättern'],
    [g('drop'), 'Getragenes Objekt ablegen — so sind Übergaben möglich'],
    ...signalRows(source, g),
    [
      `${g('talk')} halten`,
      'Sprechen — das Mikrofon wird in der Lobby aktiviert. Am Terminal: Funk per Maus/Pad',
    ],
    [g('notes'), 'Notizblock — auch neben Buch und Pult, bleibt für diesen Raum gespeichert'],
    [g('minimap'), 'Minikarte ein- und ausblenden'],
    [g('info'), 'Dieses Info-Fenster'],
    ...panels,
    [
      pad ? g('menu') : `${g('menu')} oder ⚙ in der Kopfleiste`,
      'Menü: Einstellungen, Handbuch — die Uhr läuft weiter',
    ],
  ];
}

const KIND_NAMES: Record<ManualKind, string> = {
  book: 'Buch',
  terminal: 'Terminal',
  chart: 'Wandtafel',
  clipboard: 'Klemmbrett',
  locker: 'Spind',
  cabinet: 'Aktenschrank',
};

/** What the things in the lab are for, one line each; only what the crew has come across. */
export function Legend({ map }: { map: MapView }) {
  const known = map.manuals.filter((m) => m.known);
  const kinds = [...new Set(known.map((m) => KIND_NAMES[m.kind]))];
  const rows: [IconName, string, string][] = [];
  if (kinds.length > 0) {
    rows.push(['book', kinds.join(' · '), 'Regeln der Stationen']);
  }
  if (map.edgeworkSign?.known === true) {
    rows.push(['sign', 'Schild', 'Laborkennung']);
  }
  if (map.plates.some((p) => p.freezesDrone)) {
    rows.push(['camera', 'Kamera-Platte', 'hält die Drohne an']);
  }
  if (map.plates.some((p) => !p.freezesDrone)) {
    rows.push(['plate', 'HALTEN-Platte', 'hält eine Tür offen']);
  }
  return (
    <dl className="legend">
      {rows.map(([icon, what, meaning]) => (
        <div key={what} className="legend-row">
          <dt>
            <Icon name={icon} /> {what}
          </dt>
          <dd>{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The keys and what they do, as the settings bind them — a controller's buttons on one. */
function KeyList() {
  const { keys, pad } = useSettings();
  const device = useInputDevice();
  return (
    <div className="info-body">
      <dl className="keylist">
        {/* A row goes by what it does: on a controller two rows can share a button (B). */}
        {controlsOf({ keys, pad, ...device }).map(([control, what]) => (
          <div key={what} className="keyrow">
            <dt>{control}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Im Dunkeln reicht die Sicht nur so weit wie der eigene Lichtkegel. Pfeile am Bildrand
        zeigen, wo das nächste Ziel liegt.
      </p>
    </div>
  );
}

/**
 * Everything worth reading but not worth watching: briefing, what the
 * things on the map are for and the controls. Kept out of the permanent HUD
 * on purpose — that one only shows what changes.
 */
export function InfoPanel({ view, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('auftrag');
  const closeKey = useGlyph('close');
  const armed = view.map?.stations.find(isArmed);
  const pending = view.map === null ? [] : toBring(view.map);
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
            Schließen [{closeKey}]
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
              {view.alarms.limit !== null && (
                <div>
                  <dt>Alarme</dt>
                  <dd>{`höchstens ${view.alarms.limit}`}</dd>
                </div>
              )}
            </dl>
            <p className="muted">
              Neben den Regeln der offenen Station liegen Notizen der letzten Schicht; dort
              lassen sie sich nach kurzer Wartezeit erbitten. Jede kostet Zeit — und schon eine
              kostet den Rang S.
            </p>
          </div>
        )}

        {tab === 'karte' && (
          <div className="info-body">{view.map !== null && <Legend map={view.map} />}</div>
        )}

        {tab === 'steuerung' && <KeyList />}
      </div>
    </div>
  );
}

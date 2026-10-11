import { useEffect, useState } from 'react';
import type { MissionInfo, MissionManual, MissionManualStation } from '@escapelab/core';
import { Manual } from './Manual.js';

interface Props {
  missions: MissionInfo[];
  missionId: string;
  selectMission: (missionId: string) => void;
  back: () => void;
}

type Loaded =
  | { status: 'loading' }
  | { status: 'failed'; reason: string }
  | { status: 'ready'; manual: MissionManual };

/** Edgework is rolled for every run, so the booklet explains it instead of printing it. */
const EDGEWORK_NOTE =
  'Laborkennung, Kontrollleuchten und Notstromzellen wechseln mit jedem Einsatz und stehen ' +
  'deshalb nicht in diesem Handbuch. Die Laborkennung besteht aus fünf Zeichen, einem ' +
  'Bindestrich und einer Ziffer, etwa K7G3A-2. Die drei Kontrollleuchten tragen Kürzel wie FRQ ' +
  'oder SIG und sind an oder aus. Notstromzellen sind null bis vier eingesetzt. Wer die Station ' +
  'bedient, sieht alle drei Angaben und liest sie vor, sobald eine Regel danach fragt.';

async function fetchManual(missionId: string): Promise<MissionManual> {
  const res = await fetch(`/missions/${encodeURIComponent(missionId)}/manual`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as MissionManual;
}

/**
 * The printable Handbuch: pick a mission, read every station's rules in
 * order, print them for whoever holds the manual. Paper gets the booklet
 * only — see the print rules in ui.css.
 */
export function HandbookScreen({ missions, missionId, selectMission, back }: Props) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });

  useEffect(() => {
    // An answer for a mission that is no longer picked must not land.
    let current = true;
    setLoaded({ status: 'loading' });
    fetchManual(missionId)
      .then((manual) => {
        if (current) {
          setLoaded({ status: 'ready', manual });
        }
      })
      .catch((err: unknown) => {
        if (current) {
          setLoaded({ status: 'failed', reason: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      current = false;
    };
  }, [missionId]);

  return (
    <div className="card handbook">
      <button className="link handbook-back" onClick={back}>
        ← Zurück
      </button>
      <div className="handbook-bar">
        <label>
          Mission
          <select value={missionId} onChange={(e) => selectMission(e.target.value)}>
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary handbook-print"
          disabled={loaded.status !== 'ready'}
          onClick={() => window.print()}
        >
          🖨 Drucken
        </button>
      </div>
      {loaded.status === 'loading' && <p className="muted">Lade Handbuch …</p>}
      {loaded.status === 'failed' && (
        <p className="warn" role="alert">
          Das Handbuch ließ sich nicht laden ({loaded.reason}).
        </p>
      )}
      {loaded.status === 'ready' && <Handbook manual={loaded.manual} />}
    </div>
  );
}

/** The booklet itself: a title page, then one chapter per station. */
export function Handbook({ manual }: { manual: MissionManual }) {
  const holders = [
    ...new Set(
      manual.stations.flatMap((s) => (s.manualRoleName === null ? [] : [s.manualRoleName])),
    ),
  ];
  return (
    <article className="handbook-book">
      <header className="handbook-cover">
        <span className="kicker">NOTFALL-HANDBUCH</span>
        <h1>{manual.missionTitle}</h1>
        <dl className="info-facts">
          <div>
            <dt>Ausgegeben an</dt>
            <dd>{holders.length > 0 ? holders.join(', ') : 'alle Rollen'}</dd>
          </div>
          <div>
            <dt>Hinweise</dt>
            <dd>{`je ${manual.hintCostSec} s Missionszeit (bei Schwierigkeit Normal)`}</dd>
          </div>
        </dl>
        {manual.stations.some((s) => s.usesEdgework) && (
          <p className="info-box handbook-edgework">{EDGEWORK_NOTE}</p>
        )}
      </header>
      {manual.stations.map((station) => (
        <Chapter key={station.index} station={station} />
      ))}
    </article>
  );
}

function Chapter({ station }: { station: MissionManualStation }) {
  const crew =
    station.manualRoleName === null
      ? `Bedient von: ${station.operatorRoleName}`
      : `Bedient von: ${station.operatorRoleName} · Handbuch bei: ${station.manualRoleName}`;
  return (
    <section className="handbook-chapter">
      <h2>{`§${station.index + 1} — ${station.title}`}</h2>
      <p className="handbook-crew">{crew}</p>
      <Manual sections={station.manual} />
    </section>
  );
}

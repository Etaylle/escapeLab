import { useEffect, useRef, useState } from 'react';
import type { Session } from './session.js';
import type { Rules, Scores } from './scores.js';
import { DIFFICULTY_LABELS } from './texts.js';
import type { Difficulty } from './rules.js';

/**
 * The machine's Info (the reference's Info menu): how to play, the field guide, the sound and
 * the touch, the bests. Opening it pauses a running game; Esc, I or „Schließen" returns.
 */

type Tab = 'how' | 'guide' | 'sound' | 'bests';
const TABS: readonly (readonly [Tab, string])[] = [
  ['how', 'Spielanleitung'],
  ['guide', 'Feldführer'],
  ['sound', 'Ton & Touch'],
  ['bests', 'Rekorde'],
];

function Keys({ keys, what }: { keys: readonly string[]; what: string }) {
  return (
    <div className="arcade-keys">
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
      <span>{what}</span>
    </div>
  );
}

function HowToPlay() {
  return (
    <>
      <span className="arcade-kicker">EINGEHENDE ÜBERTRAGUNG</span>
      <h3>
        Der Schwarm kam. Er quakte. <em>Das Frettchen ist dran.</em>
      </h3>
      <p>Der Schwarm greift an. Den Bau verteidigen: klein bleiben, gerade schießen.</p>
      <p>Den Schwarm lichten, bevor er die Verteidigungslinie erreicht. Die Deckungen halten nicht ewig.</p>
      <Keys keys={['←', '→']} what="oder A / D: laufen" />
      <Keys keys={['LEERTASTE']} what="halten: feuern" />
      <Keys keys={['P']} what="Pause" />
      <Keys keys={['ENTER']} what="Start · Bereit · Nochmal" />
      <Keys keys={['I']} what="diese Info" />
      <Keys keys={['ESC']} what="Pause; ohne laufendes Spiel zurück zur Spielauswahl" />
      <p>Touch: auf dem Feld ziehen zum Laufen, oder ◀ ▶; FEUER oder Dauerfeuer schießt.</p>
      <p>Zwei Spieler wechseln sich nach jedem verlorenen Leben ab.</p>
    </>
  );
}

function Row({ icon, name, points, tone = '' }: { icon: string; name: string; points?: string; tone?: string }) {
  return (
    <div className="arcade-guide-row">
      <span className={`arcade-icon ${tone}`.trim()}>{icon}</span>
      <span>{name}</span>
      {points !== undefined && <b>{points}</b>}
    </div>
  );
}

function FieldGuide() {
  return (
    <>
      <Row icon="⌐■▰■" name="Der Coole" points="30 PKT" tone="purple" />
      <Row icon="◕ ▰" name="Die Quak-Bande" points="20 PKT" tone="green" />
      <Row icon="◕ ▰" name="Die Neulinge" points="10 PKT" tone="yellow" />
      <Row icon="⌁" name="Geheimnisvoller Besucher" points="50–300" />
      <p className="arcade-guide-note">AB WELLE 2 · MODERN</p>
      <Row icon="↘◕" name="Sturzflieger" points="×2 IM STURZ" tone="yellow" />
      <Row icon="▀◕" name="Enten mit Helm" points="2 TREFFER" tone="green" />
      <Row icon="◆◕" name="The Great Drake" points="500+ BOSS" />
      <Row icon="⋎ ○ ⧗" name="Der Besucher lässt Streuschuss, Schild und Zeitlupe fallen" tone="orange" />
      <Row icon="×4" name="Treffer in Folge heben den Multiplikator; ein Fehlschuss setzt ihn zurück" tone="orange" />
      <p>
        3 Leben. 4 Deckungen. Endlose Wellen.
        <br />
        Ein Extraleben bei 1.500 Punkten.
      </p>
    </>
  );
}

function Slider({ s, name, label }: { s: Session; name: 'music' | 'effects'; label: string }) {
  const [value, setValue] = useState(Math.round(s.settings.values[name] * 100));
  return (
    <label className="arcade-slider">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          setValue(next);
          s.audio.setVolume(name, next / 100);
          s.settings.set(name, next / 100);
        }}
      />
    </label>
  );
}

function SoundAndTouch({ s }: { s: Session }) {
  const [autofire, setAutofire] = useState(s.settings.values.autofire);
  return (
    <>
      <Slider s={s} name="music" label="Musik" />
      <Slider s={s} name="effects" label="Effekte" />
      <label className="arcade-check">
        <input
          type="checkbox"
          checked={autofire}
          onChange={(e) => {
            setAutofire(e.target.checked);
            s.settings.set('autofire', e.target.checked);
          }}
        />
        <span>Dauerfeuer im Touch-Modus</span>
      </label>
      <p>Die Lautstärken des Labors und sein Tonschalter gelten auch hier.</p>
    </>
  );
}

const table = (scores: Scores): string =>
  (Object.keys(scores.values) as Difficulty[])
    .map((k) => `${DIFFICULTY_LABELS[k].toUpperCase()} ${scores.values[k]}`)
    .join(' · ');

function Bests({ books }: { books: Readonly<Record<Rules, Scores>> }) {
  return (
    <>
      <div className="arcade-records">
        MODERN <span>{table(books.modern)}</span>
      </div>
      <div className="arcade-records">
        KLASSISCH <span>{table(books.classic)}</span>
      </div>
      <p>Rekorde je Schwierigkeit, in diesem Browser gespeichert.</p>
    </>
  );
}

export function InfoPanel({ s }: { s: Session }) {
  const [tab, setTab] = useState<Tab>('how');
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);
  return (
    <div className="arcade-info" role="dialog" aria-modal="true" aria-labelledby="arcade-info-title">
      <div className="arcade-info-card">
        <div className="arcade-info-head">
          <h2 id="arcade-info-title">Info</h2>
          <button onClick={() => s.closeInfo()} aria-label="Info schließen (Esc)">
            ✕ Schließen
          </button>
        </div>
        <div className="arcade-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              ref={id === tab ? first : undefined}
              role="tab"
              aria-selected={id === tab}
              data-tab={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <section role="tabpanel" className="arcade-panel">
          {tab === 'how' && <HowToPlay />}
          {tab === 'guide' && <FieldGuide />}
          {tab === 'sound' && <SoundAndTouch s={s} />}
          {tab === 'bests' && <Bests books={s.books} />}
        </section>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { FlushPlay } from './play.js';
import { GAMES, score } from './hud.js';

/**
 * Ferret Flush's Info on the machine (the reference's Info menu, in German): how it is played,
 * the three games, the points, the field guide, sound and touch, the bests. Opening it pauses a
 * game in play; Esc, I or „Schließen" return.
 */

type Tab = 'play' | 'games' | 'scoring' | 'birds' | 'settings' | 'bests';
const TABS: readonly (readonly [Tab, string])[] = [
  ['play', 'Spielanleitung'],
  ['games', 'Die Spiele'],
  ['scoring', 'Punkte'],
  ['birds', 'Feldführer'],
  ['settings', 'Ton & Touch'],
  ['bests', 'Rekorde'],
];

function Rows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <table>
      <tbody>
        {rows.map(([name, what]) => (
          <tr key={name}>
            <td>{name}</td>
            <td>{what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const KEYS: readonly (readonly [string, string])[] = [
  ['1 · 2 · 3', 'Eine Ente, Zwei Enten, Tontauben'],
  ['ENTER · LEERTASTE', 'das zuletzt gespielte Spiel noch einmal'],
  ['P · Esc', 'Pause; Q in der Pause: zurück zur Spielauswahl'],
  ['I', 'diese Info: hält das Spiel an; Esc, I oder Schließen führen zurück'],
  ['M', 'Ton an und aus'],
];

function HowToPlay() {
  return (
    <>
      <p>
        Das Frettchen scheucht Enten aus dem Schilf. Gezielt wird mit der Maus, geschossen mit einem
        Klick; auf Handy und Tablet zählt ein Tippen dorthin, wohin der Schuss soll. Jedes Aufscheuchen
        bringt drei Patronen, und eine Patrone holt ein Ziel herunter.
      </p>
      <p>
        Eine Runde hat zehn Ziele. Unter der Marke, der gestrichelten Linie in der Zielreihe, ist das
        Spiel vorbei. Die dünne Linie unter der Reihe zeigt, wie lange die Enten bleiben.
      </p>
      <Rows rows={KEYS} />
      <p className="flush-note">
        Ein Wechsel in ein anderes Fenster hält das Spiel an. Vor jedem Spiel gilt Modern oder
        Klassisch: Klassisch spielt genau wie das Original, Modern legt ab Runde zwei die Schichten
        unter „Punkte" darüber.
      </p>
    </>
  );
}

function TheGames() {
  return (
    <>
      <h3>Eine Ente</h3>
      <p>Eine Ente je Aufscheuchen, drei Patronen. Das Frettchen bringt, was herunterkommt.</p>
      <h3>Zwei Enten</h3>
      <p>Zwei Enten je Aufscheuchen, die auseinanderfliegen, und trotzdem drei Patronen, mit etwas mehr Zeit.</p>
      <h3>Tontauben</h3>
      <p>
        Zwei Scheiben je Zug aus einer Wurfmaschine, die zweite einen Augenblick nach der ersten und in die
        andere Richtung. Die Scheiben fliegen davon: werden langsamer, kleiner und schwerer zu treffen.
      </p>
      <p className="flush-note">
        Jede Runde ist schneller, bis Runde 23. Die Marke liegt bei 6 von 10 in den Runden 1 bis 5, dann
        alle fünf Runden eine mehr, 10 von 10 ab Runde 21. Die Tageszeit dreht sich mit jeder Runde,
        vom Morgengrauen bis ins Mondlicht.
      </p>
    </>
  );
}

const POINTS: readonly (readonly [string, string])[] = [
  ['Stockente', '100'],
  ['Spießente', '150'],
  ['Schwarzkopf-Ruderente', '250'],
  ['Tontaube', '100'],
  ['Perfekte Runde, 10 von 10', '1000'],
];
const MODERN_ROWS: readonly (readonly [string, string])[] = [
  ['Serie', 'doppelte Punkte ab dem 4. Treffer in Folge, dreifache ab dem 8.; ein Fehlschuss oder ein entkommenes Ziel beendet sie'],
  ['Goldener Vogel', 'höchstens einer je Runde, selten und schnell: zehnfache Punkte'],
  ['Sicherer Schuss', 'eine geschaffte Runde, in der jede Patrone traf: 500'],
  ['Lockenten', 'nach den Runden 2, 4, 6 und so fort: zwölf Lockenten und Patronen ohne Ende, je 50, 500 für alle'],
  ['Ab Runde drei', 'Wind, der die Vögel trägt, und Enten, die Haken schlagen oder in Schüben fliegen; eine ferne Scheibe behält einen Trefferkreis von mindestens 32 Einheiten (Klassisch: 18)'],
];

function Scoring() {
  return (
    <>
      <h3>Beide Regelwerke</h3>
      <Rows rows={POINTS} />
      <p className="flush-note">Die Punkte verdoppeln sich ab Runde 6, verdreifachen sich ab 11, vervierfachen sich ab 16.</p>
      <h3>Nur Modern, ab Runde zwei</h3>
      <p>Runde eins spielt genau wie Klassisch. Dann:</p>
      <Rows rows={MODERN_ROWS} />
      <p className="flush-note">
        Die Boni wachsen mit der Runde wie die Punkte. Moderne Rekorde stehen getrennt von den klassischen.
      </p>
    </>
  );
}

const BIRDS: readonly (readonly [string, string])[] = [
  ['Stockente', 'eine eingerollte Feder am kurzen Schwanz und ein Ring um den Hals'],
  ['Spießente', 'ein langer spitzer Schwanz und ein schlanker weißer Hals'],
  ['Schwarzkopf-Ruderente', 'ein steifer Fächerschwanz nach oben, eine dunkle Kappe, eine helle Wange; die schnellste'],
  ['Goldener Vogel', 'Modern: eine Haube, zwei lange Bänder, eine Spur aus Funken'],
  ['Tontaube', 'eine flache Scheibe; eine goldene (Modern) trägt einen Ring'],
  ['Lockente', 'Modern: eine Holzente auf einem Pflock, mit einer Zielscheibe an der Seite, am Seil'],
];

function FieldGuide() {
  return (
    <>
      <p>Jeder Vogel hat seine eigene Form: Die Vögel unterscheiden sich auch ohne Farben.</p>
      <Rows rows={BIRDS} />
    </>
  );
}

function Slider({ play, name, label }: { play: FlushPlay; name: 'music' | 'effects'; label: string }) {
  const [value, setValue] = useState(Math.round(play.settings[name] * 100));
  return (
    <label className="arcade-slider">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => {
          setValue(Number(e.target.value));
          play.setVolume(name, Number(e.target.value) / 100);
        }}
      />
    </label>
  );
}

function SoundAndTouch({ play }: { play: FlushPlay }) {
  const [aim, setAim] = useState(play.settings.touchAim);
  const calm = play.fx.calm;
  return (
    <>
      <label className="arcade-check">
        <input type="checkbox" checked={!play.audio.muted} onChange={() => play.toggleSound()} />
        <span>Ton an (M)</span>
      </label>
      <Slider play={play} name="music" label="Musik" />
      <p className="flush-note">Die Melodie spielt nur in modernen Spielen.</p>
      <Slider play={play} name="effects" label="Effekte" />
      <label className="arcade-check">
        <input
          type="checkbox"
          checked={aim}
          onChange={(e) => {
            setAim(e.target.checked);
            play.setTouchAim(e.target.checked);
          }}
        />
        <span>Zielhilfe beim Tippen</span>
      </label>
      <p className="flush-note">
        In modernen Spielen reicht ein Tippen 14 Einheiten weiter bei einer Ente und 10 bei einer Scheibe,
        weil ein Finger verdeckt, worauf er zielt. Der Trefferkreis einer Ente misst 50 Einheiten auf einem
        Feld von 1280. Mausklicks und jeder Schuss in Klassisch behalten die Kreise des Originals.
      </p>
      <p className="flush-note">
        Weniger Bewegung, wie in den Einstellungen des Labors gewählt, ist{' '}
        {calm ? 'an: kein Wackeln, kein Anhalten bei Treffern.' : 'aus: sanftes Wackeln und Anhalten bei Treffern.'}
      </p>
    </>
  );
}

function Bests({ play }: { play: FlushPlay }) {
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Spiel</th>
            <th>Klassisch</th>
            <th>Modern</th>
          </tr>
        </thead>
        <tbody>
          {GAMES.map((entry) => (
            <tr key={entry.mode}>
              <td>{entry.title}</td>
              <td>{score(play.bests.classic[entry.mode])}</td>
              <td>{score(play.bests.modern[entry.mode])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="flush-note">Nur in diesem Browser gespeichert.</p>
    </>
  );
}

function Page({ tab, play }: { tab: Tab; play: FlushPlay }) {
  switch (tab) {
    case 'play':
      return <HowToPlay />;
    case 'games':
      return <TheGames />;
    case 'scoring':
      return <Scoring />;
    case 'birds':
      return <FieldGuide />;
    case 'settings':
      return <SoundAndTouch play={play} />;
    case 'bests':
      return <Bests play={play} />;
  }
}

export function FlushInfo({ play }: { play: FlushPlay }) {
  const [tab, setTab] = useState<Tab>('play');
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus({ preventScroll: true }), []);
  return (
    <div className="arcade-info" role="dialog" aria-modal="true" aria-labelledby="flush-info-title">
      <div className="arcade-info-card">
        <div className="arcade-info-head">
          <h2 id="flush-info-title">Info</h2>
          <button onClick={() => play.hideInfo()} aria-label="Info schließen (Esc)">
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
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <section role="tabpanel" className="arcade-panel flush-panel">
          <Page tab={tab} play={play} />
        </section>
      </div>
    </div>
  );
}

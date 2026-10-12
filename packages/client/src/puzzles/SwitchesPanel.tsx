import { play } from '../sounds.js';
import type { PanelProps } from './index.js';
import './switches.css';

type Switch = NonNullable<PanelProps<'switches'>['puzzle']['switches']>[number];

function markingWord(sw: Switch): string {
  if (sw.red && sw.blue) {
    return 'beides';
  }
  if (sw.red) {
    return 'rot';
  }
  return sw.blue ? 'blau' : 'keine';
}

/** The features in the manual's words, so nobody has to tell colours apart to read them out. */
function featureWords(sw: Switch, stars: boolean): string[] {
  const words = [sw.led ? 'LED an' : 'LED aus', markingWord(sw)];
  return stars ? [...words, sw.star ? 'Stern' : 'kein Stern'] : words;
}

interface SwitchItemProps {
  sw: Switch;
  number: number;
  /** a bank of three features: the star gets its row and its word */
  stars: boolean;
  onToggle: () => void;
}

function SwitchItem({ sw, number, stars, onToggle }: SwitchItemProps) {
  const words = featureWords(sw, stars);
  const position = sw.up ? 'OBEN' : 'unten';
  return (
    <button
      className={`switches-item ${sw.up ? 'switches-up' : ''}`}
      aria-pressed={sw.up}
      aria-label={`Schalter ${number}: ${words.join(', ')}; steht ${position}`}
      onClick={onToggle}
    >
      <span className="switches-num">{number}</span>
      <span className={`switches-led ${sw.led ? 'on' : ''}`} />
      <span className="switches-bands">
        {sw.red && <span className="switches-band red" />}
        {sw.blue && <span className="switches-band blue" />}
      </span>
      {stars && <span className="switches-star">{sw.star ? '★' : ''}</span>}
      <span className="switches-lever">
        <span className="switches-knob" />
      </span>
      <span className="switches-pos">{position}</span>
      <span className="switches-words">
        {words.map((word) => (
          <span key={word}>{word}</span>
        ))}
      </span>
    </button>
  );
}

export function SwitchesPanel({ puzzle, send }: PanelProps<'switches'>) {
  const failed = puzzle.attempts > 0 && (
    <span className="warn">Fehlversuche: {puzzle.attempts}</span>
  );
  if (puzzle.switches === null) {
    return <div>{failed}</div>;
  }
  const upCount = puzzle.switches.filter((sw) => sw.up).length;
  const stars = puzzle.features === 3;
  return (
    <div>
      <p className="muted switches-intro">
        Jeden Schalter ansagen: LED, Markierung{stars && ', Stern'}. Bei Ansage umlegen —
        gefahrlos, erst PRÜFEN zählt.
      </p>
      <div className="switches-bank" role="group" aria-label="Schalterbank">
        {puzzle.switches.map((sw, i) => (
          <SwitchItem
            key={i}
            sw={sw}
            number={i + 1}
            stars={stars}
            onToggle={() => {
              play('click');
              send({ switchIndex: i });
            }}
          />
        ))}
      </div>
      <div className="switches-foot">
        <span className="muted">{upCount} von 6 oben</span>
        {failed}
        <button className="primary" onClick={() => send({ check: true })}>
          ⏻ PRÜFEN
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import type { Choice, Controls, Session } from './session.js';
import type { Difficulty } from './rules.js';
import type { Rules } from './scores.js';
import { DIFFICULTY_COPY, DIFFICULTY_LABELS, RULES_COPY, RULES_LABELS } from './texts.js';

/**
 * The machine's own menu beside its attract screen (the reference's setup): the difficulty, one
 * or two players, keys or touch, Modern or Klassisch, and the start; the Info and the way back.
 */

function Segments<T extends string | number>({
  legend,
  options,
  value,
  pick,
}: {
  legend: string;
  options: readonly (readonly [T, string])[];
  value: T;
  pick: (value: T) => void;
}) {
  return (
    <fieldset className="arcade-segments">
      <legend>{legend}</legend>
      <div>
        {options.map(([id, label]) => (
          <button key={String(id)} aria-pressed={id === value} onClick={() => pick(id)}>
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const DIFFICULTIES: readonly (readonly [Difficulty, string])[] = (['Easy', 'Normal', 'Hard'] as const).map(
  (d) => [d, DIFFICULTY_LABELS[d]] as const,
);
const PLAYERS: readonly (readonly [1 | 2, string])[] = [
  [1, '1 Spieler'],
  [2, '2 Spieler'],
];
const CONTROLS: readonly (readonly [Controls, string])[] = [
  ['keyboard', '⌨ Tastatur'],
  ['touch', '✥ Touch'],
];
const RULES: readonly (readonly [Rules, string])[] = (['modern', 'classic'] as const).map(
  (r) => [r, RULES_LABELS[r]] as const,
);

export function MachineMenu({ s, onLeave }: { s: Session; onLeave: () => void }) {
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => start.current?.focus({ preventScroll: true }), []);
  const choose = (part: Partial<Choice>): void => {
    s.choice = { ...s.choice, ...part };
    s.changed();
  };
  const { difficulty, players, controls } = s.choice;
  const rules = s.settings.values.rules;
  return (
    <section className="arcade-menu" aria-label="Automatenmenü">
      <span className="arcade-kicker">MÜNZE EINWERFEN</span>
      <Segments legend="Schwierigkeit" options={DIFFICULTIES} value={difficulty} pick={(d) => choose({ difficulty: d })} />
      <p className="arcade-copy">{DIFFICULTY_COPY[difficulty]}</p>
      <Segments legend="Spieler" options={PLAYERS} value={players} pick={(n) => choose({ players: n })} />
      <Segments legend="Steuerung" options={CONTROLS} value={controls} pick={(c) => choose({ controls: c })} />
      <Segments legend="Regeln" options={RULES} value={rules} pick={(r) => s.setRules(r)} />
      <p className="arcade-copy">{RULES_COPY[rules]}</p>
      <button ref={start} className="arcade-primary" onClick={() => s.start()}>
        Spiel starten <span aria-hidden="true">→</span>
      </button>
      <p className="arcade-hint">oder ENTER drücken</p>
      <div className="arcade-menu-foot">
        <button onClick={() => s.openInfo()}>ⓘ Info</button>
        <button onClick={onLeave}>← Zur Spielauswahl</button>
      </div>
    </section>
  );
}

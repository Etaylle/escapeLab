import type { Finding, Severity, Validation } from './validate.js';

interface Props {
  validation: Validation;
  /** the text of the finding lit up on the map; null for none */
  active: string | null;
  onPick: (finding: Finding) => void;
}

const GROUPS: readonly { severity: Severity; title: string }[] = [
  { severity: 'error', title: 'Fehler' },
  { severity: 'warning', title: 'Warnungen' },
  { severity: 'info', title: 'Hinweise' },
];

/** Whether picking a finding can show anything: a thing to select or a tile to light up. */
const pointsSomewhere = (finding: Finding): boolean =>
  finding.target !== null || finding.spots.length > 0;

/**
 * The validator's findings, errors first, then warnings, then notes. One
 * that points at the map lights its tiles up when picked and selects the
 * thing it is about; the verdict above says whether the server would take
 * the mission now.
 */
export function ValidatorPanel({ validation, active, onPick }: Props) {
  const { findings, errors, ms } = validation;
  const verdict = errors === 0 ? 'editor-verdict-ok' : 'editor-verdict-bad';
  return (
    <section className="editor-check" aria-label="Prüfung">
      <header className="editor-check-head">
        <h2>Prüfung</h2>
        <span className={`editor-verdict-chip ${verdict}`}>
          {errors === 0 ? 'lösbar · speicherbar' : `${errors} Fehler`}
        </span>
        <span className="editor-check-ms" title="So lange brauchte die letzte Prüfung samt Wegen">
          {ms < 1 ? '< 1' : Math.round(ms)} ms
        </span>
      </header>
      {findings.length === 0 && (
        <p className="editor-check-clean">
          Nichts einzuwenden: Jede Crew kommt von jedem Start durch.
        </p>
      )}
      {GROUPS.map(({ severity, title }) => {
        const group = findings.filter((f) => f.severity === severity);
        if (group.length === 0) {
          return null;
        }
        return (
          <div key={severity} className={`editor-check-group editor-check-${severity}`}>
            <h3>
              {title} <span className="editor-check-count">{group.length}</span>
            </h3>
            <ul>
              {group.map((finding, i) => (
                <li key={`${i}:${finding.text}`}>
                  <button
                    className="editor-finding"
                    aria-pressed={active === finding.text}
                    disabled={!pointsSomewhere(finding)}
                    title={pointsSomewhere(finding) ? 'Auf der Karte zeigen' : undefined}
                    onClick={() => onPick(finding)}
                  >
                    {finding.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

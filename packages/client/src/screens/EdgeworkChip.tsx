import type { Edgework } from '@escapelab/core';

/** Cells the lab's emergency bank can hold; the chip draws every slot. */
const CELL_SLOTS = 4;

/** The edgework in words, all of it: „Laborkennung K7G3A-2; Kontrollleuchten SIG an, …". */
function edgeworkText(edgework: Edgework): string {
  const lamps = edgework.indicators.map((i) => `${i.id} ${i.lit ? 'an' : 'aus'}`).join(', ');
  return (
    `Laborkennung ${edgework.serial}; Kontrollleuchten ${lamps}; ` +
    `Notstromzellen ${edgework.cells}`
  );
}

/**
 * The lab's edgework for whoever has read the sign: serial, control lamps
 * and emergency cells, each under the name the manual uses for it. Where the
 * HUD strip is short of room the chip shows the serial alone, the rest in
 * its tooltip (styles/polish.css).
 */
export function EdgeworkChip({ edgework }: { edgework: Edgework }) {
  const text = edgeworkText(edgework);
  return (
    <div className="edgework" role="group" aria-label={text}>
      <span className="edgework-value" title={text} aria-hidden="true">
        {edgework.serial}
      </span>
      <div className="edgework-part" aria-hidden="true">
        <span className="edgework-label">LABORKENNUNG</span>
        <span className="edgework-serial">{edgework.serial}</span>
      </div>
      <div className="edgework-part" aria-hidden="true">
        <span className="edgework-label">KONTROLLLEUCHTEN</span>
        <span className="edgework-lamps">
          {edgework.indicators.map((lamp) => (
            <span key={lamp.id} className={lamp.lit ? 'edgework-lamp-lit' : 'edgework-lamp'}>
              {lamp.lit ? '●' : '○'} {lamp.id}
            </span>
          ))}
        </span>
      </div>
      <div className="edgework-part" aria-hidden="true">
        <span className="edgework-label">NOTSTROMZELLEN</span>
        <span className="edgework-cells">
          {Array.from({ length: CELL_SLOTS }, (_, i) => (
            <span key={i} className={i < edgework.cells ? 'edgework-cell on' : 'edgework-cell'} />
          ))}
          <span className="edgework-count">{edgework.cells}</span>
        </span>
      </div>
    </div>
  );
}

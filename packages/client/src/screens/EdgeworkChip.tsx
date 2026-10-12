import type { Edgework } from '@escapelab/core';

/** Cells the lab's emergency bank can hold; the chip draws every slot. */
const CELL_SLOTS = 4;

/**
 * The lab's edgework for whoever has read the sign: serial, control lamps
 * and emergency cells, each under the name the manual uses for it.
 */
export function EdgeworkChip({ edgework }: { edgework: Edgework }) {
  const lamps = edgework.indicators.map((i) => `${i.id} ${i.lit ? 'an' : 'aus'}`).join(', ');
  return (
    <div
      className="edgework"
      role="group"
      aria-label={
        `Laborkennung ${edgework.serial}; Kontrollleuchten ${lamps}; ` +
        `Notstromzellen ${edgework.cells}`
      }
    >
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

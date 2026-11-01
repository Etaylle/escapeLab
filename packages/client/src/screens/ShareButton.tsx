import { useState } from 'react';
import { Icon } from './Icon.js';
import { saveShareCard, type ShareCard } from './shareCard.js';

/**
 * „Bild speichern" under a run's card: the run as a picture to keep (shareCard.ts), saved as
 * a PNG through the browser's download. Where the browser draws none, the button says why.
 */
export function ShareButton({ card }: { card: ShareCard }) {
  const [refused, setRefused] = useState<string | null>(null);
  const save = (): void => {
    setRefused(null);
    saveShareCard(card).catch((err: unknown) => {
      const why = err instanceof Error ? err.message : String(err);
      // The browser's own reason, where there is one, for whoever looks into the console.
      console.warn(`[escapelab] the run's picture was not saved: ${why}`, err);
      setRefused(why);
    });
  };
  return (
    <div className="share">
      <button type="button" className="share-save" onClick={save}>
        <Icon name="camera" /> Bild speichern
      </button>
      {refused !== null && (
        <span className="share-refused" role="status">
          {refused}
        </span>
      )}
    </div>
  );
}

import { useMedia } from '../hooks.js';
import { dismissUpdate, install, usePwa } from '../pwa.js';
import { Icon } from './Icon.js';

/** The join screen's line on a phone: the browser offers to put EscapeLab on the home screen. */
export function InstallLine({ onInstall }: { onInstall: () => void }) {
  return (
    <p className="install-line">
      <button className="link" onClick={onInstall}>
        <Icon name="hex" /> Zum Startbildschirm hinzufügen
      </button>
      <span className="muted"> — startet dann ohne Browserleiste</span>
    </p>
  );
}

/**
 * Over the top bar, like an error, once a newer version has taken over: a
 * reload brings it. Laid over the bar, not into the page, so a running
 * world keeps its zoom.
 */
export function UpdateLine({
  onReload,
  onDismiss,
}: {
  onReload: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="update-line" role="status">
      <span>Neue Version —</span>
      <button className="link update-line-reload" onClick={onReload}>
        neu laden
      </button>
      <button className="link update-line-close" onClick={onDismiss} aria-label="Schließen">
        ✕
      </button>
    </div>
  );
}

/** The install line where the browser made its offer and the pointer is a finger. */
export function InstallOffer() {
  const { installable } = usePwa();
  const phone = useMedia('(pointer: coarse)');
  return installable && phone ? <InstallLine onInstall={install} /> : null;
}

/** The update line once a newer version has taken over this page's service worker. */
export function UpdateNotice() {
  const { updated } = usePwa();
  return updated ? (
    <UpdateLine onReload={() => window.location.reload()} onDismiss={dismissUpdate} />
  ) : null;
}

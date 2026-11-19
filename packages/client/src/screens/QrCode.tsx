import { useMemo, useState } from 'react';
import { QR_MAX_BYTES, QUIET_MODULES, qrOf, qrPath } from '../qr.js';

/**
 * A QR code on the screen (qr.ts): black on white whatever the page's colours — a camera reads
 * dark modules on a light ground, and the lab's night would turn them round — with the quiet
 * zone a reader wants inside its own white, its edges kept sharp at every size. Its size is the
 * style's: the box is square, a module a unit of its view box.
 */

/** Whether `text` fits a code made here; a longer one shows none. */
export const qrFits = (text: string): boolean =>
  new TextEncoder().encode(text).length <= QR_MAX_BYTES;

/** The address of the site itself, as a visitor's device opens it: the page's origin. */
export const siteAddress = (): string => window.location.origin;

/** The link that leads another device into the join step of room `code`, its code filled in. */
export const inviteLink = (code: string): string =>
  `${window.location.origin}${window.location.pathname}?room=${code}`;

/** `address` as a line under a code reads it: without its scheme. */
export const addressText = (address: string): string => address.replace(/^https?:\/\//, '');

/** The QR code of `text`, said as `label` to whoever cannot see it; nothing for a text too long. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const modules = useMemo(() => (qrFits(text) ? qrOf(text) : null), [text]);
  if (modules === null) {
    return null;
  }
  const side = modules.length + 2 * QUIET_MODULES;
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={qrPath(modules)} fill="#000000" />
    </svg>
  );
}

/**
 * A lobby's invite as a QR code, beside the room's code in the bar: the chip „QR" opens a sheet
 * under it with the code of the invite link — which leads another device into the join step, the
 * room's code filled in — and the link as text; the chip, or a click on the sheet, shuts it.
 */
export function InviteQr({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const link = inviteLink(code);
  if (!qrFits(link)) {
    return null;
  }
  return (
    <span className="invite-qr">
      <button
        className="invite-qr-chip"
        aria-expanded={open}
        title="QR-Code der Einladung zeigen"
        onClick={() => setOpen(!open)}
      >
        QR
      </button>
      {open && (
        <div
          className="invite-qr-sheet"
          role="dialog"
          aria-label={`QR-Code der Einladung in Raum ${code}`}
          onClick={() => setOpen(false)}
        >
          <QrCode text={link} label={`QR-Code der Einladung in Raum ${code}`} />
          <p className="invite-qr-room">Einladung in Raum {code}</p>
          <p className="qr-address">{addressText(link)}</p>
        </div>
      )}
    </span>
  );
}

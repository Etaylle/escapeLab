/**
 * The join screen's line on a page that is no secure origin, as over plain
 * http on a LAN address: the browser keeps the microphone from it, and only
 * the host can change that — `pnpm cert`, after which the server speaks
 * https. Localhost is a secure origin, so `pnpm dev` shows nothing.
 */

/**
 * Whether `page` lacks a secure origin. Without a window, as in a page drawn
 * on the server, or where the browser does not say, there is nothing to tell.
 */
export function needsHttps(page: { isSecureContext?: boolean } | undefined): boolean {
  return page?.isSecureContext === false;
}

/** The line where the page needs https for the microphone; nothing elsewhere. */
export function HttpsHint() {
  if (!needsHttps(typeof window === 'undefined' ? undefined : window)) {
    return null;
  }
  return (
    <p className="https-hint">
      Ohne HTTPS kein Mikrofon — der Host startet mit <code>pnpm cert</code>
    </p>
  );
}

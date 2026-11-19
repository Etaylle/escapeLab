/**
 * The demo's link: an address with `?demo=1` — the stand's QR code — leads straight into the
 * audience of the demo room (core `DEMO_CODE`), with no name and no code typed. The page reads it
 * once as it comes up and takes it off the address at once, so that no invite link made from the
 * address carries it on and a reload after „Zuschauen beenden" finds the menu; the menu that
 * comes up first takes it (screens/Join.tsx).
 */

/** Whether the address's query `search` asks for the demo. */
export function asksForDemo(search: string): boolean {
  return new URLSearchParams(search).get('demo') === '1';
}

/** What a page came with: whether its address asked for the demo, and whether a menu took it. */
interface DemoLink {
  asked: boolean;
  taken: boolean;
}

/** The demo link each address was read for — one a page, its `location` the key. */
const links = new WeakMap<object, DemoLink>();

/** The page's address without `demo` in its query, the rest of it kept. */
function withoutDemo({ pathname, search, hash }: Location): string {
  const params = new URLSearchParams(search);
  params.delete('demo');
  const rest = params.toString();
  return `${pathname}${rest === '' ? '' : `?${rest}`}${hash}`;
}

/** The page's demo link, read once: the address cleaned of it as it is. */
export function readDemoLink(): DemoLink {
  const known = links.get(window.location);
  if (known !== undefined) {
    return known;
  }
  const params = new URLSearchParams(window.location.search);
  const link = { asked: asksForDemo(window.location.search), taken: false };
  if (params.has('demo')) {
    window.history.replaceState(window.history.state, '', withoutDemo(window.location));
  }
  links.set(window.location, link);
  return link;
}

/** Whether the page came by the demo's link and no menu has taken it yet: taken from now on. */
export function takeDemoLink(): boolean {
  const link = readDemoLink();
  const fresh = link.asked && !link.taken;
  link.taken = true;
  return fresh;
}

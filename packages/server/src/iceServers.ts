import { iceServersSchema, type IceServer } from '@escapelab/core';

/**
 * The ICE servers every page's voice goes by, handed to each socket as it opens (sockets.ts):
 * the JSON list of RTCIceServer objects in ICE_SERVERS, else public STUN. STUN tells a browser
 * its address as the internet sees it, which takes the voice across most home routers; a
 * symmetric NAT — some mobile and campus networks — needs a TURN server to relay the sound,
 * named here with its username and credential. `[]` keeps the voice to one network.
 */

/** The STUN servers the voice goes by while ICE_SERVERS is unset: two, should one be down. */
export const DEFAULT_ICE_SERVERS: readonly IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/** What a wrong ICE_SERVERS is told to look like. */
const EXAMPLE =
  'erwartet eine Liste wie [{"urls":"stun:stun.l.google.com:19302"},' +
  '{"urls":"turn:turn.example.org:3478","username":"…","credential":"…"}], oder [] fürs LAN';

/** The ICE servers and where they came from, for the start-up log. */
export interface IceSetup {
  servers: IceServer[];
  from: 'env' | 'default';
}

/**
 * The ICE servers `env` names in ICE_SERVERS — unset or blank for the default STUN servers —
 * or a throw saying what is wrong with the list, so that a server set up wrong says so at the
 * start instead of every voice failing in silence.
 */
export function iceServers(env: NodeJS.ProcessEnv): IceSetup {
  const text = (env['ICE_SERVERS'] ?? '').trim();
  if (text === '') {
    return { servers: [...DEFAULT_ICE_SERVERS], from: 'default' };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`ICE_SERVERS ist kein JSON — ${EXAMPLE}`);
  }
  const parsed = iceServersSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    const where = path === '' ? '' : ` (${path})`;
    throw new Error(`ICE_SERVERS stimmt nicht: ${issue?.message ?? '?'}${where} — ${EXAMPLE}`);
  }
  return { servers: parsed.data, from: 'env' };
}

/** The start-up log's line for `setup`. */
export function iceLogLine(setup: IceSetup): string {
  const urls = setup.servers.flatMap((server) => [server.urls].flat());
  const turn = urls.some((url) => url.startsWith('turn'));
  if (urls.length === 0) {
    return 'voice: ICE_SERVERS=[] — no STUN, the voice links within one network only';
  }
  const from = setup.from === 'env' ? 'from ICE_SERVERS' : 'default STUN, ICE_SERVERS unset';
  return `voice: ${urls.join(', ')} (${from}${turn ? ', with TURN' : ', no TURN'})`;
}

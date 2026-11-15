/**
 * What the voice asks of Opus, a speaking voice on a lossy line: forward error correction, so
 * that a lost packet is filled in from the next; no packets while nobody speaks (DTX); one
 * channel; 32 kbit/s, plenty for speech. They go into the description that came from the other
 * end, before it is set: its parameters tell this end's encoder how to send. A browser takes a
 * remote description as the network brings it, so nothing is set that it could refuse.
 */
const SPEECH: Readonly<Record<string, string>> = {
  useinbandfec: '1',
  usedtx: '1',
  stereo: '0',
  'sprop-stereo': '0',
  maxaveragebitrate: '32000',
};

/** `params` („a=1;b=2") with every one of SPEECH set, the others kept in their order. */
function withSpeech(params: string): string {
  const kept = params
    .split(';')
    .map((param) => param.trim())
    .filter((param) => param !== '' && !Object.hasOwn(SPEECH, param.split('=')[0] ?? ''));
  const ours = Object.entries(SPEECH).map(([key, value]) => `${key}=${value}`);
  return [...kept, ...ours].join(';');
}

/**
 * `sdp` with the Opus format's parameters set for speech (`SPEECH`), added where it has none;
 * a description without Opus comes back as it was.
 */
export function speechOpus(sdp: string): string {
  const payload = /^a=rtpmap:(\d+) opus\/48000/im.exec(sdp)?.[1];
  if (payload === undefined) {
    return sdp;
  }
  const fmtp = new RegExp(`^a=fmtp:${payload} ([^\\r\\n]*)`, 'm');
  if (fmtp.test(sdp)) {
    return sdp.replace(fmtp, (_, params: string) => `a=fmtp:${payload} ${withSpeech(params)}`);
  }
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const rtpmap = new RegExp(`^a=rtpmap:${payload} [^\\r\\n]*`, 'm');
  return sdp.replace(rtpmap, (line) => `${line}${eol}a=fmtp:${payload} ${withSpeech('')}`);
}

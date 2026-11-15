import { describe, expect, it } from 'vitest';
import { speechOpus } from '../src/voice/opus.js';

/** The Opus parameters for speech, set in a description from the other end before it is set. */

const SPEECH = 'useinbandfec=1;usedtx=1;stereo=0;sprop-stereo=0;maxaveragebitrate=32000';

describe('speechOpus', () => {
  it("sets speech's parameters on Opus, keeping the others, line ends and all", () => {
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 109 9',
      'a=rtpmap:109 opus/48000/2',
      'a=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=0',
      'a=rtpmap:9 G722/8000/1',
      '',
    ].join('\r\n');
    const tuned = speechOpus(sdp).split('\r\n');
    expect(tuned[3]).toBe(`a=fmtp:109 maxplaybackrate=48000;${SPEECH}`);
    expect(tuned.filter((line) => line !== tuned[3])).toEqual(
      sdp.split('\r\n').filter((_, i) => i !== 3),
    );
  });

  it('adds the parameters where Opus has none, and leaves a description without Opus be', () => {
    const sdp = 'm=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\na=sendrecv\n';
    expect(speechOpus(sdp)).toBe(
      `m=audio 9 RTP/AVP 111\na=rtpmap:111 opus/48000/2\na=fmtp:111 ${SPEECH}\na=sendrecv\n`,
    );
    expect(speechOpus('offer of 0: sendrecv')).toBe('offer of 0: sendrecv');
  });
});

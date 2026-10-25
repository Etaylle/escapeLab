import { mixDown, RATE } from './wav.js';

/**
 * The microphone, through MediaRecorder: opened for a take and closed after it. A browser
 * hands it out only to a page on localhost or https, and only once its user allows it. The take
 * comes back decoded at RATE in one channel, as the trim and the WAV want it; the browser's own
 * compression on the way is far finer than the radio's band.
 */

/** A take under way. */
export interface Rolling {
  /** Ends the take and hands back what the microphone heard, at RATE, one channel. */
  stop(): Promise<Float32Array>;
  /** Ends the take and drops it: the page is going. */
  cancel(): void;
}

/** One channel, and nothing done to it that a browser does to a call. */
const MICROPHONE: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** What a finished take sounds like, decoded at RATE and mixed into one channel. */
async function decode(take: Blob): Promise<Float32Array> {
  const bytes = await take.arrayBuffer();
  const buffer = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes);
  const count = buffer.numberOfChannels;
  return mixDown(Array.from({ length: count }, (_, i) => buffer.getChannelData(i)));
}

/** Opens the microphone and starts a take; fails, in words, where there is none to be had. */
export async function startRecording(): Promise<Rolling> {
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (devices === undefined) {
    throw new Error('Kein Mikrofon: Der Browser gibt es nur über localhost oder https heraus.');
  }
  const stream = await devices.getUserMedia(MICROPHONE).catch((err: unknown) => {
    throw new Error(`Das Mikrofon ließ sich nicht öffnen: ${reasonOf(err)}`);
  });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
  const close = (): void => stream.getTracks().forEach((track) => track.stop());
  recorder.start();
  const finished = (): Promise<Blob> =>
    new Promise((resolve) => {
      const done = (): void => resolve(new Blob(chunks, { type: recorder.mimeType }));
      recorder.addEventListener('stop', done, { once: true });
      recorder.stop();
    });
  return {
    stop: () =>
      finished()
        .finally(close)
        .then(decode)
        .catch((err: unknown) => {
          throw new Error(`Die Aufnahme ließ sich nicht lesen: ${reasonOf(err)}`);
        }),
    cancel: () => {
      if (recorder.state !== 'inactive') recorder.stop();
      close();
    },
  };
}

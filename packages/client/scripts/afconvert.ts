/**
 * The Mac's own converter, as the sound script (sfx.ts) and the pack script (packs.ts) use it: a
 * recording decoded into PCM through a WAV in a scratch folder, and PCM encoded as AAC in an .m4a.
 * afconvert comes with macOS and reads MP3, AAC, WAV, AIFF, FLAC and Ogg Vorbis; nothing is
 * installed for it.
 *
 * Runs on Node's own TypeScript, as the scripts do: it imports nothing of the app.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWav, wavBytes, type Pcm } from './pcm.ts';

/** Decodes the recording at a path into PCM. */
export type Decode = (path: string) => Pcm;
/** Encodes `pcm` into the file at `path`, as AAC in an .m4a. */
export type Encode = (pcm: Pcm, path: string) => void;

/** Decodes a recording with afconvert into `scratch` and reads it back as PCM. */
export function afconvertIn(scratch: string): Decode {
  return (path) => {
    const wav = join(scratch, 'decoded.wav');
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', path, wav]);
    try {
      return parseWav(readFileSync(wav));
    } finally {
      rmSync(wav, { force: true });
    }
  };
}

/**
 * Encodes with afconvert, the PCM written as a WAV into `scratch` first: AAC in an .m4a at
 * `bitrate`, bit/s, at the encoder's best quality.
 */
export function afconvertOut(scratch: string, bitrate: number): Encode {
  return (pcm, path) => {
    const wav = join(scratch, 'piece.wav');
    writeFileSync(wav, wavBytes(pcm));
    try {
      const aac = ['-f', 'm4af', '-d', 'aac', '-b', String(bitrate), '-q', '127'];
      execFileSync('afconvert', [...aac, wav, path]);
    } finally {
      rmSync(wav, { force: true });
    }
  };
}

/** Fails, naming `who`, where afconvert is not on this machine: a Mac's, which has it. */
export function requireAfconvert(who: string): void {
  try {
    execFileSync('/usr/bin/which', ['afconvert'], { stdio: 'ignore' });
  } catch {
    throw new Error(`${who}: afconvert is missing — it comes with macOS; run this on a Mac`);
  }
}

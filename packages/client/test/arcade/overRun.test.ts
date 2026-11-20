import { describe, expect, it } from 'vitest';
import { FakeContext, reaches, type FakeGain, type FakeNode } from '../fakeGraph.js';
import { MACHINE_DB, buildMix, duck, followDucks, type Mix } from '../../src/world/mix.js';
import { ArcadeAudio } from '../../src/arcade/sound.js';
import { runLineOf } from '../../src/arcade/RunLine.js';
import { runGoesOn } from '../../src/arcade/door.js';

/**
 * The break-room machine open while the run goes on around the player: its frame says that the
 * run's clock keeps running, and shows it; the run's radio and its alarms stand over the
 * machine — the machine goes down under them, they never go down under the machine.
 */

const VOLUMES = { master: 1, music: 1, effects: 1, voice: 1, ambience: 1 };

describe('the run’s clock over the machine', () => {
  it('is said while a crew mate is away or the own line is down, never in the lobby or a hold', () => {
    expect(['crew', 'line', 'pause', 'lobby', 'menu', null].map((w) => runGoesOn(w as never))).toEqual(
      [true, true, false, false, false, false],
    );
  });

  it('says the clock runs on, with the time left as the run’s HUD shows it', () => {
    expect(runLineOf({ deadlineAt: 100_000, pausedAt: null }, 40_000)).toBe(
      'Die Uhr des Einsatzes läuft weiter · 01:00',
    );
    expect(runLineOf({ deadlineAt: null, pausedAt: null, clockFrom: 0 }, 75_000)).toBe(
      'Die Uhr des Einsatzes läuft weiter · 01:15',
    );
    expect(runLineOf({ deadlineAt: null, pausedAt: null }, 5)).toBe(
      'Die Uhr des Einsatzes läuft weiter.',
    );
  });
});

describe('the run’s sounds over the machine', () => {
  const ctx = new FakeContext();
  const mix = buildMix(ctx as unknown as BaseAudioContext, VOLUMES, 1) as Mix;
  const node = (n: AudioNode): FakeNode => n as unknown as FakeNode;

  it('plays the machine through a gain of its own that follows the run’s ducks', () => {
    let followed: AudioParam | null = null;
    const audio = new ArcadeAudio(() => ({
      ctx: ctx as unknown as AudioContext,
      destination: mix.sfx,
      follow: (param) => {
        followed = param;
        return followDucks(mix, param, MACHINE_DB, ctx.currentTime);
      },
    }));
    audio.play('shoot');
    expect(followed).not.toBeNull();
    const tone = ctx.nodes.filter((n) => n.kind === 'oscillator').at(-1);
    if (tone === undefined) throw new Error('no tone');
    expect(reaches(tone, node(mix.sfx))).toBe(true);
    // Through the gain that follows the run's ducks: nothing of the machine passes beside it.
    const ducked = ctx.nodes.find((n) => (n as unknown as FakeGain).gain === (followed as unknown));
    if (ducked === undefined) throw new Error('no followed gain');
    expect(reaches(tone, ducked)).toBe(true);
    expect(ducked.outputs).toEqual([mix.sfx]);
    expect(ctx.nodes.filter((n) => n !== ducked && n.outputs.includes(node(mix.sfx))).length).toBe(
      0,
    );
    audio.close();
  });

  it('pulls the machine down under a radio line and an alarm, and leaves the radio and alarms be', () => {
    const machine = ctx.createGain();
    followDucks(mix, machine.gain as unknown as AudioParam, MACHINE_DB, ctx.currentTime);
    const voiceBefore = (mix.voice.gain as unknown as FakeGain['gain']).events.length;
    const sfxBefore = (mix.sfx.gain as unknown as FakeGain['gain']).events.length;
    duck(mix, 'arcade', 11, Infinity, 10.5);
    duck(mix, 'voice', 12, 14, 11.5);
    duck(mix, 'alarm', 20, 21, 19.5);
    const ramps = machine.gain.ramps().map(([level]) => Number(level.toFixed(4)));
    // Under a radio line the machine goes 12 dB down, as the music does since M-tension.
    expect(ramps).toContain(Number((10 ** (-12 / 20)).toFixed(4)));
    expect(ramps).toContain(Number((10 ** (-8 / 20)).toFixed(4)));
    // The radio's bus and the effects' (the klaxon's) are set by nothing the machine does.
    expect((mix.voice.gain as unknown as FakeGain['gain']).events.length).toBe(voiceBefore);
    expect((mix.sfx.gain as unknown as FakeGain['gain']).events.length).toBe(sfxBefore);
    expect(MACHINE_DB).toEqual({ voice: -12, alarm: -8, siren: -8 });
  });
});

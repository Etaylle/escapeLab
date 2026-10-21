# EscapeLab — sound

The lab is heard the way it is seen: rooms with a sound of their own, a partner you can
locate in the dark, a person on the radio, and music that tightens as the clock runs out.
Everything is made at runtime from oscillators, filters and noise, except mission control's
lines, which are recordings. Code: `packages/client/src/world/` — `audio.ts` (the one path and
the effects), `ambience.ts`, `spatial.ts`, `radioVoice.ts`, `music.ts`.

## One path

Every sound goes into one AudioContext (`sharedAudio()`, made on first use) and through one
master gain, which the sound switch sets to 0 (`isMuted()`). The beds and the music enter it
through the duck bus, which the radio voice pulls 6 dB down while it speaks. Until a click or a
key resumes the context (the browser's autoplay rule), one-shot effects are dropped rather
than queued; the loops — beds, music, rotors — are built anyway and sound once it runs. The
crew's own voices bypass the master gain: switching the lab off leaves the crew audible.

Levels, at the master gain: the effects around 0.04 (`EFFECTS_LEVEL`), a room's bed 0.02,
the music 18 dB under the effects, the radio voice at 0.12 of a line's peak.

Nothing is scheduled per frame. Each frame only checks whether anything changed — the tile
the player stands on, the view, the lit rooms, the power, a partner's half tile walked —
and builds nodes only for a sound that starts. The beds' sporadic sounds and the music's notes
are scheduled ahead on the audio clock (`AudioContext.currentTime`) by timers of their own:
every 250 ms for 0.8 s ahead, every 100 ms for 0.3 s ahead.

## Rooms you can hear (`ambience.ts`)

Each room plays a bed after its label's kind (the art bible's room kinds; a room without a
kind is a plain lab room). A bed has two layers: what runs on the lab's power, and what lives
without it.

| Kind | On power | Without power |
| --- | --- | --- |
| server | fan whoosh, 120 Hz hum, faint 8 kHz whine | a creak now and then |
| machine | a slow stroke every 1.6 s, steam hissing every 8–20 s | 38 Hz rumble |
| archive | faint ventilation | a drip every 7–12 s |
| corridor | vent hum | a distant clank every 20–40 s, echoing |
| lab | 50 Hz fridge hum, bubbling every 10–25 s | a creak now and then |
| reactor | containment hum, 110 Hz | 30 Hz rumble, a throb on the core's beat |
| control | console hum, a soft tick every second | a creak now and then |
| plain | ventilation, 55 Hz hum | a distant clank or creak every 7–15 s |

The room the player stands in plays at full, every room behind an open door or an opening
12 dB under it, the rest not at all; a door or a doorway never flips the room. A change
crossfades over 1.2 s. The audience stands nowhere and hears every room 12 dB under.

While the lab has its power (Normalbetrieb) every bed runs with the power hum. With the bang
of the blackout the powered layers spin down over 1.4 s, their hums falling in pitch: drips,
rumble and creaks stay. A room whose lights a station brings back warms its powered layer up
along the lights' own warm-up (`rooms.ts` `warmUp`, dips and all); a room lit before the
screen looked comes back at once. A run won powers every room again. The reactor's throb
peaks with the core's light, 2.4 s apart on the simulation's clock.

## A partner you can locate (`spatial.ts`)

A partner steps every half tile they walk, as you do. Each step is panned by how far to the
side they stand (all one side at 6 tiles), plays in full within 2 tiles and fades out by 10,
and with no line of sight between (`canSee`, walls and shut doors) it is muffled through a
600 Hz low-pass and turned down to the share a voice keeps through a wall (`WALL_SHARE`). A
drone buzzes faintly where it flies — two detuned saws in a band, fluttering with its blades
— placed the same way ten times a second, silent while a plate freezes it, and chirps once
when it catches somebody. Your own steps stay as they are. The audience hears none of this.

## A voice on the radio (`radioVoice.ts`, `scripts/voice.ts`)

Mission control speaks every line a shipped mission can put on the air: everything core's
`logRadio` is handed — `radio.start` as the clock starts, each `puzzles[].onSolved` as its
station is solved, `radio.escape` as the hatch unlocks. Notes of the last crew and the
devices' texts are read, not heard. A line without a recording — a custom mission's — keeps
the radio's chirp.

```sh
pnpm --filter @escapelab/client voice            # record the lines that have no recording yet
pnpm --filter @escapelab/client voice --fresh    # record every line anew
```

macOS only. The script reads `missions/*.json`, turns a dash, a middle dot or a colon into a
short pause (a colon between digits stays), reads each line with `say -v Anna -r 190`,
converts it with `afconvert -f m4af -d aac -b 48000` to
`packages/client/public/voice/<first 12 hex of the line's SHA-1>.m4a`, and writes
`manifest.json` as `{ [id]: { text, ms, missions } }`. A recording no line needs any more is
deleted. The files are committed (27 lines, 707 kB); `test/voiceLines.test.ts` fails, naming
the command, when a shipped line has no recording, and when a file is over 150 kB or the
folder over 3 MB.

At a run's start the mission's lines are fetched and decoded; a line that comes over the air
is fetched then, where it was not yet. When the banner shows a line, its recording plays as a
handset hears it: high-pass 300 Hz and low-pass 3.4 kHz, each fourth order, a gentle
waveshaper (tanh), a bed of static 30 dB under the speech, a squelch as the key goes down
and a longer one as it comes up; the beds and the music duck 6 dB meanwhile. A newer line
cuts an older one short. The banner itself is unchanged.

**The voice.** The Mac offers German voices of two kinds: Anna, a recorded (unit-selection)
voice, and the Eloquence formant synthesizers Eddy, Flo, Reed, Rocko, Sandy, Shelley,
Grandma and Grandpa. They were compared on the first line of Blackout at 190 words a minute,
by measurement rather than by ear: Anna speaks it in 3.6 s with her pitch ranging from 77 to
200 Hz (10th to 90th percentile); Reed takes 4.5 s over 77 to 124 Hz, Rocko 79 to 102 Hz,
and each Eloquence voice adds half a second of silence. Anna is the only one that sounds like
a person: a calm, low, slightly soft female voice whose phrasing carries an order such as
„Erst Handbuch im Archiv, dann Kasten und Prüfpult."; through the radio's band she stays
clear. The formant voices read flat and buzzy — a computer announcing, not a person at a
desk — and take longer. Anna it is.

## Music that breathes (`music.ts`)

Three layers, brought in and out by one pressure value from 0 to 1:

- **calm** — a slow pad, two sines a hertz apart through a resonant low-pass sweeping over
  20 s, and a swell of filtered noise about every 12 s;
- **pressure** (from 0.35) — a muted bass pulse on A at 90 bpm and a sparse A-minor arpeggio,
  a note every other beat;
- **last minute** (from 0.8) — the arpeggio doubles an octave up between, the pulse goes to
  120 bpm and a heartbeat comes in, two thumps, from 70 bpm a minute before the end to 120 at
  zero.

The pressure follows the clock — the tension curve the lab always had, 0 while half the time
or more is left and rising to 1 at the end, and at least 0.8 in the last minute — adds 0.15
for 20 s with every alarm, and stays at 0.8 at least in the escape. A layer goes only a
little under its threshold before it leaves, so a wavering pressure never flips it. Every
change starts on the next beat and lasts whole beats, 2 s at least. The music starts 2 s
after the blackout's click (in a run without an intro, as it starts), never while the lab
still has its power. The escape's siren takes the pad and the arpeggio away and keeps the
pulse and the heartbeat. A run won fades the music out before the end screen's chord; a run
lost drains it, its low-pass closing and the pad sagging, with the power. Heavy hits — the
heartbeat, a machine's stroke — carry a mid layer so that a phone's speaker plays them too.

## Proof

Unit tests run every module against a fake AudioContext that keeps the graph:
`test/ambience.test.ts` (rooms, levels, power, the beds' graphs, dead and alive variants,
crossfades), `test/spatial.test.ts` (pan, gain, muffle, steps, rotors, the chirp),
`test/radioVoice.test.ts` (the chain, the speech, ducking, preloading),
`test/voiceLines.test.ts` (the recordings against the missions) and `test/music.test.ts`
(pressure, layers, beats, endings).

With `?trace=1` the page exposes `window.__escapelab.audio`: `room`, `kind`, `beds` and
`power` by kind, `music` (`calm`, `pressure`, `last`, the pressure as `level`), `voice`
(`playing`, `lastId`), `spatial` (`partnerPan`, `partnerGain`) and `renderRadio()`, which
renders the radio's chain offline on white noise. The walkthrough (`tools/shots.mjs`) checks
the start room's bed dead after the blackout, the room the lever lights alive again, every
solve's line spoken from the manifest, the pressure in the escape, the partner's side across
the corridor, and the chain's band-pass in the offline render (`tools/spectrum.mjs`).

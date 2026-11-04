# EscapeLab — sound

The lab is heard the way it is seen: rooms with a sound and an answer of their own, a partner
you can locate in the dark by their steps on the floor they walk, a person on the radio, and
music that tightens as the clock runs out. Every sound is a recording: mission control's lines
(below), and the effects, the rooms' beds and the music, which ElevenLabs made from the catalog
`packages/client/audio/catalog.json`. Four things are still made at runtime, because the game
sets them as they play: the radio's chain and the static under its voice, the rooms' answers
(their impulse responses, `reverb.ts`), the meter's hum, whose pitch is the voltage it reads,
and the colour game's tones, one pitch a colour, as long as the game holds them
(`puzzles/sounds.ts`). The Morse device is a lamp and makes no tone. The countdown's beep is a
recording whose speed — and so its pitch — rises with each second gone. Code:
`packages/client/src/world/` — `audio.ts` (the effects and the budget), `mix.ts` (the buses,
the brickwall, the ducking), `samples.ts` (the recordings, loaded as they are wanted),
`audioStream.ts` (what streams instead), `audioMemory.ts` (what a page keeps, counted),
`reverb.ts`, `footsteps.ts`, `ambience.ts`, `spatial.ts`, `radioVoice.ts`, `pa.ts`, `music.ts`,
and `audioCount.ts` and `soundProbe.ts` for the walkthrough's census.

**The catalog.** Each entry names one sound: its `id`, its `kind` — a one-shot, a bed that
loops seamlessly, a stem of the music or a sting — the English prompt ElevenLabs is given
(material, mechanism, room, distance), how long it lasts, whether it loops, the loudness it is
brought to (`target`), a stem's tempo (`bpm`, the one its prompt states: the script holds the
two to each other, and the three stems to one tempo) and where the game plays it (`usedBy`,
`src/<file>#<symbol>`). There are 81 effects — 69 one-shots, three loops (the mains hum, the
siren, the drone's rotor) and nine room beds — and five pieces of music: the stems `calm`,
`tense` and `critical`, 72 s each, all three in A minor at 90 bpm, and the stings `won` and
`lost`, 10 s each. A step is one of three takes of the same work boot on the floor it lands on —
`step-concrete-1`–`3`, `step-lino-1`–`3`, `step-steel-1`–`3` — a door that slides open has its
pneumatic slide and one that shuts one of two closes (`door-close-1`, `-2`), the hatch strikes
its stops as it does on screen (`hatch-open-done`), a drone that comes close whooshes by
(`drone-pass`), every alarm brings a two-second stinger with it (`alarm-sting`) and a volume
set in the settings ticks through the bus it sets (`ui-tick`).

```sh
pnpm --filter client sfx -- --dry-run                    # the plan and its cost; nothing asked
pnpm --filter client sfx                                 # everything not made yet
pnpm --filter client sfx -- sfx                          # the effects alone (`music`: the music)
pnpm --filter client sfx -- --only klaxon,ping           # those entries, made anew
pnpm --filter client sfx -- --candidates 3 --only ping   # three takes, the best one kept
```

**Awaiting a render.** Twelve entries were written before the user could render them — the
agents that write the catalog may not spend the account's credits, the permission system holds
any paid request back — and the game plays them meanwhile from what there is: the linoleum and
steel steps borrow the concrete takes and the door's closes its slide, each listed in
`public/sfx/manifest.json` with the file it plays and `standIn` naming whose it is, its hash
that recording's request, so that the script counts it as made from another request and makes it
on its next run; the alarm's sting, the fly-by, the hatch's landing and the tick are not listed
at all and stay silent until made (the hatch then grinds out with the clunk its grind ends on).
`test/sampleManifest.test.ts` names them in its title — `AWAITING_RENDER`, to be emptied once
they are made — and fails for any other entry without a recording of its own. The render, some
11 s of effects in three takes, about 130 credits, in `packages/client`:

```sh
node --env-file=/Users/uros/Documents/Req.Eng./escapelab/.env.local scripts/sfx.ts --candidates 3 --only step-lino-1,step-lino-2,step-lino-3,step-steel-1,step-steel-2,step-steel-3,alarm-sting,door-close-1,door-close-2,drone-pass,hatch-open-done,ui-tick
```

The concrete steps needed none: their entries are the old `step-1`–`3` renamed, their prompts as
they were, and a request's hash leaves the id out, so the recordings made for them stand.

`scripts/sfx.ts` asks text-to-sound-effects (`eleven_text_to_sound_v2`, prompt influence 0.5,
a bed with `loop: true`) and Eleven Music (`music_v2_5`, instrumental) for each entry, one
request after the other, 300 ms apart, a 429 waited out as the voice script does, through the
client of `scripts/elevenlabs.ts`; an effect comes as MP3 at 44.1 kHz and 128 kbit/s into
`public/sfx/<id>.mp3`, a piece of music at 192 kbit/s — the Creator plan's best — into
`public/music/<id>.mp3`. `public/sfx/manifest.json` and `public/music/manifest.json` list each
as `{ file, ms, gain, startMs, floor, rms, loop, hash, influence, source }`; `floor` and `rms`
are measured before the gain (below), `hash` names the request that made it, `influence` how
closely an effect followed its prompt, so a run makes only what is new, changed or missing, and
one cut short goes on where it stopped.

**Candidates.** With `--candidates N` (up to 5; 1 unless told) every entry the run makes is
made N times, each take into a folder of its own in the system's temp (the run names it; nothing
of it goes into the project): an effect with its prompt followed ever more closely — 0.3, 0.6
and 0.9 for three — a piece of music by the same request again. The script prints each take's
peak, RMS, start, silence, length, gain and floor and keeps the one that misses the fewest of
five rules — its peak at −6 dBFS or more before any gain; its sound starts within 50 ms; at most
a tenth of it is silence, 10 ms frames under −60 dBFS; its length lies within a fifth of the
catalog's; its floor is not heard (below) — and of those the one with the loudest RMS. Only that
one goes into `public/sfx` or `public/music`, and the checks below are made on it. A short click
misses the silence rule whatever it does, its tail silent long before its half second is over,
so for it the RMS decides.

The key comes from the environment: the package script hands node the repo's `.env.local`
(`--env-file-if-exists`), and from a worktree it is `node --env-file=<repo>/.env.local
scripts/sfx.ts` in `packages/client`. Before it asks for anything the script reads the account's
credits and stops below 40,000 or where the plan would pass a group's cap (12,000 credits for
the effects, 18,000 for the music); after a group's first request it reads what that cost and
prices the rest at that rate. The first full render (2026-10-26) cost 542 credits for the 154 s
of effects and 4,136 for the 236 s of music; the dry run prices at those rates, rounded up to 4
and 18 credits a second, times the takes.

**Listening to them.** The page `/sounds`, which no menu links to, lists every entry of the
catalog by its kind — effects, rooms and loops, music, the end card — each with its prompt, its
length, its gain and its floor once the gain is applied („Grundrauschen −45,7 dBFS, hörbar"
where it is heard, „vom Klang verdeckt" where the sound fills its quietest 100 ms), a button
that plays it through the game's own loader at the loudness the game brings it to (a loop — a
room's bed, a stem — round and round until it is stopped) and a box „neu rendern"; below, it
puts together the command for what is ticked, to be run in `packages/client`:

```sh
node --env-file=/Users/uros/Documents/Req.Eng./escapelab/.env.local scripts/sfx.ts --candidates 3 --only a,b,c
```

The key file is the main checkout's unless the page is told another path, which it remembers
for the next visit. The page asks no service for anything: the user runs the command.

**Loudness without re-encoding.** The files stay as ElevenLabs made them. The script decodes
each with `afconvert` into a temporary folder, measures its peak and its RMS and writes the gain
that brings it to its target: a one-shot's peak to −3 dBFS, a bed's or a stem's RMS to
−20 dBFS, a sting's RMS to −14 dBFS. What a gain can spoil is the noise floor it brings up, so
the script measures that as well: `floor`, the RMS of the recording's quietest 100 ms. A take
plays its floor where it is heard when that floor comes out louder than −50 dBFS once the gain
is applied, and lies 20 dB or more under the take's RMS — closer, the quietest 100 ms is the
sound itself, a bed, a stem, a hiss, a ringing tone that fills its file, and the sound masks
whatever noise lies under it (`floorHeard`). A take more than a fifth off its length is named as
well. The script names each such take, with its gain, its floor or its length, and fails with
the command that makes them again, `--candidates 5 --only …`; `test/sampleManifest.test.ts`
lists them. Nothing is capped. More than 30 ms of silence at a recording's start becomes
`startMs`, where its sound starts; a bed keeps its start, so that its loop stays seamless. A run
that makes nothing measures every file anew, so a rule changed costs nothing. The game applies
the gain as it decodes a recording (`samples.ts`), multiplying its samples once, and plays it
from `startMs`. `test/sampleManifest.test.ts` fails, naming the command, where an entry has no
file, a file was made from another request, runs off its length, came back clipped (a gain
under 0.1) or plays a floor that is heard, or a folder passes its cap: `public/sfx` 3 MB,
`public/music` 8 MB.

The game applies the gain as it decodes an effect or a bed; a piece of music, which streams
undecoded, gets its gain on its element's level instead.

The rule replaced a limit on the gain alone — 6 for a one-shot, 4 for the rest — that flagged a
take for being quiet rather than for what is heard. The first render (2026-10-26) brought 17
takes over it, each quiet throughout (the three footsteps at a gain of 28 to 87, the archive's
bed at 104); they and ten more judged weak were made again as three candidates each, their
prompts naming the material and the mechanism and asking for close, loud, dry takes at full
level, and the music anew at 192 kbit/s. Two stayed over the limit, the big button (12.3) and
the lab's bed (8.1); neither plays a floor that is heard, but their prompts were sharpened once
more. Measured by the floor without the 20 dB, 26 of the 74 recordings would fail: every bed
but the archive's, the calm and the tense stem, and 13 one-shots, 11 of them sounds that fill
their file, such as the ping, the steam's hiss and the radio's static. With it, two fail, both
played at a gain of about 0.7: the door's slide, which settles on a floor of −42.7 dBFS after
the slide, and the power going down, whose whine still falls at −43.5 dBFS where its file ends.
The `lost` sting came back 19.0 s long for the 10 s asked, its chord struck three times.

## The mix (`mix.ts`)

Every sound goes into one AudioContext (`sharedAudio()`, made on first use) and there into one
of five buses, which the settings' three volumes set:

```text
music ─────── musicDuck ────┐
sfx ────────────────────────┤
ambience ──── ambienceDuck ─┼─ master (the sound switch) ─ limiter ─ trim ─ output
voice ──────────────────────┤     the radio: mission control's voice and its key, dry
announce ───────────────────┤     the plant's loudspeakers
reverb's return ────────────┘
sfx ──────────── send −14 dB ─┐
ambienceDuck ─── send −18 dB ─┼─ the room's reverb (reverb.ts) ─ its return
announce ─────── send −6 dB ──┤
intercom ─────── send −14 dB ─┘   a crew voice over the station's intercom (voice/intercom.ts)
```

Musik sets the music, Effekte the effects and the rooms' beds, Funk the radio and the
loudspeakers (`settings.ts` `applyVolumes`, `mix.ts` `setBusVolumes`); the master gain is the
sound switch (`isMuted()`). Behind it stands a brickwall, a DynamicsCompressorNode at threshold
−3 dB, no knee, 20:1, 1 ms attack and 100 ms release, so that effects stacked on one another
never clip. Web Audio puts a makeup gain behind every compressor, worked out from its own curve
— its gain at full scale, inverted and raised to 0.6: +1.71 dB for these settings — which the
trim takes back (`limiterMakeup`), so that whatever stays under the threshold plays exactly as
loud as before the brickwall. The devices' own sounds (`puzzles/sounds.ts`) go into the
effects' bus like every other effect — the meter's hum and the colour tones the game pitches,
and the device hum while a panel stands open, too: the Effekte volume and the sound switch reach
them there, the bus's send carries them into the room's reverb, and the brickwall covers them
with the rest (`test/deviceMix.test.ts` follows their chains into the real mix).

**Ducking.** Mission control's voice pulls the music 8 dB and the beds 4 dB down while it is on
the air — from its opening squelch where it opens a run, else from its first word — and the
klaxon, the alarm's sting and the siren pull the music 6 dB down while they sound; where several
pull at once the deepest holds, and as one lets go the bus comes back to the next deepest. A bus
goes down over 50 ms and comes back over 400 ms, on straight lines laid on the audio clock from
the moments each pull starts and ends (`duckKnots`, pure); a move cut short by the next starts
that one from where it stood. A line straight after another keeps the music down between them.
The loudspeakers' announcement pulls nothing: it is the room's sound, and the cue under it
would only pump.

Until a click or a key resumes the context (the browser's autoplay rule), one-shot effects are
dropped rather than queued; the loops — beds, music, rotors — are built anyway and sound once
it runs. The crew's own voices bypass the master gain: switching the lab off leaves the crew
audible, and only the station intercom's touch of the room's reverb goes with the lab (The
crew's voice, below).

Levels, at the master gain: the effects around 0.04 (`EFFECTS_LEVEL`) for a recording whose
peak stands at −3 dBFS; a room's bed 0.03 for one at −20 dBFS RMS, each layer a few dB up or
down from it; the music 0.02 for a stem at −20 dBFS RMS — its RMS 26 dB under the effects'
level, about where the synthesised pad sat; the end card's sting its RMS 8 dB under the
effects' level; the loops of the mains hum, the siren and the drone at levels that put each
about where the sound it replaced sat; the radio voice at 0.12 of a line's peak; a partner's
step at 0.02 before it is placed, your own 4 dB under it.

Nothing of it runs in the frame loop. One timer listens to the lab ten times a second
(GameWorld.tsx): the beds follow the player's tile, the doors, the lit rooms and the power,
the room's reverb and the floor under the player follow the room, the partners' steps and the
drones are placed, the music follows the clock — and each of them schedules what is due on the
audio clock (`AudioContext.currentTime`), the own room's sporadic sounds 0.4 s ahead, the
music's elements a second ahead. Your own footsteps and the doors still come from the frame
loop, on the frame their step lands or their leaf starts to move.

## What a page keeps (`samples.ts`, `audioStream.ts`, `audioMemory.ts`)

Until this was built every recording was decoded in the lobby: 74 files, 390 s, all of it
stereo at 44.1 kHz as ElevenLabs makes it — about 138 MB of PCM a page, the three 72 s stems
alone 76 MB. On 2026-10-26 a walkthrough under `SHOTS_SOFTWARE_GL=1` with four pages failed on
this machine for it, and a phone does not give a tab that much. A page now keeps at most
**30 MB**, measured: every buffer of samples the game holds is registered with who holds it
(`audioMemory.ts`), and the probe reports the sum as `audio.decodedBytes`, by holder in
`audio.decoded`.

- **The first minute first.** The lobby loads what a run needs in its first minute
  (`FIRST_MINUTE`): the power hum, the blackout's thunk, arcs, drain, relay and buzz, the lights
  striking, the steps on every floor, the doors, the first find, the radio's keys for the
  Leitstelle's first line, the briefing's count and the first station's lever. The rest of the
  effects and loops follow in the background once the lights have failed (`loadTheRest`, from
  `ambience.ts` `hearRooms`) — or as soon as one of them is asked for — two at a time, after
  whatever is wanted now. A recording that fails is said once and asked for again no sooner
  than 5 s on.
- **One-shots in one channel.** Every effect and loop is folded to one channel once decoded,
  the mean of its two, at the files' own 44.1 kHz: it is placed by a panner or sounds everywhere
  alike, and a panner places one channel better than two. 69 one-shots and three loops, some
  60 s once all are made: about 10.5 MB.
- **A room's bed for the rooms near.** A bed keeps both its channels — a room tone's width is
  the room — at 32 kHz, a quarter less than 44.1: what a bed at its level is heard by lies
  under 16 kHz. It is loaded only for the room the player stands in and the rooms one way from
  it, through a door shut or open or an opening, and only the layers their power has due
  (`ambience.ts` `bedsWanted`): in the dark a corridor's bed is not even loaded. One no room
  near needs is let go 4 s later, long after its loop has faded. 2.56 MB a bed; in Blackout's
  Flur, with the power on, four of them.
- **The music streams.** The stems, the end card's stings and the opening's cue are never
  decoded: each plays from its file through an `<audio>` element that Web Audio takes in
  (`MediaElementAudioSourceNode`, `audioStream.ts`), which decodes a little at a time and keeps
  none of it. The stems' files are fetched once as the music starts and kept as they came —
  1.7 MB each, compressed, not counted — and their elements play them from memory; the stings
  and the cue stream from the server.
- **A line as it airs.** Mission control's lines are fetched at a run's start and kept as they
  came; a line is decoded as it comes over the air, in one channel at 22.05 kHz — the radio's
  band ends at 3.4 kHz and the loudspeakers' at 5 — and let go once spoken (below).
- **What is made.** The radio's static (2 s, made once) and the room's impulse responses (one,
  or two while they cross) count too.

Decoding a stem instead was measured against it: 72 s in two channels at 44.1 kHz is 25.4 MB a
stem, and a change of stem holds two at once — 50.8 MB, the budget's whole and more before a
single effect; in one channel at 22.05 kHz still 12.7 MB a stem. Streaming had to keep time
instead, and it was measured in the walkthrough's Chromium on this machine, two elements of the
critical stem recorded frame by frame through an AudioWorklet and found in the decoded file by
cross-correlation (`scratchpad/sound/stream`): an element started by `play()` at the moment its
timer came sounds within 1–8 ms of that moment, idle or under a frame loop that keeps the main
thread busy 12 ms a frame; its `currentTime` stands within 2 ms of what is heard and does not
drift over 45 s; a seek in the MP3 lands 17–26 ms off where it says it is; a playback rate of
1.05, the pitch kept, gains 5 ms of position every 100 ms from the moment it is set, while
switching `preservesPitch` off throws its position about by hundreds of milliseconds. So nothing
is ever placed in time by a seek: an element starts from its file's start on its timer, and one
that came in late is caught up by playing it up to 3 % faster, its pitch kept (`steer`). The
walkthrough logs, for the music, how late its latest element came in and how far one that has
played a second or more is off now.

## What it may cost

Chrome renders every node wired into the output, 375 times a second, silent or not, on an
audio thread that shares the machine's cores with the page, and every node made and let go is
garbage for the page to collect; on a CI runner with two cores and software rendering both are
felt in the frames. So the sound keeps to a budget (`CAPS` in `audio.ts`): the beds, the
music and the placed sounds together keep at most 12 voices (the sources of short sounds) and
6 loops alive. A short sound with no room left in it is not played; a loop that finds none is
tried again on the next round. A room's layer, the rotor and a stem of the music each take a
loop while heard and are stopped, not muted, whenever they are not — a stem's two elements
taking turns are one loop; a partner's step goes into a stage that stays (a partner's feet) and
is unwired as it ends (`playSample`); a drip, a clank, a drone's chirp or fly-by, a door each
go into an outlet of their own at their level, unwired once they have ended (`capped`) — a voice
each; the opening's cue takes a voice while it streams. Nothing of a sound stays in the graph.
Mission control's voice, the effects and the end card's sting are not counted. The room's
reverb is one convolver, two for the 300 ms they cross, its input unwired once its tail has
died; the brickwall is one compressor.

Measured on the Systemcheck walkthrough at `SHOTS_CPU_SLOWDOWN=3` before this budget, by the
probe's census: by the escape the host's audio graph held 399 nodes wired into the output
(163 gains, 97 filters, 52 oscillators, 85 buffer sources) while 19 sources played — every
note, step and sporadic sound had left its last gain stage wired to its bus — and Chrome
counted about 550 live audio nodes on the host page, against about 150 for the lab before
the sound. With the budget the graph holds about 40 nodes in the escape and does not grow. At
full speed every frame window of both missions keeps 16.7 ms; at a third of the speed the
windows stay within the spread the lab without sound shows on the same machine.

To tell the systems' costs apart, `?audio-off=beds,music,spatial,reverb` switches any of them
off (`SHOTS_AUDIO_OFF` in the walkthrough), and with `?trace=1` the probe reports
`audio.nodes` — the sources playing and the nodes wired into the output, by kind, media
elements, compressors and convolvers among them — `audio.spent`, the main thread's milliseconds
each system has taken (the reverb's own besides the beds', which call it), and `audio.budget`,
the voices and loops given out against their caps.

## Rooms you can hear (`ambience.ts`)

Each room plays a bed after its label's kind (the art bible's room kinds; a room without a
kind is a plain lab room). A bed has two layers: what runs on the lab's power, and what lives
without it. Each layer is a recording that loops seamlessly (ElevenLabs' `loop: true`), 10 s
long, played at its own level against the bed's — so that a server room roars and an archive
hushes, though every bed comes in at −20 dBFS RMS; each sporadic sound is a one-shot recording,
played a little faster or slower each time.

| Kind | On power | Without power |
| --- | --- | --- |
| server | `bed-server` +3 dB: rack fans, a 120 Hz hum, a power supply's whine | a creak every 15–35 s |
| machine | a piston's stroke every 1.6 s, steam hissing every 8–20 s | `bed-machine-idle`: idle machinery's rumble |
| archive | `bed-archive` −8 dB: soft air through a duct | a drip every 7–12 s |
| corridor | `bed-corridor` −2 dB: vent hum and duct air | a clank far down the corridor every 20–40 s |
| lab | `bed-lab` −3 dB: a fridge's compressor, a fume hood, bubbling every 10–25 s | a creak now and then |
| reactor | `bed-reactor`: the containment hum | `bed-reactor-idle`: the core's rumble, a throb on its beat |
| control | `bed-control` −3 dB: console hum, screens' whine, a relay's tick every second | a creak now and then |
| plain | `bed-plain` −3 dB: ventilation and a 55 Hz building hum | a far clank, or a creak a third of the time, every 7–15 s |

The room the player stands in plays both its layers at full and its sporadic sounds; the two
nearest rooms behind an open door or an opening — nearest by the way between — play their main
layer 12 dB under it; the rest nothing, stopped. A door or a doorway never flips the room. A
change crossfades over 1.2 s. The audience stands nowhere and hears no beds. A bed's recording
is loaded as its room comes one way near the player — through a door shut or open, so that it
is there when the door opens — and only for the layers its power has due; it is let go 4 s
after no room near needs it (above, „What a page keeps").

While the lab has its power (Normalbetrieb) every bed runs with the power hum. With the bang
of the blackout the powered layers spin down over 1.4 s, the loop slowing to a quarter as it
fades — its hums falling in pitch, its fans winding down: drips, rumble and creaks stay. A
room whose lights a station brings back warms its powered layer up along the lights' own
warm-up (`rooms.ts` `warmUp`, dips and all); a room lit before the
screen looked comes back at once. A run won powers every room again. The reactor's throb,
which swells for a third of a second, comes that much before the top of the core's light, 2.4 s
apart on the simulation's clock.

### The room's answer (`reverb.ts`)

Every sound of the effects' bus, every bed and the plant's loudspeakers are answered by the room
the player stands in: one impulse response for each kind of room, made rather than recorded —
noise through a one-pole lowpass, the walls taking the top off, decaying exponentially by
60 dB over the room's time, a steel room ringing in five inharmonic modes (420, 690, 1130, 1870
and 2950 Hz) over it, two channels from two seeds so that its tail is wide, each at the RMS gain
its room gives back — and the same seed, the same room, run after run (`impulseResponse`, pure).

| Kind | Rings | Bright up to | Steel | Gives back |
| --- | --- | --- | --- | --- |
| corridor | 1.2 s | 9 kHz, bright | — | 0.9 |
| lab, plain | 0.6 s | 6 kHz | — | 0.7 |
| server | 0.4 s | 2.5 kHz, dull: the racks' foam | — | 0.6 |
| reactor | 1.8 s | 7 kHz | 0.5, metallic | 1 |
| archive | 0.5 s | 3 kHz, dead: the books | — | 0.35 |
| machine | 1 s | 5 kHz | 0.25 | 0.85 |
| control | 0.7 s | 5.5 kHz | — | 0.65 |

A ConvolverNode plays it on the mix's sends — the effects at −14 dB, the beds at −18 dB after
their duck, the loudspeakers at −6 dB, a crew voice over the station's intercom at −14 dB, the
radio and the music not at all — its normalisation off, so that a dead archive answers less than
a steel hall; its return goes into the master.
Walking into a room of another kind brings its answer in over 300 ms while the old one goes;
the old convolver is let go once its tail has died, one still going is cut over 20 ms for a
third, so that two play at most, and only while they cross. The audience hears the lab dry. The
response is made on the main thread as the room changes (1–3 ms) and the convolver set up with
it; the probe counts the time as the reverb's (`audio.spent.reverb`).

## A partner you can locate (`spatial.ts`, `footsteps.ts`)

A partner steps every half tile they walk, as you do, and every step sounds the floor under
them: concrete in the corridors, the machine room and a room without a kind, linoleum in the
lab, the archive and the control room, steel in the server room's raised floor and the
reactor's tread plate (`footsteps.ts` `SURFACES`; a doorway keeps the floor of the step before).
A step is one of the three takes of the same work boot on that floor, at random, ±5 % in speed.
Your own steps sound the floor of the room you stand in, 4 dB under a partner's, a little louder
at a sprint, unplaced.

Each placed sound is panned by how far to the side it stands (all one side at 6 tiles), plays
in full within 4 tiles and falls off beyond as Web Audio's inverse model does — 4 / (4 + 1.2 ·
(distance − 4)): 0.45 at 8 tiles, 0.29 at 12 — and is not started at all beyond 12 tiles,
which saves its voice. With no line of sight between (`canSee`, walls and shut doors) it is
muffled through a 600 Hz low-pass, 6 dB further down and 15 ms later, the way round the wall
(a DelayNode in its stages, gliding as a wall comes or goes). The steps of one tenth of a
second are spread evenly over the next, so they keep their pace, into the stages that place
that partner, kept while the partner is within earshot and moved ten times a second. The
nearest drone in flight within 12 tiles buzzes faintly where it flies — the recorded loop of a
hovering quadcopter (`drone-rotor`) — placed the same way; beyond, or frozen by its plate, the
rotor stops. A drone that comes within 2.5 tiles whooshes by, its rotors rising and falling
away (`drone-pass`), once in 6 s at most. A drone chirps once when it catches somebody, its
recording placed where it flies. A door that starts to slide is heard from where it is
(`doorMoved`, its own leaf no wall between): its pneumatic slide as it opens, one of two closes
as it shuts. The audience hears the doors unplaced and none of the rest.

## The crew's voice and the station's intercom (`voice/mesh.ts`, `voice/intercom.ts`)

The crew's push-to-talk goes from browser to browser and plays through the shared context, past
the master gain. How loud each voice plays is the voice's rule (`voice/rules.ts` `crewGain`):
between the places of the armed station — its consoles and the open sources that cover it, as
the server counts presence and the view of each player on them lists it (core `map.ts`
`intercomOf`, the view's `intercom`) — in full, however far apart the two stand and whatever
walls lie between, as over the station's intercom; everywhere else by proximity, as before: in
full within 4 tiles, falling on a straight line to 15 % at 10 and staying there, ×0.35 through a
wall or a shut door. A spectator hears every voice in full and plain.

```text
voice ─ volume ─┬─ plain ──────────────────────────────── output, past the master
                └─ 400 Hz ─ 4 kHz ─ speaker ─┬─────────── output, past the master
                                             └─ −14 dB ── the room's reverb (sends)
```

Over the intercom the voice comes out of a console's speaker: a high-pass at 400 Hz and a
low-pass at 4 kHz, each second order (Butterworth), and from the speaker 14 dB under into the
room's reverb — the sends the plant's loudspeakers ring in, at the effects' level — so that the
partner sounds in the room's speaker rather than at the player's ear. No squelch, no static, no
shaper: it is no radio. Under the proximity rule the plain way is open and the speaker's shut,
and nothing of the voice reaches the reverb. Going on the intercom or off it moves the volume
and both ways on straight lines over 150 ms, each from where it stands (`switchPath`), so that
nothing clicks; the distance waits that long, and then the volume glides by it as before, a time
constant of 0.12 s, looked at twenty times a second. Muting the lab leaves the dry voice; only
the reverb's touch goes with it. The device's PARTNER LED ends in „· Funk" while the page hears
that partner over the intercom, their link up (`VoiceState.intercom`).

Measured with the audit's pairs, re-run on the branch's own code — the core's run of Blackout
on seed 5, the station armed, the pair placed as the server counts presence
(`scratchpad/intercom/m7-voicegain.mjs`, copied from the audit's):

| Pair | Apart | Before | After |
| --- | --- | --- | --- |
| Signalkette, console A ↔ B | 14.4 tiles, no sight | −25.6 dB | 0 dB |
| Notstrom, box ↔ the book's reader | 12.1 tiles, no sight | −25.6 dB | 0 dB |
| Notstrom, box ↔ meter | 5.1 tiles, no sight | −10.6 dB | 0 dB |
| Serverraum, terminal ↔ rack | 8 tiles, in sight | −7.3 dB | 0 dB |
| Signalkette armed, console A ↔ the solved meter | 17 tiles, in sight | −16.5 dB | −16.5 dB |
| Serverraum armed, terminal ↔ Signalkette B | 12.2 tiles, no sight | −25.6 dB | −25.6 dB |

With `?trace=1` the voice's probe (`window.__escapelab.voice`) gives each voice's volume as last
set (`gains`, by peer) and whom the page hears over the intercom (`intercom`).
`test/intercom.test.ts` holds the band, the two ways, the send, the 150 ms ramps and the
unwiring; `test/voiceMesh.test.ts` the pages: console and console, console and source, source and
source of the armed station in full through a wall 14 tiles off, every other pair by proximity
and plain, the ramps on and off and no glide during them, the screens told only while the link
is up; `core/test/intercom.test.ts` and `server/test/intercomRoom.test.ts` who is on it. The
walkthrough fails unless both devices at the first two-console station say „· Funk" and both
pages play the partner in full (partner-funk.png).

## Answers that wait for the lab (`press.ts`, `audio.ts`)

The station's chirp (`console-ready`) plays as the server takes E, never on the press: a press
it refuses has no chirp, and its words turn the prompt pill amber instead (`press.ts`).
Reading a source, a note or a station already open needs nobody's yes, and chirps at once. An
emergency cleared in time chimes (`stage-chime`, `emergencyOver`); one that runs out has its
alarm's klaxon and no sound of its own. A station solved while a player reads its rules at the
source plays the solve's chord for them too, quietly (`readerSolve`, two fifths of a chirp) —
the ka-chunk and the full chord are the operator's at the console — and the room it lights
comes on behind the open book at once: only a station's panel holds the light back until it
closes. A part put down (Q) is set down with the sheet's recording (`sheet-down`) within
earshot; a page turning in a book and the notepad taken up are the paper's swish that recording
opens with (`paperSwish`, cut at 0.1 s, before the board's clack), the notepad laid down its
whole sound, and a terminal's screen changing the display's tick (`step-tick`). A body walked
into a wall thuds once a push (`wall-thud`, `wallBump`), its steps silent while it stands. The
drone warning (`danger.ts`) keeps the ping's recording (`ping`) until L-1 renders one of its own.

## A voice on the radio (`radioVoice.ts`, `scripts/voice.ts`)

Mission control speaks every line a shipped mission can put on the air: everything core's
`logRadio` is handed — `radio.start` as the clock starts, each `puzzles[].onSolved` as its
station is solved, `radio.escape` as the hatch unlocks — and each station's `nudges` while
it stays quiet. Emergencies and lost runs go into the run report, not on the air. Notes of
the last crew and the devices' texts are read, not heard. A line without a recording — a
custom mission's — keeps the radio's key.

**Who speaks.** The Leitstelle talks as a control room does on the radio: short, factual and
still human — what it sees, what is next, the place in the words a person would use („mitten
im Flur, unter der roten Lampe"), never an answer, no praise, no feelings spelled out. The call
sign opens a run („Leitstelle an Nachtschicht.", in the Systemcheck „… an Schulungsgruppe.")
and no other line, and a nudge names the next place in one sentence. A line says 22 words at
most beside its call sign, in two sentences at most; a short call of three words or fewer
(„Reaktor läuft.", „Alle raus, jetzt.") may stand beside them, three pieces in all. Read by a
deep, trailer-like voice, the lines stay plain: only the escape may call out with an
exclamation mark. `core/test/radioLines.test.ts` holds every shipped line to that — words,
sentences and pieces, no praise („gut gemacht", „super", „toll" …), the call sign in
`radio.start` alone, nudges of one sentence, no exclamation mark but on the way out, no
„Spieler", „Crew-Mitglied" or „Bediener", nothing from the manuals' code tables (E23,
„Legende", „Zeile"), a line for every station — and Blackout and the Systemcheck to a start
with the call sign, a nudge for every station, a line after every solve but the last, and the
escape.

```sh
pnpm --filter @escapelab/client voice              # record the lines that have no recording yet
pnpm --filter @escapelab/client voice --fresh      # every synthetic line this voice did not make
pnpm --filter @escapelab/client voice --fresh=all  # … and a person's recordings too
VOICE_MODEL=de_DE-thorsten-medium pnpm --filter @escapelab/client voice --fresh  # another Piper voice
VOICE_ENGINE=say pnpm --filter @escapelab/client voice --fresh   # the Mac's own voice (Anna)
```

On a Mac, with `uv` (`brew install uv`). The script reads `missions/*.json` and has Piper read
each line: `uv run --with piper-tts==1.8.0` on Python 3.13, so nothing is installed for good.
Piper is a build tool here and never ships — only its recordings do; the Piper of today
(piper1-gpl) is GPL-3.0, the MIT original is archived. The model is the one `VOICE_MODEL`
names, `de_DE-thorsten-high` by default, fetched once from the Piper voices on Hugging Face
(`rhasspy/piper-voices`, pinned to one revision) into `~/.cache/escapelab-piper/`, outside the
repo; its voice is Thorsten Müller's, whose dataset is CC0. Piper reads at `length_scale` 1.05
(a little slower than the model's own pace, some 3.5 words a second) and leaves 0.25 s
between two sentences. Before it sees a line, `piperText` makes a dash or a middle dot a pause
as long as a semicolon's, says a time once („23 Uhr 47"), and gives Piper the words espeak-ng —
whose phonemes Piper speaks — gets wrong in the shipped lines the way it reads them right
(`SPOKEN_AS`): a compound split where its parts come out right on their own („Notstrom" came
out „Nots-trom", „Notzellen" stressed on „zel", „Maschinenraum" and „Serverraum" stressed on
their first syllable, „Südtür" with a short ü, „Westende" as „Wes-tende", „Kabel" short),
Piper's own phonemes where no spelling helps („Labor" stressed as „LA-bor", „Unterlagen" on its
third syllable). Such a block never ends a sentence that another follows: Piper runs the next
sentence into it, stop and pause lost — so the Systemcheck calls „Schulungsgruppe", not
„Schulungslabor" — and `test/voiceLines.test.ts` checks every line for it. Single letters need
nothing: espeak-ng reads „Pult A" and „Pult B" as „Pult Ah" and „Pult Beh". Every word of every
line was phonemized to find these.
Each WAV goes to AAC with `afconvert -f m4af -d aac -b 48000` into
`packages/client/public/voice/<first 12 hex of the line's SHA-1>.m4a`, and `manifest.json`
lists `{ [id]: { text, ms, missions, file } }`, `file` naming the recording the radio plays — an
.m4a or an .mp3 — with `opens: true` on a run's first line. A synthetic recording carries
`render`, a hash of what made it: the engine, the voice and its settings, the words as the engine
was given them. `--fresh` makes anew only what the chosen voice would make differently, so a
render cut short goes on where it stopped and spends nothing twice, and the list is written
after every line. A recording no line needs any more is deleted. The files are committed (47
lines, 1.6 MB; the longest speaks 9.5 s in 62 kB); `test/voiceLines.test.ts` fails, naming the
command, when a shipped line has no recording, when a file is over 150 kB or the folder over
6 MB — raised from 3 MB for ElevenLabs' MP3, some 12 kB a second — and when a recording takes
less than 200 ms or more than 700 ms a word.

**ElevenLabs.** `VOICE_ENGINE=elevenlabs` has an ElevenLabs voice read the lines through the
official SDK, `@elevenlabs/elevenlabs-js`, a dev dependency of the client that never ships,
written as ElevenLabs' text-to-speech skill shows it (`scripts/elevenlabs.ts`). The SDK reads
`ELEVENLABS_API_KEY`: from the environment, or from the repo's `.env.local`, which the
ElevenLabs CLI writes (`npx -y @elevenlabs/cli@latest onboard init`) and git ignores; the script
puts that one value into its environment and prints it nowhere. The model is `eleven_v4`,
ElevenLabs' newest and the skill's default, which speaks German among some 90 languages; it
takes only stability (0.5) and similarity (0.75), so style and speaker boost are left out, and
German is enforced with `language_code: de` (`ELEVENLABS_MODEL` names another model: style 0.2
and speaker boost go to v2 and v3, and `eleven_multilingual_v2` takes no language code). The
voice is „Helmut - German Epic Trailer Voice" (`g1jpii0iyvtRs8fqXsd1`) where `ELEVENLABS_VOICE`
names none, by id or exact name. Each line comes as `mp3_44100_96` into
`public/voice/<id>.mp3`; the requests go one after the other, 300 ms apart, and one turned away
as too many (429) waits the seconds its `retry-after` asks before it goes again. Before it
starts the script prints how many characters it will spend, and asks nothing.

```sh
pnpm --filter @escapelab/client voice --list-voices   # the account's voices: name, id, labels
VOICE_SAMPLES_DIR=~/Desktop pnpm --filter @escapelab/client voice \
  --sample g1jpii0iyvtRs8fqXsd1 "Reaktor läuft. Alle raus, jetzt."   # one line, to listen to
VOICE_ENGINE=elevenlabs pnpm --filter @escapelab/client voice --fresh   # every line, by Helmut
```

The free plan gives 10,000 credits a month; every shipped line read once is 3,983 characters,
some 4,000 of them, and a run that stops short spends nothing twice. On the free plan ElevenLabs
asks for attribution: wherever the game is shown with these recordings, name ElevenLabs
(elevenlabs.io) as the voice's source.

**A person's voice.** The page `/record`, which no menu links to, shows one line at a time in
large type with its number and its text to copy („Text kopieren", or marked in a field where
the browser keeps the clipboard shut), records it from the microphone, trims the silence at both
ends to 120 ms in the browser and plays the take back for a retake or „Speichern"; a file made
elsewhere — in ElevenLabs' web app, say — can be dropped on the line's zone instead („Audiodatei
ablegen": mp3, m4a or wav; WebM not, which afconvert cannot read). Either goes to the server's
`POST /voice/:id` — there only with `ALLOW_RECORD=1`, as `pnpm dev` sets it, 404 otherwise, 8 MB
at most — which keeps an MP3 or an M4A as it came and converts a WAV with `afconvert`, and marks
the line's manifest entry with its file, its decoded length and `source: 'human'` or `'upload'`.
The game plays whatever the manifest names, so a person's recordings replace the synthetic ones
line by line, and the voice script keeps them — under `--fresh` too — until `--fresh=all`
replaces them.

Where the model cannot be fetched — no network — the script says what to run once by hand,
and VOICE_ENGINE=say still reads the lines with the Mac's Anna (`say -v Anna -r 190`, a dash, a
middle dot or a colon a 250 ms pause):

```sh
mkdir -p ~/.cache/escapelab-piper
curl -L -o ~/.cache/escapelab-piper/de_DE-thorsten-high.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx
curl -L -o ~/.cache/escapelab-piper/de_DE-thorsten-high.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json
```

At a run's start the mission's lines are fetched and kept as they came, compressed — Blackout's
24 lines some 2 MB — and the line that opens the run decoded, so that it comes the moment the
lights fail; any other line is decoded as it comes over the air, from its file in memory, in one
channel at 22.05 kHz (a few tens of milliseconds), spoken and let go, so that a page keeps a line
or two decoded rather than a mission's 159 s (28 MB at 44.1 kHz). A line asked for while an
older one still decoded speaks alone. When the banner shows a line, its recording plays as a
handset hears it: high-pass 300 Hz and low-pass 3.4 kHz, each fourth order, a light waveshaper
(tanh at a drive of 1.2: a 1 kHz tone at the speech's peak comes out with 8 % distortion,
where the drive of 2.2 the Mac's voice had gave 17 %, and the quiet parts come up 3 dB against
the peaks instead of 7, so that the consonants stay clear), a bed of static 33 dB under the
speech, a squelch as the key goes down and a longer one as it comes up — each a recording
(`radio-key`, `radio-tail`), its peak about 6 dB under the speech's — and the music goes 8 dB
and the beds 4 dB down meanwhile (mix.ts, above). The run's first line comes after the
Leitstelle opening the channel: static swells up for 0.3 s and snaps shut on the squelch gate's
click (`radio-open`), 0.4 s before the key — on that line alone. A line no recording speaks, a
custom mission's, keys the radio with the key's recording alone (`radioChirp`). A newer line
cuts an older one short. The banner stays up while its line speaks: 7 s at least (4 s on a
touch screen), and as long as the recording, its opening and its squelch take for a longer line
— by the manifest's length where the line is not decoded yet (`radio.ts` `noticeMs`,
`radioVoice.ts` `airtimeMs`).

**The voice.** Three German Piper voices were compared by measurement on the same three
Blackout lines — the start, the Signalkette's places, the escape — each at `length_scale` 1.05
with 0.25 s between sentences: how long it speaks, how far its pitch moves (10th to 90th
percentile by autocorrelation over 40 ms frames, checked with YIN) and the share of 20 ms
frames 40 dB under the loudest.

| Voice | Speaks | Pitch, 10th–90th percentile | Spread | Silence |
| --- | --- | --- | --- | --- |
| de_DE-thorsten-high (22 kHz) | 8.0 / 6.6 / 8.4 s | 104–176 / 100–188 / 105–162 Hz | 9.1 / 10.9 / 7.4 semitones | 20 / 25 / 20 % |
| de_DE-kerstin-low (16 kHz) | 8.5 / 7.2 / 9.7 s | 145–180 / 152–186 / 138–184 Hz | 3.7 / 3.5 / 5.0 semitones | 20 / 17 / 21 % |
| de_DE-eva_k-x_low (16 kHz) | 10.7 / 6.8 / 9.5 s | 168–222 / 154–211 / 163–211 Hz | 4.8 / 5.4 / 4.4 semitones | 22 / 9 / 14 % |

Thorsten's pitch moves two to three times as far as the others' — a person stressing what
matters, where Kerstin and Eva read flat — he speaks the lines in the least time at the same
pace, and his pauses fall where the commas are, a fifth of the line, as in speech; Eva drags
the first line out to 10.7 s and runs the second together with 9 % of pauses. Thorsten it is:
a calm, low male voice (his pitch round 120 Hz), the night shift at the desk.

**Tried next: Chatterbox.** Chatterbox Multilingual (Resemble AI, code and weights MIT,
`chatterbox-tts` 0.1.7) runs on the M4 through `uv run --python 3.11 --with
chatterbox-tts==0.1.7 --with "setuptools<81"` — its watermarker imports `pkg_resources` — with
3.2 GB of weights: loaded in 12 s on the CPU (27 s on MPS), each of the three approved Blackout
lines took 32–53 s on the CPU (89–181 s on MPS) for 6–9 s of speech. Its default speaker talks
faster than Thorsten with fewer pauses (12–21 % silence against 20–25 %) and a higher, livelier
pitch (median 136–174 Hz against 117–130 Hz), but Whisper could not make out its escape line in
either take, and every output carries Resemble's inaudible PerTh watermark; the game stays
with Piper.

## Music that breathes (`music.ts`)

Three recorded stems, between which one pressure value from 0 to 1 crossfades — Eleven Music
composed them from one brief, all three in A minor at 90 bpm, so that one blends into the next:

- **calm** — an uneasy pad over a low drone, sparse muted piano, no drums;
- **tense** (from 0.35) — a bass pulse on every beat, a sparse A-minor arpeggio, low strings,
  light ticking percussion;
- **critical** (from 0.8) — pounding low drums, fast hats, a pulsing bass and a string
  ostinato in double time.

The pressure follows the clock — the tension curve the lab always had, 0 while half the time
or more is left and rising to 1 at the end, and at least 0.8 in the last minute — adds 0.15
for 20 s with every alarm, and stays at 0.8 at least in the escape. A stem goes only a little
under its threshold before it leaves, so a wavering pressure never flips it. Every alarm the
music hears brings the alarm's sting with it, two seconds of brass and strings on the effects'
bus, the music pulled 6 dB down under it.

The stems keep bars: four beats at the tempo the catalog gives them (`bpm`, the one their
prompts state, 90), counted from where the music starts — 2 s after the blackout's click (in a
run without an intro, as it starts), never while the lab still has its power, and no sooner
than its first element's timer can make it. A change waits for the next bar: the stem coming
in starts from its beginning on that bar line — where its sound starts, past the silence its
file opens with — and crosses with the one going over 2 s; the one going stops once it is
silent and lets its elements go. A stem plays round and round on two elements taking turns,
one loop of the budget: its next pass starts from its beginning on a bar line too, as many
whole bars after the last as leave room — 24 bars, 64 s, for a 72 s stem — and comes in one bar
later over 3 s on equal-power curves while the pass before goes out under it; the bar between
is the one a late element is caught up in, unheard. Each element is told a second ahead when to
start, and steered while it plays (`audioStream.ts`). Every stem's file is fetched once as the
music starts; one that could not be had is asked for again 5 s on. In the escape, under the
siren, the critical stem plays. A run won fades the music out before the end card's sting; a
run lost drains it, its low-pass closing and its elements slowing to half their speed, with the
power. The end card streams its sting once on the music's bus (`playSting`): `won`, strings
and soft brass rising to a C major chord over a breath of wind, or `lost`, a low A-minor chord
sinking into silence. The heartbeat that quickened through the last minute is gone with the
synthesised layers: the critical stem carries the last minute.

## What the budget changed, to the ear

- A room behind a door plays its main layer only, and only the two nearest such rooms play;
  their drips, creaks and clanks are the own room's alone.
- Only the nearest drone within earshot buzzes.
- A recording sounds the same every time but for its speed: a step varies over three takes and
  ±5 % in speed, a sporadic sound of a room up to 15 %; its place follows a partner ten times
  a second while it sounds.
- The audience hears no beds and no reverb.
- A short sound that finds no room in the budget is not played; a placed one beyond 12 tiles is
  not started at all.
- An effect asked for in the lobby's first seconds, before the rest of the effects have come, is
  not played; the first minute's are there.

## Proof

Unit tests run every module against a fake AudioContext that keeps the graph, the
recordings served to a fake fetch and decoded by a fake OfflineAudioContext at its own rate,
each tagged with its id (`test/fakeSamples.ts`), and a fake `<audio>` element whose position the
test moves (`test/fakeMedia.ts`): `test/samples.test.ts` (nothing before it is asked, the first
minute in the lobby and no more, the rest once asked, two at a time and never a bed, a one-shot
folded to one channel at 44.1 kHz and a bed kept in two at 32 kHz, the gain and the start
applied, what is kept counted and let go, a load shared with the entry that borrows it, an entry
awaiting its render silent, a failure said once and asked again 5 s on, the music's entries
named and never decoded), `test/audioMemory.test.ts` (four bytes a sample, by holder, a shared
buffer once, the 30 MB budget), `test/audioStream.test.ts` (a file streamed through a level of
its own, started from its start as its timer comes, how late it came in, caught up at most 3 %
faster and slowed when ahead, a seek only where the beat does not matter, rewound and let go,
held back by the browser and played at the next gesture), `test/mix.test.ts` (the brickwall's
settings and its makeup taken back, every bus into the master and the master through the
brickwall, the sends into the reverb and none from the radio or the music, Musik, Effekte and
Funk on their buses, a later engine at the volumes set, the ducks' depths, 50 ms down and 400 ms
back, the deepest of two held, a move cut short, a pull with no end, the klaxon and the siren
pulling the music, the volume's tick through its bus), `test/reverb.test.ts` (each kind's time,
60 dB of decay, the same seed the same answer, its level, bright and dull rooms, the reactor's
modes over its noise, the convolver on the sends into the master, a 300 ms crossfade and the
old one let go after its tail, a third cut, nobody's room dry, `?audio-off=reverb`),
`test/footsteps.test.ts` (the floor of each kind, three takes a floor, ±5 %, the floor under the
player and under a tile, a doorway keeping the last, your own step 4 dB under a partner's),
`test/sampleManifest.test.ts` (the code's ids against the catalog, the catalog's `usedBy`
against the code, the entries awaiting the render and what they borrow, every other recording
on disk, made from its request as it stands, its length, its start, its gain, its floor, the
stems' tempo in the manifest, the folders' caps), `test/sfxScript.test.ts` (the catalog's rules
— a stem's tempo the one its prompt states, the stems' one tempo, no other kind's — the requests
and their hash, the tempo asking nothing anew, what a run makes, the command line, the
candidates' influences and the rules a take is picked by, the credits' guard and the pricing at
the first entry's rate, a WAV read, the gain, the start, the silence and the floor worked out
from PCM of known loudness, the floor heard or masked, a length off), `test/soundsPage.test.tsx`
(the audition page's address, its listing by kind, its floors flagged as the script flags them,
what it says of each recording, the command it puts together), `test/ambience.test.ts` (rooms,
levels, power, the beds' recorded loops, dead and alive variants, crossfades, the sporadic
sounds, sounds let go, the rooms one way near, the beds wanted by power, a bed loaded as its
room comes near and let go 4 s after, the rest brought in as the lights fail, the room's
reverb), `test/spatial.test.ts` (pan, the inverse model and its 12 tiles, a wall's 600 Hz, 6 dB
and 15 ms, steps on the floor under a partner, the rotor, the chirp and the fly-by placed, the
doors placed and the audience's unplaced), `test/radioVoice.test.ts` (the chain, the shaper's
distortion, the static's level, the speech, the squelches' recordings, the Leitstelle's opening,
the music 8 dB and the beds 4 dB down, the run's lines fetched and the opening line alone
decoded, a line decoded as it airs and let go once spoken, the newest of two, a line's airtime,
the offline renders), `test/pa.test.ts` (the loudspeakers' band, the room's answer left to the
reverb, the lines on their moments, decoded as the announcement starts and let go once said, cut
with the power), `test/introCue.test.ts` (the script and the cue's peak in its list, the cue
streamed from where the opening stands, faded or cut, let go), `test/voiceLines.test.ts` (the
recordings against the missions, their pace and sizes, the voice's choice, what Piper and `say`
are given to read, what a run keeps and makes anew), `test/elevenlabs.test.ts` (the key, the
voices, the request, the MP3, the retry on 429, the gap; with a client of its own, no request
leaves), `test/record.test.tsx` and `test/recordWav.test.ts` (the /record page's lines, its
states, its buttons, the files it takes, the trim and the WAV),
`server/test/voiceRecording.test.ts` (the switch, the size limit, a WAV converted, an MP3 and an
M4A kept, WebM turned away, the manifest), `test/music.test.ts` (pressure, the stem it brings,
bars of four beats, a pass's period on whole bars with room for its lead bar and its seam,
every stem's file fetched once and none decoded, a stem from its start on its first bar, the
next pass a bar ahead of its 3 s equal-power seam and the old element rewound, a change on the
next bar crossing over 2 s, a late element caught up, the critical stem in the last minute and
the escape, the alarm's push and sting, a stem kept waiting for the budget, a file asked for
again, the endings and the drain, the streamed stings), `test/sounds.test.ts` (each device's
recording, the alarm after a buzz or an arc, the meter's hum and the colour tones still made,
the device hum's loop), `test/coldOpen.test.tsx`, `test/finale.test.tsx` and
`test/putDown.test.tsx` (the effects on the audio clock, the hatch's grind and its landing, a
recording that failed made up by nothing, the mute ahead of the brickwall) and
`test/audioKit.test.ts` (the budget, a recording within it, the loops, the census);
`core/test/radioLines.test.ts` checks the lines themselves. Ten of them were proved by breaking
the code once — the brickwall's ratio, the ducks' release, the IR's decay, the downmix, the
beds' release, the rolloff, the pass's lead bar, a floor's material, the steering's cap, the
voice decoding every line at the start — each failing its tests.

With `?trace=1` the page exposes `window.__escapelab.audio`: `room`, `kind`, `beds` and
`power` by kind, `music` (`calm`, `pressure`, `last`, the pressure as `level`, the `streams`
playing, `lateMs` and `lagMs`), `voice` (`playing`, `lastId`, and `opened` where the Leitstelle
opened the channel for it), `spatial` (`partnerPan`, `partnerGain`), `nodes`, `spent` and
`budget` (see above), `decodedBytes` and `decoded` by holder, `reverb` (the room answering and
whether another still fades), `ducks` (the music's and the beds' levels now), `limiterDb` (the
brickwall's hold) and `renderRadio(id?)`, which renders the radio's chain offline on white
noise or on the recording `id`. The walkthrough (`tools/shots.mjs`) checks the start room's bed
dead after the blackout, the room the lever lights alive again, the run's first line and every
solve's line spoken from the manifest — for 200 ms a word at least, the first after the
Leitstelle's opening and no other — the pressure in the escape, the partner's side across the
corridor, the chain's band-pass in the offline renders (`tools/spectrum.mjs`), on white noise and
on the mission's opening line, and at the first station and in the escape, on each page, the
PCM it keeps — over 30 MB fails the run — the budget against its caps, the buffer sources
playing, the music's streams and their timing, the room's reverb and the brickwall
(`audio` lines).

## The opening: loudspeakers and a cue (`pa.ts`, `intro/cue.ts`)

A mission with an intro opens with the lab's power on (`world/intro/sequence.ts`), and while
the camera runs across the lit lab the Leitstelle makes its routine shift-change announcement
over the wing's loudspeakers: the same voice as the radio's, recorded with the radio's lines by
the voice script — the intro's `pa` lines, a run's first, listed in the manifest like every
other — and never on the air. Blackout's, in full:

> Durchsage der Leitstelle für Trakt C. Es ist 23 Uhr 47, die Nachtschicht hat übernommen.
> Reaktor in Teillast, 60 Prozent. Die Zentrifugen laufen bis 6 Uhr durch.
> Netzlast im Trakt 96 Prozent, Notstrom in Bereitschaft.
> Die Spätschicht gibt Dosimeter und Schlüssel bitte an der Pforte ab.
> Herr Haller, bitte die Leitstelle anrufen. Herr Haller, bitte die Leitstelle anrufen.

**The loudspeakers.** A horn on a wall, not a handset: a high-pass at 300 Hz and a low-pass at
5 kHz, each second order (Butterworth), the direct sound straight out — no squelch, no static,
no shaper (`paChain`) — into the loudspeakers' bus at 0.1 of a line's peak, so the Funk volume
sets it, and from there 6 dB under into the room's reverb: the room the player stands in
answers the announcement with its own impulse response, a corridor long and bright, the
archive dead (reverb.ts, above), where two fixed reflections stood before. Nothing ducks under
it. Its lines are decoded as the announcement starts and let go once said; when the power cuts
it off, every one of them is let go.

**When each line speaks.** The first line starts 3 s into the opening, once the card has gone
and the lab has faded in; each next one 0.8 s after the one before has ended, by the lengths the
manifest gives (`paSchedule`); the subtitles follow it sentence by sentence, each sentence its
share of its line by length. A line whose recording is not loaded yet is left out, its subtitle
still shown, and a screen that comes in late skips the lines whose moment passed. The lights fail
by themselves 4 s past the whole announcement's length (`LIGHTS_AFTER_SPEECH_MS`;
`intro.lightsSec`, which `test/voiceLines.test.ts` holds to the recordings and names where it
does not fit): with the 3 s before the first line and the pauses between, that falls into the
last line — the page said twice — and the power under the loudspeakers goes with the lights, the
line breaking off mid-word. A player who skips hears the rest of the announcement as the room's
sound, without the subtitles, until the lights fail on their screen.

**The cue.** Under the announcement, low, plays one instrumental bed of some 40 s — dark, low,
industrial, slowly building — from the card on: at the peak of a room's bed (`CUE_PEAK`), into
the music's bus at the Musik volume, one voice of the budget. It streams from its file
(`audioStream.ts`) rather than being decoded — 40 s in two channels would hold 15 MB through the
whole opening — from where the opening stands, and its element is let go once it has played.
It fades out over 1.5 s where the player skips and stops dead at the blackout's bang; the
game's own music starts 2 s after the click, as ever. The cue is composed once by ElevenLabs
Music through the SDK (`scripts/introCue.ts`, `client.music.compose`, `forceInstrumental`,
`mp3_44100_96`) into `public/intro/title.mp3`, its list `public/intro/manifest.json` naming the
file, its length, its peak over both channels — measured by afconvert as it is composed, since
nothing decodes it in the game any more: 0.845; the decoded cue's first channel alone (0.537) set
its level before, so it now plays 3.9 dB quieter — and a hash of the request: a run that finds
the same hash and its file composes nothing anew. Before it composes, the script reads the
account's credits and stops below 40,000. Where there is no cue the opening plays without
music.

**The bang.** As the lights-out view arrives on a screen whose shot still ran — or whose skip
was the last the crew needed, which keeps the film running up to 1.5 s to meet the lights — the
cold open is joined at its bang (`coldOpen.ts` `darkSince`, `cut`): the breaker's thunk the game
plays today (`blackoutSounds`) with no flicker before it, the emergency relay's click 0.4 s
later. A player who had skipped before hears the lights fail as ever, flicker and all.

```sh
# in the main checkout, whose .env.local holds the key (never printed)
VOICE_ENGINE=elevenlabs pnpm --filter @escapelab/client voice --fresh   # Helmut reads the five
pnpm --filter @escapelab/client intro-cue --dry-run   # what it would compose and spend
pnpm --filter @escapelab/client intro-cue             # the cue; says what it cost
```

The announcement's five lines are 368 characters. In the branch that brought the opening they are
recorded by Piper (Thorsten) in place of Helmut, and no cue is composed: the session could not
spend the account's credits. The first command above has Helmut read exactly those five — every
other line keeps its recording — after which the voice test names the `lightsSec` to set.

`test/pa.test.ts` holds the chain and the lines' timing, the cut and a line left out;
`test/intro.test.tsx` the opening's phases and their timings, the skip and its count, the
reduced-motion path, the title on the lights-out, the crew held still; `test/introCue.test.ts`
the script against a client of its own and the cue in the game.

## Open

What the sound packages left for later, one line each, the newest first:

- **Twelve recordings await a render** (L-sound): the linoleum and steel steps, both door
  closes, the alarm's sting, the drone's fly-by, the hatch's landing and the settings' tick.
  The agents may not spend the account's credits; the command is under „Awaiting a render"
  (some 130 credits). Until it runs the linoleum and steel steps borrow the concrete takes, the
  door's closes borrow its slide and the other four stay silent, and
  `test/sampleManifest.test.ts` lists them in `AWAITING_RENDER`, to be emptied once they are made.
- **The opening's cue plays 3.9 dB quieter** (L-sound): its level now follows its peak over both
  channels, where the first channel's alone set it before (The opening, above) — a change of
  level, not a fault.
- **Helmut's announcement and the opening's cue** (the opening, above): Piper (Thorsten) reads the
  loudspeakers' five lines and no cue is composed until the two commands there are run.
- Done in L-polish: the devices' sounds play into the effects' bus, its reverb and its brickwall
  (The mix); nothing of the lab goes past the buses any more.

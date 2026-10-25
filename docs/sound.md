# EscapeLab — sound

The lab is heard the way it is seen: rooms with a sound of their own, a partner you can
locate in the dark, a person on the radio, and music that tightens as the clock runs out.
Everything is made at runtime from oscillators, filters and noise, except mission control's
lines, which are recordings. Code: `packages/client/src/world/` — `audio.ts` (the one path,
the effects and the budget), `ambience.ts`, `spatial.ts`, `radioVoice.ts`, `music.ts`, and
`audioCount.ts` for the walkthrough's census.

## One path

Every sound goes into one AudioContext (`sharedAudio()`, made on first use) and through one
master gain, which the sound switch sets to 0 (`isMuted()`). The beds and the music enter it
through the duck bus, which the radio voice pulls 6 dB down while it speaks. Until a click or a
key resumes the context (the browser's autoplay rule), one-shot effects are dropped rather
than queued; the loops — beds, music, rotors — are built anyway and sound once it runs. The
crew's own voices bypass the master gain: switching the lab off leaves the crew audible.

Levels, at the master gain: the effects around 0.04 (`EFFECTS_LEVEL`), a room's bed 0.02,
the music 18 dB under the effects, the radio voice at 0.12 of a line's peak.

Nothing of it runs in the frame loop. One timer listens to the lab ten times a second
(GameWorld.tsx): the beds follow the player's tile, the doors, the lit rooms and the power,
the partners' steps and the drones are placed, the music follows the clock — and each of them
schedules what is due on the audio clock (`AudioContext.currentTime`), the own room's sporadic
sounds 0.4 s ahead, the music's notes 0.3 s ahead. Only your own footsteps still come from the
frame loop, as they always did.

## What it may cost

Chrome renders every node wired into the output, 375 times a second, silent or not, on an
audio thread that shares the machine's cores with the page, and every node made and let go is
garbage for the page to collect; on a CI runner with two cores and software rendering both are
felt in the frames. So the sound keeps to a budget (`CAPS` in `audio.ts`): the beds, the
music and the placed sounds together keep at most 12 voices (the sources of short sounds), 4
noise sources (the shared noise through live filters) and 6 prerendered loops alive. A short
sound with no room left in it is not played; a loop that finds none is tried again on the next
round. What sounds often is rendered once on an offline context at half the live rate and
played back: the steady layers — each room kind's two layers, the pad, the rotor — as loops
(`loopOf`), stopped, not muted, whenever they are not heard; the music's notes and a
partner's steps as samples (`sampleOf`), each played as one buffer source into a stage that
stays — a music bus, a partner's feet — and unwired as it ends (`playSample`). The rare
sounds — a drip, a clank, a chirp — are built into an outlet of their own that is unwired once
their sources have ended (`capped`). Nothing of a sound stays in the graph. Mission control's
voice and the effects are not counted.

Measured on the Systemcheck walkthrough at `SHOTS_CPU_SLOWDOWN=3` before this budget, by the
probe's census: by the escape the host's audio graph held 399 nodes wired into the output
(163 gains, 97 filters, 52 oscillators, 85 buffer sources) while 19 sources played — every
note, step and sporadic sound had left its last gain stage wired to its bus — and Chrome
counted about 550 live audio nodes on the host page, against about 150 for the lab before
the sound. With the budget the graph holds about 40 nodes in the escape and does not grow. At
full speed every frame window of both missions keeps 16.7 ms; at a third of the speed the
windows stay within the spread the lab without sound shows on the same machine.

To tell the systems' costs apart, `?audio-off=beds,music,spatial` switches any of them off
(`SHOTS_AUDIO_OFF` in the walkthrough), and with `?trace=1` the probe reports
`audio.nodes` — the sources playing and the nodes wired into the output, by kind — and
`audio.spent`, the main thread's milliseconds each system has taken.

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

Each layer is a loop of 4 s rendered once per kind: every tone in it is a whole number of
cycles long, every slow wander turns once, and the shared noise repeats every 2 s, so the loop
has no seam. The room the player stands in plays both its layers at full and its sporadic
sounds; the two nearest rooms behind an open door or an opening — nearest by the way between —
play their main layer 12 dB under it; the rest nothing, stopped. A door or a doorway never flips
the room. A change crossfades over 1.2 s. The audience stands nowhere and hears no beds.

While the lab has its power (Normalbetrieb) every bed runs with the power hum. With the bang
of the blackout the powered layers spin down over 1.4 s, the loop slowing to a quarter as it
fades — its hums falling in pitch, its fans winding down: drips, rumble and creaks stay. A
room whose lights a station brings back warms its powered layer up along the lights' own
warm-up (`rooms.ts` `warmUp`, dips and all); a room lit before the
screen looked comes back at once. A run won powers every room again. The reactor's throb
peaks with the core's light, 2.4 s apart on the simulation's clock.

## A partner you can locate (`spatial.ts`)

A partner steps every half tile they walk, as you do. Each step is panned by how far to the
side they stand (all one side at 6 tiles), plays in full within 2 tiles and fades out by 10,
and with no line of sight between (`canSee`, walls and shut doors) it is muffled through a
600 Hz low-pass and turned down to the share a voice keeps through a wall (`WALL_SHARE`).
The steps of one tenth of a second are spread evenly over the next, so they keep their pace.
A step is one of three takes rendered once, played ±10 % in pitch as your own are, into the
stages that place that partner; they are kept while the partner is within earshot and moved
ten times a second. The nearest drone in flight within 10 tiles buzzes faintly where it flies
— two detuned saws in a band, fluttering with its blades, rendered once into a 2 s loop —
placed the same way ten times a second; beyond, or frozen by its plate, the rotor stops. A
drone chirps once when it catches somebody. Your own steps stay as they are. The audience
hears none of this.

## A voice on the radio (`radioVoice.ts`, `scripts/voice.ts`)

Mission control speaks every line a shipped mission can put on the air: everything core's
`logRadio` is handed — `radio.start` as the clock starts, each `puzzles[].onSolved` as its
station is solved, `radio.escape` as the hatch unlocks — and each station's `nudges` while
it stays quiet. Emergencies and lost runs go into the run report, not on the air. Notes of
the last crew and the devices' texts are read, not heard. A line without a recording — a
custom mission's — keeps the radio's chirp.

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

At a run's start the mission's lines are fetched and decoded; a line that comes over the air
is fetched then, where it was not yet. When the banner shows a line, its recording plays as a
handset hears it: high-pass 300 Hz and low-pass 3.4 kHz, each fourth order, a light waveshaper
(tanh at a drive of 1.2: a 1 kHz tone at the speech's peak comes out with 8 % distortion,
where the drive of 2.2 the Mac's voice had gave 17 %, and the quiet parts come up 3 dB against
the peaks instead of 7, so that the consonants stay clear), a bed of static 33 dB under the
speech, a squelch as the key goes down and a longer one as it comes up; the beds and the music
duck 6 dB meanwhile. The run's first line comes after the Leitstelle opening the channel:
static swells up for 0.3 s and snaps shut on the squelch gate's click, 0.4 s before the key —
on that line alone. A newer line cuts an older one short. The banner stays up while its line
speaks: 7 s at least (4 s on a touch screen), and as long as the recording, its opening and its
squelch take for a longer line (`radio.ts` `noticeMs`, `radioVoice.ts` `airtimeMs`).

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

Three layers, brought in and out by one pressure value from 0 to 1:

- **calm** — a slow pad, two sines a hertz apart (a loop of one second: they beat once in it)
  through a resonant low-pass sweeping over 20 s in steps of 250 ms, and a swell of filtered
  noise about every 12 s;
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
pulse and the heartbeat, and the pad stops once its layer has faded out. A run won fades the
music out before the end screen's chord; a run lost drains it, its low-pass closing and the
pad slowing, with the power. Heavy hits — the heartbeat, a machine's stroke — carry a mid
layer so that a phone's speaker plays them too. Every note — the bass, each pluck, both
thumps, the swell — is a sample rendered once as the music starts.

## What the budget changed, to the ear

- A room behind a door plays its main layer only, and only the two nearest such rooms play;
  their drips, creaks and clanks are the own room's alone.
- The air in a room wanders once every 4 s (it took 14 to 20 s), and a plain room's slow beat
  is 55 against 55.5 Hz (it was 55.4), so that the loops repeat without a seam.
- A clank down the corridor echoes twice, each repeat fainter and plainer, instead of ringing
  down a delay line.
- Only the nearest drone within earshot buzzes, and the pad's sweep moves in 250 ms steps.
- The music's notes are played back from samples, so a note sounds the same every time; a
  swell varies by ±5 % in speed instead. A partner's step varies over three takes and ±10 % in
  pitch, as before; its place follows the partner ten times a second while it sounds.
- The pad's swell breathes its whole 8 s; it used to break off after 2 s, where the shared
  noise ran out.
- The audience hears no beds.
- A short sound that finds no room in the budget is not played.

## Proof

Unit tests run every module against a fake AudioContext that keeps the graph:
`test/ambience.test.ts` (rooms, levels, power, the beds' loops, dead and alive variants,
crossfades, sounds let go), `test/spatial.test.ts` (pan, gain, muffle, steps, the rotor, the
chirp), `test/radioVoice.test.ts` (the chain, the shaper's distortion, the static's level, the
speech, the Leitstelle's opening, ducking, preloading, a line's airtime, the offline renders),
`test/voiceLines.test.ts` (the recordings against the missions, their pace and sizes, the
voice's choice, what Piper and `say` are given to read, what a run keeps and makes anew),
`test/elevenlabs.test.ts` (the key, the voices, the request, the MP3, the retry on 429, the gap;
with a client of its own, no request leaves), `test/record.test.tsx` and `test/recordWav.test.ts`
(the /record page's lines, its states, its buttons, the files it takes, the trim and the WAV),
`server/test/voiceRecording.test.ts` (the switch, the size limit, a WAV converted, an MP3 and an
M4A kept, WebM turned away, the manifest), `test/music.test.ts` (pressure,
layers, beats, the pad, the samples, endings) and `test/audioKit.test.ts` (the budget, the
loops, the samples, the census); `core/test/radioLines.test.ts` checks the lines themselves.

With `?trace=1` the page exposes `window.__escapelab.audio`: `room`, `kind`, `beds` and
`power` by kind, `music` (`calm`, `pressure`, `last`, the pressure as `level`), `voice`
(`playing`, `lastId`, and `opened` where the Leitstelle opened the channel for it), `spatial`
(`partnerPan`, `partnerGain`), `nodes` and `spent` (see above) and `renderRadio(id?)`, which
renders the radio's chain offline on white noise or on the recording `id`. The walkthrough
(`tools/shots.mjs`) checks the start room's bed dead after the blackout, the room the lever
lights alive again, the run's first line and every solve's line spoken from the manifest — for
200 ms a word at least, the first after the Leitstelle's opening and no other — the pressure in
the escape, the partner's side across the corridor, and the chain's band-pass in the offline
renders (`tools/spectrum.mjs`), on white noise and on the mission's opening line.

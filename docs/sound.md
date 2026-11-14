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
recording whose speed — and so its pitch — rises with each second gone; as recorded, it ticks
each whole second of a sync station's window too (`countTick`, docs/gameplay.md). Code:
`packages/client/src/world/` — `audio.ts` (the effects and the budget), `mix.ts` (the buses,
the brickwall, the ducking), `samples.ts` (the recordings, loaded as they are wanted),
`audioStream.ts` (what streams instead), `audioMemory.ts` (what a page keeps, counted),
`reverb.ts`, `footsteps.ts`, `ambience.ts`, `spatial.ts`, `radioVoice.ts`, `pa.ts`, `music.ts`,
`menuSound.ts` and `endTheme.ts`, and `audioCount.ts` and `soundProbe.ts` for the walkthrough's
census; the recordings are made by `packages/client/scripts/sfx.ts`, the score with `suite.ts`
and `pcm.ts` beside it.

**The catalog.** Each entry names one sound: its `id`, its `kind` — a one-shot, a bed that loops
seamlessly or a sting — the English prompt ElevenLabs is given (material, mechanism, room,
distance), how long it lasts, whether it loops, the loudness it is brought to (`target`) and where
the game plays it (`usedBy`, `src/<file>#<symbol>`). None has a tempo of its own, and a stem or a
theme on its own is refused: the music's stems and themes are sections of a suite. One entry is of
that other kind: the suite `score`, the game's music written as one (Score, below) — its key, its
tempo, its motif in a composer's words (its cell, the fall that ends its first phrase, its answer),
the styles every section shares and those none may have, the loudness its pieces are brought to, and
its eight sections, each a piece the game plays with its name, its bars, whether it loops, how much
of the motif it plays, its lines, its styles and where it plays. There are 83 effects — 70
one-shots, three loops (the mains hum, the siren, the drone's rotor) and ten room beds, the
facility's hum under the menu among them — the end card's stings `won` and `lost`, 10 s each, and
the score's eight pieces, all in A minor at 90 bpm but the dawn's C major: the menu's theme and the
lobby's, the opening's title, the run's stems `calm`, `tense` and `critical`, 72 s each, and the end
cards' themes `end-lost` and `end-won`, 40 s each. A step is one of three takes of the same work
boot on the floor it lands on — `step-concrete-1`–`3`, `step-lino-1`–`3`, `step-steel-1`–`3` — a
door that slides open has its pneumatic slide and one that shuts one of two closes (`door-close-1`,
`-2`), the hatch strikes its stops as it does on screen (`hatch-open-done`), a drone that comes
close whooshes by (`drone-pass`), every alarm brings a two-second stinger with it (`alarm-sting`)
and a volume set in the settings ticks through the bus it sets (`ui-tick`).

```sh
pnpm --filter client sfx -- --dry-run                    # the plan and its cost; nothing asked
pnpm --filter client sfx                                 # all not made yet; a suite: --only
pnpm --filter client sfx -- sfx                          # the effects alone (`music`: the music)
pnpm --filter client sfx -- --only klaxon,ping           # those entries, made anew
pnpm --filter client sfx -- --candidates 3 --only ping   # three takes, the best one kept
pnpm --filter client sfx -- --candidates 3 --only won    # three takes of a piece, for the ear
pnpm --filter client sfx -- --keep won=2                 # its take 2 kept, the others deleted
pnpm --filter client sfx -- --candidates 2 --only score  # two takes of the whole score
pnpm --filter client sfx -- --keep score=2               # its take 2 kept whole, cut in pieces
```

**Awaiting a render.** Nine entries await a render by the user — the agents that write the
catalog may not spend the account's credits, the permission system holds any paid request back —
and the game plays meanwhile what there is. The facility's hum, whose three takes of 2026-11-13
came back near silent, has no recording, and the menu plays without it. The
score's eight pieces play the recordings the stems, the menu's theme and the end cards' themes had
before it, their manifest entries made from the older requests; the lobby plays the menu's theme
at its weight, the opening its older cue (`public/intro/`), until a take of the score is kept.
`test/sampleManifest.test.ts` names them in its title — `AWAITING_RENDER`, to be emptied once they
are made — and fails for any other entry without a recording of its own, made from its request as
it stands. The score's render and keep are under „Takes und Auswahl" (below); the hum's:

```sh
node --env-file=/Users/uros/Documents/Req.Eng./escapelab/.env.local scripts/sfx.ts \
  --candidates 5 --only bed-facility   # five takes, the best within +12 dB kept: some 200 credits
```

`scripts/sfx.ts` asks text-to-sound-effects (`eleven_text_to_sound_v2`, prompt influence 0.5,
a bed with `loop: true`) and Eleven Music (`music_v2_5`, instrumental) for each entry — a suite
as one composition plan of chunks (Score) — one request after the other, 300 ms apart, a 429
waited out as the voice script does, through the client of `scripts/elevenlabs.ts`; an effect
comes as MP3 at 44.1 kHz and 128 kbit/s into `public/sfx/<id>.mp3`, a piece of music at 192
kbit/s — the Creator plan's best — into `public/music/<id>.mp3`, a take of the score at 192 kbit/s
into `takes/score/`, and a kept score's pieces as AAC at 160 kbit/s into `public/music/<id>.m4a`.
`public/sfx/manifest.json` and `public/music/manifest.json` list each as `{ file, ms, gain,
startMs, floor, rms, loop, hash, influence, source }`, a piece of the score with its `loudness`
before the gain, its loop's `bars` and its `suite` besides; `floor` and `rms` are measured before
the gain (below), `hash` names the request that made it — a piece's its suite's — `influence` how
closely an effect followed its prompt, so a run makes only what is new, changed or missing, and
one cut short goes on where it stopped.

**Candidates.** With `--candidates N` (up to 5; 1 unless told) every effect the run makes is
made N times, each take into a folder of its own in the system's temp (the run names it; nothing
of it goes into the project), its prompt followed ever more closely — 0.3, 0.6 and 0.9 for
three. The script prints each take's peak, RMS, start, silence, length, gain and floor and keeps
the one that misses the fewest of five rules (`PICK`) — its peak at −6 dBFS or more before any
gain; its sound starts within 50 ms; at most a tenth of it is silence, 10 ms frames under
−60 dBFS; its length lies within a fifth of the catalog's; its floor is not heard (below) — and
of those the one with the loudest RMS. Only that one goes into `public/sfx`, and the checks
below are made on it. A short click misses the silence rule whatever it does, its tail silent
long before its half second is over, so for it the RMS decides. A piece of music is made in
takes as well, three at most, but no rule picks among them: they wait for the ear (Takes und
Auswahl, below).

The key comes from the environment: the package script hands node the repo's `.env.local`
(`--env-file-if-exists`), and from a worktree it is `node --env-file=<repo>/.env.local
scripts/sfx.ts` in `packages/client`. Before it asks for anything the script reads the account's
credits and stops below 40,000 or where the plan would pass a group's cap (12,000 credits for the
effects, 18,000 for the music) — a dry run refuses what passes a cap as a run does. Once a group's
first take has landed it reads what that cost and prices the rest at that rate, before the next is
asked for: the first of a suite's two takes, so that a rate dearer than the dry run's stops the
second where both would pass the cap. The first full render (2026-10-26) cost 542 credits for the
154 s of effects and 4,136 for the 236 s of music; the dry run prices at those rates, rounded up to
4 and 18 credits a second, times the takes.

**Listening to them.** The page `/sounds`, which no menu links to, lists every entry of the
catalog by its kind — effects, rooms and loops, the end card's stings — and the score with its
pieces apart, each with its prompt, its length, its gain and its floor once the gain is applied
(„Grundrauschen −45,7 dBFS, hörbar" where it is heard, „vom Klang verdeckt" where the sound fills
its quietest 100 ms), a button that plays it through the game's own loader at the loudness the
game brings it to (a loop — a room's bed, a stem — round and round until it is stopped) and a box
„neu rendern"; below, it puts together the command for what is ticked, to be run in
`packages/client` — an effect ticked comes back as the best of three candidates, a sting as three
takes under its row, the score as two:

```sh
node --env-file=/Users/uros/Documents/Req.Eng./escapelab/.env.local scripts/sfx.ts --candidates 3 --only a,b,c
```

The key file is the main checkout's unless the page is told another path, which it remembers
for the next visit. The page asks no service for anything: the user runs the command. Under a
piece of music stand its takes, where the dev server has any (Takes und Auswahl, below).

**Loudness without re-encoding.** The files stay as ElevenLabs made them, but for the score's
pieces, cut from one take (Score). The script decodes each with `afconvert` into a temporary folder,
measures its peak and its RMS and writes the gain that brings it to its target: a one-shot's peak to
−3 dBFS, a bed's or a stem's RMS to −20 dBFS, a sting's RMS to −14 dBFS, a piece of the score's
loudness to −19 LUFS (Score, „One loudness"). What a gain can spoil is the noise floor it brings up,
so the script measures that as well: `floor`, the RMS of the recording's quietest 100 ms. A take
plays its floor where it is heard when that floor comes out louder than −50 dBFS once the gain is
applied, and lies 20 dB or more under the take's RMS — closer, the quietest 100 ms is the sound
itself, a bed, a stem, a hiss, a ringing tone that fills its file, and the sound masks whatever
noise lies under it (`floorHeard`). A take more than a fifth off its length is named as well. The
script names each such take, with its gain, its floor or its length, and fails with the command that
makes them again — `--candidates 5 --only …` for an effect, `--candidates 3 --only …` for a piece of
music, whose takes then wait for the ear (`remakeArgs`); `test/sampleManifest.test.ts` lists them
with the same command. Nothing is capped but a bed's gain: a bed that would need more than +12 dB
came back near silent — the facility's hum of 2026-11-13 needed +31 dB, and the one click in it came
up as a crack — so the script keeps no such take, says so in a line and fails, and the game plays no
bed listed so (`samples.ts` `BED_GAIN_MAX`; the hum's three takes would all have been refused). More
than 30 ms of silence at a recording's start becomes `startMs`, where its sound starts; a bed keeps
its start, so that its loop stays seamless. A run that makes nothing measures every file anew, so a
rule changed costs nothing. The game applies the gain as it decodes a recording (`samples.ts`),
multiplying its samples once, and plays it from `startMs`. `test/sampleManifest.test.ts` fails,
naming the command, where an entry has no file, a file was made from another request, runs off its
length, came back clipped (a gain under 0.1), plays a floor that is heard or brings a bed up past
+12 dB, or a folder passes its cap: `public/sfx` 3 MB, `public/music` 11 MB — the score's pieces,
some 10.0 MB as afconvert writes 491 s at 160 kbit/s, and the stings.

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

## Takes und Auswahl

No measurement says whether a piece of music sounds right, so the script picks none. With
`--candidates N` every piece of music the run makes on its own — a sting — is made N times by the
same request, three times at most (`MAX_MUSIC_TAKES`: its cost runs by the second, and a fourth
is refused before anything is asked), and every take goes into
`packages/client/takes/<id>/<n>.mp3`, a folder git ignores beside `public/`, which no build
copies. Each entry's `takes/<id>/index.json` lists its takes as they come in: the number and
file, the hash of the request it was made from — its prompt and its settings, the hash its
manifest entry will carry — the settings themselves (model, format, length, instrumental; Eleven
Music takes no seed beside a prompt), when it was made, and how it measures: its length, its
gain, where its sound starts, its peak, RMS and floor before the gain, its share of silence and
the rules of `PICK` it misses, said and never used. A later run adds its takes, numbered on;
nothing of them goes into `public/music`, and the recording the game plays keeps its file and its
manifest entry until one is kept. The run says where the takes lie and the command that keeps
one of each. A run asking for one take (no `--candidates`) makes a piece once, straight into
`public/music`, as before — but never one whose takes wait: it leaves that piece as it is, so that
no recording goes into the game past takes nobody has heard, and says so in a line
(`--keep <id>=<n>` keeps one, `--candidates 3 --only <id>` makes more); its recording is not
measured anew either, so that a stale one stays stale in the manifest. An effect keeps its
candidates and its pick. A suite is made only where `--only` names it: a run of everything leaves
it and says the command that makes its takes, for a take of the score costs thousands of credits.
Named, it is always made in takes, one where no more are asked for — its pieces replace the game's
whole score at once, and none of it goes into the game before the ear has chosen — at most as many
a run as the music's cap holds (two of the score), its takes numbered on. Each take
of a suite is listed with its pieces where the plan cuts it, each measured as a render would
measure it — its length, gain, loudness, peak, RMS, floor and silence, and `length`, `silence`
or `floor` missed — and the take itself misses `length` where it runs more than a second off its
plan. The run itself is `runWith`, its account opened only where something is to be made; a test
runs it end to end.

The score in three takes, two in one run and one in a second — three would pass the 18,000
credits the music may spend in a run — then one kept whole:

```sh
# in packages/client of the main checkout
node scripts/sfx.ts --candidates 2 --only score --dry-run   # the plan, 17,665 credits: no key
node --env-file=/Users/uros/Documents/Req.Eng./escapelab/.env.local scripts/sfx.ts \
  --candidates 2 --only score             # two takes of the whole score into takes/score/
node --env-file=/Users/uros/Documents/Req.Eng./escapelab/.env.local scripts/sfx.ts \
  --only score                            # a third, numbered on: about 8,833 credits
# at the repo's root, in a terminal of its own: the server and the client
pnpm dev                                    # then http://localhost:5173/sounds, and listen
# back in packages/client: the take chosen, kept whole, by its number on the page
node scripts/sfx.ts --keep score=2
```

After the keep, `AWAITING_RENDER` in `test/sampleManifest.test.ts` loses the score's eight
pieces, and the tests hold them as every other recording.

**Listening.** On `/sounds` the takes stand under their piece, below the recording the game plays
now: a button streams each at the gain the game would give it, so that loudness decides nothing
between them; one line says its length, gain, peak, RMS, floor, silence, where its sound starts
and the rules it misses — amber where it runs more than a fifth off its length or plays a floor
that is heard: kept, it would fail `test/sampleManifest.test.ts` — and „Diesen Take wählen"
shows the command that keeps it, and that the page plays the take as the game's recording once
it is loaded anew after the command; the script's own line after a keep says so too. The page
runs nothing and asks for its lists alone. The takes come from the dev server: `GET /takes/`
lists every entry's, `GET /takes/<id>/<n>.mp3` plays one — whole with its length, or the span a
Range asks for (206), as Safari and a loop on its way round ask — both only with
`ALLOW_TAKES=1`, which `pnpm dev` sets (`packages/server/src/takes.ts`; Vite passes `/takes` on
to it). Without it every address under `/takes` answers 404 ahead of the built site, never the
page in a take's place, and `/sounds` says „Takes liefert nur der Entwicklungsserver
(pnpm dev)."

The score stands first on the page, under „Partitur": its row with the box to tick — the command
it puts together asks for two takes, a run's most, and run again makes more — then its takes, one
row each: its length and the rules it misses, „Diesen Take wählen", and every piece of it in the
plan's order, each with a button that streams the take from where the plan cuts that piece to
where the next begins, at the gain the game would give the piece, and its line of facts — its
length, gain, loudness, floor, silence, the rules it misses — amber where a piece, kept, would
fail the game's recordings, and the take's own line with it. „Diesen Take wählen" shows the one
command that keeps the take whole, `node scripts/sfx.ts --keep score=<n>`. Below the takes stand
the eight pieces as the game plays them now, each to be played round and round where it loops.

**Keeping.** `--keep <id>=<n>` measures the take as a render is measured, moves it into
`public/music` as the entry's file, writes its manifest entry — the request's hash, the gain,
the floor — and deletes the entry's other takes and their list. It asks
ElevenLabs for nothing and needs no key, only afconvert. It refuses, in one line and before
anything moves, an id the catalog does not know, an entry without takes, a number it has no take
of, a take made from another request than the catalog's now (the prompt changed since: new
takes, then) and a take whose file is gone; and it comes alone. A kept take passes
`test/sampleManifest.test.ts` as a render does, and the script reports the folders and any
floor heard or length off afterwards, as after a render. Keeping the game's own `won.mp3` as a
take, on a copy of the client, wrote its manifest entry to the digit as the render had.

A take of a suite is kept whole (`--keep score=<n>`): decoded, cut where the plan puts each piece,
each piece's edges faded over 10 ms, encoded by afconvert as AAC at 160 kbit/s into
`public/music/<piece>.m4a` — as a part first, every piece measured as encoded, then all moved in at
once — and listed with the suite's hash, the gain that brings it to −19 LUFS, a loop's bars and its
suite; only then, the manifest naming the pieces, the file each piece played before is deleted where
no other entry plays it, and so are the suite's other takes. It refuses, besides the refusals above
and before anything moves, a piece named alone („a piece of score, kept whole: --keep score=<n>"), a
take more than a second off its plan's length — its pieces would not lie where the plan put them —
and a take a piece of which came back silent, taking back every part it had encoded. A piece of a
suite is never made or kept alone: `--only calm` is refused as well, naming `--only score`.

**What a take costs**, at the dry run's 18 credits a second of music:

| Entry | Kind | Length | A take | Three takes |
| --- | --- | --- | --- | --- |
| `score` | suite of 8 pieces | 490.7 s | 8,833 credits | 26,497 credits, in two runs |
| `won`, `lost` | sting | 10 s | 180 credits | 540 credits |

Three takes of the score come to 26,497 credits at that rate, over the 18,000 the music may spend
in one run: two go in one run (17,665 credits), the third in a second, and a run asked for three
is refused before it asks for any music, naming the runs. ElevenLabs lists Eleven Music at 900
credits a minute, which would make the three 22,080 credits; the run reads what the first take
cost off the account and says the rest at that rate, and it stops below 40,000 credits left.

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

## Score

The game's music is one piece of writing in eight parts — the menu's theme, the lobby's, the
opening's title, the run's three stems and the end cards' two themes — composed by Eleven Music
in one generation from the suite `score` of the catalog and cut into the pieces the game plays
(scripts/suite.ts, scripts/sfx.ts). Before it, each piece was asked for on its own, from a prompt
of its own, the pieces sharing a key and a tempo by their words alone, and the menu's theme came
out, in the user's words, as „ein einfacher Ton mit Störung": a dark pad over a drone, as its own
prompt had asked (RMS −14.5 dBFS, a crest of 14.5 dB, steady throughout). The direction since is
a score with a theme, in the spirit of Clair Obscur: Expedition 33 (Lorien Testard): a melodic
motif that stays with the player, piano and strings, a wordless voice, a dynamic arc, an
electronic colour held in tension with the acoustic instruments, French-romantic melancholy —
here in a 1980s research facility at night, so the electronic colour is an analog synthesiser and
the melancholy the night shift's.

**The motif.** A melody of eight bars, two phrases of four, long notes on the strong beats so that
it can be hummed after one hearing, written in the key's own degrees: from the fifth, a leap up a
sixth held three beats and a sigh down one step, then falling by step in half notes to rest on the
fifth, held a whole bar — a half cadence; the answer leaps from the sixth up to the fourth, held
three beats, and falls by step to a full close on the tonic. In A minor that is E–C–B, A–G–F, E and
F–D, C–B, A; in the dawn's C major the same steps, G–E–D, C–B–A, G and A–F, E–D, C. It starts on the
fifth, not on the tonic: from the tonic, a minor sixth up and a sigh down is the opening of Wagner's
Tristan prelude. The catalog writes it in three parts (the suite's `motif`: `cell`, `fall`,
`answer`), and every section names how much of it it plays (`motif`: `cell`, `phrase` or `whole`)
and is told that much beside its own words, with the key and the tempo, and no more: the main theme,
the lobby and the dawn the whole, the opening and the lights going out the first phrase, the three
stems the cell alone, which the calm stem breaks into fragments, the tense stem's ostinato is built
from and the last minute hammers — no chunk is told to play a melody its section avoids. The motif
is shared by construction: one request, one generation, every chunk told the same cell and played on
from the chunk before. A wordless voice — a solo female voice on an open „ah", written as a voice's
sound in parentheses and never as a word — carries the answering phrase once in the main theme and
sings the motif once more at dawn; nowhere else.

**The pieces**, in the order of the plan, which is the order a crew hears them; a loop's bars that
go round, and its tail of three:

| Piece | Section | Bars | Length | What plays |
| --- | --- | --- | --- | --- |
| `menu-theme` | Main Theme | 32 + 3 | 93.3 s | felt piano states the motif alone, chamber strings answer, the voice enters once; a faint analog pad, cold under the warm piano; a swell to mezzo-forte and back |
| `lobby` | Interlude | 20 + 3 | 61.3 s | the motif thinner: solo piano, a solo cello answering once, a faint arpeggiated synth like a distant machine |
| `title` | Opening | 15 | 40 s | the motif's first phrase alone on solo piano, pianissimo, long silences, a warm pad breathing under it, ending on an open chord — room for the loudspeakers' announcement |
| `calm` | Night Shift | 24 + 3 | 72 s | the motif in fragments, its leap alone with long pauses; low piano, a dark pad, a muted synth bass on every bar |
| `tense` | Pressure | 24 + 3 | 72 s | an analog ostinato in eighths built from the motif's first notes, a bass pulse on every beat, low strings, a tick like a clock; the piano answers in the low register |
| `critical` | Last Minute | 24 + 3 | 72 s | a double-time feel at the same tempo: low drums, strings in sixteenths, a pulsing synth bass, horns and strings hammering the motif's leap |
| `end-lost` | Lights Out | 15 | 40 s | the music breaks off; the motif sunk into the piano's low register over a bowed bass, the pad dimming like failing lights, into silence |
| `end-won` | Dawn | 15 | 40 s | the motif resolved into C major: strings carry it, the voice sings it once more, piano arpeggios like first light; it comes to rest on a long held chord, a true ending |

**How they hang together.** One key, A minor — the dawn's own C major, the relative major the won
card's sting has struck just before it — one tempo, 90 bpm in bars of four, and the motif
throughout, as far as each section plays it. The run's intensity rises as instruments enter by stage
— the analog pulse with the pressure, percussion only with the pressure, drums only in the last
minute — and never by tempo or key, so that the music can cross from one stem to the next on any bar
line. Every section lasts whole bars, so each starts on a bar line of the one generation: the three
stems are as long as each other to the millisecond and share their bar grid by construction, not by
asking three times for 90 bpm. A loop's section is written three bars longer than its loop — the bar
the game catches a next pass up in, and the bars its 3 s seam crosses in, with a second to spare
(suite.ts `tailBars`) — and is told to stay steady to its last bar and to come back to its opening;
the cut keeps the tail, and the game loops on the bars the manifest names. What never appears: words
of any kind, drums in the menu, the lobby, the opening, the calm stem and the endings, a voice in
the run, an electric guitar, a drop, a change of tempo, sound effects (the suite's and each
section's `avoid`). `test/suiteScript.test.ts` holds the catalog to all of it: the order, the
lengths, the stems' grid, the key, the tempo and the motif in every chunk, the voice where it
belongs and nowhere else, the drums kept out.

**What Expedition 33 showed, and what was not taken.** Its music is remembered as music, not as
background: a melody comes back, piano and a few strings carry the feeling, a voice without words
rises above them, and an electronic colour pulls against the acoustic warmth. The score here works
the same way — one motif in many guises, piano and strings in front, a wordless voice twice, an
analog synth in tension, an arc from the menu's quiet through the last minute to the quiet after
— and takes no note of it: the motif is written for this game, the prompts describe music in a
musician's terms and name no composer, no game and no piece (the test refuses such a name in the
suite), and Eleven Music is given no recording to follow, only the catalog's words.

**Cut into pieces.** The plan lays every section on whole bars at 90 bpm — the cumulative bar
lines rounded to the millisecond, so that the chunks' lengths add up exactly to where each section
lies (suite.ts `spansOf`) — and a kept take is cut there, nowhere else: no beat is searched for, no
onset guessed. A loop's section carries its tail of three bars into its piece, so that a pass
crosses into the next from its own sound, never from the next section's; the game loops on the
bars the manifest names (music.ts `loopPeriod`), as far as the file holds them with the lead bar
and the seam. A loop's piece starts at its start, its bars on the grid; a piece played once skips
the silence it opens with. Each cut fades in and out over 10 ms, so that no cut clicks where the
sound at it is not at rest.

**One loudness.** The pieces follow one another — the menu's theme into the lobby's, the opening's
title into the calm stem two seconds after the blackout, a stem into the next, the critical stem
into an ending — so none may jump against the next. The script measures each piece's integrated
loudness as ITU-R BS.1770-4 does (`pcm.ts` `lufsOf`; not a certified meter: no true peak, no
conformance suite run): every channel through the K-weighting — the head's high shelf and the RLB
high-pass, worked out from their analog prototypes for the file's rate, at 48 kHz exactly the
coefficients the recommendation tabulates — the mean square of 400 ms blocks, a new one every
100 ms, summed over the channels, the blocks under −70 LUFS left out as silence and then those
10 LU under the mean of the rest; a full-scale 997 Hz tone in one channel reads −3.01 LUFS, as the
recommendation has it. Every piece is brought to −19 LUFS, where today's stems and menu theme
play: measured the same way, as their gains bring them, the stems and the menu's theme lie at
−19.7 to −17.8 LUFS, the end themes at −17.0 and −16.7 and the opening's older cue, whose peak
set its level, at −13.0. The game plays every piece at the stems' level by its gain — the title
too, where the cue's peak set it before — so that menu, lobby, title, stems and endings meet
within a decibel as the script measures them; `test/sampleManifest.test.ts` holds a suite's kept
pieces within 2 dB of each other. The end card's stings stay apart, louder, by design.

**One generation, as the service takes it.** Eleven Music's newest model, `music_v2_5`, takes a
composition plan of chunks — 30 at most, each 3 to 120 s, 10 minutes in all, every chunk's
length kept to the millisecond — each with a text of its own (its section's name in brackets,
directions in braces, a voice's sounds in parentheses) and styles of its own, the first chunk's
setting the tone of the whole (ElevenLabs' API reference and its guide „Composition plans",
2026-11). The main theme comes first, the fullest statement of the motif, so that its tone sets
the rest. A plan takes no switch for the instrumental as a prompt does (`force_instrumental`):
here the lines are the switch, and the catalog's rules refuse any line that is neither a
direction nor a voice's sounds. Eleven Music's overview page still names 5 minutes for a song;
the score's 491 s keep within the 10 minutes the composition plans name. A plan of that length
takes the service some two to four minutes to compose, so the script waits up to 15 for it
(sfx.ts `SUITE_TIMEOUT_S`), where the SDK would give up after 4. Should the service refuse the
plan, the run stops at that request and says what ElevenLabs answered; a request that failed may
still have been billed, which the account's credits tell. Every section states the tempo, and
none asks for another: a quiet piece is sparse, its notes held long at the same tempo, as the
last minute's double time is a feel at the same tempo — the plan's bar lines, which the loops are
cut on, hold only where the music keeps them.

## Music that breathes (`music.ts`)

Three recorded stems, pieces of the score (Score, above), between which one pressure value from
0 to 1 crossfades — composed in one generation in A minor at 90 bpm on one bar grid, so that one
crosses into the next on any bar:

- **calm** — the motif in fragments, its leap alone with long pauses: low piano, a dark analog
  pad, a muted synth bass on every bar, no percussion;
- **tense** (from 0.35) — an analog ostinato in eighths built from the motif, a bass pulse on
  every beat, low strings, a tick like a clock, the piano answering low;
- **critical** (from 0.8) — a double-time feel at the same tempo: low drums, strings in
  sixteenths, a pulsing synth bass, horns and strings hammering the motif's leap.

Until a take of the score is kept, the stems play the recordings they had before it — three
pieces asked for one by one, „an uneasy pad", „a bass pulse", „pounding drums" — on the same
code.

The pressure follows the clock — the tension curve the lab always had, 0 while half the time
or more is left and rising to 1 at the end, and at least 0.8 in the last minute — adds 0.15
for 20 s with every alarm, and stays at 0.8 at least in the escape. A stem goes only a little
under its threshold before it leaves, so a wavering pressure never flips it. Every alarm the
music hears brings the alarm's sting with it, two seconds of brass and strings on the effects'
bus, the music pulled 6 dB down under it.

The stems keep bars: four beats at the tempo the catalog gives them (`bpm`, the one their prompts
state, 90), counted from where the music starts — 2 s after the blackout's click (in a run without
an intro, as it starts), never while the lab still has its power, and no sooner than its first
element's timer can make it. A change waits for the next bar: the stem coming in starts from its
beginning on that bar line — where its sound starts, past the silence its file opens with — and
crosses with the one going over 2 s; the one going stops once it is silent and lets its elements go.
A stem plays round and round on two elements taking turns, one loop of the budget: its next pass
starts from its beginning on a bar line too, as many bars after the last as its manifest names — 24
for the score's stems, which carry a tail of three for the seam — or, for a recording without
`bars`, as many whole bars as leave room — 24 bars, 64 s, for a 72 s stem — and comes in one bar
later over 3 s on equal-power curves while the pass before goes out under it (`loopPeriod`); the bar
between is the one a late element is caught up in, unheard. Each element is told a second ahead when
to start, and steered while it plays (`audioStream.ts`). Every stem's file is fetched once as the
music starts; one that could not be had is asked for again 5 s on. In the escape, under the siren,
the critical stem plays. A run won fades the music out before the end card's sting; a run lost
drains it, its low-pass closing and its elements slowing to half their speed, with the power. The
end card streams its sting once on the music's bus (`playSting`): `won`, strings and soft brass
rising to a C major chord over a breath of wind, or `lost`, a low A-minor chord sinking into
silence. The heartbeat that quickened through the last minute is gone with the synthesised layers:
the critical stem carries the last minute.

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

Unit tests run every module against a fake AudioContext that keeps the graph, the recordings served
to a fake fetch and decoded by a fake OfflineAudioContext at its own rate, each tagged with its id
(`test/fakeSamples.ts`), and a fake `<audio>` element whose position the test moves
(`test/fakeMedia.ts`): `test/samples.test.ts` (nothing before it is asked, the first minute in the
lobby and no more, the rest once asked, two at a time and never a bed, a one-shot folded to one
channel at 44.1 kHz and a bed kept in two at 32 kHz, the gain and the start applied, what is kept
counted and let go, a load shared with the entry that borrows it, an entry awaiting its render
silent, a failure said once and asked again 5 s on, the music's entries named and never decoded),
`test/audioMemory.test.ts` (four bytes a sample, by holder, a shared buffer once, the 30 MB budget),
`test/audioStream.test.ts` (a file streamed through a level of its own, started from its start as
its timer comes, how late it came in, caught up at most 3 % faster and slowed when ahead, a seek
only where the beat does not matter, rewound and let go, held back by the browser and played at the
next gesture), `test/mix.test.ts` (the brickwall's settings and its makeup taken back, every bus
into the master and the master through the brickwall, the sends into the reverb and none from the
radio or the music, Musik, Effekte and Funk on their buses, a later engine at the volumes set, the
ducks' depths, 50 ms down and 400 ms back, the deepest of two held, a move cut short, a pull with no
end, the klaxon and the siren pulling the music, the volume's tick through its bus),
`test/reverb.test.ts` (each kind's time, 60 dB of decay, the same seed the same answer, its level,
bright and dull rooms, the reactor's modes over its noise, the convolver on the sends into the
master, a 300 ms crossfade and the old one let go after its tail, a third cut, nobody's room dry,
`?audio-off=reverb`), `test/footsteps.test.ts` (the floor of each kind, three takes a floor, ±5 %,
the floor under the player and under a tile, a doorway keeping the last, your own step 4 dB under a
partner's), `test/pcm.test.ts` (the K-weighting against BS.1770's own coefficients, a full-scale 997
Hz tone at −3.01 LUFS in one channel and 0 in two at 44.1 and 48 kHz, the gates leaving out what
lies 10 LU under the rest and silence, a span cut out with its 10 ms edges faded, a WAV written and
read back), `test/suiteScript.test.ts` (a suite's plan on whole bars, a loop's tail for the game's
lead bar, seam and a spare second — the seam's numbers held to music.ts — the chunks of one request,
the hash, a piece of each section, the motif as far as each plays it; the catalog's rules: no lyric,
the API's limits, the ids once, a motif in three parts; the cost and the runs within the cap, a dry
run refusing them as a run does, the price read after the first take and the run stopped there, that
take kept; the takes made into takes/ even once, the plan waited for 900 s, each piece measured, the
plan's length missed, a section refused alone, a suite left while its takes wait and by a run of
everything; a take kept whole — cut, faded, encoded, measured, brought to −19 LUFS, the loops' bars
alike — the files the pieces played before deleted and nobody else's, the manifest written first,
each refusal moving nothing, a kept suite measured anew; and the score as the catalog writes it: its
order, its lengths, its stems' bar grid, the tempo and key in every chunk and no other tempo asked,
the motif from the fifth with its rhythm and cadences, each section told as much of it as it plays,
the voice where it belongs, no drums before the run, no name copied), `test/sampleManifest.test.ts`
(the code's ids against the catalog, the catalog's `usedBy` against the code, the entries awaiting
the render and what they borrow, every other recording on disk, made from its request as it stands,
its length, its start, its gain, its floor, a looped piece's tempo in the manifest, the folders'
caps, no bed past +12 dB, a suite's pieces within 2 dB as played), `test/sfxScript.test.ts` (the
catalog's rules — no stem or theme of its own, no sound of its own with a tempo — the requests and
their hash, the tempo asking nothing anew, what a run makes, the command line, the candidates'
influences and the rules a take is picked by, the credits' guard and the pricing at the first take's
rate, a WAV read, the gain, the start, the silence and the floor worked out from PCM of known
loudness, the floor heard or masked, a length off; the music's takes against a client of the test's
own — three at most, each into `takes/<id>/` with its list and nothing public, numbered on, the
recording the game plays left as it was, every take priced in the plan — and `--keep`: the take
moved, its manifest entry as a render writes it, the rest deleted, each refusal in a line; a bed
whose every take needs more than +12 dB refused in a line and landing nowhere, one within kept),
`test/soundsPage.test.tsx` (the audition page's address, its listing by kind, the score's block — a
row a take, every piece in the plan's order, one command keeping it whole, a piece played where the
plan cuts it, its suite's command for two takes — its floors flagged as the script flags them, what
it says of each recording, the command it puts together, the takes read from the script's lists and
asked of the dev server with a plain GET, each under its piece in one line, the keep command the
script reads, a take played at the gain the game would give it, no other request in its sources),
`server/test/takes.test.ts` (the switch, 404 under `/takes` ahead of the built site without it, the
lists and a take with it, a span a Range asks for and 416 past the end), `test/ambience.test.ts`
(rooms, levels, power, the beds' recorded loops, dead and alive variants, crossfades, the sporadic
sounds, sounds let go, the rooms one way near, the beds wanted by power, a bed loaded as its room
comes near and let go 4 s after, the rest brought in as the lights fail, the room's reverb),
`test/spatial.test.ts` (pan, the inverse model and its 12 tiles, a wall's 600 Hz, 6 dB and 15 ms,
steps on the floor under a partner, the rotor, the chirp and the fly-by placed, the doors placed and
the audience's unplaced), `test/radioVoice.test.ts` (the chain, the shaper's distortion, the
static's level, the speech, the squelches' recordings, the Leitstelle's opening, the music 8 dB and
the beds 4 dB down, the run's lines fetched and the opening line alone decoded, a line decoded as it
airs and let go once spoken, the newest of two, a line's airtime, the offline renders),
`test/pa.test.ts` (the loudspeakers' band, the room's answer left to the reverb, the lines on their
moments, decoded as the announcement starts and let go once said, cut with the power),
`test/introCue.test.ts` (the script and the cue's peak in its list, the cue streamed from where the
opening stands, faded or cut, let go), `test/voiceLines.test.ts` (the recordings against the
missions, their pace and sizes, the voice's choice, what Piper and `say` are given to read, what a
run keeps and makes anew), `test/elevenlabs.test.ts` (the key, the voices, the request, the MP3, the
retry on 429, the gap; with a client of its own, no request leaves), `test/record.test.tsx` and
`test/recordWav.test.ts` (the /record page's lines, its states, its buttons, the files it takes, the
trim and the WAV), `server/test/voiceRecording.test.ts` (the switch, the size limit, a WAV
converted, an MP3 and an M4A kept, WebM turned away, the manifest), `test/music.test.ts` (pressure,
the stem it brings, bars of four beats, a pass's period on whole bars with room for its lead bar and
its seam, every stem's file fetched once and none decoded, a stem from its start on its first bar,
the next pass a bar ahead of its 3 s equal-power seam and the old element rewound, a change on the
next bar crossing over 2 s, a late element caught up, the critical stem in the last minute and the
escape, the alarm's push and sting, a stem kept waiting for the budget, a file asked for again, the
endings and the drain, the streamed stings), `test/sounds.test.ts` (each device's recording, the
alarm after a buzz or an arc, the meter's hum and the colour tones still made, the device hum's
loop), `test/coldOpen.test.tsx`, `test/finale.test.tsx` and `test/putDown.test.tsx` (the effects on
the audio clock, the hatch's grind and its landing, a recording that failed made up by nothing, the
mute ahead of the brickwall) and `test/audioKit.test.ts` (the budget, a recording within it, the
loops, the census); `core/test/radioLines.test.ts` checks the lines themselves. Ten of them were
proved by breaking the code once — the brickwall's ratio, the ducks' release, the IR's decay, the
downmix, the beds' release, the rolloff, the pass's lead bar, a floor's material, the steering's
cap, the voice decoding every line at the start — each failing its tests.

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

**The title.** Under the announcement, from the card on, plays the score's `title` where the music's
manifest has it — the motif's first phrase alone on a felt piano, pianissimo, a warm pad breathing
under it, ending open — at the stems' level by its gain, as every piece of the score, past the
silence it opens with, so that the calm stem two seconds after the blackout does not jump against
it. Until the score is kept it is the older cue, which the rest of this paragraph describes. **The
cue.** One instrumental bed of some 40 s — dark, low, industrial, slowly building — from the card
on: at the peak of a room's bed (`CUE_PEAK`), into the music's bus at the Musik volume, one voice of
the budget; measured as the score's pieces are, it plays at −13.0 LUFS, 6 dB over the stems it hands
on to. Either streams the same way, and the rest holds for both. It streams from its file
(`audioStream.ts`) rather than being decoded — 40 s in two channels would hold 15 MB through the
whole opening — from where the opening stands, and its element is let go once it has played. It
fades out over 1.5 s where the player skips and stops dead at the blackout's bang; the game's own
music starts 2 s after the click, as ever. The cue is composed once by ElevenLabs Music through the
SDK (`scripts/introCue.ts`, `client.music.compose`, `forceInstrumental`, `mp3_44100_96`) into
`public/intro/title.mp3`, its list `public/intro/manifest.json` naming the file, its length, its
peak over both channels — measured by afconvert as it is composed, since nothing decodes it in the
game any more: 0.845; the decoded cue's first channel alone (0.537) set its level before, so it now
plays 3.9 dB quieter — and a hash of the request: a run that finds the same hash and its file
composes nothing anew. Before it composes, the script reads the account's credits and stops below
40,000. Where there is no cue the opening plays without music.

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

## The menu (`menuSound.ts`)

The main menu has a sound of its own, and keeps it through the lobby: a title theme, the facility's
hum under it, and the interface's sounds — all of it silent until the player's first click, tap or
key, as a browser wants (`pointerdown`, `keydown`, `touchend`, caught on the window). That gesture
makes the audio context — within it, so that it may run — and brings the theme and the hum in from
nothing over 2 s (`FADE_IN_S`). Until then the menu's sound waits, and the speaker in the top bar
says so: an amber lamp on its corner, its title „Ton kommt mit dem ersten Klick oder Tastendruck" —
on the menu alone, never over a run or the editor. A lobby after a run needs no gesture: the run
woke the context, and the sound comes in at once. With the sound switched off nothing streams and
nothing waits; switched on again it waits for the next gesture or comes in at once where the context
already runs. It plays on under the menu's booklet and Bestenliste, but not in the editor, a
workshop of its own: opening the editor fades it out over 0.6 s, and leaving it brings the sound
back at once (App.tsx `menuPlaceOf`).

**The theme** (`menu-theme`) is the score's main theme, 93.3 s in A minor at 90 bpm like the run's
three — felt piano states the motif, chamber strings answer, a wordless voice enters once, no
drums (Score, above); until the score is kept, the older theme of 60 s. It streams from its file on
two elements as the stems do (`audioStream.ts`), into the music's bus at the stems' level, and
loops on the bars its manifest names, 32: each next pass starts a bar before it is heard, caught up
meanwhile, and comes in over the seam's 3 s as the last goes out under it, equal in power (music.ts
`loopPeriod`, `SEAM_IN`, `SEAM_OUT`). **The hum** (`bed-facility`) is a bed: the facility at night
heard from its entrance hall, transformers and ventilation far down the corridors, looped on the
rooms' bus at 0.02 — a little under a room's bed — where it is rendered: its takes of 2026-11-13
came back near silent and it awaits a render at full level, which the menu waits for in silence;
no bed is ever brought up more than +12 dB (`samples.ts` `BED_GAIN_MAX`). It is a 10 s seamless
loop, as every room bed of the lab is: a bed lasts 30 s at most in the catalog, and a 30 s bed at
128 kbit/s (480 kB) would not fit the effects' folder, held to 3 MB. The music takes a loop of the
budget while a piece of it is heard, the hum one while it plays, and both give them back as they go.

**The lobby** has a piece of its own where the score is kept: `lobby`, the motif again, thinner —
solo piano, a solo cello answering once, a faint arpeggiated synth — 61.3 s, 20 bars round. As the
doors close on the crew room it comes in from its start on the theme's next bar line, crossing with
the theme over 2 s as the run's stems cross, and as loud as the theme, the score's pieces being
brought to one loudness; back on the menu the theme comes in the same way. Where it is not rendered
the lobby keeps the theme, only 6 dB down (`LOBBY_WEIGHT`), moving there over 1.5 s (`WEIGHT_S`),
and back up should the window return to the menu — no seam heard either way. The crew's own voices
pull both down while anybody speaks — the theme 8 dB, the hum 4 dB, as the Leitstelle's voice pulls
the run's music down (mix.ts `DUCK_DB`, the source `crew`) — and let them back up after. **The run's
start** fades both out over 0.6 s and lets everything go: their elements, the theme's blob, the
hum's recording, the loops.

**One piece of music at a time** (`musicTurn.ts`): the menu's music — its theme or the lobby's
piece, which cross with each other alone —, the end card's sting and theme, the opening's title or
cue and the run's stems never play over each other on the music's bus. A piece that goes holds the
bus until its fade has died — the menu's theme 0.6 s as the run starts, the end card's theme 1 s as
its card goes, the run's stems 1.5 s at its end, the cue its skip's 1.5 s — and a piece that comes
starts no sooner: the opening's cue comes in where the opening then stands, the stems on their first
bar after it, the menu's theme in a lobby after the end card's has gone. The hum and the interface's
sounds are no music and wait for nothing.

**The interface's sounds** are recordings the lab already has, each played once into the effects'
bus under the theme: a tick as an item lights (`ui-tick`, 0.012 at the master gain — no oftener than
every 50 ms, so that a held arrow ticks along and never buzzes), a toggle's clack as one is taken
(`toggle-clack`, 0.03), a dial's detent as a panel is stepped out of (`dial-detent`, 0.024), the
stage's two-note chime as a round comes up on the screen — opened or joined (`stage-chime`, 0.035) —
a console's ready chirp as somebody of the crew says ready (`console-ready`, 0.03), and the cold
open's relay click as the menu's hero switches its lamp on at the end of its entrance
(`relay-click`, 0.04; art bible, „The hero"). None plays before the gesture or with the sound
switched off.

## The end cards (`endTheme.ts`)

The card a run ends on keeps its sting (`playSting`, Music that breathes) and has a theme after it,
as a film's end does: half a second after the sting has ended (`THEME_GAP_S`), `end-won` — the
score's motif resolved into C major, the strings carrying it, the wordless voice singing it once
more, piano arpeggios like first light, coming to rest on a long held chord — or `end-lost` — the
music breaking off, the motif sunk into the piano's low register over a bowed bass, the pad dimming
like failing lights, into silence. Each lasts 40 s and plays once through to its true end, never
round again; until the score is kept, the older themes of 32 s. It streams on the music's bus at the
stems' level, so the Leitstelle's voice pulls it 8 dB down as it does the run's music, and takes one
voice of the budget while it plays. It goes with its card — the crew on to another run, back to the
lobby or out — fading over 1 s and holding the bus until then, so the lobby's theme comes in only
after it. The sting waits for the bus as well: the run's music has faded by the time the card comes.

The score's pieces are AAC at 160 kbit/s, some 20 kB a second: the music's folder is held to 11 MB —
the eight pieces some 10.0 MB, the stings 0.5 — where it held 8 MB for MP3s of 72 s and less. A
test holds the plan to the caps before anything is made
(`test/sampleManifest.test.ts`: each folder's files, less those the entries awaiting their render
will replace, and those entries at their rates, within its cap).

**Rendered.** The menu's theme, the hum and the two end themes were made on 2026-11-13 on the
Creator plan: the hum as the best of three takes, the three pieces of music as one take each (some
2,352 credits in all). The hum's takes came back near silent and were dropped; the three pieces play
until the score is kept, which brings all eight of its pieces at once. Until an entry has its file
the menu plays the interface's sounds alone, the end card its sting alone, and the walkthrough logs
„no theme (awaiting its render?)". `test/menuSound.test.tsx` holds the gesture — no context made
before it —, the buses and the 2 s fades, the lobby's weight, the lobby's own piece coming in on the
theme's next bar over 2 s as loud as the theme, the start without a gesture after a run, the switch
and the sound back at once as it is switched on again, a theme not rendered tended by no timer, the
hum's loop taken only while it plays and a hum brought up past +12 dB kept silent, the end with the
run, the crew's duck, the bus held and waited for, the interface's sounds, and the probe saying the
music sounds once an element of it plays, not when its pass is laid;
`test/doorWipe.test.tsx` the places it is wanted, the editor none of them; `test/endTheme.test.ts`
the sting and the theme after it, its level and voice, a true ending played once and never round
again, its fade with the card and the bus held, no theme for a card gone or a theme not made;
`test/music.test.ts` and `test/introCue.test.ts` the stems and the cue waiting for the bus, the
stems looped on the bars their manifest names, the score's title in the cue's place. The walkthrough
checks the lamp lit before the first key, the sound playing after it and the theme sounding within
8 s where the music's manifest lists it — an element of it playing, as the probe counts it, not a
pass laid — the lobby's music, its own piece sounding where it is listed, else the theme at its
weight, which its log line names, chime and chirp, all of it gone in the run, the won card asking
for its music and its music gone as the next run opens; and once the manifest lists a kept score's
pieces, AAC in .m4a, it asks the browser once whether it plays them (`canPlayType`), and fails
where it plays none (tools/shots.mjs `menuSoundAtFirstKey`, `checkPieceCodec`,
`menuSoundAfterStart`, `checkEndMusic`, `checkEndMusicGone`).

## Lizenz

Every sound the game ships, where it comes from and on what terms, as of 2026-11-14. No stock music,
no sample library and no third-party recording is used: every recording was generated from this
repo's catalog and mission lines, under the account's own ElevenLabs plan, and the rest is
synthesised by the game as it plays.

| What | Where | Made by | When | Terms |
| --- | --- | --- | --- | --- |
| 82 effects and beds | `public/sfx/` | ElevenLabs text to sound effects | 2026-10-26 to 2026-11-04 | paid Creator plan: commercial use, no credit |
| 8 pieces of music: 3 stems, 2 stings, the menu's theme and the end cards' two themes | `public/music/*.mp3` | Eleven Music | 2026-10-26, the themes 2026-11-13 | paid Creator plan, Eleven Music's terms (below) |
| The score: 8 pieces cut from one suite, `score` | `public/music/*.m4a` | Eleven Music, `music_v2_5`, a composition plan | awaits the user's render | as the music; once kept, it replaces the pieces of the row above but for the stings |
| The opening's cue | `public/intro/title.mp3` | Eleven Music | 2026-10-26 | as the music; the score's `title` plays in its place once kept |
| 52 lines of the Leitstelle | `public/voice/` | ElevenLabs text to speech, the library voice „Helmut" | 47 on 2026-10-25, 5 on 2026-10-26 | see below |
| Kalam, the notepad's hand | `public/fonts/` | Indian Type Foundry, 2014 | shipped since 2026-11-01 | SIL Open Font License 1.1, its text beside it |
| Michroma, the title's face | `public/fonts/` | Vernon Adams, 2011 | shipped since 2026-11-13 | SIL Open Font License 1.1, its text beside it |
| Caveat, the last shift's hand | Google Fonts, loaded by the page | Pablo Impallari | not shipped | SIL Open Font License 1.1 |

**ElevenLabs' terms.** Whatever the account makes while it holds a paid plan it may use
commercially, for good — also after the plan ends — and without naming ElevenLabs; whatever it makes
outside a paid plan needs the credit „elevenlabs.io" wherever it is shown and may not be used
commercially, even after an upgrade (ElevenLabs help centre, „What happens to my content after my
subscription ends?"). Eleven Music's own terms (last updated 2026-10-09) allow commercial use on
every paid plan except in film, TV, radio and „Studio Games": commercial games that are no Indie
Game, an Indie Game having earned under 500,000 USD since its first release and coming from a maker
that earned under 1,000,000 USD from all its games. So EscapeLab may use its music commercially as
long as it stays an Indie Game; beyond that, Eleven Music's Enterprise terms would be needed. The
paid Creator plan is on record from 2026-10-26: the render script that guards 40,000 credits and the
first render of the effects and music, which spent 4,678 credits that day.

**The score** is the account's own output on that paid Creator plan, made from the catalog's own
words alone: no recording is given to the model to follow, and no composer, game or piece is
named to it (Score, above). Its pieces are then as free as the rest of the music: commercial use as
long as EscapeLab stays an Indie Game, no credit needed.

**The Leitstelle's 47 lines of 2026-10-25** were recorded the evening before that record, when the
voice section of this document still reckoned with the free plan and its credit. The repo does not
say which plan the account held then. Recorded on the free plan, they need the credit
„elevenlabs.io" and may not be used commercially; recorded on the paid plan, they are as free as the
rest. Recording them again settles it, some 4,000 characters, every line by the same voice:
`VOICE_ENGINE=elevenlabs pnpm --filter @escapelab/client voice --fresh`. A library voice can carry
conditions of its own, which its page in the Voice Library names.

**Made as the game plays.** The radio's chain and the static under its voice, the rooms' answers
(their impulse responses, `reverb.ts`), the meter's hum and the colour game's tones are synthesised
by the game's own code and carry no one else's rights. Piper and its voices, which recorded the
lines before Helmut did, are build tools that never ship.

## Open

What the sound packages left for later, one line each, the newest first:

- **The score, rendered and kept by ear** (M-music): three takes in two runs, about 26,500
  credits at the script's rate (22,080 at ElevenLabs' 900 a minute); the commands are under „Takes
  und Auswahl". Then `AWAITING_RENDER` loses the eight pieces.
- **The older cue goes once the score's title is kept** (M-music): `public/intro/`,
  `scripts/introCue.ts` and the cue's fallback in `intro/cue.ts` play no part after it.
- **The facility's hum at full level** (M-music): `--candidates 5 --only bed-facility`, some 200
  credits; a take needing more than +12 dB is refused, and the menu plays on without it.
- **Bars checked by ear only** (M-music): nothing measures whether Eleven Music kept 90 bpm and
  the bar lines the plan lays; the audition decides, and the cut follows the plan.
- **The Leitstelle's 47 lines of 2026-10-25** (S-menu, „Lizenz"): the repo does not record the
  plan they were made on; recorded again on the paid plan, they are licensed as the rest.
- **The opening's cue plays 3.9 dB quieter** (L-sound): its level now follows its peak over both
  channels, where the first channel's alone set it before (The opening, above) — a change of
  level, not a fault.
- **Helmut's announcement and the opening's cue** (the opening, above): Piper (Thorsten) reads the
  loudspeakers' five lines and no cue is composed until the two commands there are run.
- Done in L-polish: the devices' sounds play into the effects' bus, its reverb and its brickwall
  (The mix); nothing of the lab goes past the buses any more.

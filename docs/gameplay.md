# EscapeLab — gameplay

How the crew steers, how it finds things, what a run leaves behind and how runs compare: the
controls on keys and on a controller, the quick chat, the station's intercom, finding things, the
walks of Blackout's lab, the first win at the stations the whole crew presses, the Erfolge, the
Tagesschicht, the picture of a run, the danger sense, the Serverraum's cabling diagram, typing at
its terminal, what the notepad takes down and what happens when a line drops. Code:
`packages/client/src/input/` (bindings, controller, prompts), `client/src/achievements.ts` and
`screens/{Plaques,ShareButton,ControlSettings}.tsx`,
`screens/shareCard.ts`, `world/{labelFade,finds,danger,ChatWheel}.ts(x)`,
`puzzles/RackDiagram.tsx`, `puzzles/{prompt.ts,ServersPanel.tsx}`,
`puzzles/{SyncCount.tsx,syncPress.ts}`, `voice/{rules,intercom}.ts`, `noting.ts`, `notes.ts`,
`screens/{Notepad,NoteButton}.tsx`, `pass.ts`, `line.ts`, `ws.ts`,
`screens/{Join,Pause,Line,GiveUp}.tsx`; in the core `chat.ts`, `discovery.ts`, `achievements.ts`,
`daily.ts`, `map.ts` (`intercomOf`), `puzzles/servers.ts` (`serviceDiagram`),
`puzzles/buttonSync.ts` and `actions.ts` (the pause); in the server `seats.ts`, `heartbeat.ts`.

## Controls

Every action has a key of the player's choosing (Settings → Tastenbelegung); a few keys keep
their task whatever is bound. A standard-mapping controller works everything; its four main
actions sit on buttons of the player's choosing (Settings → Controller), the rest is fixed.

| Action | Keys (default) | Controller |
| --- | --- | --- |
| Laufen | W A S D, arrows (fixed) | left stick (dead zone 0.2, radial) |
| Sprinten | Shift, held | R1, held |
| Benutzen: bedienen, lesen, durchsuchen, aufnehmen, einsetzen | E; Enter and Space (fixed) | A/✕ |
| Ablegen (hands full) | Q | B/○ |
| Weglegen / Zurücktreten / Fenster schließen | Esc (fixed); E or a step puts a sheet down | B/○ |
| Notizblock | N | X/□ |
| Minikarte | M | Y/△ |
| Ping für alle | a click on the world | D-pad ◀: the floor the lamp points at |
| Schnellchat | C, then 1–8 (fixed); a phrase with a slot, then 1–9 | D-pad ▶, then the D-pad to a phrase and A, and to a slot's value and A |
| Einsatzinfo | I | Select |
| Sprechen (push-to-talk) | V, held (at the terminal V types; its FUNK key talks) | L1, held |
| Einstellungen | ⚙ in the top bar | Start |
| Blättern beim Lesen | ← → (fixed) | D-pad ◀ ▶ |
| In Pulten und Fenstern wählen und drücken | Tab, Enter | D-pad or a flick of the stick, then A |

**Rebinding.** „Ändern" waits for the next key: a key the game keeps (the arrows, Enter, Space,
Esc, Tab, 1–8, Backspace, Delete) is refused with its task, a key another action holds is
refused naming that action („Schon belegt: Notizblock (N)."), a key held with Strg, Alt or Cmd
is no key to hold alone; Esc stops waiting, and so does any controller button, which has no key
to give. On the controller the next button pressed takes the action — A, B, X, Y, L2 or R2 —
and where another of the four sat there, the two swap, which the panel says. „Tasten und
Controller zurücksetzen" brings both back. The settings are kept on the device
(`escapelab.settings`, `keys` and `pad`); settings kept before the key map keep their talk key.
A bound key is the game's: the browser's own use of it stays off (F5 bound to the minimap
reloads nothing). A key held down — a step, the sprint, the talk key — is let go where it went
down, whatever Shift or a new binding made of its name meanwhile (`input/heldKeys.ts`).

**Prompts.** No screen names a key by itself: every prompt reads it from the binding map
(`input/glyphs.ts`) — „[E] Lesen" on keys, „[A] Lesen" (or „[✕] Lesen" on a PlayStation
controller, told by its id) once a controller was pressed or its stick leant, and back to keys
at the next real key. The world's prompt, the carried part's line, the HUD's buttons, the foot
of a sheet and of a device, the notepad's and the book's buttons, the intro's skip and the key
list all follow, and the lever and the world's tips name the keys bound.
`client/test/bindings.test.tsx` reads every screen's strings and JSX text and fails on a key
written by hand — in brackets or worked in a sentence („E drücken") — and on a letter a handler
listens for itself (`useKeys(['e'], …)`).

**A controller.** Polled once a frame while one of the standard mapping is connected — another
one's buttons and axes would mean something else (`input/padRuntime.ts`). In the world the
stick walks as far as it leans — past the dead zone of 0.2, scaled from there to the rim, as
fast on a diagonal; the buttons press the keys they stand for, A by Space, so that it also
skips the opening. The D-pad walks nobody there: its ◀ pings for the whole crew where the lamp
points — two tiles ahead along the way the avatar faces, short of the first wall, shut door or
piece of furniture (`world/padPing.ts`), as a click pings where it lands — and its ▶ opens the
quick chat by its key; the wheel then takes the controller as a dialog does, its first phrase in
the focus, the D-pad moving between them, A saying one — or opening the second step of one with a
slot, its first value in the focus — and B shutting it. ▲ and ▼ do nothing in
the world. A text field in the focus lets go first, as a controller types nothing: X closes the
notepad it opened. Over a dialog (the device, the pages, the settings, the info) the D-pad moves
the focus to the nearest control that way, A presses it — a control made to be held, as the
button module's face (`data-pad="hold"`), by Space for as long as A is held, every other one by a
click — and B steps back; in a book the D-pad turns the pages. A direction still held in the
world as a dialog comes up — the stick walking, the ▶ that opened the quick chat — moves nothing
there until it is let go. An Xbox controller says Xbox in its id
(„Xbox Wireless Controller"), a PlayStation one Sony's vendor or its name. The settings show a
live test: every button lights while held, the stick's dot leans. The walkthrough's
`?fakepad=1` puts a controller of its own on `window.__escapelab.pad` (press, release, tap,
lean).

## Quick chat

The wheel holds eight phrases in the crew's own words: the mission's (`chat.phrases`, validated
in core `chat.ts`) or, where it names none, the default list. A phrase may hold one slot, filled
as it is said: `{n}`, a number from 1 to 9, or `{name}`, one of the phrase's own `names` (two to
nine, eight characters each at most); a phrase stays within 24 characters, filled in. Blackout's
wheel has no valves: „Hier rüber!", „Warte kurz …", „Bereit!", „Brauche eine Ansage!", „Ich
halte die Platte", „Achtung, Drohne!", „Kabel {n}" and „Dienst {name}" with the Serverraum's
six services. The wheel shows a slot as „…" („Kabel …"); its digit, a click or A opens the
second step, every value as the phrase will say it („Kabel 1" … „Kabel 9", three abreast), where
1–9, a click or the D-pad and A say it. While that step is up the digits are its, whatever else
they are bound to; Esc or B shuts the wheel from either step. A client names a phrase by its
place and the slot's value; the server fills it in (`sayPhrase`) and refuses a place or a value
the mission does not have. The bubble over the speaker and the HUD's line show it as said:
„Anna: Kabel 3" (`world/ChatWheel.tsx`, `client/test/chatWheel.test.tsx`; chat-slot.png).

## The station's intercom

Between the places of the armed station — its consoles and the open sources that cover it — the
crew hears each other in full however far apart, walls or not; everywhere else the voice fades
with distance and walls as before. The device's PARTNER LED then reads „Ben · Pult B · Funk".

## Finding things

A player finds a source, note, part, the sign or an armed console within 2 tiles in sight, or
after 600 ms in their lamp's cone (0.5 rad, 3 tiles), lit room or not; a part within 0.9 always.
The beam shows 7.5 tiles: what lies beyond 3 shows as what it is, nameless, till one comes nearer.
The server decides, per player. The same sight says who stands where: at a source, a note or
the sign only a player who has found it counts, at a console only one who sees the middle of
its tile — walls and shut doors in between hide it — or has found it. Through a wall or round
a pillar there is no prompt, no „Bedienen" and no device (server `room.ts` `facesConsole`,
client `world/interact.ts`). While the power is on (the opening, the way out) every view shows
the whole lab; in the dark it holds a thing nobody has found only in sight: what and where. The
armed station is whole on every map. The sign stays on every map and the minimap as a landmark,
but glows through the dark only once the crew has found it.
Names fade in over 300 ms; a find that matters gets its caption, a chime at most once in 1.5 s.

## Walking Blackout's lab

An avatar walks 4.2 tiles a second, 5.46 sprinting (core `map.ts`). Blackout's lab (36 × 22
tiles, the plan in `docs/art-bible.md`) is laid out so that no walk of the plan the walkthrough
plays on seed 5 takes longer than 12 s, the run from the reactor to the hatch included; core's
missionMaps test holds every one to that. Each walk below goes the eight ways a player steers,
round furniture and doors shut at the time, never cutting a corner, from a tile at the place to
a tile at the next — measured on the lab of 27 × 17 before N-xxl and on this one:

| Station | Who | From → to | Tiles before → now | Seconds before → now |
| --- | --- | --- | --- | --- |
| Notlicht | Anna | the start in the Archiv → the lever | 12.0 → 16.8 | 2.9 → 4.0 |
| Notlicht | Ben | the start at the Flur's west end → the lever | 10.4 → 15.2 | 2.5 → 3.6 |
| Notstrom-Kasten | Ben | the lever → the book | 15.0 → 20.4 | 3.6 → 4.9 |
| Notstrom-Kasten | Ben | the book → the Laborkennung | 6.0 → 7.4 | 1.4 → 1.8 |
| Notstrom-Kasten | Ben | the Laborkennung → the plate | 8.8 → 11.7 | 2.1 → 2.8 |
| Notstrom-Kasten | Anna | the lever → the fuse box, the plate held | 13.2 → 17.7 | 3.2 → 4.2 |
| Notstrom-Kasten | Ben | the plate → the meter | 4.8 → 6.2 | 1.1 → 1.5 |
| Signalkette | Ben | the meter → the clipboard | 6.8 → 10.2 | 1.6 → 2.4 |
| Signalkette | Ben | the clipboard → console A | 11.8 → 18.2 | 2.8 → 4.3 |
| Signalkette | Anna | the fuse box → console B | 7.8 → 10.1 | 1.9 → 2.4 |
| Serverraum | Anna | console B → the terminal | 29.7 → 36.7 | 7.1 → 8.7 |
| Serverraum | Ben | console A → the locker | 16.0 → 19.0 | 3.8 → 4.5 |
| Serverraum | Ben | the locker → the rack | 6.0 → 6.4 | 1.4 → 1.5 |
| Frequenz | Ben | the rack → the key | 2.0 → 3.0 | 0.5 → 0.7 |
| Frequenz | Ben | the key → the cabinet | 32.1 → 36.5 | 7.6 → 8.7 |
| Frequenz | Anna | the terminal → the radio | 31.7 → 39.3 | 7.5 → 9.4 |
| Reaktor | Anna | the radio → the spare fuse | 16.8 → 21.2 | 4.0 → 5.1 |
| Reaktor | Anna | the fuse → its slot | 32.7 → 43.4 | 7.8 → 10.3 |
| Reaktor | Ben | the cabinet → the reactor | 17.2 → 24.2 | 4.1 → 5.8 |
| Escape | both | the reactor → the hatch, by the Labor | 37.1 → 47.9 | 8.8 → 11.4 |
| Escape | both | the reactor → the hatch, by the Serverraum | 38.8 → 49.1 | 9.2 → 11.7 |

Each walks the plan in about 55 s now, Anna 55.5 and Ben 53.9, where both took about 42 before
(43.2 and 41.3): three tenths more. Both ways out are 52 steps on the grid, as the last shift's
note by the hatch says; counted the eight ways, the Labor's is a tile shorter. Every start lies
3.6 to 4 s from the lever.

## The first win

Both missions open on a main switch the whole crew throws together, and Blackout ends on a
reactor restart the whole crew presses together: its first win and its last. Each gives the crew
one window, 3.5 s (`windowMs` 3500 at Blackout's Notlicht and Reaktor-Neustart and at the
tutorial's Initialisierung; its Synchronkalibrierung keeps 3 s). A press lives that long from the
moment the server takes it, and the station closes once every press of the crew is live at the
same moment (core `puzzles/buttonSync.ts`). A press that runs out is dropped on the room's
clock, its owner's device says „Zug verfallen — nur zu zweit zugleich" („Druck verfallen — …" at
a button), and nothing is charged. The plate says the window („NOTLICHT · HAUPTSCHALTER · NUR ZU
ZWEIT · 3,5 S"), and so do the printed rules and the coach line, all read from the mission: no
module writes a window of its own (`core/test/firstWin.test.ts` greps them).

**The count both see.** After Portal 2's co-op countdown, a way for the crew to keep in step:
from the first press of the window, every page at the station — and the partner's, when they
open it later — shows the same count, from the server's clock (`clock.ts`), not the page's own.
Beside the levers or the button, in a dark window, it names who opened the window („Anna hat
gezogen —", „Ben hat gedrückt —") and shows in large digits the whole seconds left as each
begins: 3, 2 and 1 a second each, then 0 for the last half second. The control never moves for
it: where the stage is too narrow for a column beside it (a phone held upright, under 560 px)
the count sits under the control on one line. Each whole second ticks once
at the station (the countdown's beep, on the effects' bus), at the same moment on every page
within the clock's offset; a page that comes to a second more than 250 ms late waits for the
next. When the last press lands in time the station solves as before, with no GO of its own;
when the window runs out the count goes, and the next press starts it afresh. The view lists
every live press, whose and when, for every viewer wherever they stand (`presses`); the panels
draw the count from it (`puzzles/SyncCount.tsx`, `syncPress.ts`). Under reduced motion the ring
round the own grip stands at what is left instead of draining; the digits change all the same.

**Telling the partner.** While a press waits, every crew strip tags its owner „zieht" at the
main switch or „drückt" at a button, in place of „am Pult" and wherever they stand: a partner
still on the way sees that the switch is waiting for them (`screens/Crew.tsx`). The audience's
footer says the same.

The walkthrough has one player pull alone at the main switch — the host in Blackout, the guest
on an upright phone in the tutorial — and shoots lever-countdown.png (the puller's page) and
lever-countdown-partner.png 1.3 s in: the digits no more than one apart, the partner's page
naming the puller and its strip saying „zieht"; once the window has shut, the count has to be
gone from both pages (`client/test/syncCount.test.tsx`, `crew.test.tsx`).

## Erfolge

Seven plaques a crew earns in a run it wins, read off the run's report alone
(`achievementsOf(report)` in the core) — none for a run lost:

| Plaque | Earned when |
| --- | --- |
| Ohne Alarm | not one alarm in the whole run, whatever set it off |
| Unter acht Minuten | from the lights going out to the escape in under 8:00 |
| Alle Notizen gelesen | every note of the last shift on the map read; none on a map without notes |
| Jede Station im ersten Versuch | no station reported a wrong move (a drone's alarm is none) |
| Ungesehen | no drone caught anybody, on a map where drones patrol |
| Stiller Serverraum | no command at the Serverraum failed (an alarm there); none without one |
| Erste Schicht | every won run — that it is the first is the device's to tell |

The view of a finished run carries them (`PlayerView.achievements`). The device keeps each with
the moment of the run that first earned it (`escapelab.achievements`, by mission). The won card
shows them as brass plates under its facts — title, line, the day first earned — the ones new
to this device coming in one after the other, 300 ms apart; under reduced motion they are
simply there. The lobby counts the mission's: „Erfolge 3/7". The plates praise nobody: they say
what happened.

## Tagesschicht

One seed a day for a mission that offers it (`daily: true` in the mission; Blackout does): the
host's switch „Tagesschicht 31.10." beside the difficulty in the lobby, named by today (UTC; its
title says what it is), pins the room to the day's seed, so every crew that day plays the same
instance — spawns, sources, edgework, every station. The server decides the day: its clock at
each start, so a rematch after midnight UTC plays the next day's; it hands the reducer the day
and the day's seed with the start, and the core reads no clock.

The seed is an FNV-1a hash of a salt and the day, mixed through a finaliser
(`dailySeed(day, salt)`). The salt is the server's alone, so that nobody works a day's instance
out from its date: `DAILY_SALT` where it is set, else `packages/server/data/daily-salt`, made at
random on the first start, readable by the server alone and kept across restarts (git ignores
it). Two servers with different salts play different instances on the same day; a server
without one starts no run on the Tagesschicht. The start-up log says where the salt came from.

It needs no `ALLOW_SEED` (the server's own pinning stays dev-only) and passes over a tester's
pinned seed while it is on. A switch to a mission without one turns it off. The report says
`daily: true` and names the seed, for whoever holds the run log; the players never see it. The
Bestenliste ranks daily runs apart, by the UTC day they started on: `GET /stats/daily` (the last
14 days, the newest first), `GET /stats/:mission?run=…&daily=…` for a run's place among its
day's; `GET /stats` leaves them out. The Bestenliste page has a „Tagesschicht" tab with a chip
per day; the end screen of a daily run gives its place on its day.

## The picture of a run

„Bild speichern" under the won and the lost card draws the run on a 1200 × 630 canvas — the
size of a link's preview — and saves it as a PNG through the browser's download
(`escapelab-blackout-im-labor-2026-10-31.png`): the game's name and the day, the Tagesschicht
where it was one, the mission spaced out in capitals, what the run came to in large letters, the
time and the rank (for a run lost, the stations it got through), the crew by name behind a dot
of their colour, the Erfolge on brass, and the plant's name at the foot, all in the lab's type:
monospace, capitals spaced out.

## Danger sense

A drone in flight within five tiles that comes nearer — it flies at the player, or the player
walks into it, measured against the look 0.4 s before — ticks: the ping's recording, cut short
and pitched up, placed by the spatial API (`placeOf`: panned to its side, quieter with the
distance, muffled through a wall), 900 ms apart at five tiles and 220 ms right beside, higher the
nearer. The screen's edge glows red toward it through the marker system — a marker with a glow
instead of an arrow, on the screen's edge where the line toward the drone leaves it — as strong
as it is near. At every difficulty; a drone held still by its plate, or one flying off, is quiet.

## The Serverraum's cabling diagram

The rack (console B) shows the Netzplan as a cabling diagram derived from `DEPENDS_ON`
(`serviceDiagram`): each service in the column of the longest chain of dependencies under it —
NETZ; DNS, DB; AUTH; MAIL, WEB — each column ordered so that no cable runs through a box, an
arrow from every dependency to the service that needs it, every box with its power LED as the
rack's unit shows it. Rules, not answers: the codes stay at the terminal. The Netzplan is the
plant's fixed topology, the same for every seed and every instance, so it may stand at a console;
the rules that vary with the instance stay with the sources. The printed page of the Serverraum
draws the same diagram, its LEDs dark.

## Typing at the Serverraum's terminal

The terminal (console A) is worked by typing, and its prompt holds the keyboard while it is up
(`puzzles/prompt.ts`, `ServersPanel.tsx`):

- **Focus.** The prompt takes the focus as the terminal opens and takes it back after every
  command and every key of the bezel — where keys and a mouse steer. Under a finger it waits to
  be touched, as the screen's own keyboard would cover the terminal; on a controller the D-pad
  moves the focus itself.
- **Stray keys.** While the terminal is up, every printable key typed on the keyboard goes to
  the prompt wherever the focus went — a click on the screen or a key of the bezel loses
  nothing — and no other listener hears it: not the world, not N for the notepad. Keys typed in
  the notepad stay there, a dialog over the terminal (settings, Einsatzinfo) keeps its own, a
  terminal stepped back from or solved takes none, and a controller's presses are no letters
  (`isTrusted`, as `input/device.ts` reads it).
- **Tab** completes the line's last word: the first to a command, the one after `start` or
  `restart` to a service, as far as every word it could still become agrees — `s` → `sta`,
  `star` → `start ` (a command that takes a service gets the blank), `start d` stays (DNS or DB),
  `start dn` → `start dns`. A line it cannot complete stays; Shift+Tab leaves the prompt.
- **Enter** sends, as ⏎ on the bezel does; **Esc** steps back as at every device.
- **Answers at the prompt.** A line the terminal cannot read gets „? Befehl unbekannt" under the
  prompt, which shakes; a command the server refuses gets its words there too („! Am Rack steht
  niemand."), besides the device's head.
- **Talking.** The talk key types at the prompt like any letter: while a prompt holds the keys
  the voice stands back (`hooks.ts` `claimKeys`, `voice/useVoice.ts` `talkKeyBusy`). The bezel's
  FUNK key talks while held by a mouse or a finger (with the microphone on), and L1 on a
  controller talks straight to the voice, sending no key (`input/padRuntime.ts` `onPadTalk`).
  The Einsatzinfo's controls say „Am Terminal: Funk per Maus/Pad".
- **The notepad.** N types at the prompt like any letter too. The bezel's „Notieren" brings the
  pad up beside the terminal with the table taken down fresh; a controller's X and the
  chassis' tab on a touch screen bring it up as at every device, and Esc, N and E again do it
  from the world.

`client/test/terminal.test.tsx` holds each of these; the walkthrough types Blackout's first
command as a player would — a click on the screen first, then letters and Tab — and shoots the
line half typed (terminal-typing.png).

## Captures in the notepad

„Notieren" — at a source's rules list or table, on the slip with the last shift's notes at a
source, on the terminal's bezel, under a note of the last shift pinned up — and the notepad's
„Laborkennung übernehmen" take down a capture: a
one-line head naming the place and the part of it, and at most eleven lines under it, holding
the data a player needs there and nothing else (`noting.ts`). The place is the source by its
label („Klemmbrett", „Handbuch", „Spind", „Aktenschrank"), the terminal, the sign („Schild") or
the note's slip („Zettel"); the part is the section's heading — among several blocks in one
section a table by its first column, a list as „Regeln" — or what the place holds.

| Template | Set as | In Blackout (seed 5) |
| --- | --- | --- |
| Table | its columns aligned under their names, two blanks apart, never wrapped; a repeated column the table already gives left out | Klemmbrett · Legende (Zeile · Pult A · Muster · Pult B: the printed second „Muster" is the pattern Pult A's column gives B's colour), Spind · Netzplan, Terminal · Dienste (Dienst · Status · Strom · Braucht) |
| More pairs than lines | two pairs a line, the first half down the left | Aktenschrank · Frequenztabelle: 16 words in 8 lines |
| Morsetafel | only the letters the Frequenztabelle's words are told apart by (their first three) — 18 of 26 — two a line | Aktenschrank · Morsetafel: 9 lines |
| Long table of pairs of rows | a pair of rows a line, alike but for a yes-or-no column | the Kippschalterbank's Stellungstabelle (Stern nein · Stern ja) |
| Table wider than 38 characters (what the pad holds aligned on a phone) | a row a line, its cells parted by „ · ", wrapped | Spind · Code, Spind · Befehl am Terminal |
| Rules list | numbered as printed | Handbuch · Schnittfolge, Spind · Regeln |
| Laborkennung | one line: serial · control lamps · cells | Schild · Laborkennung: „UZKM9-8 · CAR aus, SIG an, NSA aus · 4 Notstromzellen" |
| Notes of the last shift | as written, one a line; a pinned note under the room it hangs in | Klemmbrett · Notizen der letzten Schicht, Zettel · Flur |

The notepad keeps the player's own writing at the top and the captures under it, newest at the
bottom (`notes.ts`), each one editable; one wiped is gone once the pen leaves it. A capture of
the same place and part replaces the first: it moves to the bottom with „aktualisiert" beside its
head, and the control says „Aktualisiert" instead of „Notiert". The pad is kept per room and
player (`escapelab-notes:<ROOM>:<player>`, JSON); a pad kept before captures were kept apart
reads as the player's writing. The walkthrough takes the last shift's note it asked for down
from the slip as well (hint-noted), word for word.
`client/test/captures.test.ts` runs every template on Blackout's real rules and on what seed 5
deals (`tools/fixtures/blackout-plan.json`), and holds every capture of every mission to twelve
lines with its head.

## Verbindung und Wiedereintritt

A run binds whoever plays it, as a match does in Dota 2: they can come back at any time and
leave it only by saying so. Every browser profile holds a crew pass, the Dienstausweis: an id and
a secret minted once and kept in `localStorage` (`escapelab-pass`) with the name last played
under. Every seat is bound to the pass that sat down on it — the server keeps the pass's id and a
SHA-256 of its secret, never the secret — and any socket that shows the pass has the seat back
(`resume {code, pass}`), from any tab or window of that browser. A tab keeps only the room's
code (`sessionStorage`) and whether it just watches, so a reload or a new socket is back in the
run, or back in its audience (`spectate`), at once.

**Bound to the run.** While the pass sits in a run that is on, live or paused, the join screen
opens on the run's card instead of the form (`whereami`, asked as the screen comes up): the
mission, the room's code, the crew and the clock as the server last showed it, with „Zurück zum
Einsatz" and „Einsatz aufgeben" (a second press within 4 s confirms it). Opening or joining
another room is refused, naming the run. A seat in a lobby shows its card too, and „Raum
verlassen" leaves it as before; a finished run binds nobody.

**The pause.** A line that drops pauses the run for everyone — the clock, the patrols, the
emergencies — and the others' card counts: „Warten auf Ben · 0:12". 60 s into the run's first
drop, and 20 s into every later one, everybody still on the line is offered „Ohne Ben weiter"
(Overcooked 2: the crew chooses between waiting and going on). One press runs the clock again
and waives Ben: the stations the whole crew presses, the hatch and the escape count the crew
without him, and an emergency at the relay is rolled anew without his console (and with it
again once he is back); a station with two consoles still takes two. With one member left on
the line the way on is never offered; after the same wait the card offers „Einsatz abbrechen"
instead, which ends the run lost (`lost:abandoned`, „EINSATZ ABGEBROCHEN"). A waived member who
comes back counts again at once, without a pause, and the others read „Ben ist zurück". The
escape is never judged while the run stands paused, and a drop alone ends no run.

**Giving the run up.** „Einsatz aufgeben", on the run's card or on the card of a line lost, gives
the seat up for good: what they carried goes down where they stood (on their start where the
server never had them), a plate they held lets go, and the pass is free again. Below the
mission's least crew (`players.min`) the run ends lost for everyone, its end card naming who
left („Ben hat den Einsatz verlassen."), and the rematch works as ever — decided before an
emergency at the relay is rolled anew for whoever is left. Otherwise the run goes on, its clock
running again where it waited for them; but with fewer than the least crew left on the line it
waits again for whoever it went on without, their wait starting anew (20 s), and the one left
alone may call it off once that is over.

**Taking a seat over.** As in Jackbox, a new device joins a running room by its code and the
exact name of a seat whose line is down, and sits on it; the pass that held the seat is refused
from then on („Der Platz wurde auf einem anderen Gerät übernommen."). The name of a seat still
on the line is refused („Ben ist noch verbunden."); any other name gets the refusal of a join
into a run, which says that a seat whose line is down can be taken over by its name.

**The line.** The page counts its line dead when an ask for the server's time stays unanswered
for 5 s, after 20 s without a word from the server, or when a socket is not open 8 s after it
was made: it closes it and makes a new one at once, the pause between tries back at 1 s
(doubling up to 10 s after a close). The network back, the page shown again or in focus try at
once. While the line is down in a run the player's own card stands over the world —
„VERBINDUNG VERLOREN", „Verbinde neu · Versuch 3 · in 4 s", „Jetzt versuchen", „Seite neu laden",
„Einsatz aufgeben" — and what is pressed meanwhile goes nowhere. The server cuts a socket that
left two pings unanswered or sent nothing for 20 s: a browser answers pings even for a page held
offline. Every 10 s the server beats on every socket — the join screen's, the lobby's, a run's,
the audience's — with a `tick`, which the page answers at once with a `tock` from its message
handler: a tab long hidden, whose timers the browser runs only once a minute, still answers,
so neither side's 20 s rule cuts a page that lives. The voice links come up again after a
return.

**The lobby.** The host cannot start while a seat's line is down: the lobby says whose („Bens
Leitung ist unterbrochen"), as it says who has not confirmed yet. A seat whose line has been
down for 120 s in the lobby is freed, its pass bound no more and the log saying so — at once
where the room comes back to its lobby later than that — and the crew starts without it.

**What the server says.** One log line per event, with the room and the name: a seat joining,
its line closing, its return with how long it was away, a socket the heartbeat cut and why, a
refusal at the door or of the way on, going on without somebody, a seat given up or taken over,
and every run's end with its outcome. `GET /health` counts the rooms, the runs on and paused,
the players and the audience on the line, and says the uptime and the build
(`RENDER_GIT_COMMIT`, else `dev`); it names nobody.

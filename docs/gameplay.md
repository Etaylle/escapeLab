# EscapeLab — gameplay

How the crew steers, how it finds things, what a run leaves behind and how runs compare: the
controls on keys and on a controller, finding things, the Erfolge, the Tagesschicht, the picture
of a run, the danger sense and the Serverraum's cabling diagram. Code:
`packages/client/src/input/` (bindings, controller, prompts), `client/src/achievements.ts` and
`screens/{Plaques,ShareButton,ControlSettings}.tsx`, `screens/shareCard.ts`,
`world/{labels,finds,danger}.ts`, `puzzles/RackDiagram.tsx`; in the core `discovery.ts`,
`achievements.ts`, `daily.ts` and `puzzles/servers.ts` (`serviceDiagram`).

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
| Schnellchat | C, then 1–8 (fixed) | D-pad ▶, then the D-pad to a phrase and A |
| Einsatzinfo | I | Select |
| Sprechen (push-to-talk) | V, held | L1, held |
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
the focus, the D-pad moving between them, A saying one and B shutting it. ▲ and ▼ do nothing in
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

## Finding things

A player finds a source, note, part, console or the sign within 2 tiles in sight, or once it has
stood 250 ms in their lamp's cone (0.5 rad either side, 7.5 tiles) in sight; a part within 0.9
always. The server decides, per player; a lit room finds nothing by itself. Names wait for a find
and fade in over 300 ms; only finds that matter chime, once a thing, at most once in 1.5 s.

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

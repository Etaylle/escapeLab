# EscapeLab — gameplay

How the crew steers, what a run leaves behind and how runs compare: the controls on keys and
on a controller, the Erfolge, the Tagesschicht, the picture of a run, the danger sense and the
Serverraum's cabling diagram. Code: `packages/client/src/input/` (bindings, controller,
prompts), `client/src/achievements.ts` and `screens/{Plaques,ShareButton,ControlSettings}.tsx`,
`screens/shareCard.ts`, `world/danger.ts`, `puzzles/RackDiagram.tsx`; in the core
`achievements.ts`, `daily.ts` and `puzzles/servers.ts` (`serviceDiagram`).

## Controls

Every action has a key of the player's choosing (Settings → Tastenbelegung); a few keys keep
their task whatever is bound. A standard-mapping controller works everything but the quick chat
and the ping; its four main actions sit on buttons of the player's choosing (Settings →
Controller), the rest is fixed.

| Action | Keys (default) | Controller |
| --- | --- | --- |
| Laufen | W A S D, arrows (fixed) | left stick (dead zone 0.2, radial) or D-pad |
| Sprinten | Shift, held | R1, held |
| Benutzen: bedienen, lesen, durchsuchen, aufnehmen, einsetzen | E; Enter and Space (fixed) | A/✕ |
| Ablegen (hands full) | Q | B/○ |
| Weglegen / Zurücktreten / Fenster schließen | Esc (fixed); E or a step puts a sheet down | B/○ |
| Notizblock | N | X/□ |
| Minikarte | M | Y/△ |
| Schnellchat | C, then 1–8 (fixed) | — |
| Einsatzinfo | I | Select |
| Sprechen (push-to-talk) | V, held | L1, held |
| Einstellungen | ⚙ in the top bar | Start |
| Blättern beim Lesen | ← → (fixed) | D-pad ◀ ▶ |
| In Pulten und Fenstern wählen und drücken | Tab, Enter | D-pad or a flick of the stick, then A |

**Rebinding.** „Ändern" waits for the next key: a key the game keeps (the arrows, Enter, Space,
Esc, Tab, 1–8, Backspace, Delete) is refused with its task, a key another action holds is
refused naming that action („Schon belegt: Notizblock (N)."), a key held with Strg, Alt or Cmd
is no key to hold alone; Esc stops waiting. On the controller the next button pressed takes the
action — A, B, X, Y, L2 or R2 — and where another of the four sat there, the two swap, which
the panel says. „Tasten und Controller zurücksetzen" brings both back. The settings are kept
on the device (`escapelab.settings`, `keys` and `pad`).

**Prompts.** No screen names a key by itself: every prompt reads it from the binding map
(`input/glyphs.ts`) — „[E] Lesen" on keys, „[A] Lesen" (or „[✕] Lesen" on a PlayStation
controller, told by its id) once a controller was pressed or its stick leant, and back to keys
at the next real key. The world's prompt, the carried part's line, the HUD's buttons, the foot
of a sheet and of a device, the notepad's and the book's buttons, the intro's skip and the key
list all follow. `client/test/bindings.test.tsx` reads every screen's strings and JSX text and
fails on a key written by hand.

**A controller.** Polled once a frame while one is connected (`input/padRuntime.ts`). In the
world the stick walks as far as it leans — past the dead zone of 0.2, scaled from there to the
rim, as fast on a diagonal — and the D-pad at full; the buttons press the keys they stand for,
A by Space, so that it also skips the opening. Over a dialog (the device, the pages, the
settings, the info) the D-pad moves the focus to the nearest control that way, A presses it, B
steps back; in a book the D-pad turns the pages. The settings show a live test: every button
lights while held, the stick's dot leans. The walkthrough's `?fakepad=1` puts a controller of
its own on `window.__escapelab.pad` (press, release, tap, lean).

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
host's switch „Tagesschicht 31.10." beside the difficulty in the lobby (its title says what it
is) pins the room to the seed of the UTC day
(`dailySeed(utcDay(at))`, an FNV-1a hash of the day mixed through a finaliser), so every crew
that day plays the same instance — spawns, sources, edgework, every station. The day is the
one each run starts on: a rematch after midnight UTC plays the next day's. It needs no
`ALLOW_SEED` (the server's own pinning stays dev-only) and passes over a tester's pinned seed
while it is on. A switch to a mission without one turns it off. The report says `daily: true`
and names the seed. The Bestenliste ranks daily runs apart, by the UTC day they started on:
`GET /stats/daily` (the last 14 days, the newest first), `GET /stats/:mission?run=…&daily=…` for
a run's place among its day's; `GET /stats` leaves them out. The Bestenliste page has a
„Tagesschicht" tab with a chip per day; the end screen of a daily run gives its place on its day.

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
rack's unit shows it. Rules, not answers: the codes stay at the terminal. The printed page of
the Serverraum draws the same diagram, its LEDs dark.

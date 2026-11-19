# EscapeLab — gameplay

How the crew steers, how it finds things, what a run leaves behind and how runs compare: the
controls on keys and on a controller, the quick chat, the station's intercom, finding things, the
walks of Blackout's lab, stations in any order, runs without a clock and the Übungshalle, the
first win at the stations the whole crew presses, a crew of three, the Erfolge, the Tagesschicht,
the picture of a run, the danger sense, the Serverraum's cabling diagram, typing at its terminal,
the Zugangskontrolle, the Anlaufsteuerung, the Paketfilter, an emergency and the open station,
what the notepad takes down and what happens when a line drops. Code:
`packages/client/src/input/` (bindings, controller, prompts), `client/src/achievements.ts` and
`screens/{Plaques,ShareButton,ControlSettings}.tsx`,
`screens/shareCard.ts`, `world/{labelFade,finds,danger,ChatWheel}.ts(x)`,
`puzzles/RackDiagram.tsx`, `puzzles/{prompt.ts,ServersPanel.tsx}`,
`puzzles/{AccessPanel.tsx,accessPrompt.ts}`, `puzzles/{StartupPanel.tsx,startupPrompt.ts}`,
`world/{conduits,ductArt}.ts`, `puzzles/{FirewallPanel.tsx,firewallView.ts}`,
`puzzles/{SyncCount.tsx,syncPress.ts}`, `voice/{rules,intercom}.ts`, `noting.ts`, `notes.ts`,
`screens/{Notepad,NoteButton}.tsx`, `pass.ts`, `line.ts`, `ws.ts`, `screens/hands.ts`,
`screens/{Join,Pause,Line,GiveUp}.tsx`, `clock.ts`; in the core `chat.ts`, `discovery.ts`,
`achievements.ts`, `daily.ts`, `hands.ts`, `mission.ts` (`order`, `lit`), `map.ts` (`intercomOf`,
`stationUp`), `puzzles/servers.ts` (`serviceDiagram`), `puzzles/access.ts`,
`puzzles/startup.ts`, `conduits.ts`, `puzzles/firewall.ts`,
`puzzles/buttonSync.ts` and `actions.ts` (a line that drops, the maintenance, `takeUp`,
`hasClock`, `clocked`), the hall in `test/hall.ts`; in the server `room.ts`, `seats.ts`,
`heartbeat.ts`.

## Controls

Every action has a key of the player's choosing (Einstellungen → Steuerung → Tastenbelegung); a
few keys keep their task whatever is bound. A standard-mapping controller works everything; its
four main actions sit on buttons of the player's choosing (Einstellungen → Steuerung →
Controller), the rest is fixed.

| Action | Keys (default) | Controller |
| --- | --- | --- |
| Laufen | W A S D, arrows (fixed) | left stick (dead zone 20 %, radial; 5–40 % in Steuerung) |
| Sprinten | Shift, held | R1, held |
| Benutzen: bedienen, lesen, durchsuchen, aufnehmen, einsetzen | E; Enter and Space (fixed) | A/✕ |
| Ablegen (hands full) | Q | B/○ |
| Weglegen / Zurücktreten / Fenster schließen | Esc (fixed); E or a step puts a sheet down | B/○ |
| Menü (Pausenmenü und Verlassen) | Esc with nothing open, ⚙ in the top bar, the strip's „Menü" | Start |
| Notizblock | N | X/□ |
| Minikarte | M | Y/△ |
| Ping für alle | a click on the world | D-pad ◀: the floor the lamp points at |
| Schnellchat | C, then 1–8 (fixed); a phrase with a slot, then 1–9 | D-pad ▶, then the D-pad to a phrase and A, and to a slot's value and A |
| Nachricht schreiben | T, then Enter to send, Esc to drop it | — (a controller types nothing) |
| Einsatzinfo | I | Select |
| Sprechen (push-to-talk) | V, held (at the terminal V types; its FUNK key talks) | L1, held |
| Blättern beim Lesen | ← → (fixed) | D-pad ◀ ▶ |
| In Pulten und Fenstern wählen und drücken | Tab, Enter | D-pad or a flick of the stick, then A |

**Rebinding.** „Ändern" waits for the next key: a key the game keeps (the arrows, Enter, Space,
Esc, Tab, 1–8, Backspace, Delete) is refused with its task, a key another action holds is refused
naming that action („Schon belegt: Notizblock (N)."), a key held with Strg, Alt or Cmd is no key to
hold alone; Esc stops waiting, and so does any controller button, which has no key to give. On the
controller the next button pressed takes the action — A, B, X, Y, L2 or R2 — and where another of
the four sat there, the two swap, which the panel says. „Zurücksetzen" in „Steuerung" brings both
back, with the symbols and the dead zone. The settings are kept on the device
(`escapelab.settings`, `keys` and `pad`); settings kept before the key map keep their talk key. A
bound key is the game's: the browser's own use of it stays off (F5 bound to the minimap reloads
nothing). A key held down — a step, the sprint, the talk key — is let go where it went down,
whatever Shift or a new binding made of its name meanwhile (`input/heldKeys.ts`).

**Prompts.** No screen names a key by itself: every prompt reads it from the binding map
(`input/glyphs.ts`) — „[E] Lesen" on keys, „[A] Lesen" (or „[✕] Lesen" on a PlayStation controller,
told by its id, or as „Controller-Symbole" in Steuerung choose) once a controller was pressed or
its stick leant, and back to keys at the next real key. The world's prompt, the carried part's
line, the HUD's buttons, the foot of a sheet and of a device, the notepad's and the book's buttons,
the intro's skip and the key list all follow, and the lever and the world's tips name the keys
bound. `client/test/bindings.test.tsx` reads every screen's strings and JSX text and fails on a key
written by hand — in brackets or worked in a sentence („E drücken") — and on a letter a handler
listens for itself (`useKeys(['e'], …)`).

**A controller.** Polled once a frame while one of the standard mapping is connected — another
one's buttons and axes would mean something else (`input/padRuntime.ts`). In the world the stick
walks as far as it leans — past the dead zone, 20 % unless „Stick-Totzone" in Steuerung sets it
from 5 to 40 %, scaled from there to the rim, as fast on a diagonal; the buttons press the keys
they stand for, A by Space, so that it also skips the opening. The D-pad walks nobody there: its ◀
pings for the whole crew where the lamp points — two tiles ahead along the way the avatar faces,
short of the first wall, shut door or piece of furniture (`world/padPing.ts`), as a click pings
where it lands — and its ▶ opens the quick chat by its key; the wheel then takes the controller as
a dialog does, its first phrase in the focus, the D-pad moving between them, A saying one — or
opening the second step of one with a slot, its first value in the focus — and B shutting it. ▲ and
▼ do nothing in the world. A text field in the focus lets go first, as a controller types nothing:
X closes the notepad it opened. Over a dialog (the device, the pages, the menu, the settings, the
info) the D-pad moves the focus to the nearest control that way — on the settings' tab bar each tab
opens as the focus comes to it —, A presses it — a control made to be held, as the button module's
face (`data-pad="hold"`), by Space for as long as A is held, every other one by a click — and B
steps back; in a book the D-pad turns the pages. A direction still held in the world as a dialog
comes up — the stick walking, the ▶ that opened the quick chat — moves nothing there until it is
let go. An Xbox controller says Xbox in its id („Xbox Wireless Controller"), a PlayStation one
Sony's vendor or its name. The settings show a live test: every button lights while held, the
stick's dot leans. The walkthrough's `?fakepad=1` puts a controller of its own on
`window.__escapelab.pad` (press, release, tap, lean).

## Quick chat

The wheel holds eight phrases in the crew's own words: the mission's (`chat.phrases`, validated
in core `chat.ts`) or, where it names none, the default list. A phrase may hold one slot, filled
as it is said: `{n}`, a number from 1 to 9, or `{name}`, one of the phrase's own `names` (two to
nine, eight characters each at most); a phrase stays within 24 characters, filled in. Blackout's
wheel has no valves: „Hier rüber!", „Warte kurz …", „Bereit!", „Brauche eine Ansage!", „Ich
halte die Platte", „Achtung, Drohne!", „Nummer {n}" — one number phrase for the
Anlaufsteuerung's Abgang, the Paketfilter's Leitung and the Notstromkasten's Kabel, so that the
wheel keeps its six plain phrases — and „Dienst {name}" with the Serverraum's
six services. The wheel shows a slot as „…" („Nummer …"); its digit, a click or A opens the
second step, every value as the phrase will say it („Nummer 1" … „Nummer 9", three abreast), where
1–9, a click or the D-pad and A say it. While that step is up the digits are its, whatever else
they are bound to; Esc or B shuts the wheel from either step. A client names a phrase by its
place and the slot's value; the server fills it in (`sayPhrase`) and refuses a place or a value
the mission does not have. The bubble over the speaker and the HUD's line show it as said:
„Anna: Nummer 3" (`world/ChatWheel.tsx`, `client/test/chatWheel.test.tsx`; chat-slot.png).

## Typed chat

A crew member can type a line to the crew, in the lobby and in a run (`screens/TypedChat.tsx`).
In the lobby the room's last eight lines and the field stand in the mission panel under the
microphone; T (as bound) puts the focus in the field, Esc takes it out. In a run the field opens
over the world's foot with T or the ✎ button beside the quick chat's — on a touch screen just
left of the cluster, outside its four, so that its reach stays as it is — and shuts the wheel;
it closes as the line goes out, with Esc (which then opens no menu) or once it loses the focus.
The T is kept from the field it opens. While the field has the focus every key types there: the
world, the run's keys and the talk key leave a text field alone, and a controller's button lets
go of it first. The client sends `say` with the text; the server tidies it — control characters
and direction marks out, each run of spaces one space, none at the ends (core `chat.ts`
`typedLine`) — refuses an empty line, one over 120 characters (as the player counts them), one
from anyone not in the crew, and a sender past three lines at once and one every 2 s after
(„Nicht so schnell — gleich noch einmal."), and passes it on as a `chat` line with its sender to
everyone a quick-chat phrase reaches, the audience included. Nothing keeps it: the page holds
the room's last eight lines, phrases and typed lines alike, until it is in another room
(`chatLog.ts`). It shows as a phrase does, over the speaker — a long line in up to three rows,
cut with „…" — and in the HUD's line, and in the log, each name in its crew colour.

## The station's intercom

Between the places of the armed station — its consoles and the open sources that cover it — the
crew hears each other in full however far apart, walls or not; everywhere else the voice fades
with distance and walls as before. At a station with two consoles the device's PARTNER LED then
reads „Ben · Pult B · Funk".

## Voice links over the internet

The voice goes from browser to browser (WebRTC, `voice/mesh.ts`); the game's server only passes
the signals on. Each socket is told first thing which ICE servers the links go by (`ice-servers`,
server `iceServers.ts`): the JSON list in `ICE_SERVERS`, or public STUN (Google's and
Cloudflare's) where it is unset; `[]` keeps the voice to one network. STUN tells a browser the
address the internet sees it under, which gets through most home routers; behind a symmetric NAT
— some mobile, campus and office networks — only a TURN server relaying the sound gets a link up,
named with its username and credential (`{"urls":"turn:turn.example.org:3478","username":"…",
"credential":"…"}`). A wrong list stops the server's start, saying what is wrong. A link that
fails, does not come up within 15 s or stays `disconnected` for 6 s is made anew by the lower id,
after 3 s, then twice as long each time in a row up to 30 s; until it is up, the lobby's panel
and the world say „Keine Sprechverbindung zu Ben — neuer Versuch läuft.", apart from the
microphone's own line. Each end sets the Opus parameters in the description from the other end
before it sets it — forward error correction, DTX, mono, 32 kbit/s — which is what its encoder
sends by (`voice/opus.ts`).

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

**The chain.** A run of Blackout has six stations, in this order (`missions/blackout.json`):

| # | Station | Where it is worked | Its rules | Its solve |
| --- | --- | --- | --- | --- |
| 1 | Notlicht (lever, whole crew) | the Flur's middle (15,9) | none | lights Flur and Archiv |
| 2 | Anlaufsteuerung (`startup`, 2 stages) | console A in the Maschinenraum (1,15) behind the plate door, console B at the Flur's west end (2,9), the duct between them under the wall | the Betriebsbuch in the Archiv | the generator runs: lights the Maschinenraum, its door stays open |
| 3 | Paketfilter (`firewall`, 4 rules, one wave of 9 packets) | Analysepult (21,9) and Sperrpult (26,9) in the Flur east of the Serverschott | the RICHTLINIE on the Flur's south wall, west of the Schott | opens the Serverschott, lights the Serverraum |
| 4 | Serverraum (`servers`) | terminal and rack in the Serverraum | the Spind there | opens the Labortür, lights the Labor; both drones wake |
| 5 | the **Wechselplatz** (pool `wechsel`): one of three, by the seed | Signalkette: console A in the Flur's east corner (29,9), B in the Maschinenraum (9,20) · Funkpult in the Labor (11,20) · Notstromkasten: box inside the Maschinenraum's door (6,14), meter in the Labor (15,20) | Klemmbrett in the Flur · Aktenschrank in the Labor, its key in the Serverraum · Wartungsbuch in the Maschinenraum | opens both doors of the reactor, lights it |
| 6 | Reaktor-Neustart (button, whole crew) | the reactor's east wall | none; the spare fuse from the Archiv | the hatch opens |

The two stations of the Wechselplatz a run does not have stand dark with the tag „AUSSER
BETRIEB", and so do their sources (Stations that take turns, below): the box hangs right inside
the Maschinenraum's door, the Funkpult and the meter along the Labor's south wall, console A of
the Signalkette at the Flur's east end — each on a way the crew walks anyway. Three notes of the
last shift say so in the lab's words: the duty roster beside the Sperrpult („Dienstplan
Wechselplatz: …"), Haller's hand-over in the Maschinenraum, and his note in the Labor that the
Aktenschrank's key hangs in the Serverraum over the rack — true in every draw, read before the
Funkpult's first nudge names it. The light travels room by room in every draw: Flur and Archiv,
Maschinenraum, Serverraum, Labor, Reaktor (`core/test/coldOpen.test.ts`). Both drones wake
once four stations are solved, with the Serverraum; the emergencies after three.

**Nobody is caught for having solved a station.** After any solve, in every draw, a crew that
stays where it stood — anywhere within reach of one of that station's consoles, or of a source
that holds its rules, on every place a seed may lay that source — is seen by no drone, not in
the next ten seconds and not on any later round of the beats
(`server/test/blackoutParked.test.ts`, on the room's own patrol code). The level does it, not
the engine: both drones sleep until the Serverraum is solved, whose consoles and locker lie
inside the room and out of their sight; the Paketfilter's consoles in the Flur are worked
before any drone is out; and every console and source of the Wechselplatz stands where no beat
looks — console A of the Signalkette in the Flur's east corner (29,9), a tile past the
Flurwache's reach from the east end of its beat; the Klemmbrett at the Flur's west end; the
Aktenschrank in the Labor's north-west corner. Once the Flurwache flies, the camera plate at
the Schott (20,9) holds it still for whoever crosses the Flur. The walkthrough stands still in
the Serverraum twelve seconds after its solve, the moment the drones wake, as the proof in the
browser. The policy hangs west of the Schott, on the way from the Anlaufsteuerung: the crew
passes it before it reaches the consoles.

**The Anlaufsteuerung behind the plate door.** Whoever works console A is shut in the
Maschinenraum until the generator runs. The table of lamp pictures lies in the Archiv, and only
console B's player can walk to it: 6.1 s there and back to the book's farther place, 5.4 s to
the nearer (a test keeps it within 10 s). So console B's player is the one who knows the table —
read before, taken into the notepad, or walked to again — in both stages: in stage 1 they read
their own lamps and say the number for console A to type, in stage 2 console A reads its lamps
out and they type. `start` waits for both consoles („Am Schaltfeld der Gegenseite steht
niemand."). With three, the third reads the book or holds the plate.

**The Klemmbrett past the patrol's reach.** The Signalkette is worked with both patrols out,
so its clipboard lies at (4,12) or (3,12): on the Flur's south wall at its west end, where
nobody within its reach is in the Flurwache's cone — the beat is main's, turning at (10,10),
and its look ends at x = 6. So near the guest's start the lamp finds it in the first second;
the crew passes it on the way to the Maschinentür. The Aktenschrank lies at (12,16) or (11,15)
for the same reason: its places beside the Laborwache's beat, (18,14) and (18,20), put its
reader in that drone's eye four seconds after the solve (`tools/patrol.test.mjs`, the parked
test). A drone keeps the look it arrived with while it stands on a waypoint; until 18.11.2026
it looked east there for two ticks, whichever way it had come, and caught whoever it had just
passed (`server/test/drones.test.ts`).

**The seeds.** `core/test/blackoutPlan.ts` pins a seed for each draw — 12 the Signalkette, the
walkthrough's and the smoke's own; 56 the Funkpult; 93 the Notstromkasten — and all three deal
the same start: Anna in the Archiv, Ben at the Flur's west end, the Betriebsbuch at (8,1), the
Richtlinie at (17,12), the Spind at (16,2). `tools/fixtures/blackout-plan.json` carries a plan for
each, written anew by `node --import tsx ../core/test/writeBlackout.ts` from `packages/server`.

**The walks.** An avatar walks 4.2 tiles a second, 5.46 sprinting (core `map.ts`). Blackout's
lab (36 × 22 tiles, the plan in `docs/art-bible.md`) is laid out so that no walk of a plan takes
longer than 12 s, the run from the reactor to the hatch included; core's missionMaps test holds
every one of the three plans to that. Each walk below goes the eight ways a player steers, round
furniture and doors shut at the time, never cutting a corner, from a tile at the place to a tile
at the next; the host (Anna) takes console A of every station, the guest (Ben) reads and takes
console B:

| Station | Who | From → to | Tiles | Seconds |
| --- | --- | --- | --- | --- |
| Notlicht | Anna | the start in the Archiv → the lever | 16.8 | 4.0 |
| Notlicht | Ben | the start at the Flur's west end → the lever | 15.2 | 3.6 |
| Anlaufsteuerung | Ben | the lever → the Betriebsbuch | 20.4 | 4.9 |
| Anlaufsteuerung | Ben | the Betriebsbuch → the Laborkennung | 7.4 | 1.8 |
| Anlaufsteuerung | Ben | the Laborkennung → the plate | 11.7 | 2.8 |
| Anlaufsteuerung | Anna | the lever → console A, the plate held | 17.7 | 4.2 |
| Anlaufsteuerung | Ben | the plate → console B | 6.2 | 1.5 |
| Paketfilter | Ben | console B → the Richtlinie | 16.2 | 3.9 |
| Paketfilter | Ben | the Richtlinie → the Analysepult | 5.2 | 1.2 |
| Paketfilter | Anna | console A → the Sperrpult | 28.7 | 6.8 |
| Serverraum | Anna | the Sperrpult → the terminal | 18.8 | 4.5 |
| Serverraum | Ben | the Analysepult → the locker | 12.0 | 2.9 |
| Serverraum | Ben | the locker → the rack | 6.4 | 1.5 |
| Signalkette | Ben | the rack → the Klemmbrett | 23.2 | 5.5 |
| Signalkette | Ben | the Klemmbrett → console A | 26.2 | 6.2 |
| Signalkette | Anna | the terminal → console B | 36.7 | 8.7 |
| Signalkette | Anna | console B → the spare fuse | 18.7 | 4.4 |
| Signalkette | Ben | console A → the reactor | 34.2 | 8.2 |
| Funkpult | Ben | the rack → the key | 3.0 | 0.7 |
| Funkpult | Ben | the key → the cabinet | 36.5 | 8.7 |
| Funkpult | Anna | the terminal → the radio | 39.3 | 9.4 |
| Funkpult | Anna | the radio → the spare fuse | 21.2 | 5.1 |
| Funkpult | Ben | the cabinet → the reactor | 24.2 | 5.8 |
| Notstromkasten | Ben | the rack → the Wartungsbuch | 29.1 | 6.9 |
| Notstromkasten | Ben | the Wartungsbuch → the meter | 10.8 | 2.6 |
| Notstromkasten | Anna | the terminal → the box | 30.1 | 7.2 |
| Notstromkasten | Anna | the box → the spare fuse | 12.0 | 2.9 |
| Notstromkasten | Ben | the meter → the reactor | 22.1 | 5.3 |
| Reaktor | Anna | the fuse → its slot | 43.4 | 10.3 |
| Escape | both | the reactor → the hatch, by the Labor | 47.9 | 11.4 |
| Escape | both | the reactor → the hatch, by the Serverraum | 49.1 | 11.7 |

Each walks a plan in 50 to 56 s, the escape by the Labor included — Anna 54.3 s with the
Signalkette, 55.7 with the Funkpult, 51.3 with the Notstromkasten; Ben 53.3, 50.7 and 50.3 —
where the chain before the Wechselplatz took Anna 55.5 and Ben 53.9: the walk to the Paketfilter
came in, the Signalkette's long way to the Flur's east end went out of two draws in three. Both ways out are 52 steps on the grid, as the last shift's
note by the hatch says; counted the eight ways, the Labor's is a tile shorter. Every start lies
3.6 to 4 s from the lever.

## Free order, no clock, the Übungshalle

**Free order.** A mission's stations form a chain unless it says otherwise (`order: 'chain'`):
one is armed at a time, in the file's order. With `order: 'free'` every station stands open from
the start, and the crew takes them in any order. The first E at a station's console switches
that one on (core `actions.ts` `takeUp`), and while it runs no other comes on: one station runs
at a time, since two at once would need a state of their own each (`docs/gameplay-models.md`
weighs it). Solved, it closes, and every station still to solve stands open again. The goal line
names the station that runs, and while none does, how many are left: „Noch 7 Stationen" (client
`world/known.ts` `armedGoal`). The run is won once every station is solved and the whole crew
stands on the hatch; a mission in free order may have none, and then its last solve wins the
run, every station counted (`core/test/missionMaps.test.ts` holds every other mission to its
hatch). Each station's instance is drawn from the seed and the station's own id, so the order a
crew takes them in changes none of them.
The run report lists the stations in the order they were solved. The validation proves every
station workable with nothing solved yet, as any may come first: reached as in a chain — by the
whole crew together, by two players at once at two consoles, by one while another reads its
rules — every source reachable, a cabinet's with its key in hand; a door that only a solve opens
counts as shut (core `mission.ts` `walkFree`).

**No clock.** `timeLimitSec: 0` is a run without a clock. The HUD counts the time run since the
lights went out, pauses left out (`clockFrom`), and never turns red; the run report keeps the
limit as 0 and the time from the lights to the end as ever; the levels keep it at 0. Neither an
alarm nor a note of the last shift costs time (an alarm still counts), and mission control
sends no nudges, as nobody is hurried. The mission cards and the lobby say „ohne Uhr", the end
card „Zeit" instead of „Restzeit" — the time the HUD counted, its pauses left out, where the
report, „Meine Einsätze" and the Bestenliste keep the time from the lights to the end, pauses
and all, as for every run — and its top rank „keine Notiz gebraucht" instead of time to spare;
the operator's last word is the one for time to spare. Without a hatch (every view's
`noHatch`) the third rank says every station is done, not that all are out, and so do the
caption under the crew and its words for a screen reader („Jede Station abgenommen"). The
button's Einsatzuhr counts up as well, and its release reads the digits as shown, a second's
latency allowed the other way round (core `puzzles/button.ts` `releaseInTime`). An alarm limit
stays the mission's own (`maxAlarms`).

**The Übungshalle** (`missions/uebungshalle.json`, 40 × 33 tiles, 2–3 players) has one station
of every type the lab knows, fourteen with nineteen consoles — every module but the relay,
which runs only as an emergency. Each stands in a bay of its own, four abreast in four rows: the
station, its book on the floor five tiles beside it with a desk, and a sign naming the machine
and its type („SIGNALKETTE · SK-4"); a station with two consoles has both in its bay, five tiles
apart — the validation keeps one player from standing at both — and its book under them; the
Anlaufsteuerung's cable duct runs along the row under its consoles. The
crew starts at the entrance, beside the notice board („Übungshalle · Jede Station steht offen;
die Regeln liegen daneben") and the Laborkennung. Free order, no clock, no alarm limit, no
drones, no emergencies, no intro: its lights burn from the start (`lit: true` lights every room
the map names, and refuses an intro). No hatch either: the last station wins the run, as a
practice ends — no siren, no run back across the hall, whose lit floor the escape's red would
only wash out. The last shift's notes at each station say how its machine is learned, never an
instance's answer. Each station takes its module's defaults, but for the Zugangskontrolle's token
device, which turns every 15 s, the module's shortest period: a practice waits less for an
account; and the Paketfilter, two waves of packets 10 s on their way: a practice learns the
policy, it does not stand a shift. The menu's card, known by the hall's id, says „Jede Station
zum Üben" over its title.
The hall is made from the module registry (`core/test/hall.ts`): a module added there fails
`core/test/hall.test.ts` until the hall is written anew, with the walkthrough's plan, by
`node --import tsx ../core/test/writeHall.ts` from `packages/server`.
Every Systemcheck walkthrough plays it before its own run, a drill in a room of its own (group
`hall`, `tools/groups.mjs`), to the won card from that plan (`tools/fixtures/hall-plan.json`,
made by `core/test/hallPlan.ts`): the host's own world past the briefing (`hall-player.png`,
failing outside a mean luma of 70 to 180: the hall's fourteen room names once lit its one floor
fourteen times over, to a white sheet), the overview from the audience (`hall-overview.png`), every
station's device as it opens (`hall-<type>.png`) and the won card (`hall-won.png`). The
plan's host reads a two-console station's rules at its book as it comes on, then takes console a;
at the Zugangskontrolle the walkthrough types the token its device shows, not the plan's, which
hung on the plan's own clock, at the Anlaufsteuerung it closes each breaker once the ladder
shows the pulse on its marked steps, and at the Paketfilter it makes each mark and trip once its
pages allow it, then waits for the last packets to reach the Kern.

## Stations that take turns

A puzzle may name a **pool** (`pool: "wechselplatz"`, a short id; the editor's field
„Wechselplatz"). The puzzles of one pool are alternatives for one place: a run has exactly one
of them, the others are **out of service** for that run. So a mission can hold more stations
than a run is long, and a second run is not the first one again.

**The draw.** The start draws one member per pool from the run's seed and the pool's id alone
(core `rotation.ts` `drawPools`: `pickOf` over the members sorted by id), whatever order the file
or a run has them in and at any difficulty: the same seed has the same stations. On the
Tagesschicht every crew of the day therefore plays the same drawn station, as it plays the same
instance; a rematch draws anew from its new seed. The state
keeps the draw (`GameState.drawn`, by pool id), and the run's `mission.puzzles` stand in the
run's order: its own stations first — a pool standing where its first member stands in the
file, as the drawn one — and the stations out of service after them (`runOrder`), so that
`currentPuzzleIndex` stays the count of solved stations. In a chain the pool takes one place in
the order; in free order the drawn station stands open with the rest. The file need not keep a
pool's members next to each other: a snapshot checks a run's mission as a file, and a run's
order has to pass.

**What names a pool.** A door's `opensBy.puzzleId` and `untilSolved`, and a part's
`requiredFor`, may name a pool instead of a puzzle: „once this place is solved", „the station
the run has here waits for it". Everything that counts solved stations counts a pool as one:
the lobby's and the cards' station count, the dots on the objective bar, a drone's
`activeAfterSolved` (the validation holds it below the stations of a run), the emergencies'
`afterSolved`, the hatch, the report. A station's own things name the member: its consoles
(`map.stations`), its sources (`manuals.puzzleIds`), a part only it needs, its `lights`,
`hints`, `nudges` and `onSolved`. The validation refuses a door that waits for a single member —
it would stay shut in most runs — and names the pool to use; a pool needs two members at least
and an id no puzzle has, and may not be called `__proto__`, the one key a snapshot's records
drop. The draw is read by its own keys alone (`drawnIn`), so a puzzle or a pool called
`constructor` is what it says.

**Out of service.** A station out of service is never armed and never solved, takes no input
and has no instance: no view carries its rules, its notes or mission control's lines about it
(`core/test/rotation.test.ts` holds that with `JSON.stringify` on every view, wherever its
player stands). Its console stands dark, a tag hung across it and „AUSSER BETRIEB" under it
once this player has found it; in sight from afar it already wears the tag (`MapView.stations`:
status `'out'`, a glimpse's `out`). The E prompt there reads the same and opens nothing; the
server answers a forged E with „Außer Betrieb.". A source that prints only the rules of
stations out of service wears the same tag card once found, says „Zu einer Anlage außer
Betrieb." (core `SOURCE_OUT_OF_SERVICE`, the prompt's and the refusal's one text), gives no page
and cannot be searched or unlocked (`outOfService` on the source); nobody standing at it counts
as reading; one that also covers a station of the run
stays as it is and shows only that station's pages. A part only such a station waits for, and
the key of a cabinet that holds only such rules, are not put out. Neither the goal line, the
arrows nor the minimap ever show a station out of service or its source, and a player standing
at one counts at no station. The printable Handbuch prints every member, as it knows no seed,
and says on each of their pages which machines share the place: „Wechselplatz mit Signalkette,
Notstromkasten: Je Schicht ist eine dieser Anlagen in Betrieb, die anderen tragen das Schild
AUSSER BETRIEB." (`MissionManualStation.takesTurnsWith`).

**The validation** proves every run the mission can have: each proof — reach for every crew
size and choice of spawns, two different players at two consoles, sources and keys — runs once
per possible draw, on the stations that run has, a pool's door opening with the one drawn. An
issue ends with the draw it holds for: „— in a run with pool "wechselplatz" drawing
"notstrom"".

**The report** names the drawn station per pool (`drawn`, left out for a mission without pools;
the version stays 2, as for every field added since) and lists the stations of the run alone.
The Bestenliste keeps one board a mission and difficulty: runs of different
draws stand on it together, so a board mixes stations of unequal length — worth a board per
draw only once the spread shows (Blackout's three lay 39 s apart for the script crew). The clock
is set by that crew: it keeps at least 40 % of it in its slowest draw, measured without capture
groups (`SHOTS_ONLY=run`) — 310 to 365 s after the lights went out, 62 to 68 % of Blackout's
960 s left, its walks past the drones waiting for a gap an avatar a second late still passes
(290 to 339 s before they did); the capture run keeps 38 to 39 % and is no measure, main's old chain stood at 34 %
of 900 s by it. A snapshot keeps the draw; one from before
the pools has none and restores as before — a run in flight over the deploy that gave its
mission a pool plays its old chain to the end (`server/test/snapshotFixture.test.ts`).

**Which runs rank.** A mission that gets a Wechselplatz was another chain of stations before:
its older runs were shorter or longer than any run can be now. So on a mission with pools a
run stands on the boards only where its report names its draw — a station of every pool the
mission has now (server `runStats.ts` `namesItsDraw`, `rankingOf`); a mission without pools
asks nothing. One rule for every reader of the stats: the Bestenliste, „Platz x von n" on the
end card, the best time and share won on the lobby's and the join screen's cards, and each day
of the Tagesschicht. A run left out is deleted nowhere: it stays in the store, in `GET
/runs.jsonl` and in „Meine Einsätze", whose rows show a run's own grade and no place. On the
first day of a new chain the board is empty and reads so: the cards name no best time, the
Bestenliste lists the mission once its first run is in, and the first crew to win stands „Platz
1 von 1 Lauf"; a run of the older chain that ends after the deploy gets its end card without a
place. The start-up log says how many runs stand off the boards.

**In Blackout.** Its fifth place is the pool `wechsel` of the Signalkette, the Funkpult and
the Notstromkasten (Walking Blackout's lab, above): core wins every draw by the solvers for two
and three players over 200 seeds (`modules.test.ts`) and on the three pinned seeds
(`blackoutPlan.test.ts`), the server wins each in a room and one after a sealed restart
(`server/test/blackoutDraws.test.ts`), the smoke plays the pinned seed's draw over real sockets
(`SMOKE_SEED=56` or `93` the other two), and the Blackout walkthrough plays seed 12 to the won
card, a console out of service shot on the way (out-of-service.png).

**The probe.** `tools/fixtures/rotation-probe.json`
(„Wechselprobe") is a chain of three places whose middle one is a pool of the Funkfeuer (one
console), the Signalkette and the Notstromkasten (two each), with a door the pool opens. Every
Systemcheck walkthrough plays it on two seeds that draw different stations (group `rotation`,
`tools/fixtures/rotation-plan.json` from `core/test/rotationPlan.ts`, written anew by
`node --import tsx ../core/test/writeRotation.ts` from `packages/server`): in each room the
first station is solved, every console out of service found and held to the draw, and the page
shot at one beside the live console (`rotation-out-of-service-<drawn>.png`); the second room is
played to its won card (`rotation-won.png`).

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

## Zu dritt

Blackout takes two or three (`players` 2..3), and a crew of three finds a place for every hand at
every station. A station's places are its consoles, the manual objects covering it, the plates of
the doors it keeps open until it is solved (`untilSolved`) and the parts it still needs carried
in, a cabinet's key at the first station the cabinet covers (core `hands.ts` `placesOf`); where
the whole crew works the panel, every hand stands at it. Core `test/hands.test.ts` counts them for
every shipped mission and lab:

| Station | Its places | Hands at work | With three |
| --- | --- | --- | --- |
| Notlicht | the main switch, for the whole crew | 3 | all three throw their lever together; the plate says „NUR ZU DRITT" |
| Anlaufsteuerung | Pult A (Maschinenraum), Pult B (Flur), the Betriebsbuch, the plate HALTEN | 4 | one reads the book first and works console B, one holds HALTEN, one works console A |
| Paketfilter | the Sperrpult (A), the Analysepult (B), the Richtlinie | 3 | two at the consoles, the third reads the policy off the wall and calls the rule |
| Serverraum | the terminal (A), the rack (B), the Spind | 3 | two at the consoles, the third searches the locker and reads; no drone is out yet |
| Wechselplatz: Signalkette | Pult A, Pult B, the Klemmbrett | 3 | two at the consoles, the third reads the legend at the clipboard |
| Wechselplatz: Funkpult | the radio desk, the Aktenschrank, its key | 3 | one at the radio, one reading the cabinet, the third fetching the key — and the fuse for the reactor |
| Wechselplatz: Notstromkasten | Pult A (the box), Pult B (the meter), the Wartungsbuch | 3 | one cuts at the box, one measures, the third reads the book in the Maschinenraum |
| Reaktor-Neustart | the switch, for the whole crew; the SICHERUNG | 4 | the third carries the fuse in, then all three press |

The module tests play every mission for every crew size from `players.min` to `players.max`
through the reducer (`core/test/modules.test.ts`), 200 seeds each without an alarm; at a station
of one console the moves go in with the reader stepped off the rules, the operator alone at it.
With a third hand the roles follow the stations: at two consoles p1 works A, p2 works B and p3
reads; at one, p1 works, p2 reads and p3 runs the errands — the parts, a cabinet's key, a shut
source, the plates the station's doors need — so that the first two never leave their places; at
a whole-crew station everyone presses. As each station is switched on, exactly as many of the
crew are at work as it has places, up to the crew. Kettenreaktion (three) and the Doppelschicht
(four) give most of their stations two places only (backlog N-6).

**The hands line.** For a crew of three or more the goal line names, under its title, each hand's
job at the station in front of the crew, from the view's `hands` (core `handsOf`): where the server
counts each of the crew — at a console, at a manual object covering the station, on a plate that
still holds a door or a drone (presence `plates`, counted by the reach that keeps the plate
pressed), or with a part in hand — and the station's places nobody holds that the crew knows of. The
screen says them in the map's words, its own player first: „Cleo: Klemmbrett · Anna: Pult A · Ben:
Pult B". A console is Pult A or B, the main switch („Hauptschalter") or the station's title; a
source goes by its label as a name („Handbuch"), a plate by its own („HALTEN"), a part as „SICHERUNG
holen". The first hand without a place names the places nobody holds, the others say „frei": „Cleo:
frei — Handbuch, HALTEN · Anna: frei". Whoever is away has no hand free and is named only where
their avatar still holds a plate or a part („Cem: HALTEN"); the crew strip says the rest. A source
or a part nobody has found stays unnamed, and so does a key until its cabinet has been come across.
On a phone held sideways the row keeps the own job alone as a chip beside the goal („Cleo:
Klemmbrett"); while a device is open the line gives way to its Laborkennung row, keeping its place.
Nothing moves. For a crew of two nothing changes (`client/test/hands.test.tsx`).

**The drill.** The walkthrough's three drill (`SHOTS_ONLY=three`, 80 s on a laptop) plays
Blackout for Anna, Ben and Cleo in a room of its own on the plan's seed: all three throw the main
switch (three-lever.png); Ben reads the Betriebsbuch while Cleo holds HALTEN, Anna and Ben run
the Anlaufsteuerung up (three-plate.png, Cleo's screen); Cleo reads the Richtlinie while Anna and
Ben stand at the Paketfilter's consoles (three-hands.png, Anna's screen; three-reader.png;
three-phone-932.png, Cleo's phone) — the Paketfilter itself is the walkthrough's own run's.
Then Cleo and Ben give their seats up from the menu, the run is called off, and Anna leaves the
room. It samples no frame window: three pages on one runner would make it lie.

## Erfolge

Seven plaques a crew earns in a run it wins, read off the run's report alone
(`achievementsOf(report)` in the core) — none for a run lost:

| Plaque | Earned when |
| --- | --- |
| Ohne Alarm | not one alarm in the whole run, whatever set it off |
| Unter acht Minuten | from the lights going out to the escape in under 8:00; none without a hatch |
| Alle Notizen gelesen | every note of the last shift on the map read; none on a map without notes |
| Jede Station im ersten Versuch | no station reported a wrong move (a drone's alarm is none) |
| Ungesehen | no drone caught anybody, on a map where drones patrol |
| Stiller Serverraum | no command at the Serverraum failed (an alarm there); none without one |
| Erste Schicht | every run won at the hatch — that it is the first is the account's to tell |

A run its last solve won, in a mission without a hatch (the Übungshalle), earns neither of the
hatch's two: its report says so (`noHatch`).

The view of a finished run carries them (`PlayerView.achievements`). The account of each crew
member's pass keeps each with the end of the run that first earned it, unlocked as the run is
stored (docs/accounts.md); the browser keeps a cache of them (`escapelab.achievements`, by
mission), which the server fills with every account message. The won card shows them as brass
plates under its facts — title, line, the day first earned — the ones new to the account coming in
one after the other, 300 ms apart; under reduced motion they are simply there. The lobby counts
the mission's: „Erfolge 3/7". The plates praise nobody: they say what happened.

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

## The Signalkette's last stage without colour

Every colour of the Signalkette carries a pattern — rot glatt, blau Punkte, grün Streifen, gelb
Ring — which the consoles draw over the sign and the legend's two „Muster" columns name beside the
colours. With the legend the pattern carries a rule as well: from stage `greyFrom` on (core
`puzzles/signal.ts`; left out, the last stage; 0, never; a positive stage only with the legend, as
the validation says) the display loses its colour. No view of the station names a colour then: the
sending console's and the audience's carry each sign as its form and its pattern alone, the
receiving console's, as in every stage, no sign at all. In a grey stage the legend's Muster columns
are the way back from a pattern to its colour, and so to the row to press: they, or Abb. 2, or the
textures the coloured stages showed over each colour, which tell the same; a player who cannot tell
the colours apart reads exactly what everyone else reads. With both Muster columns in the notepad
(Klemmbrett · Legende), either console finds its row by the pattern at once. The sending console
lights a third legend, ANZEIGE · FARBLOS, and draws the signs grey at 64 px, their patterns bold and
near black: every cell of a pattern 18 px or more, its ink 9.4:1 against the grey
(`SignalPanel.tsx`; the art bible's „Type and targets"). A fleeting stage stays fleeting, one grey
sign at a time; the receiving console's keys stay as they are. The printed Betrieb says from which
stage the display shows no colour and that the legend gives each pattern its colour, and the
workshop's note on the display's capacitor says from which stage it is colourless; Betrieb is kept
terse for it, every rule kept, so that the page stays within its 170 words. In Blackout
(`greyFrom` 4) the Frühschicht's third note in the margin says it too. The solver reads a grey
sign's colour back through the patterns the legend prints beside the colours, and the walkthrough
plays the last stage from the plan with grey signs and shoots it (signal-grey.png in the host's
window, signal-grey-phone-932.png on a large phone).

## The Funkfeuer's lamp and tone

At the Funkfeuer (`morse`) the operator's lamp spells the word in Morse on a loop, and each
blink sounds as a tone of its length, both on one schedule (docs/sound.md, The Funkfeuer's key):
a unit of 250 ms, short one, long three, one dark between the signals of a letter, five between
letters — wider than the standard three, so that the letters stand apart to the ear — and ten
before the repeat, with a short hiss of the carrier four units before the word's first signal.
The tone is a help, not the carrier of the word: the lamp keeps blinking with reduced motion,
with the sound off and before the browser lets the page sound, and the device's line names the
long pause and its hiss (`coach.ts`). The tone falls silent as the panel closes or the station
is solved. Nothing transcribes the dots and dashes on screen: reading them is the operator's
work, the word's frequency the partner's at the Frequenztabelle. The puzzle itself is the
core's, unchanged: the same sixteen words, the same pattern, the same penalty.

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

## The Zugangskontrolle

A login with two factors under a running clock (`access`, backlog I-1), after Quadrilateral
Cowboy's terminal, Among Us's ID code read and typed, and Lethal Company's terminal as the second
player's instrument. No shipped mission has it yet — its place follows the playtest (N-6) —; it
ships with its probe mission, `tools/fixtures/access-probe.json` („Zugangsprobe": the terminal in
the Leitstand, the token device in the Wache, the list on a clipboard by the terminal).

- **Console A, the terminal**, is of the Serverraum's make — its screen, prompt, keys and FUNK
  key, typed as above. It names the doors it asks for (`doors`, 1–3) with their state — asked
  for, standing open with its seconds, released —, the open session, the accounts a lock holds
  and its log, and takes `login <konto>`, the token that login asks for (six digits, the blank
  the device groups them by allowed), `status` and `freigeben <tür>`. Tab completes a command
  and, after `freigeben`, a door it asks for — never an account: the terminal names none. While
  the prompt asks for a token it reads „TOKEN <konto> ›", a numeric pad takes the door keys'
  place on the bezel, and a phone's keyboard comes up numeric.
- **Console B, the token device**, is bound to one account of the run's list each period
  (`tokenSec`, 30 s), turning through the list's three accounts in an order of its own, and shows
  that account, its token in two groups of three and a bar that drains to the period's end on
  the server's clock — blinking, the seconds inverted and a tick each, in the last five. The
  token is a pure function of the run's seed, the account and the period (`tokenOf`, no TOTP
  library); the periods count from the moment the station came on, and the room ticks it at each
  period's end (`dueAt`), the module harness as well.
- **The source** holds the whole lookup, dealt anew every run: the list of three accounts, each
  with its role (one of the four roles stays unheld) and the two doors that role may release —
  no door to two —, shown under the rules once the station is on, as the maze's walls are, with
  „Notieren" beside it („Benutzerliste · Konten" on the probe's clipboard), so that a crew of two
  can carry it to the consoles. The printed page names no role's doors; which account a door
  needs is only decidable at the list. The device never opens on the account the terminal's
  first door needs, so a crew that logs in whatever it shows first, without the list, takes an
  alarm at that door in every run; it brings that account second or third at even odds, so a crew
  that waits for a later turn instead takes one in about half the runs.
- **The rules.** A login opens a session only with its account's token of the period it arrives
  in; the session stays open until the next login. A wrong token is a Fehlquittierung, an alarm;
  the third in a row for an account locks it for `lockSec` (45 s) on the station's clock, as the
  periods run — the alarms' time off the mission clock takes none off the lock —, the prompt
  closing. A token of the period just gone — typed as the bar ran out — is turned back without an
  alarm, the log saying the period changed. A session releases each door of its role once, the
  door standing open for `openSec` (5 s; whoever passes through is fiction, not a rule); a
  release the list does not give its role is an alarm as well, the terminal saying no more than
  „Keine Berechtigung für diese Tür". `status` names the session as typed and the doors still
  asked for, never what a session may release. Solved once every door the terminal asked for is
  released.
- **Alone at the terminal.** A command counts as at every station, whoever else stands where:
  one at the terminal alone types, though only the token device shows the tokens.

`core/test/access.test.ts` holds the token (pure and exact to the period), the instance, the views
by presence (the terminal's also with a session open and after a release), every rule, `status`,
the list's need (over 200 seeds a crew without it takes an alarm, the solver none; over 600 the
first door's account comes second and third about equally often), the lock, a command typed
alone and the room's tick through the reducer, the solver over 200 seeds in five variants, and the
probe with its pinned plan (`tools/fixtures/access-plan.json`, made by
`core/test/accessPlan.ts`); `client/test/access.test.tsx` the prompt, the keys, both devices,
the list, the sounds and the type and targets at both consoles on three screens. The
walkthrough drills the probe in a Systemcheck run, as it does the Serverraum's (group `access`;
`SHOTS_SKIP=access` leaves it out, and Blackout's run logs it as left out): the list
(access-list.png), both devices (access-terminal.png, access-token.png), the terminal on a large
phone held sideways (access-phone-932.png), then each door of the plan, the token read off the
device.

## The Anlaufsteuerung

A start script, a pulse through the floor and a breaker in time (`startup`, backlog I-3), after
the light-beam rooms of Portal 2's co-op and We Were Here — one side routes, the other sees where
it lands — and Quadrilateral Cowboy's typed line that makes the world move. Blackout
has it as its second station, the emergency generator's start (Walking Blackout's lab, above);
its probe mission is `tools/fixtures/startup-probe.json`
(„Anlaufprobe": a console in each of two rooms, the duct between them under the wall, the
Betriebsbuch in the west room), and its bay in the Übungshalle.

- **Both consoles are the same device**: a terminal of the Serverraum's make — its screen,
  prompt, keys and FUNK key, typed as above — beside a Schaltfeld of four feeders (Abgänge), each
  two control lamps over a breaker, and an LED ladder with a step a second (`travelSec` +
  `windowSec`), its top `windowSec` steps marked. The stages (`stages`, 2–3) alternate the sides:
  in the odd ones console A's terminal runs the script and console B's Schaltfeld takes the
  pulse, in the even ones the other way round. At a console the live part fills the device; the
  idle one is a plate's line over it that shows nothing of the instance and says where the stage
  runs („TERMINAL B · IN RUHE · SKRIPT AN PULT A", „SCHALTFELD A · IN RUHE · AUFGESCHALTET: B"),
  so that in stage 2 nobody waits at the wrong half; the live Schaltfeld's plate reads
  „SCHALTFELD B · AUFGESCHALTET" in amber, its breakers closed in earlier stages standing closed.
  A status strip over all, headed by the make (ANLAUFSTEUERUNG AS-86), says the stage and what
  the last pulse came to in the device's words. The ladder's marked steps carry a bracket and
  FENSTER over them, as the book draws them.
- **The script** (`zeige` lists the stage and its open gaps in the log) names the load the stage
  starts — Netzeinspeisung, Notstromschiene, Kühlkreis, Lüftung, Beleuchtung, one of its own each
  stage — and has the gap `abgang`, from stage 2 on also `sperre`. Its comments are the hints:
  „Kühlkreis: Leuchtbild in Tabelle 2, Betriebsbuch", „gestört: rote Leuchte an Schaltfeld A",
  „Schalter im Fenster der Leiter". `setze <lücke> <wert>` (or the script's own
  `abgang = 2`) sets a gap — the value then stands bracketed and underlined, `abgang = [2]`,
  told from the script's own text —, `start` runs the script; Tab completes a command and, after
  `setze`, a gap of the script; the keys put the same lines together. Every comment stands on a
  line of its own over the line it explains — a comment wraps, a command or a gap keeps its row
  —; the log shows its last three entries whole (a phone held sideways its newest, or the hint
  in its place), and a refused start stays in the status strip until the next `start`; the
  device stands whole at 1280 × 720 and on a phone held sideways. The script loads
  with a log line naming the three commands. `npm` and whatever follows it the terminal
  answers itself, without a fault: „? npm: unbekannter Befehl — AS-86, Baujahr 1986". Once
  `zeige` has answered last, the line under the prompt names the typed steps the stage still
  takes: „Eingabe: setze abgang <nr> · start".
- **The facts and the rule lie apart.** The lamps burn only at the other console's Schaltfeld:
  three feeders show the pictures of three loads, the fourth red over dark, faulty. Which picture
  a load has stands only in the book's Tabelle 2 (grün over dunkel the Netzeinspeisung, gelb over
  dunkel the Notstromschiene, gelb over gelb the Kühlkreis, grün over gelb the Lüftung, dunkel
  over gelb the Beleuchtung, rot over dunkel gestört) — four of the five carry yellow, so one
  lamp never decides. One lookup a stage; a crew that sets the first feeder that is not red takes
  an alarm in most runs. Every lens has its colour's word engraved under it.
- **The pulse.** `start` needs every gap set and somebody else at the other console's Schaltfeld
  („Am Schaltfeld der Gegenseite steht niemand."); with a value that does not fit the Schaltfeld
  it is a Fehlquittierung, the values staying — the log says a value does not fit, never which —;
  the same refused values started again are turned away without another alarm („Werte
  unverändert: …"). Otherwise the pulse goes off: the terminal says
  „IMPULS UNTERWEGS" and counts nothing down; the other console's ladder fills a step a second,
  the pulse's hum rising with it, and after `travelSec` (6 s) it stands `windowSec` (3 s) on the
  marked steps, on the server's clock (`dueAt`: the arrival, then the end and its grace). The
  breaker of the feeder the script named has to close then: the stage runs up, the breaker
  latching home with the relay's clack. The ladder goes dark at the window's end on every screen,
  and the server still takes the right breaker for `PULSE_GRACE_MS` (500 ms) after it — half a
  round trip's slack for a press made while the window still showed. A moment early the ladder
  drops the pulse („Impuls verworfen"), late it dies („Impuls verfallen"), neither an alarm; any other breaker kills it with one. Either way the
  script has to be started again. Solved after the last stage.
- **The duct in the world** (`map.conduits[]`: `{ puzzleId, tiles: [[x, y], …] }`) runs from
  beside one console to beside the other, tile by orthogonal tile, under floor, walls and doors —
  the validation turns away another module's puzzle, a second duct for a station, a gap, a tile
  twice, a tile over the void and an end beside no console, and wants one at every
  Anlaufsteuerung — its messages say what to lay or move in the mission file, as the editor has
  no tool for ducts. It is baked with the floor, a dark
  channel with a steel grating. While a pulse runs, its light travels along it at the pulse's
  speed, a quarter tile at a step, toward the console taking it, then waits at the far end; every
  view of the map carries the pulse's times (`conduitsOnMap`) and the client works the spot out
  from them on the server's clock (`world/conduits.ts` `pulseSpot`), an amber light of the frame
  (`sourcesOf`) that shows where light falls on its tile now, or its room is lit, and never
  under a wall or a shut door: the pulse leaving one room is seen there, its arrival in the
  other. The times reach every player, as a door's state does: the light is the world's, the
  typing side started the pulse and could count the seconds anyway, and nothing of the instance
  is in them. The editor keeps the ducts a file brings and follows a
  rename; it has no tool to draw one yet.

`core/test/startup.test.ts` holds the deal, the script, the views by presence, every refusal, the
window to the millisecond (the breaker a millisecond early drops the pulse, the window's first
and last millisecond run the stage up, its end lets the pulse die), the needs-two rule, the
solver over 200 seeds in four variants, the crew without the book (an alarm in more than 60 % of
200 seeds) and the probe with its pinned plan (`tools/fixtures/startup-plan.json`, made by
`core/test/startupPlan.ts`); `core/test/conduits.test.ts` the ducts' validation and the pulse in
the map's views through the reducer; `client/test/startup.test.tsx` the prompt, the ladder, both
consoles, the status strip, the sounds and the type and targets on three screens;
`client/test/conduits.test.ts` the duct's tiles, its bake, the pulse's spot and its light. The
walkthrough drills the probe in a Systemcheck run (group `startup`; `SHOTS_SKIP=startup` leaves
it out, and Blackout's run logs it as left out): the terminal (startup-terminal.png), the
terminal on a large phone held sideways (startup-phone-932.png), the pulse in the duct from the
audience (startup-duct.png) and the Schaltfeld with the pulse on its marked steps
(startup-ladder.png), then both stages to the solve. Blackout's own walkthrough plays its
Anlaufsteuerung as `tools/fixtures/blackout-plan.json` pins it: the host's terminal with the
first value typed (anlauf-terminal.png), the pulse in the duct under the Flur's west end from
the audience (anlauf-duct.png), the guest's Schaltfeld with the pulse on its marked steps
(anlauf-ladder.png). A terminal worked by keys takes N as a letter, so the host's notepad
beside a device (device-notepad.png) is taken at the Sperrpult instead.

## The Paketfilter

Two halves in motion at once (`firewall`, backlog I-2, study rank 9): packets come down, one
person can drop them, only the other can tell which are hostile — and says so by marking them,
not by calling them out. After Operation: Tango's agent and hacker, Hacknet's and Uplink's
traces, and Among Us's short tactile tasks; a design of the lab's own — five lines and a gate,
plain points and header cards, no arcade formation, sprite or sound. Soft real time: slow
packets, whole lines, generous windows; the talk and the marks decide, not reflexes. Blackout has it as the Serverraum's gate, its third station, one wave of nine packets whose
solve opens the Serverschott (Walking Blackout's lab, above); its probe is `tools/fixtures/firewall-probe.json`
(„Filterprobe": the Sperrpult in the Leitstand, the Analysepult in the Wache, the policy in a
binder, the Laborkennung between them), and with its bay in the Übungshalle.

- **Console A, the Sperrpult**, a scope of five lines numbered from the left, running down into the
  Kern. The packets come down them as plain points — no header anywhere at this console —, a packet
  marked at console B wearing a ring and a tick (never the colour alone). A gate stands under one
  line: a tap on a line sets it there, ◀ ▶, ← → or the keys that walk left and right (A D unless
  rebound) step it; SPERREN trips it, and the server drops the lowest packet on that line at its own
  moment. FREIGABE starts a waiting wave — never while the Analysepult stands empty, nor in the
  second after a fault, when space may still be a late trip's —; space or enter press whichever of
  the two the wave stands for. The gate is the console's own; only the trip goes to the server, with
  its line. The lines' numbers stand over the lines, where no packet covers them.
- **Console B, the Analysepult**, the same scope with the same packets at the same places, each as a
  card of its header in two lines — the Quelle over port and protocol, „67/UDP", 14 px at least, two
  lines of its type high, 44 px at least, at every text size the settings offer —, a marked card
  wearing a ring inside its edge and a tick after the protocol, so that the mark takes nothing of
  the header's room: the widest header a wave can deal (core `widestHeader`, a Quelle of ten
  figures, a port of four) stands whole on every card, marked or not, on every screen and at
  every text size. A tap on a card, or a cursor stepped with ← → and space or
  enter, sets or takes back its mark; the cursor's dashed outline lies inside the card. It drops
  nothing.
- **A phone held upright** (a window taller than wide, up to 720 px across; proven from 360 × 640 to
  430 × 932) keeps the five lines side by side, 58 px each at 360: a card breaks each of its two
  lines in two — the Quelle's network, the rest of it, the port, the protocol, „141.7" over „.9.98"
  over „3389" over „TCP", five figures a line at most and nothing left out —, wears its mark inside
  its own edge and its tick beside the protocol, and a line is never narrower than five figures of
  the card's type in the widest face its stack resolves to (SF Mono, 0.618 em a figure). The scope
  takes the height the window leaves, a notch and a home bar counted out — 194 px at 640, 340 at 844
  and above, never less than 8/3 of a card, so that two cards of a line stay clear at every text
  size —, the Sperrpult's 130 to 340 px over its keys in two rows under a thumb: ◀ SPERREN ▶, then
  FREIGABE, the lamp and the talk key. The status line keeps three rows, so that the scope stands
  where it stood whatever the device says, and the head leaves out the line that says what the
  console does; a window under 700 px high has a slimmer bezel besides, and stands whole at 360 ×
  640 with the largest text as well.
- **The audience's panel** is a narrow column on every screen — 380 px beside the world, a third of
  the window at least, 317 px on a large phone held sideways; under the world in a window up to 900
  px — and sets its cards in four lines everywhere: its device is a window there, hardly a bezel,
  reaching into the panel's sides, so that the five lines stand in their scope and the widest header
  whole at every text size. On a phone that strip of panels is 113 to 227 px high (68 px held
  sideways at 844 × 390) and scrolls: the scope, 262 to 304 px, never stands whole in it.
- **The source** is the module's printed page, the Sicherheitsrichtlinie: three networks (Labornetz
  10.4.x.x, Wartungsnetz 10.9.x.x, everything else Fremdnetz) and six numbered rules, the first that
  fits deciding — the Wartungsnetz passes, ports 23 and 3389 are dropped, the Labornetz over TCP
  passes, a port ending on the Laborkennung's last digit is dropped, UDP to 53 or 67 passes, any
  other UDP is dropped — and the Grundregel: anything else passes. The same for every seed and
  state, printable; the headers stand only at console B, what they mean only in the policy. `rules`
  (3–6, default 4) says how many of the six an instance's packets are decided by, always in one
  order: the four simplest first — 1, 2, 3 and 6 —, then 5, the name service's exception, and last
  4, the Laborkennung's digit. A first run at the default reads the whole page but meets no packet
  that turns on the sign or on a port pair; that reading load, six rules first-match against packets
  falling for 14 s, is the lab's heaviest. Every wave carries a decoy — a packet a rule in play
  further down would drop, which only the order lets through: within rules 1, 2, 3 and 6 only a
  Wartungsnetz packet can be one, caught further down by rule 2 in one wave and rule 6 in the next
  (a Labornetz decoy would need rule 4). Every wave also carries a trap, one of four the simplest
  rules set, in an order the seed draws, so that one wave's differs from the next: the Labornetz
  over TCP on a port that looks like trouble (rule 3 passes it), the Labornetz over UDP (rule 6
  drops it, friendly as it looks), the Wartungsnetz on port 23 or 3389 (rule 1 passes it before rule
  2) and the Labornetz over TCP on 23 or 3389 (rule 2 drops it before rule 3); a crew that learned
  only „the Wartungsnetz passes, the rest of UDP drops" takes an alarm in most seeds. The default's
  three waves take about two minutes on the clock (118 s median over 200 seeds for the solver,
  98–126 s), the moves never shortening a wave.
- **A wave** is `packets` packets (5–9, default 7), two or three of them hostile, coming on one
  after another a quarter of a fall apart, each on a line nothing came onto for 0.6 of a fall —
  so that two cards of a line never overlap on the smallest scope, a phone's 130 px —, and each
  `fallSec` seconds (8–20, default 14) from the top into the Kern, the first 4 s after the wave
  starts. The first wave waits for the Freigabe („Bereit · Welle 1 starten"), so a crew reads the
  policy before anything falls; after a clean wave the next follows on its own. Positions are a
  pure function of the wave's start and the server's clock; the room ticks the station as a
  packet comes on and as a hostile one would reach the Kern. A wave is clean once every hostile
  packet was dropped and every other reached the Kern; `waves` (1–4, default 3) clean waves solve
  the station, the last on the clock as its last packet goes through.
- **Faults.** A packet dropped that the policy lets through, and a hostile one reaching the Kern,
  are a Fehlquittierung, an alarm — one reaching the Kern is charged to nobody, and the banner
  calls it „Angriff im Kern", not a Fehlversuch. A wave costs one alarm at most: the fault calls
  it off, and the fresh wave waits for the Freigabe, so a crew standing still loses one alarm at
  most, ever (a property test from any moment over ten minutes). A trip that hits nothing is no
  fault. A console draws the packets from its own reading of the server's clock, so a trip lands
  half a round trip after what was seen: for 300 ms after a marked packet reaches the Kern line a
  trip still takes it (`TRIP_GRACE_MS`), and only then is the Kern's fault judged. The grace is
  for a mark's honest late trip and nothing else: an unmarked packet is in the Kern once through,
  so a Sperrpult alone that trips in the grace learns nothing of the policy (a property test: in
  100 seeds × 3 waves not one packet dropped). A move the clock overtook — the station
  solved, or an alarm raised, by the move's moment — counts for nothing and is refused by none.
- **Needs two.** A wave runs only while both consoles are manned, and holds — the packets frozen
  where they stand, the Sperrpult's points dimmed, the Analysepult's cards as readable as ever
  (marks go on during a hold), HALT over the lines' numbers, never across a card — while one stands
  empty or the run stands still; the status line says „Analysepult unbesetzt · Pakete halten" (or
  the Sperrpult; „Pakete halten" alone while the run stands still, never that the viewer's own
  console is empty), and a trip refused then „Am Analysepult steht niemand.", as the other
  two-console modules word it. The partner LED names who stands at the other console. A crew of
  three has its third read the policy at the source while B marks; with two, B walks to the policy —
  the wave holds meanwhile, which is the intended way to read — and may take the rules into the
  notepad with the Notieren beside them.

The module is the first whose station runs on the clock and on its consoles' presence: its
`elapse` (core `puzzles/module.ts`) brings the station to the moment of every action — before a
move, so that a trip meets the packets where the server's clock has them, and after every
action, so that a change of presence, a pause for the server's maintenance or the switch-on holds
or frees the wave at once (`actions.ts` `clocked`) — only for the armed station, and for no
module without one. A crew that stands still is woken all the same: the module's `dueAt` names
the next packet coming on, the next attack reaching the Kern or the wave's clean end, and the
room arms one timer for it after every dispatch (`puzzle-tick`, as for a sync press running
out), none while paused and none once solved. An alarm the clock runs into is charged to
nobody, a solve on the clock advances the run. A snapshot holds a wave in flight at its
moment, as a pause does; after a restore it goes on from there once both consoles are manned
again (`server/test/firewallRoom.test.ts`). The solver reads the moment the crew looks
(`SolveAid.at`). Sounds (docs/sound.md): the gate's step, the trip's thunk, a pop for a packet
taken out, a blip as one reaches the Kern, a chime for a clean wave; the fault's klaxon and the
solve's chord are the kit's.

`core/test/firewall.test.ts` holds the policy's first-match rule, the waves (two or three hostile
by the policy, a decoy in each, the rules exercised, 0.6 of a fall apart on a line), the clock on a
fake clock with a second's slack at the boundaries, what a trip hits, the one-alarm-per-wave cap,
the hold while a console stands empty or the server is down, the views (no header at A, no
packet still to come and no hostility anywhere), the reducer's tick and the probe with its plan
(`tools/fixtures/firewall-plan.json`, made by `core/test/firewallPlan.ts`); `modules.test.ts` the
solver alarm-free over 200 seeds, and crews marking every packet, none, or every reason to drop in
no order each taking an alarm in all of them; `client/test/firewall.test.tsx` both devices, the
scope's clock and status line, reduced motion, the sounds, and the type and targets on phones
held sideways at 844 and 932 and upright at 360, 390 and 430, and that two cards of a line never
overlap there, five lines stand side by side in the window and a card breaks into four lines
upright only, the audience's everywhere, and that the widest header fits its card — marked and
unmarked, on the laptops, the phones sideways and upright, at every text size (a test that reads
the scope's width at each screen as the drill measures it);
`client/test/firewallWiring.test.tsx` presses every control through the components.
`server/test/firewallRoom.test.ts` lets an idle crew meet the Kern alarm on the room's own timer.
The walkthrough drills the probe in a Systemcheck run (group `firewall`; `SHOTS_SKIP=firewall`
leaves it out, Blackout's run logs it as left out), following the pages, never the plan's
seconds: FREIGABE where a wave waits, a mark on every packet the plan says the policy drops — in
any wave the run may deal, a called-off one included —, a trip under every ring
(firewall-policy.png, firewall-phone-932.png, firewall-headers.png, firewall-gate.png), and once
mid-wave the Sperrpult's player walks off: the held Analysepult, every card drawn whole
(firewall-held.png). Held so, the Analysepult and the page of a third who watches are turned
upright, 430 × 932 and 360 × 640 — the device whole, nothing scrolling, every key and card 44 px,
five lines in the window, no header cut, and a card of the fifth line tapped on the smallest takes
its mark (firewall-phone-upright-b.png, firewall-phone-upright-audience.png); then the
Analysepult's player walks off in turn and the Sperrpult stands upright the same way, the marked
point ringed and ticked on its line (firewall-phone-upright-a.png). The marked card is held to the
phones sideways and the laptop as well, no line of any card wider than its box
(firewall-marked-844.png, firewall-marked.png), and the audience's panel at laptop size.
Blackout's own walkthrough follows its Paketfilter the same way, the guest's phone held upright
at the Analysepult (filter-headers.png, filter-gate.png, filter-held.png), and shoots the
Serverschott as the solve opens it (schott-open.png).

## An emergency and the open station

An emergency (Notfall) interrupts whatever the crew does, but it no longer throws the open
station away: a crew keeps what it has earned there (backlog N-7; Among Us sets no task back for
a sabotage either). While the emergency runs the station **rests** (`GameState.resting`, core
`actions.ts` `startSabotage`): it is off every view — no panel, nothing of its instance for
anybody, the audience included —, takes no input („Gerade ist keine Station in Betrieb.") and no
switch-on („Gesperrt, bis der Notfall behoben ist."), and its clock stands still: the room arms
no tick for it (`puzzleDueAt`). The map says of its consoles that it rests (`resting` on the
station's spots): the prompt there reads „Ruht, bis der Notfall behoben ist" and E does nothing,
and the goal line names it — „Paketfilter ruht — Stand gehalten". The cover a working station
gives against the drones is off meanwhile, as it always was in an emergency.

As the emergency ends — cleared or run out — the station is back on its consoles at once, with
no second switch-on (E opens its panel), through its module's optional `resume(def, state, at)`
(`puzzles/module.ts`; left out, the state comes back as it was). What was done is done; what was
under way on a clock is called off without an alarm, a fault or a solve:

| Module | Kept | Called off |
| --- | --- | --- |
| Paketfilter | the clean waves | the wave in the air: a fresh one waits for FREIGABE, no report |
| Anlaufsteuerung | stages run up, the script's filled gaps | the pulse: „Impuls verfallen", the script starts again |
| Zugangskontrolle | doors released, the session, a login asked for, the misses | nothing — the token device stands at the period of the moment, a lock that ran out meanwhile is lifted |
| Synchrontaster, Hebel | every press where none runs out | presses in their window, nobody told „verfallen" |
| Knopf | its face and strip | a held button springs back |
| every other module | its whole state: stages, switches, wires, the dial, the maze's place | nothing: it holds no moment |

A module with a clock (`dueAt`, `elapse`) has to have a `resume`: `core/test/resume.test.ts`
walks the registry, plays every module to its solve through two rests on 100 seeds, and holds
each module to its row; `rest.test.ts` and the server's `restRoom.test.ts` play the Paketfilter
and the Anlaufsteuerung through an emergency in the reducer and in a room on its timers; the
smoke lets an emergency fall into the second wave of an open Paketfilter over real sockets, in a
scratch mission of its own (`smoke.ts` `restProbe`, „Ruheprobe", about a minute); the
walkthrough rests Blackout's Signalkette, where its emergency is due within the station's step,
with a stage through (rest-goal.png, rest-kept.png — left out with the reason where none is). A
snapshot taken in an emergency carries the resting station; one of a build before has none and
restores as it did. Pools, free order and the Tagesschicht need nothing of their own: the
resting station is the one up (`currentPuzzleIndex`) — the one drawn at a Wechselplatz, the one
picked in free order, whose pick stands through the emergency — and a seed changes nothing in it.
Two things the rule does not do: a hostile packet that reached the Kern between the room's last
tick and the emergency's start goes with its wave uncharged, and the Zugangskontrolle's locks
run on the wall clock through the emergency rather than standing still.

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
| Table | its columns aligned under their names, two blanks apart (one where two would run wider than the pad), never wrapped | Klemmbrett · Legende (Zeile · Pult A · Muster · Pult B · Muster: each console's pattern beside its colour, so that a grey sign's pattern gives either console its row at once), Spind · Netzplan, Terminal · Dienste (Dienst · Status · Strom · Braucht) |
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

**The seat follows the account.** Once the server has found the pass's account — as it sits down,
comes back or signs in — the seat is bound to the account as well, as in Dota 2: every device
signed into it (docs/accounts.md, „Sign in") sees the run's card on its join screen, and its
„Zurück zum Einsatz" takes the seat back without the crew's yes, its own pass bound to it from
then on. While the seat still plays on its line it is refused („Dieser Platz spielt gerade auf
einem anderen Gerät.") — the device that has it leaves first, „Zum Hauptmenü" say — and the pass
that held it hears, when it comes back, that the seat went to another device. A device signed
out of a run (Abmelden, a switch of accounts, or a new Kennwort set on another device of the
account) loses the seat's line as a drop: the seat waits for its account, the device starts as a
guest with no card. The room's sealed snapshot carries the binding, so a server that takes the
room up again hands the seat to the account's device too.

**Bound to the run.** While the pass sits in a run that is on, running or standing still for the
server's maintenance — or a seat of its account does, on another device — the join screen opens on
the run's card instead of the form (`whereami`, asked as the screen comes up): the mission, the
room's code, the crew and the clock as the server last showed it — counting down as the run goes
on, whoever is away; standing where it was while the maintenance stands the run still
(„WARTUNG"), or nobody of the crew is on the line („WARTUNG · NIEMAND AUF DER LEITUNG") — with
„Zurück zum Einsatz" and „Einsatz aufgeben" (a second press within 4 s confirms it). Opening or
joining another room is refused, naming the run. A seat in a lobby shows its card too, and „Raum
verlassen" leaves it as before; a finished run binds nobody.

**The line that drops.** A line that drops stops nothing: the clock, the patrols, the emergencies
and the escape run on, as in Overcooked 2 and Among Us, and as Deep Rock Galactic keeps its
mission running with the seat open. (Until 2026-11-14 a drop stood the run still for everybody, as
Dota 2 pauses a match; Uros asked for the run to go on.) The seat stays bound, and whoever comes
back plays on at once, in the run as it stands. Meanwhile their avatar stands where it stood and
holds what it held — a plate stays down under it, and on the open hatch it counts as out —, the
patrols do not see it, so the crew is not punished for a body that cannot move, and its console
counts as unmanned: a station with two consoles still takes two of the crew on the line, and an
emergency at the relay is rolled without the consoles of whoever is away — anew, once, at its
first tick after a line has been down 5 s while one runs, and again as they are back; a page
loaded anew is back sooner and rolls nothing, its console and every clock as they were. With
fewer than two of the crew on the line, where no console is worked anyway, it keeps one for each
of the crew the run counts; the server's maintenance stands it still as it is. Mission
control says it on the air once — „Bens Leitung ist weg.", for the main menu „Ben hat sich
abgemeldet." — and the crew strip greys Ben, his time away counting up („getrennt · 0:12", „im
Hauptmenü · 0:12"); no card stands over the world. The stations the whole crew presses, the hatch
and the escape count Ben as ever and wait for him as for somebody slow, until the crew goes on
without him: 60 s into the run's first drop, and 20 s into every later one, the bar over the world
offers everybody still on the line „Ohne Ben weiter" (Overcooked 2: the crew chooses between
waiting and going on). One press waives Ben: the stations the whole crew presses, the hatch and
the escape count the crew without him; a station with two consoles still takes two. With one
member left on the line the way on is never offered; after the same wait the bar offers „Einsatz
abbrechen" instead, which ends the run lost (`lost:abandoned`, „EINSATZ ABGEBROCHEN"). A waived
member who comes back counts again at once, and the others read „Ben ist zurück"; one not waived
simply plays on. A drop alone ends no run.

**The whole crew off the line.** With nobody of the crew on the line there is nobody to run the
run for: from the moment the last line drops it holds as for the server's maintenance (`wartung`)
— the clock, the patrols and the emergencies stand still — and goes on as soon as the first of
the crew is back, every deadline moved on by the hold; whoever is still away stays away as after
their drop. The run's card on the main menu says „WARTUNG · NIEMAND AUF DER LEITUNG", the
audience's banner „Wartung — niemand auf der Leitung"; nobody on the line sees a card, since the
first back finds the run going on. The room still closes once it has stood empty 10 minutes,
held or not, and a seat given up meanwhile leaves the hold as it is.

**Giving the run up.** „Einsatz aufgeben", on the run's card or on the card of a line lost, gives
the seat up for good: what they carried goes down where they stood (on their start where the
server never had them), a plate they held lets go, and the pass is free again. Below the
mission's least crew (`players.min`) the run ends lost for everyone, its end card naming who
left („Ben hat den Einsatz verlassen."), and the rematch works as ever — decided before an
emergency at the relay is rolled anew for whoever is left. Otherwise the run goes on — at once
where the server's maintenance stood it still for them alone; but with fewer than the least crew
left on the line it counts again whoever it went on without, their wait starting anew (20 s), and
the one left alone may call it off once that is over.

**Taking a seat over.** As in Jackbox, a new device joins a running room by its code and the exact
name of a seat whose line is down — but the crew lets it in, since the room list shows every running
room's crew to anybody. The ask waits up to 30 s while every member on the line reads „Ben meldet
sich von einem anderen Gerät" with „Zulassen" and „Ablehnen", on a card of its own at the top while
the run goes on, or on the maintenance card while it stands still for that; the first answer
decides. Let in, the device resumes the seat on its own pass, and the pass that held it is refused
from then on („Der Platz wurde auf einem anderen Gerät übernommen."); turned away or left
unanswered, the device is told „Die Crew hat die Übernahme nicht bestätigt.", and Ben's pass keeps
the seat — that device may ask for it again only a minute later, refused quietly meanwhile, with no
card for the crew. Ben back first ends the ask („Ben ist wieder verbunden."), and with nobody of the
crew on the line none is taken. The name of a seat still on the line is refused („Ben ist noch
verbunden."); any other name gets the refusal of a join into a run, which says that a seat whose
line is down can be taken over by its name. The ask is for guests and for devices of other
accounts: a device signed into the seat's account comes back by its card, without one.

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

**The restart.** A deploy, or a restart of the server, ends no run. Two seconds after a deed of the
crew's, and every 10 s at the latest while a run's clock runs, where everybody stands with it, every
seat on the line is handed the room's snapshot, packed and sealed with the server's key
(`ROOM_SECRET`, Deflate and AES-256-GCM, the room's code bound in; under 12.5 kB for Blackout mid-way);
a room whose clock stands sends only what changed, and its browser keeps the newest in
`localStorage` (`escapelab-snapshot:<code>`) beside what the join screen's card shows of the room.
On SIGTERM the server stands every run still — the maintenance pause (`wartung`), every seat away —
hands every seat the room's last snapshot (`restart`), closes the sockets with 1012 and exits. The
player's own card says „WARTUNG · Der Server startet neu" with the usual retry counter, and the page
comes back as for a line dropped, the snapshot in its `resume`. A server that knows the room no more
takes it up again from it, under its code, still in the maintenance pause — the one thing that
stands a run still: its card over the world says „WARTUNG" over „Warten auf Ben", and the run goes
on, its deadline moved on by exactly the downtime, once whoever was on the line at SIGTERM is back,
or goes on without whoever of them is not: the card offers „Ohne Ben weiter" a minute after the
restore at the soonest, „Einsatz abbrechen" for one alone once that minute is over. Whoever's line
had dropped before stays away as before, its wait the one of the drop, and is not waited for: a drop
never turns into a pause by way of a deploy (decided 2026-11-14). A server killed outright takes the
same rule from the newest snapshot, which names whoever was on the line as it was taken; a snapshot
of a build before R-nopause names nobody, and its run goes on as the first of the crew is back. A
lobby's seats wait from the restore as well: one not back is freed 120 s after it, whatever the
lobby's last snapshot was. For 10 s after the restore, until the crew does anything, a newer
snapshot handed in replaces the one the room was taken up from; an older one changes nothing, and a
newer one that comes later only goes into the log, with both seqs. A seq orders the snapshots of one
history only: a room taken up again from an older snapshot counts on from it, a history of its own,
so a last snapshot of the history it left could in theory outrank its newer ones — accepted. Every
snapshot names the server instance that sealed it, one id per boot, and the one at SIGTERM is its
last (`final`): a new instance takes a room up from a snapshot of another one that is not its last
only once that last one comes, or 90 s after the first such snapshot came, however long the instance
has been up, from the newest handed in meanwhile — whoever dropped in the minute a deploy keeps the
old instance up comes back after the switch with an older snapshot than the crew still on it, whose
last ones come some 61 s after the switch at the latest; a last snapshot never waits. Meanwhile the
player's card says „EINSATZ WIRD WIEDERHERGESTELLT · Der letzte Stand trifft gleich ein", with only
the reload to press; the join screen's card, its way back pressed or the page loaded anew, says the
same with the seconds it has waited, only „Einsatz aufgeben" open — carried out once the room is
back — and the audience waits as well, while a join by its code is told „Der Raum wird gerade
wiederhergestellt, gleich noch einmal." A page loaded anew stands on the card of the newest snapshot
it keeps from the start, never on the plain form. A server killed outright, with no SIGTERM, loses
at most the last 2 s of a deed and 10 s of a walk, and its rooms are back 90 s after the first of
their crew came back to the next one. A snapshot over a day old, of a run that is over, of another
room or under another key is refused in one line, and so is one whose code another room holds
meanwhile. A room the server closed for standing empty 10 minutes leaves a tombstone for a day that
refuses its snapshots — „Dieser Einsatz ist beendet." where its run was over by then, else „Der Raum
stand 10 Minuten leer und wurde geschlossen." — and the page drops the snapshot and its card: a seat
that left mid-run brings back no ghost of the run. A room taken up again binds only whoever has come
back to it: the join screen of anybody else shows its own card, and nothing keeps them from another
room; a run given up by the only one of its crew who came back is not counted. Where the server does
not know the room yet, the join screen shows its card from the kept snapshot: „Zurück zum Einsatz"
takes the room up again, and „Raum verlassen" or „Einsatz aufgeben" there drops it. A tab that
watched the room asks for it again for 30 s after a restart, until the room is back. Patrols stand
still through the maintenance, where they are; an ask for a seat lapses with the restart. Without
`ROOM_SECRET` the key is one of the server's boot alone, and no room survives a restart.

**The lobby.** The host cannot start while a seat's line is down: the lobby says whose („Bens
Leitung ist unterbrochen"), as it says who has not confirmed yet. A seat whose line has been
down for 120 s in the lobby is freed, its pass bound no more and the log saying so — at once
where the room comes back to its lobby later than that — and the crew starts without it. A
tab closed for good, its socket closing cleanly (1000, 1001), frees its lobby seat after 10 s
unless its pass is back by then, as a reload is; in a run the seat stays bound either way.

**What the server says.** One log line per event, with the room and the name: a seat joining,
its line closing, its return with how long it was away, a socket the heartbeat cut and why, a
refusal at the door or of the way on, going on without somebody, a seat given up, a seat asked
for and let in or kept, every run's end with its outcome, the server going down for a restart
with each room's last snapshot, and a room taken up again: `restored room <code> from snapshot seq
<n> (<k> seats, <age> old)`, or why a snapshot was not taken. `GET /health` counts the rooms,
the runs on and those the maintenance stands still, the players and the audience on the line, and
says the uptime and the build (`RENDER_GIT_COMMIT`, else `dev`); it names nobody.

## Pausenmenü und Verlassen

In a room — a run, a lobby, the audience's view — Esc with nothing else open (a device or a page
still fading out takes the Esc meant for it), the gear in the top bar, a controller's Start or the
strip's „Menü" (the ≡ in a phone's row; under 820 px across the gear alone) opens the pause menu
over the room, as Hades and Celeste hold theirs: the mission's name in Michroma over one item under
the next, the door-dark dim behind it, nothing blurred. Off any room the gear opens the settings at
once. The list: „Weiter", „Einstellungen", „Handbuch" (the mission's booklet over the room), then
the room's ways out — „Zum Hauptmenü" and „Einsatz aufgeben" in a run, „Zum Hauptmenü" and „Raum
verlassen" in a lobby, „Zuschauen beenden" for the audience. The arrows or the D-pad step between
the items, round at the ends; Enter or A takes one; Esc, B or „Weiter" closes the menu, and the
control that had the focus before has it again — in a lobby or the audience; in a run the focus
stays with the world. While a menu stands open, nothing under it takes a key, a press or the
controller: the screens are `inert`, and what they listen for on the window hears nothing either —
the world's keys, the notepad's, the lever's, the arrows of a book, the opening's Space (App.tsx
`ScreenArea`, hooks.ts `useKeys`); the talk key alone talks on. Opening it pauses nothing: the
clock, the patrols and the emergencies run on — a run stands still only for the server's maintenance
and while nobody of the crew is on the line, as above —, the line under the list says so in a run,
and the crew's strip marks the player „im Menü" for as long as it stands open — a phone's row, which
shows a doing only for three seconds after it changed, for those (`pause-menu`, core `set-menu` and
`menus`; six marks at once and one more a second, as the voice's signals are allowed). Meanwhile the
avatar stands. Under reduced motion the menu cuts in.

**The ways out**, as Dota 2 has them:

- „Zum Hauptmenü" in a run closes the seat's line on purpose (`to-menu`): the seat stays bound,
  and the server logs `left to the main menu, the seat kept` where a drop logs a drop. The run goes
  on as after a drop: mission control says „Ben hat sich abgemeldet.", the crew strip „im
  Hauptmenü · 0:12" by his name, and the bar offers „Ohne Ben weiter" after the same wait as for
  a drop (60 s the first time, 20 s later). Only when nobody of the crew is left on the line does
  the run hold — whoever leaves last stalls nobody, and the room's 10-minute close caps it — until
  the first one is back. The page loads anew on the main menu, the run's card first and lit:
  „Zurück zum Einsatz" — the way back a drop takes — and „Einsatz aufgeben".
- „Einsatz aufgeben" asks once, as Overcooked 2 does: a card says what it means in the world's
  words — „Der Platz wird aufgegeben und lässt sich nicht zurückholen." and „Der Einsatz läuft
  mit 2 Plätzen weiter.", or below the mission's least crew „Mit 1 Platz liegt der Einsatz unter
  seiner Mindestbesetzung von 2 und endet damit für alle." — „Zurück" in the focus; its „Einsatz
  aufgeben" gives the seat up as the run's card does (`abandon`).
- „Zum Hauptmenü" in a lobby leaves the seat as a line down does: the lobby says „Ben ist im
  Hauptmenü" and the start waits, until Ben is back by the menu's card or the seat is freed 120 s
  later.
- „Raum verlassen" in a lobby leaves at once, the seat freed.
- „Zuschauen beenden" leaves the audience.
- Closing the tab stays a drop: a run keeps the seat and goes on, a lobby frees it after 10 s.

The end screen keeps its „Nochmal", its way back to the lobby and „Raum verlassen".

**The host's part.** Where the host leaves a lobby, or its seat is freed, the part passes to the
longest-seated member still on the line — the first in the crew's order whose line is up, else
the first (core `heirOf`) — and the lobby says so for 8 s: „Anna ist gegangen · Ben leitet jetzt
den Raum."

**The back button.** In a run the browser's back button opens the pause menu instead of leaving
the page: the run keeps a history entry of its own (`historyGuard.ts`), which a press of back
spends and the menu puts back.

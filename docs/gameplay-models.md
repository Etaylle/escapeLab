# EscapeLab — gameplay models

What the best co-op puzzle games do that EscapeLab can borrow, written as decisions we can take.
Each game below gets two or three mechanics. Each mechanic is told in four parts: what the game
does, why it works, how it fits our invariants, and how big the change would be. A last line per
game says what we would not copy. The ranked list at the end turns the findings into backlog
lines, so that „gameplay improvement" becomes tickets.

The games are described from playing them and from their published design talks. Where the
foundation audit (`docs/foundation-audit.md`) sourced a fact, that fact is quoted from there.
Sizes follow the backlog: S is data and one module's change, M a module or map element across
core, server and client, L several systems, XL a new layer of the game.

## Our invariants, the yardstick

Every borrowing has to survive five rules of `CLAUDE.md`:

- **Two consoles or a reader.** Nobody works a station alone. An input counts only while a
  second crew member stands at the other console or at an open source of the station
  (`backupsOf`). Stations the whole crew presses together are the only exception.
- **Views by presence.** What a player sees follows from where they stand, never from a role.
  The instance reaches only the players at the console. The rules reach only the players at a
  source, and the Laborkennung only those who read the sign.
- **Rules at sources.** Rules lie in the world: in a book, a terminal, a chart, a clipboard,
  a locker or a cabinet. Nothing that carries rules can be carried.
- **Manuals without answers.** A module's printed page holds rules, never answers. It does not
  depend on the seed or the state, so it can be printed.
- **Missions are data, modules have a contract.** A new mission is a JSON file. A new puzzle
  type is one module file plus one registry line in core and one panel in the client.

Already borrowed, and not proposed again: the module set and the Laborkennung (Keep Talking),
the bomb manual's one-page-per-machine layout (Keep Talking, `printed.ts`), the shared 3-2-1 at
the sync stations (Portal 2, N-4), the ping and the quick chat (Portal 2), the relay emergency
(Spaceteam, `relay.ts`), the crew's choice between waiting and going on (Overcooked 2, R-3) and
the seat taken over by name (Jackbox, R-3).

---

## Keep Talking and Nobody Explodes (Steel Crate Games, 2015)

One player holds the bomb. The others hold the Bomb Defusal Manual and never see the bomb. The
bomb carries regular modules, which must be solved, and needy modules, which can only be kept in
check. The audit counts the manual at 23 pages, one module a page, with Who's on First on two.

### 1 · Needy modules

**What it does.** A needy module, such as Venting Gas, Capacitor Discharge or Knobs, sleeps
and then wakes with a short timer of its own. Somebody has to answer it before it runs out:
vent, discharge, or set the knob as the manual's lamp table says. It can never be finished. It
comes back after a while, and a timer that runs out costs a strike.

**Why it works.** It gives the bomb a second rhythm on top of the main task. The defuser has to
split their attention, and an expert with nothing to read gets a job. Knobs needs the manual,
so even the needy side keeps the talking going.

**Our invariants.** A needy object stands at a fixed spot and wakes while a station is open.
Its gauge shows only to whoever stands at it, which keeps views by presence. It is no station:
like a plate, it is a chore for one person, not a puzzle for two. That is a deliberate,
documented exception to „two consoles or a reader". A Knobs-like variant keeps the rule: what
the needle means is printed at a source, and venting it right takes a reader. Its page holds
the table, never the setting. A missed answer is an alarm, so it uses the existing penalty
path.

**Size.** M. It needs a map element (`needy`: spot, kind, wake period, window) and a server
timer like the sabotage's. It also needs a core action, a small client prop with its gauge,
and validation that someone can reach it while each station is open.

### 2 · The manual's structure

**What it does.** Every page opens the same way: the module's name („On the Subject of
Wires"), a picture of the module so that the expert can match what they hear, and one line
of flavour. The rules come next, in the order the expert needs them. Appendices explain the
edgework once: batteries, indicators and ports. Every rule that reads the edgework points
there.

**Why it works.** The expert learns the book's layout once. After that, any page is a
lookup and not a reading. The picture solves the first problem of every exchange: which
module are we on?

**Our invariants.** Ours already follows it. Every page is a Betriebsanleitung with a type
plate, purpose, a drawing, the build, the operation, its tables, a log excerpt and the
workshop's notes (`printed.ts`). F-2 keeps one station to a spread. One piece is missing: an
appendix for the Laborkennung. Today each rule that reads the serial, the lamps or the cells
explains them again in its own words. The keypad's other trick, shapes without names, forces
the crew to describe. The Signalkette's patterns do the same since T-8.

**Size.** S. One printed section „Anhang: Laborkennung" added to the sources that cover an
edgework module. Its wording is checked by the manual-voice tests.

### 3 · Strikes that speed the clock

**What it does.** Every strike shows on the timer, and after a strike the timer runs faster.
The bomb explodes at the strike limit, three on a default bomb.

**Why it works.** A mistake costs more than seconds: every later second gets scarcer, and the
crew can hear it in the faster ticking. The pressure grows exactly when the crew is shaken.

**Our invariants.** No conflict. Alarms already go through one path, `applyPenalty`, which
charges seconds and ends the run at `maxAlarms`.

**Size.** S, and only the audible half: the countdown's tick could quicken in the last minute.
A clock rate that changes would be M.

**Not for us.** One defuser while everybody else reads. Our presence model spreads both halves
over the map, and the reader walks to the source. We would also not use a paper manual
outside the game: our rules lie in the world, and reading them takes a body there. And we would
not let the clock run faster after strikes. A clock rate that changes makes the time left
unreadable for planning a walk of 12 s. Our alarms already take whole seconds off, which the
HUD shows.

---

## Among Us (Innersloth, 2018)

Tasks are short mini-games at fixed spots. They spread the crew over the map. In a sabotage
the impostor breaks something that the crew must fix together.

### 1 · Task shapes

**What it does.** Every task teaches itself in a second, with no text:

- **Fix Wiring:** drag four coloured wires to their colour on the other side, at three panels
  in three rooms.
- **Swipe Card:** swipe at the right speed. „Too fast" and „Too slow" say how it went.
- **Clear Asteroids:** shoot twenty.
- **Two-part tasks:** Fuel Engines (fill the can in Storage, empty it at both engines), Divert
  Power (Electrical, then accept in the target room), Download/Upload (two rooms).

**Why it works.** The input carries the feel: a drag, a swipe at the right speed, a tap. That
makes a task readable and satisfying although it is trivial. The two-part tasks route people
across the map and give a reason to be in a room.

**Our invariants.** Our stations are the opposite: the puzzle is the point, and two people are
needed. Two shapes still carry over:

- **The feel input.** A card swipe with a speed window becomes Pult B's half of I-1's access
  control. The window is printed at the source: the card reader's page says how fast a
  card has to pass, the token generator says which card. Pult A has the login.
- **The two-part task.** A part that is made at one station and needed at another fits our
  items. Items are carried by hand, one at a time, to a drop-off. Today they lie on the map
  from the start. They could also come out of a solve (G-3).

**Size.** M for the card reader as part of I-1. M for parts that come out of a solve.

### 2 · The two-panel sabotages

**What it does.** Reactor Meltdown is fixed only while two players hold the two handprint
scanners at the room's two ends at the same moment. Oxygen Depleted needs a code typed at two
keypads in two rooms. Both run on a countdown that ends the round.

**Why it works.** It turns everybody's attention to one place at once and forces a split: who
goes where. One player cannot do the reactor, however fast.

**Our invariants.** Our valves emergency is the Reactor: every panel manned at once, each by a
different player (`map.sabotage.mode: 'valves'`). Blackout runs the relay instead. The O2
shape is not built yet: a code read at one place and typed at two others. It can run as a
valves variant with a keypad at each panel and the code at a source, which keeps the rules at
the source.

**Size.** M as a third emergency mode (`codes`). It needs the code drawn per emergency from the
seed, a keypad at each panel and validation like the valves.

### 3 · The emergency meeting

**What it does.** A button in the Cafeteria calls everybody to the table at once. It works a
limited number of times per player and has a cooldown. The game stops for the talk and the
vote.

**Why it works.** It makes a ritual of talking, ends the scattered phase in one stroke and
puts everybody on the same information.

**Our invariants.** We have no traitor and no vote, and our talking is continuous: voice,
quick chat and the station's intercom.

**Size.** None proposed.

**Not for us.** The emergency meeting, because it needs a traitor to mean anything. A pause
called by the crew would also undo the clock's pressure. Tasks as filler, since ours have to
need two people. The vision circle, since our lamp cone already shapes sight.

---

## Spaceteam (Sleeping Beast Games, 2012)

Every player's phone shows a panel of absurdly named controls. Every player gets
instructions on a timer, mostly for controls on somebody else's panel.

### 1 · Commands addressed to other panels

**What it does.** „Set the Eigenthrottle to 3": the instruction is on my screen, the control on
yours. Everybody shouts at once. Each completed instruction moves the ship on, and each
missed one damages it. Each player holds one instruction at a time (audit).

**Why it works.** No one can play their own screen. The chaos of everyone shouting at once
is the fun, and it can't be had alone.

**Our invariants.** The relay emergency is exactly this (`relay.ts`). Each console is built
from the run's crew, each player has one instruction for a control on somebody else's console,
and nothing is printed except the drill.

**Size.** Done.

### 2 · Panels that shift

**What it does.** From one sector to the next the panels are rebuilt. Within a sector, events
break things: a control falls off and has to be fixed, labels go missing, an event needs every
player at once.

**Why it works.** Nobody can memorise a panel. The crew has to keep reading and keep
talking, and an event that breaks the routine makes a story.

**Our invariants.** It can only shift what an emergency's consoles show, which keeps views by
presence. A control that fails mid-emergency („ausgefallen") would pass its instruction to the
next free control, on another player's console. The drill on the page names the failure („Ein
ausgefallener Regler gibt seine Anweisung an den nächsten Regler im Uhrzeigersinn"). That is a
rule, never an answer.

**Size.** S, within `relay.ts`: a failure rolled per emergency from its stream, the view's
console marking the dead control, a line in the drill.

**Not for us.** Nonsense names at stations: ours are documents of the world with type plates,
and only the relay talks nonsense. Shaking the device. Chaos as the main loop: our stations
are deliberate, and the relay is its one burst of chaos.

---

## We Were Here Together (Total Mayhem Games, 2019) and Operation: Tango (Clever Endeavour Games, 2021)

Two players with different halves of the same puzzle. In We Were Here they can talk only over a
radio. In Operation: Tango one is an agent in a building and the other a hacker in its network.

### 1 · Asymmetric information puzzles

**What it does.** Each half is incomplete without the other.

- **We Were Here Together:** one player stands in a room of levers and symbols, the other
  holds the key that explains them. The pair starts together and is then split up, so the
  roles change during the game.
- **Operation: Tango:** the two halves are two representations of the same thing. The agent
  sees doors and cameras, the hacker the nodes behind them. Both halves move at the same time.
  The audit quotes its designers: „Downtime in asymmetrical co-op is never an option!"

**Why it works.** Describing is the game. Building a shared vocabulary for a symbol neither
can name is the satisfying part. When both halves move at the same time, nobody waits.

**Our invariants.** Our stations are this: console A and B, or console and reader, each view
by presence. Two borrowings fit:

- **The role swap within a station.** A second stage that only takes inputs from the player
  who read in the first stage. The device says so on its plate, as machines do („Stufe 2:
  Freigabe nur von der Prüfseite"). This is a reducer guard in the module's `apply`, and the
  views do not change.
- **Both halves in motion at once.** For example, I-2's firewall: packets flowing at A while
  B edits the rule list, both against the same clock.

**Size.** S for the role swap as a module flag. L for I-2.

### 2 · The walkie-talkie discipline

**What it does.** In We Were Here the radio works only while its key is held, and with no
distance (audit). The click of the key and the hiss frame every turn.

**Why it works.** Turn-taking becomes audible. Each player speaks in short reports, and the
radio itself becomes the place where the crew meets.

**Our invariants.** N-3 did the important half. Between the places of the armed station,
voice carries in full however far apart, while everywhere else it fades with distance. Push
to talk (V) exists. Two things are left:

- **A busy lamp.** The device's PARTNER LED could light while the partner talks.
- **The key's click at both ends.** One sound at key-down and key-up, on the station's
  intercom only.

**Size.** S, client only (voice/intercom).

**Not for us.** Keeping the crew apart for a whole mission with the radio as its only line:
our crew walks one lab, and proximity voice sells the place.

---

## Portal 2 co-op (Valve, 2011)

Two robots, Atlas and P-Body, solve test chambers together. The game gives them tools for
pointing, for timing and for showing feelings.

### 1 · Pointing and timing tools

**What it does.** The ping marks a spot for the partner („look here", „portal here"). The
countdown shows 3-2-1 on both screens for actions that must happen together. The audit records
that Portal 2 teaches the ping first and gives a countdown so that „both players see the GO at
the same instant".

**Why it works.** It replaces the hardest sentences to say: „there, no, there" and „now!".

**Our invariants.** Done. Pings come from a click or the D-pad. The shared count runs on the
server's clock at the sync stations (N-4). The quick chat carries station data (T-3).

**Size.** Done.

### 2 · The gesture wheel

**What it does.** Wave, high five, hug, rock-paper-scissors, laugh. The partner sees the robot
do it in the world.

**Why it works.** It is expression without voice, and a high five after a chamber builds the
pair.

**Our invariants.** No conflict. Gestures carry no information about an instance. The figures
already pose (`figure.ts`): they flinch at an alarm and cheer on the won card.

**Size.** S, client mostly. Two gestures, a wave and a thumbs up, could be quick-chat entries
whose figure performs them, with the server relaying the chat line as today.

**Not for us.** The partner's view as a picture in picture. Views by presence forbid showing
the partner's console or source. What a camera feed of the world would show, the minimap
shows already.

---

## Escape Simulator (Pine Studio, 2021) and Escape Academy (Coin Crew Games, 2022)

First-person escape rooms, played in co-op. Escape Simulator rooms are dense with physical
props, and it ships with a room editor. Escape Academy is a school of escape rooms with a
campus between them.

### 1 · Room pacing

**What it does.** Each game paces its rooms differently:

- **Escape Academy:** the first room takes about 10 minutes, later ones 15–30 (audit). Each
  room introduces one idea, uses it, twists it, and ends in a set piece.
- **Escape Simulator:** the 15-minute timer is „an optional challenge, not a fail condition"
  (audit). Its rooms run several strands of puzzles in parallel that converge on the exit.

**Why it works.** The parallel strands let a crew split up without anyone waiting. The
optional timer lets a first crew learn without losing. Short rooms with one idea each teach
one thing at a time.

**Our invariants.** G-2 builds the base:

- **Free order** (`order: 'free'`) gives parallel strands: every station is open, and the
  crew picks.
- **No clock** (`timeLimitSec: 0`) makes the timer optional.
- **The Übungshalle** is a room per machine, one idea each.

Left for N-6: a crew's first run of Blackout without a clock, and the hall, the tutorial and
Blackout as a course with one idea added per step.

**Size.** S: a lobby switch „ohne Uhr" for the first run, data for the course.

### 2 · Hint design

**What it does.** Both games give hints per puzzle in steps, from a nudge to the answer, and
the players ask for them.

**Why it works.** The crew decides how much help it wants, and the steps protect the
„aha" for as long as the crew wants it.

**Our invariants.** Done in our terms. Every station has up to three notes of the last shift
(nudge, then specific, then near-answer). They lie at the sources, the first after 45 s, each
costing 20 s of the clock (none without one). Mission control also names the next place after
90 s of silence. In free order the notes follow the station that is switched on.

**Size.** Done.

### 3 · Inventory and tokens

**What it does.** Objects go into an inventory and can be turned to find marks. A token, such
as a key, a coin, a fuse or a gem, fits exactly one receptacle, which answers visibly when it
goes in.

**Why it works.** Every object promises a place, and finding it is a small satisfying search.
Examining turns a carried thing into information.

**Our invariants.** Our hands hold one part at a time, and parts go to their drop-off or a
key to its cabinet (`map.items`). One borrowing fits: a mark on a part, readable only while
holding it. For example, the fuse's rating is stamped on its cap, and the Notstrom rules ask
for it. The holder becomes a reader of an instance fact, which is not a rule and does not
break the rule against carrying rules. Only the holder's view carries it.

**Size.** M: a part's `mark` drawn from the seed, the holder's view, a rule that reads it.

**Not for us.** A bag inventory: one part in hand keeps the walk meaningful and the hand-off
necessary. Turning objects in 3D. Rooms with a single exit lock as the only goal: our
missions end with the crew out.

---

## Overcooked 2 (Ghost Town Games, 2018)

Up to four cooks run a kitchen: chop, cook, plate, serve and wash, with orders that overlap.

### 1 · Chained logistics

**What it does.** One order goes through several stations and several hands: chopping board,
pot, plate, the pass, the sink, and plates back again. Orders overlap, and kitchens move,
split or catch fire. That forces a division of labour that the crew has to talk out.

**Why it works.** Nobody is ever idle: there is always a next link in some chain. Mastery
shows in the routes the crew finds.

**Our invariants.** Our chain is one station at a time. In free order, parts that come out of
a solve and are needed elsewhere make chains (G-3). A crew of three splits into a pair at a
station and a runner with the part. Each station keeps its two people. The part is carried,
not read.

**Size.** M (G-3).

### 2 · The hand-off

**What it does.** Counters are where things pass from hand to hand. Overcooked 2 added
throwing ingredients across a gap.

**Why it works.** The hand-off is the visible moment of cooperation. Two cooks meeting at a
counter save each other a walk.

**Our invariants.** Today a part can be put down (Q) and picked up anywhere. A hatch in a wall
(„Durchreiche") would hold one part and be reachable from both rooms. It is a map element on a
wall tile with floor on two sides, and walks would plan with it. No rules are involved.

**Size.** S–M: a map element, the server's pick and drop at its two faces, validation that it
joins the two rooms.

**Not for us.** Throwing. Fire and moving floors as pressure: our pressure is the clock,
the drones and the emergency.

---

## Lovers in a Dangerous Spacetime (Asteroid Base, 2015)

One to four players run a round ship from the inside by running between its stations: turrets,
shield, engine, a big laser and the map.

### 1 · Stations that scale with crew size

**What it does.** The ship has more stations than there are players. A crew of two runs
between them, four can man more at once, and alone a player directs an AI pet. Which station
is manned right now is the game's constant decision.

**Why it works.** The same ship works for any crew. A crew that is too small feels it as
tension, never as a broken level.

**Our invariants.** M-1 found that a third player has too little to do. Free order lets a
mission hold more stations than a crew of two works at once. One station runs at a time. Two
stations open at once for a crew of four is a later step, where two pairs would each have
their own instance. A station could also take an optional third place that helps without
being needed, such as a second meter at the Notstrom. Its view would show only what that
console shows.

**Size.** M for the third place within a module. L for two stations open at once: a state
per open station instead of one.

### 2 · Upgrades that change stations

**What it does.** Gems socketed into a station change its behaviour. The shield reflects, the
turret fires a beam, and combinations matter.

**Why it works.** Players see that stations are connected, and how they upgrade becomes a
crew decision.

**Our invariants.** A solved station could change another station's instance, such as the
Notstrom's power lighting the Signalkette's legend lamp. That has to be data in the mission,
and the rules for both cases must be printed.

**Size.** L. Not proposed now.

**Not for us.** Real-time combat. An AI partner: our stations need two people.

---

## Phasmophobia (Kinetic Games, 2020)

One to four investigators gather evidence of a ghost and name its type.

### 1 · The journal as the crew's memory

**What it does.** The journal lists the types of evidence: EMF 5, Spirit Box,
Fingerprints, Ghost Orbs, Ghost Writing, Freezing Temperatures and D.O.T.S. Each type that is
ticked narrows the list of ghosts. The crew pools what each member found, and the journal is
where the reasoning happens.

**Why it works.** Nobody can conclude alone. The journal turns scattered findings into one
decision, and it shows what is still unknown.

**Our invariants.** Our notepad holds each player's own writing and captures from the sources
(`noting.ts`), kept per player. A Lagetafel would be a board in the world where captures are
pinned for everybody standing at it. It would be a place, so views stay by presence. It holds
only what the crew pinned. A pinned capture of rules is the player's copy, as the notepad is,
and input still needs a second person.

**Size.** M (G-4): a map element `board`, a server list of pinned captures per run, the
notepad's „Anheften", a view of the board's pins for whoever stands there.

### 2 · Voice recognition as input

**What it does.** The Spirit Box and the Ouija board answer questions spoken into the
microphone, and the ghost reacts to its name.

**Why it works.** Speech becomes an act in the world, and saying the wrong thing is
frightening.

**Our invariants.** Our voice is the crew's line to each other, not to the game.

**Size.** None proposed.

**Not for us.** Speech recognition. The browser's Web Speech API runs well only in Chrome,
which sends the audio to a cloud service. That is a privacy question we should not raise in a
study project. Recognising German lab jargon is unreliable, and talking to the machine would
take talk away from the crew. Drones that hear voices would punish the talking our game is
made of.

---

## Lethal Company (Zeekerss, 2023)

A crew collects scrap from facilities to meet a quota. The ship is its base.

### 1 · The terminal as a second player's instrument

**What it does.** One player stays on the ship at the terminal. They watch the radar with the
crew as dots, switch between crewmates, and type short codes printed on the radar to open the
facility's secure doors or switch off turrets and mines. Everything is typed, and they talk
the others through by walkie-talkie.

**Why it works.** A player who never enters the facility plays all the time, as a navigator.
The runners trust the voice. Typing makes every intervention deliberate.

**Our invariants.** A Leitstand terminal, typed like the Serverraum's, shows the radar of
drones and doors only to whoever stands at it. The codes stand on the doors in the world,
drawn from the seed: the runner reads them out, the operator types them. The door opens for
five seconds, or a drone holds while somebody runs. Neither can do it alone. This is I-1's
„Schleuse", made concrete.

**Size.** L: a terminal module whose commands act on the map (doors, drones), the door codes
per run, the radar view, validation that every lock can be opened from the terminal.

### 2 · The ship as hub

**What it does.** The crew starts and ends every day on the ship. A lever lands it, and the
ship holds the terminal, the scrap and the quota.

**Why it works.** A safe place between dangers. Starting is something the crew does
together in the world.

**Our invariants.** S-2 (Pausenraum) already has Lethal Company's lever as a model.

**Size.** XL. Not proposed again.

**Not for us.** The quota and scrap economy. Death and recovering bodies. Monsters.

---

## Ranked borrowings

For Blackout and the next missions, ranked by what each does for the open findings (idle
waits, the third player, the first run) against its size.

| # | Borrowing | From | Backlog | Size |
| --- | --- | --- | --- | --- |
| 1 | **Needy valve:** while a station is open, a gauge nearby wakes every 40–60 s and needs one hand; missed, an alarm | Keep Talking (needy), Lovers (too few hands) | T-4, M-1 | M |
| 2 | **Parts out of a solve:** a solved station puts out a part that another station needs; in free order the crew splits into a pair and a runner | Overcooked 2 (chains), Among Us (two-part tasks) | G-3 (new) | M |
| 3 | **Leitstand with door codes:** a terminal shows drones and doors only at its keyboard; the runner reads a door's code, the operator opens it for five seconds | Lethal Company (terminal) | I-1 | L |
| 4 | **A course without a clock:** a crew's first run without a clock, then the hall, the tutorial and Blackout, one idea added per step | Escape Academy (pacing), Escape Simulator (optional timer) | N-6 | S |
| 5 | **Card reader with feel:** Pult B's token says which card, the card passes the reader within a printed speed window | Among Us (Swipe Card, O2) | I-1 | M |
| 6 | **Lagetafel:** a board in the world where captures are pinned for everyone standing at it | Phasmophobia (journal) | G-4 (new) | M |
| 7 | **Role swap within a station:** the second stage takes inputs only from whoever read in the first | We Were Here Together | G-5 (new) | S |
| 8 | **Relay with a failing control:** one control per emergency fails, and its instruction passes to the next; the drill names the rule | Spaceteam (panels that shift) | M-1 | S |
| 9 | **Firewall in two halves moving at once:** packets flow at A while B edits the rules | Operation: Tango (agent and hacker) | I-2 | L |
| 10 | **Laborkennung appendix:** one printed page explaining serial, lamps and cells, referenced by every rule that reads them | Keep Talking (manual appendices) | G-6 (new) | S |

Why this order:

- **1 and 2 answer what the audit and M-1 found.** Ben waits 7.7 s at the reactor and Anna
  5 s at the Notstrom door, and a third player has too little to do. Both fit the module and
  map contracts without changing a station's rules.
- **3 and 5 grow out of I-1.** I-1 has since taken its own shape, the Zugangskontrolle (a
  login with two factors and the run's list, `puzzles/access.ts`); the runner's door codes and
  the card reader stay open as stations beside it, and both use what we already have: typing at
  a terminal and items carried by hand.
- **4 is cheap and settles N-6's open question.** Should a first run fail on time? The no-clock
  missions G-2 adds are its tool.
- **6 and 7 deepen the talk** without new content.
- **8 and 10 are small polish**, and 9 is the largest.

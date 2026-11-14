# EscapeLab — art bible

The world is a 1980s research lab seen from above, in three quarters, mostly in the dark.
Three references set the bar: **Among Us** for chunky, readable shapes and a crew you tell
apart by colour at a glance; **Escape Simulator** for rooms dense with believable props;
**Alien: Isolation** for retro instruments — phosphor screens, tungsten light, gauges and
warning stripes. Every rule below is enforced by the code; where a test checks it, it says so.

## The plant

The lab is a wing of the **Forschungsanlage Kaltenbrunn**, a research site of the early
1980s with a reactor of its own, centrifuge labs and a server room, run in three shifts —
Frühschicht, Spätschicht, Nachtschicht — from a Leitstelle that talks to the crew on the radio
and, while the power is on, to the whole wing over loudspeakers. Blackout plays in **Trakt C**
on the night shift, at 23:47. The plant is made up; no real site carries its name.

A run opens on a location card in the art's own type, the plant's name over the wing and the
shift with its time (`intro.place`, `intro.time` of the mission; client
`world/intro/IntroOverlay.tsx` `PLANT`); a mission without an intro shows the plant over its own
name. Then the opening shows the world as a film: two black bars, 12 % of the picture each,
thinner on a phone, the subtitles in the lower one; the HUD fades meanwhile and comes back where
it was. Its title lands in the warm white of the lit lab with a faint red glow, letterspaced, the
mission's name in capitals. Under reduced motion nothing slides and nothing pans: the bars and
the title fade.

## Palette (`packages/client/src/world/palette.ts`)

Every colour the world draws with is a token of the palette or mixed from tokens
(`mix`, `lift` toward white, `sink` toward black, `night` for the dark). No other module of
`world/` writes a colour literal; `test/palette.test.ts` reads every string of every
drawing module with the TypeScript scanner and fails on `#…`, `rgb(…)` or `hsl(…)`.

| Token | Value | Use |
| --- | --- | --- |
| `CONCRETE` | 96 91 82 | floors: corridor concrete, the base of every slab |
| `WALL_FACE` | 70 72 72 | a wall's face, the side toward the camera, painted per room |
| `WALL_CROWN` | 104 101 94 | a wall's top: lighter than its face, never brighter than a floor |
| `STEEL` | 92 104 116 | cabinets, desks, racks, frames, pipes |
| `BRASS` | 181 149 82 | the Laborkennung, keys, padlocks |
| `AMBER` | 251 191 36 | warning: doors, stripes, the beacon, a prop calling for attention |
| `PHOSPHOR` | 110 255 150 | screens and their text |
| `EMERGENCY` | 255 52 52 | emergency lamps, the escape's siren red |
| `SERVER_BLUE` | 72 160 255 | rack LEDs, the server room's cold light |
| `REACTOR` | 255 122 28 | the core |
| `TUNGSTEN` | 255 214 168 | the ceiling lights with the power on |

Materials besides: `WOOD`, `LINO`, `PAPER`, `GLASS`. The game's signal colours keep their
meaning everywhere: `TEAL` what is up and who you are, `READ_BLUE` reading, `DONE_GREEN` done
and the way out, `ALARM` red. Neutrals: `INK` (every outline), `VOID`, `NIGHT` (the darkness),
`LABEL`. The crew's eight colours stay as the server hands them out (`CREW`). A tube's red and
blue guns alone, `GUN_RED` and `GUN_BLUE`, paint nothing: they are what an alarm's knock cuts
the picture down to (Camera).

In the dark a material is drawn in `night(colour)`: darker and colder — the flashlight finds
it, the ceiling lights show it warm. A wall's face takes the light of the room it looks into.

## Light rule

Key light from the top left, flat shading: a lit lip on top and left edges, a darker line on
bottom and right edges. Every standing prop casts a soft foot shadow, 25 % black in its middle
(`FOOT_SHADOW`). A wall with floor south of it shows a crown (38 % of its tile) and a face, and
throws a soft shadow a tile long onto the floor below (`DROP_SHADOW` 40 % at the wall's foot).

## Line rule

A 2 px dark outline at 64 px per tile around every prop and every crown edge that meets
floor (`OUTLINE` = 2/64 tile), scaling with the zoom. Inside, two tones: a lighter top face,
a darker front.

## Scale rule

Props fit the tile grid: one tile each. The tall ones — shelves, racks, a locker, the filing
cabinet, a pillar standing free — rise over the tile behind them (`RISE`, half a tile; the
cabinet 0.3), and a crew member behind one shows only above it (Depth); everything else stands
within its tile, so a crew member in front always overlaps it. Labels sit under props in the
world's text, as they always have. Wall props hang on the face of a wall tile, never on a floor
tile. A note of the last crew (`map.notes`, art.ts `drawPinnedNote`) is a sheet of `PAPER` in
blue ballpoint with a dog-ear: pinned with a red pin to the face that looks into the floor it is
read from, or lying turned on the floor; until somebody reads it, a faint `READ_BLUE` glow calls.

## Motion rule

Ambient motion is slow and small: fans turning, screens scrolling, LEDs blinking, the core
pulsing, steam rising, dust drifting in the light cones, the emergency lamps' beacons sweeping
once in 3 s after the blackout, a drone's rotors blurring and its nav lights blinking once a
second. It steps at most 15 times a second (`ANIM_HZ`), and nothing moves faster than a walking
crew member (4.2 tiles/s) except the sparks of a short and a beacon's lobe at its far end. Under
reduced motion nothing turns, scrolls or flies — a beacon sweeps once in 6 s, steadily, its tube
not trembling; the drones' rotors stand and their nav lights burn steadily; a figure keeps only
its poses (Figure animation) and a solve lands no hit-stop — and lights still blink.
`test/particles.test.ts` checks the pool's cap of 120 particles, each kind's share, the 15 Hz
step and the speeds.

## Rooms with identity

A label's `kind` dresses its room; the floor no door cuts off goes to the label nearest by
walking. The dressing grows from the mission's id (`dress.ts`, `seedOf`), so a room looks the
same every run.

| Kind | Floor | Walls' faces | Furniture (`map.decor`) |
| --- | --- | --- | --- |
| archive | planks, a dropped sheet | wood panelling, folder shelves, clock | shelf, cart |
| corridor | concrete, worn along its length | pipes, cable trays, extinguisher, posters | — |
| machine | dark oily concrete, puddles, drains | gauges, steam vents, pipes | generator, pipes, barrel |
| server | raised floor, perforated panels | blue-grey, rack fronts with LEDs, fans | rack |
| lab | linoleum checker, tape marks | white tiles, whiteboards, screens | bench, hood |
| reactor | tread plate, hazard stripes round the core | stripes, gauges, screens | core, cables, desk |
| control | slate linoleum, cable covers | screens, gauges, clock | desk |

Every face beside a door gets warning stripes. Furniture is solid for every step — the
server's `stepAllowed`, the reach proofs, the client's walk, the harness's route — and is
validated like a wall: never on a spawn, a console, a plate, a door, a source's spot, an item
or its drop-off, the sign, the exit, a lamp, an emergency's panel, a drone's waypoint or its
flight path. Sight passes over it; on the WebGL light layer it throws a shadow.

## Blackout's lab

Trakt C's night-shift wing is a lab of 36 × 22 tiles (`missions/blackout.json`, since N-xxl; 27 ×
17 before), its rooms a ring: the Archiv opens on the Flur, the Flur's bulkhead on the
Serverraum, the Serverraum on the Ost-Flur, the Ost-Flur's bulkhead on the Reaktor, the Reaktor's
door on the Süd-Flur, the Süd-Flur on the Labor, the Labor's door on the Maschinenraum and the
Maschinenraum's plate door on the Flur again — closed into a loop once the reactor's two doors
open after the fifth station. Every wall is a tile thick; the corner north of the Ost-Flur is
void. The main ways open two tiles wide; a door that is a device stays one tile, and so does the
gap between the Serverraum's pillars — six one-tile openings where the smaller lab had fifteen.

| Room | Kind | Floor, tiles | Furniture | Ways out |
| --- | --- | --- | --- | --- |
| Archiv | archive | 9 × 7 | nine shelves, a cart | two tiles wide south to the Flur; the hatch in its north-west corner |
| Flur | corridor | 29 × 4, two buttresses on its south wall | — | the Archiv's opening, the Serverschott, the Maschinenraum's plate door |
| Serverraum | server | 11 × 7, two pillars | twelve racks in four rows | the Serverschott; two tiles wide east to the Ost-Flur |
| Ost-Flur | corridor | 12 × 4 east, then 4 × 5 south; a buttress | — | the Serverraum's opening, the Reaktorschott |
| Reaktor | reactor | 9 × 7 | the core, four cables, five desks | the Reaktorschott; the Reaktortür west |
| Süd-Flur | corridor | 4 × 7, a buttress | — | the Reaktortür; two tiles wide west to the Labor |
| Labor | lab | 9 × 7, a pillar | a hood, ten benches | the Süd-Flur's opening; the Labortür west |
| Maschinenraum | machine | 9 × 7, a pillar | four pipes, four generators, two barrels | the Labortür; the plate door north to the Flur |

Every room stands at least eight pieces of its own kind of furniture (core test missionMaps).
A corridor has no furniture: its props hang on the faces that look into it — pipes, cable trays,
posters, an extinguisher — one at least in every four tiles along it, both ways (dress.test.ts).
A corridor running east–west shows the faces of its north wall; one running north–south shows
only its walls' crowns, so the Ost-Flur and the Süd-Flur each have a buttress, a wall tile
standing a tile out from the side wall, its face carrying what the dressing hangs there. The
Flur's two buttresses stand on its south wall, where they show no face: they keep its two ends
out of each other's sight, as the starts there have to be.

The minimap draws the larger lab about as wide as the smaller, its tiles smaller: 180 × 110 CSS
px at 1440 × 820 and density 1, a tile 5 px (189 × 119 and 7 before), and 126 × 77 on a phone
held sideways, a tile 3.5 px (135 × 85 and 5) — taller than the 56 px it stands at least there
(A phone held sideways).

## Light with colour

`sources.ts` lists every coloured light of a frame (`sourcesOf`): the emergency lamps, the
screens' phosphor green and the racks' blue (faint, in the dark too), the core's pulsing
orange, the beacon turning over the hatch through the escape. Both ways of the light draw from
this one list. A light shows where the world shows its spot, as objects do. The WebGL light
layer lights every source with soft shadows (walls, shut doors, furniture) and blooms the
strong ones; what glows and moves — screen text, LEDs, the beacon's beams, particles — is drawn
under its light map and shaded like everything else. The Canvas pass, its fallback, draws the
emergency lamps itself and lays the other sources' glow, the glowing marks and the particles
over its darkness.

## Figures (`figure.ts`, art.ts `drawScientist`)

A crew member walks a real cycle: the legs swing in boots that lift as they come forward and
plant as they go back, the back leg half a cycle behind the front; the body rides one art
pixel (`WALK_BOB` = 1/64 tile) higher while the legs pass each other than at full stride, and
leans `LEAN` into the way it walks — only as far as that way runs across the picture, so a
figure walking up or down the screen stands straight. The cycle runs on the ground covered,
one cycle every `GAIT_CYCLE` (1.75 tiles): a sprint swings the legs 1.3 times as fast, and a
partner's legs keep pace with how far their figure moves on this screen, never skating. Idle,
look, carry, flinch, celebrate and slump stand as before. Under every figure lies a soft blob of
shadow in the light it stands in (`FIGURE_SHADOWS`): 50 % dark and thrown a little to the
bottom right under the ceiling lights, away from their key light; 18 % and right under the feet
in the dark, where the only light is the lamp in its own hands; 35 % where no light is said (the
lobby). Your flashlight shines from your hands (`handLamp`), 0.16 tile ahead of you across the
picture, and sways `SWAY` (2°) either way with the step; under reduced motion it holds still.
What its light sees — where walls and shut doors cut it — is taken from where you stand
(frameLight.ts `standingLamp`): pacing over the same ground finds that sight kept from before
(light.ts `sightCache`), however the lamp in your hands sways. Taken from the swaying lamp, the
sight was worked out anew on every frame of a walk: 0.7 to 0.9 ms a frame more than before,
pacing by the hatch in the escape on a main thread slowed four times (bench, below), where CI's
runner has the least to spare. Cost now: within the bench's noise of the frames before the
walk cycle, walking or standing.

## Light and shadow on the light layer (`gl/`)

Every light with a size throws soft shadows on the layer — the walls, shut doors and furniture
stopping it, four samples across the light — and so do the lamps the crew carries as they move:
the light pass marches every pixel's lines to every light each frame, a moving lamp no dearer
than a still one. Each emergency lamp's tube wavers (`trembleAt`) by 2 to 4 % of its strength,
its own depth and out of step with every other, stepped at most 12 times a second and seeded by
where it hangs. The reactor's core pulses slowly, 2.4 s a beat, on both ways of the light. The
Canvas pass keeps its look: its lamps burn as they did. Cost: none on the Canvas pass; on the
light layer a few more numbers in the lights' uniforms, within the bench's noise.

## Atmosphere (`particles.ts`, render/atmosphere.ts)

The air of the lab is one pool of at most 120 particles, each kind within its share — dust 44,
steam 28, smoke 18, falling dust 30, the sparks always finding room — and none ever made twice:
one that dies waits in the pool to be born again. Dust drifts in the light cones — your beam, a
drone's eye, a lit room's light through a door standing open — and shows only inside a cone
and on a tile its lamp can see, so the dark between the beams stays dark. Steam rises from the
machine room's vents and puffs, now and then three at a time, from the reactor's core. The fuse
box throws its sparks on a short as before. For 10 s after the blackout's thunk a wisp of grey
smoke rises from the main breaker, the first station that is a lever. Dust falls off the
hatch's rim while it grinds open. Screens, terminals and station monitors flicker as tubes do
(`crtFlicker`: between 92 % and full, now and then a dip to 82 %, a light blinking that reduced
motion keeps) and roll a faint bar down every 3.4 s (`rollAt`, none under reduced motion).
Cost: switched off one at a time, each lies within the bench's noise (±0.3 ms a frame on the
main thread slowed four times, below), against the budget of 1 ms; the whole package together
in Cost.

## Props with life (`anim.ts`, wallProps.ts, decor.ts, render/props.ts)

A rack's LEDs blink each in one of five patterns — steady, a heartbeat's double blink, the
flutter of disk activity, a slow blink, a light chasing along its row — chosen by the LED alone
and read off the clock alone: nothing on a rack tells how a service is doing. Every machine room
gets a ceiling fan over its floor tile nearest its middle that nothing stands on (dress.ts
`fans`); its blades hang a room's height over the floor, over whoever walks under them, turn
while the room has its power — spinning up as its lights come on, coasting to a stop without
them (`spinFan`) — and throw a sweeping shadow under the ceiling lights; a sheet of paper lies
under it, its corner lifting in the draught as the fan turns (`paperFlutter`). The cables
hanging loose from a corridor's cable trays swing for 3 s after the blackout's thunk, dying away
(`cableSwing`). A lab's screens and every other bench show an oscilloscope's trace
(`scopeTrace`) instead of text. Under reduced motion the fan stands still, the paper lies flat
and the cables hang plumb. Cost: switched off one at a time — the fan with its shadow and
sheet, the trays' cables, the wall screens, the furniture's screens and scopes, the stations'
tubes — each within the bench's noise (Atmosphere); the Labor lit, where most of them show
together, costs 0.45 ms a frame more on the slowed main thread (Cost).

## Beacons (`beacon.ts`, render/beacons.ts)

Once the lights fail, each red emergency lamp — the one over the main switch, those by the
corridor doors — turns into a rotating beacon, as Alien: Isolation's are: two lobes opposite
each other sweep a full turn in 3 s (`BEACON_TURN_MS`), each lamp out of step with the rest by
where it hangs, out to 2.7 tiles (`LOBE_REACH`) and 0.3 rad either way of its axis, the floor lit
red in their path; a soft red bloom sits at the lens. Under reduced motion a beacon sweeps once
in 6 s and its tube does not tremble. On the light layer each lobe is a beam light with soft
edges that walls stop; on the Canvas pass each lobe is a sprite baked for each of 96 steps of a
turn at the frame's zoom and copied at whole pixels, kept to the box of tiles its lamp sees, its
lobes facing into a wall left out. The lobes only add their red: cutting them out of the dark as
well cost the software canvas 1.3 ms a frame at 4× and was left out. Cost, paced bench at 4×,
the dark Flur with three lamps: +0.36 ms to draw them, +0.22 for the lamps' wider sight; the GPU
path +0.22 ms at 1×. Capture `beacon-sweep-a.png` and `-b.png` a second apart, the lobe turned as
the probe's clock says (tools/sweep.mjs).

## Depth (`depth.ts`, render/occluders.ts)

As in Enter the Gungeon, depth is the y-sort a painter needs: a figure walking behind a shelf,
a rack, a locker, the cabinet or a server pillar shows only its upper part, the tall thing drawn
again over it, cut to the part where it hides it — only where somebody stands behind one, so
nothing costs a frame where nobody does. The name tags go over everything, the drones fly over
everything, their shadows and the figures' stay on the floor; walking and sight are unchanged.
Cost at 4× against the beacons: two figures behind the Archiv's shelves +0.28 ms, behind the
server racks in the dark +0.30, the escape by the hatch +0.21, the dark Flur +0.11. Capture
`depth-behind-shelf.png`, the probe naming the shelf that hides the host.

## Colour grade (`grade.ts`, render/grade.ts)

One grade a phase, as Hotline Miami keys a level and Alien: Isolation turns cold when the power
fails, turning over 1.5 s from one to the next: the lab with its power a faint warm mid-tone, the
blackout a cool blue-grey that lifts the shadows and dims the light, the escape none — its red
stays its own — a run won near white. A grade is a wash laid once a frame over the picture, the
lab's own light and the darkness, under every light added after, so that the lamps' red keeps
its colour; the minimap, the red edge (Camera) and the alarm's knock lie over it. Canvas: one
translucent fill. The light layer folds the same wash into its light map, a two-point table a
channel (`uGrade`). Cut down: a multiply or overlay fill, a true grade, costs the software canvas
2.2 ms a frame at 4×. Cost at 4× against depth: the dark Flur +0.33 ms, the lab lit +0.28, the
Labor +0.24, the escape none; the GPU path +0.12 ms at 1×. Every still of the world changes by
its phase's grade; those are the new baselines. Capture `grade-blackout.png`, the probe naming
the blackout's grade.

## The lamp's beam (`beam.ts`, render/beam.ts)

A flashlight shows what it reaches, as Darkwood's does: its beam fades out over 0.14 rad either
way of its half-angle instead of ending at a line, its core (0.2 rad either way) clears all of
the dark and its flanks 80 % of it, and your own core lays a faint warm light (16 % of a warm
tungsten) along its first 80 % — on the Canvas pass into the darkness after the cut, on the
light layer as a narrower second beam with a tint. A small glint burns at each lens; on lino and
steel floors (the lab, the server room, the reactor, the control room) a faint streak runs along
the beam as far as its floor lies in sight; dust is born denser near a cone's axis. The partner's
lamp has its beam too, laid from their hands, cut wherever it falls and counted as seen light,
their figure shown or not. On the Canvas pass the cut is a sprite baked per degree of a turn at
half the picture's resolution and laid unsmoothed: the software canvas copies a sprite scaled so
as fast as one at its size, where smoothing costs a third more. Cut down: the partner's beam
reaches 5 tiles, not 7.5, and their glow 1.6 tiles, not 2.8 — a full-length beam cost 0.9 ms a
frame at 4×. Cost at 4× against the grade: the dark Flur +0.60 ms (the warm core +0.24, the
partner's flashlight +0.45), both pacing +0.51, the lit Labor +0.93 (your beam +0.38 there); the
glints and streaks 0.05 ms; the GPU path +0.20 ms at 1×. Capture `beam-core.png`: the light
across the beam, read off the shot, brighter on its axis than on either flank (tools/beamcheck.mjs).

## Drones (`droneLights.ts`, hazards.ts, render/drones.ts)

A drone carries two nav lights, red to port and green to starboard, blinking at 1 Hz half a beat
apart, each drone in its own step; a blur of rotors turns round its body; its shadow on the floor
is soft. Its searchlight keeps the cone players read and dodge — the same geometry and edge,
falling off from a brighter start at the lens — and lays a hotspot on the floor 55 % of its range
ahead where it looks, sweeping as it turns, amber-white, red while it is alerted, as the light
layer lights an alerted eye. The hotspot and the nav lights' glow go over the light on both
paths. Under reduced motion the nav lights burn steadily and the rotors stand. Cut down: a cone
of three gradient stops cost 0.27 ms in the actors pass; two are filled a third faster. Cost at 4×
against the beam: a drone patrolling the dark Flur +0.11 ms, the escape's drone +0.25; the GPU
path +0.01 ms at 1×. Capture `drone-close.png`, its hotspot ahead and its nav lights read 20
times blinking, never both at once.

## Figure animation (`figure.ts`, hitStop.ts)

The arms swing against each other as a figure walks; a figure coming to face the other side of
the picture turns in three steps over 150 ms through the side toward the camera instead of
flipping; at a console both hands go up on its panel, tapping; reading a source it holds the
sheet before its chest, its head bowed over it. You are posed as your view tells it — a console's
presence, your pages open at a source — the rest as their place says once they have stood still
300 ms (presence.ts). A solve, as Enter the Gungeon lands a hit, holds the camera, the world's
clocks and the crew for 60 ms and lays a white flash over the world, 16 % fading out over 180 ms.
Under reduced motion only the poses remain. Cost at 4× against the drones: both pacing +0.05 ms,
the dark Flur +0.27, the lab lit +0.17; the GPU path +0.16 ms at 1×. Captures `pose-console.png`
and `pose-reading.png`, each posed so by the probe.

## Clutter and decals (`decals.ts`, decalArt.ts)

The floors tell what a room is for, as Half-Life's do: four or five kinds of marks a room kind —
coffee rings and papers where people sit, spills in the lab, tyre marks, oil and screws in the
machine room, cable ties in the server room, scorch round a fuse box the crew knows of and round
the reactor — on one free floor tile in nine, placed by the mission's seed like the rest of the
dressing. The corridors carry a building's markings: a yellow lane down the middle of their main
axis and, every six tiles of it, an arrow pointing the way to the exit. Nothing lies on furniture,
a door, a plate, the exit or a lamp; a mark may lie under a station or a source, which is drawn
over it — where those stand, a player's view tells only once they are found, and the dressing is
the same on every screen. Nothing is found, named, chimed at or walked into: the marks are a
layer of the client's dressing, which the mission and its validation never see, faint and flat
in the light of their tile, baked with the floor: at 4× against the figures' animation
the lab lit +0.12 ms, the dark Flur +0.07, the Labor +0.05, within the bench's noise — no work a
frame. Capture `decals-lab.png`, the Labor's floor with two marks or more and none in anybody's
way.

## Graphics 2's references

What each game does, and what the lab took from it:

- **Alien: Isolation** lights its world with the world's own lights — beacons, lamps, screens —
  and turns its corridors cold when the power fails: the rotating beacons, the blackout's cool
  grade, the flashlight's warm core.
- **Darkwood** shows the world as far as the lamp reveals it, and keeps the rest as memory: the
  beam's core and soft edge, the partner's beam as seen light.
- **Among Us** makes its figures read at a glance — bold shapes, names, poses at their tasks:
  names over every tall thing, the console and reading poses, the arm swing.
- **Enter the Gungeon** sorts its depth by height on the screen and lands a hit with a stop and a
  flash: figures behind tall furniture, the solve's hit-stop and flash.
- **Hotline Miami** keys each level and phase in a colour of its own, its impacts in frames:
  the grade per phase, the flash.
- **Dead Cells** keeps a hierarchy of readability — what matters glows, the backdrop recedes:
  glows over the grade, marks on the floor faint and flat so that none reads as a find.
- **Half-Life** tells a place by what lies about in it and what is painted on it: the marks by
  room kind, the corridors' lanes and arrows.

## Framing (world/viewport.ts `tileCss`, insets.ts)

The frame is a decision in CSS pixels, not an accident of the screen: every screen shows the
same world whatever its density. A tile stands the world canvas's CSS height over 11.5 where the
canvas stands 600 px or taller — a laptop's or a desktop's — and over 9 below that, a phone held
sideways, whose figure has to stay readable; never under 28 px, so the figure keeps 24, nor over
96 on a tall monitor. The canvas draws it at its own density (Crispness).

Below the objective bar the frame keeps a band that holds a drone's reach twice from top to
bottom with a mouse and keys — 9 tiles for Blackout's 4.5-tile cone at „Normal": the avatar in
its middle sees a cone's end before the cone sees it — and one and a half times (6.75) on a
touch screen, whose HUD a phone held sideways folds into one row of 44 px (A phone held
sideways). Where the tile count would leave the band shorter, the band wins and the tiles shrink
until it holds: a 1280 × 720 window shows 11.6 tiles of height, 9 of them below the bar. The bar
counts with a line on the air — its steady row, the clock and the goal's title, padding and all,
and the row a radio line takes, measured on a banner set into the bar unseen and taken out in
the same moment — so that a line coming or going never moves the zoom; on the phone's row a
line stands in the goal's place and adds nothing. What comes and goes under the goal's title, a
station's missing part or the escape's checklist, does not count either: with a line on the air
over the escape's checklist a 1280 × 720 window keeps about 8.8 tiles below the bar. Where the
canvas is too small for both, the 28-px floor wins over the band. „Hart" stretches the drones'
cone to 5.2 tiles and the band holds 1.7 of them; the frame stays the same at every difficulty.

The camera follows as it did — a little ahead of a walker, 0.6 tiles eased in over τ 0.1 s, the view
easing after the avatar over τ 0.17 s, held at the lab's edge. The lab, 36 tiles wide since N-xxl,
is 10 to 15 tiles wider than the view on every screen, which shows 21 to 26: the camera stands held
at a side wall on 63 % of Blackout's floor tiles at 1440 × 820, 69 % at 1280 × 720 and 57 % on a
phone held sideways (69 % before its HUD folded into a row, N-phone), and follows sideways on the
rest. The lab of 27 tiles before it held the camera on 88 % and 97 %, leaving the view 2.7 and 1.3
tiles to travel from wall to wall where it has 11.7 and 10.3 now, 14.5 on the phone. Up and down it
follows on 61 % of the floor's tiles on a laptop and 76 % on the phone (43 % and 71 % on the smaller
lab, 79 % before N-phone). Walking the Flur's 28 tiles east, a player has the camera moving with
them on 42 % of the frames, 11.7 tiles in all, its lead 0.6 tiles ahead of them throughout; the
smaller lab's 20 tiles of Flur moved it on 14 % of them, 2.7 tiles. A canvas wider than 3.1 : 1
(2.35 : 1 for the smaller lab) shows the lab whole across with the dark beyond its walls at the
sides: the zoom that kept the lab over the whole canvas is left to the opening's shot. Measured in
Blackout (the audit's camera script, copied to `scratchpad/camera/`, the phones' rows again in
`scratchpad/phone/cam/`; the canvas's box inside its 1-px border; with a line on the air in
brackets):

| Window | Density | Canvas | CSS px a tile | Tiles across × down | Below the bar | Figure |
| --- | --- | --- | --- | --- | --- | --- |
| 1440 × 820 | 1 and 2 | 1414 × 669 | 58.2 | 24.3 × 11.5 | 10.1 (9.3) | 49.4 px |
| 1280 × 720 | 1 and 2 | 1254 × 569 | 48.9 | 25.7 × 11.6 | 10.0 (9.0) | 41.5 px |
| phone held sideways, 844 × 390 | 3, drawn at 2 | 826 × 345 | 38.4 | 21.5 × 9.0 | 7.9 (7.9) | 32.7 px |
| large phone, 932 × 430 | 3, drawn at 2 | 914 × 385 | 42.9 | 21.4 × 9.0 | 8.0 (8.0) | 36.4 px |

Before, the same screens showed 22.2 × 10.5 tiles at 1440 × 820 and density 1 but the lab's whole
27-tile width × 12.8 at density 2, 23.1 × 10.5 and 27 × 12.3 at 1280 × 720, and 27 × 9.4 on the
phone; the phone's HUD folded into a row (N-phone) gave its canvas 56 px of height, from 289 px
at 32.1 a tile, 25.7 × 9.0 tiles with 7.8 (6.9) below the bar and a figure of 27.3 px. A
desktop's 1920 × 1080 window, its canvas some 1894 × 929, comes out by the rule at 80.8 px a
tile, 23.4 × 11.5 tiles.

## Camera (render/aberration.ts, vignette.ts)

The world keeps its frame and scale while a station's panel lies over it; the panel fades in on
its own (Interface). A zoom behind a panel that stands still reads as the map twitching. The
hatch grinds open with dust falling off its rim (Atmosphere).
An alarm knocks the picture's colours apart for 150 ms: the finished frame's red pushed one way
and its blue the other, 4 CSS px at first and closing in as the knock fades — two offset passes
of the finished frame, each cut down to one colour and added over the picture's two sides, a
twelfth of its width each, where a tube's convergence is worst and the eye looks least; the
middle, where the crew stands, stays sharp, and the alarm's red strobe hides the light the
passes add. The red edge of the last minute breathes with the pressure: 1.5 s a breath as the
minute begins, 0.95 s in its last 20 s, 0.8 s and deeper through the escape. Under reduced motion
there is no knock and the edge holds still. Cost: the knock 0.9 ms a frame for its 150 ms on the
software Canvas path and nothing between alarms — kept to the sides for that: across the whole
picture, its own colours faded, it cost 3.4 ms; the red edge nothing, its opacity the
compositor's.

## Crispness (render/backing.ts)

The world's canvas has as many device pixels as its box has CSS pixels times the screen's
density, at most 2, rounded to whole pixels: a laptop at 125 % or a browser zoomed draws the
same size frame after frame instead of sizing — and clearing — the canvas on every one.
Everything the passes draw is in device pixels: the sprites are baked per device pixels a tile
(atlas.ts, two levels kept), the bakes and glows on the frame's pixel grid within their bounds
(bakes.ts, radial.ts), the world's text at its CSS size times the density. `dpr2.png` checks a
page at twice the density.
The frame itself is set in CSS pixels (Framing), so the density decides only how finely the same
world is drawn: at 1440 × 820 a tile stands 58.2 device pixels at density 1 and 116.3 at 2, four
times the pixels for the same 24.3 × 11.5 tiles — where density 2 used to draw the lab's whole
27-tile width at 104.7 a tile and density 1 22.2 tiles at 63.7. The walkthrough draws its host's
window at density 2 as well and shoots it at its own pixels (`camera-dpr2.png`, and in Blackout
`cold-open-dpr2.png`, `panel-dpr2.png`, `escape-dpr2.png`, 2880 px wide): every world capture of
the walkthrough changed with the tile when the frame was fixed, so main's captures from before
are no baseline for the world's pixels any more; the join screen, the Bestenliste, the editor and
the lobby, which draw no world, stayed pixel for pixel the same (Cost).

## Interface (styles/interaction.css)

A panel over the world — a station's device, a source's pages, a note — grows from 0.98 to its
size as it fades in, over 150 ms; a sheet put down slides out as before, and a station's device
goes as it came, shrinking back to 0.98 as it fades out over the same 150 ms, the dim behind it
lifting — the game screen keeps it up that long (screens/Game.tsx, PutDown.tsx `useLeaving`),
inert, its keys and presses reaching nothing. The world behind it keeps its frame (Camera). A
plain button gives a pixel as it is pressed and darkens a little; a device's keys, levers and
wires keep their own press. Keyboard focus shows as a 2 px teal ring, never for a click; hover
affordances belong to a mouse. The type keeps its hierarchy: titles in the system sans, bold
(the page's 27 px, the station's line 20 px); labels in the mono, upper case and spaced 2 px
(13 px heads, 12 px panel labels and marks); figures in the mono with tabular digits (the
clock 30 px, 36 px at the end); running text in the system sans at 15 to 16 px; the world's own
text in the mono, bold, with a dark halo (sizes under Type and targets). Under
reduced motion every move is a cut or a cross-fade: a panel only fades in, a device stepped back
from goes at once, a press only darkens.

## The notepad (screens/Notepad.tsx, styles/notepad.css)

The notepad is the one thing on screen that belongs to the player, so it looks like a pad a
person on the night shift keeps, not like the lab's machines: cream paper (#fbf6e6), faint blue
rules a writing line apart (28 px at text size 1) and a red double margin line down its left,
glued to a board at its head. The player's own writing stands in blue-black pen (#22305a), in a
hand: **Kalam** by the Indian Type Foundry (2014), under the **SIL Open Font License 1.1**, which
reserves no font name. Its Latin subset — Latin-1 and the general punctuation, as Google Fonts
cuts it, enough for every German text and „ “ – — · … — ships with the game as
`client/public/fonts/kalam-latin.woff2` (14 kB), its licence beside it as `kalam-OFL.txt`; the
page preloads it (index.html) and the service worker keeps it, so the pad never opens in a
stand-in face and nothing comes from a CDN. The pen's ink sinks a little into the paper (a
0.6 px shadow of itself). What was taken down at a source is copied in pencil (#3a3c41, every
second capture a softer, warmer #4a4038): a table in the system's monospace — block letters — on
ruled pencil lines 24 px apart, its columns aligned and never wrapped; running text, rules and
notes, in the same hand as the pen's; each capture's head in pen, underlined as a heading on a
pad is, „aktualisiert" beside it in red pencil (#a3352b). Nothing on the pad moves, so reduced
motion has nothing to change.

Readable first: the writing 18 px, the hand's running text and heads 17 px, the pencil's tables
15 px, the red pencil 15 px, all at text size 1 and all scaled by it; against the paper the pen
stands at 11.9:1, the pencils at 10.2 and 9.3:1, the red pencil at 6.3:1 and the placeholder at
5.6:1 (`client/test/notepadLook.test.ts` reads them off the stylesheet). A table stays aligned
up to 38 characters of the pencil's — the terminal's table runs 36, the Signalkette's legend 37,
its five columns one blank apart — which the pad holds whole on a phone 420 px wide (its margin
moved in to 24 px there); a wider one is set as running text (gameplay.md). The pad in the
world's corner is 390 px wide at text size 1 and grows with it; the strip beside a page keeps its
width (`--note-strip`), so in a narrow window at the large text size a table may scroll sideways
in its own box.
notepad-captured.png and notepad-captured-phone.png show the legend and the Laborkennung in it.

## The menu (screens/Join.tsx, MainMenu.tsx, MenuPanels.tsx, world/menu/, styles/menu.css)

The start screen is the game's main menu over a living scene from the world, as Half-Life 2's and
Firewatch's are. Behind it the lab of the mission picked — lit, the power on, as the opening shows
it before the blackout — drifts along the opening's shot, from where the shot starts to the crew's
spawn and back in 30 s, slowing at both ends, the drones parked on their first waypoints and nobody
in it; a mission picked anew comes in over the lab before in 600 ms. A vignette lies over it —
darkest behind the menu, the edges sinking into the dark — and the page's scanlines over all;
nothing blurs what lies behind it. Under reduced motion the scene stands still at the shot's start.

The title, ESCAPELAB, is set in **Michroma** (Vernon Adams, 2011), under the **SIL Open Font License
1.1**, which reserves no font name: its Latin subset as Google Fonts cuts it ships with the game as
`client/public/fonts/michroma-latin.woff2` (12 kB), its licence beside it as `michroma-OFL.txt`, and
the page preloads it; Eurostile, Microgramma and the system's sans stand in where it cannot load. It
stands in the phosphor's white with a green glow and comes on as a phosphor screen does, once a page
load (intro.css `phosphor-title`); under it one line of the world, in the mono and spaced:
„Forschungsanlage Kaltenbrunn · Zutritt nur mit Dienstausweis". The menu stands one item under the
next in the title's face, upper case: Einsatz starten, Beitreten, Offene Runden, Handbuch,
Bestenliste, Editor, Einstellungen. The item lit — moved to by the arrows, a controller's D-pad or a
click — is the focus itself: a teal bar on its left, a teal light behind it, its label a step to the
right; the ring of every other control (Interface) would only box it in, so it draws none. The
pointer only glows the item it is over and moves no focus, so that a name being typed keeps it.
Under the items one quiet line says how the game is played: „Am Pult die Maschine, im Buch die
Regeln — gelöst wird nur gemeinsam, per Stimme, ein Gerät je Kopf, Rücken an Rücken." A run that
binds the pass stands first and lit, the items under it dimmed. The profile stands at the top right:
the player's own figure idling in their colour, waving once a new name has settled, the name to
type, the colour's name, and what the account holds (ProfileChip.tsx `accountLine`). Where the
stage leaves it room for three and a half tiles — from about 1100 px across — the same figure stands
large at the stage's right, the hero (The hero).

A panel slides in over the menu from its side in 200 ms, fading up, the menu dimmed under it; under
reduced motion it only fades. Into the lobby and back out, the lab's sliding doors close over the
screen in 170 ms, speeding up as a heavy door does, and open on the next in 210 ms, slowing to a
stop: two steel leaves lit from the top, the ink edge where they meet, the amber light strip and the
two chevrons of the world's doors at the seam (world/art.ts `drawDoor`, screens/DoorWipe.tsx).
Leaving a lobby loads the page anew; the doors stay shut over it until the page loaded opens them,
on the mission picked before — its card marked, its lab behind the menu — which the tab keeps.
Under reduced motion the screens cut. The lobby keeps its layout and stands over the same scene,
drifting on, evenly dimmed.

Upright on a phone, 560 px across or less, the menu takes one column, the profile under the title.
Held sideways, 500 px tall or less, the items fill the left column whole, 44 px each, the title and
the profile stand at the right over the scene, and a panel takes the stage. Every control on the
menu and its panels is a target, 36 px under a pointer and 44 under a finger, and a phone's notch
and home bar stay clear (`test/menuLayout.test.tsx`); the walkthrough measures the guest's phone
upright and sideways at 932 × 430, 844 × 390, 750 × 369 and 667 × 375 (menu-phone.png,
menu-phone-932.png).

**What it costs.** The scene never runs the world's passes for a frame. Once for each size of its
canvas it bakes the lit lab through the game's own passes — the tiles, the objects, the figures'
pass with nobody in it, the glows, the light, on the Canvas path without a WebGL context — into one
canvas the size of the shot's box at the shot's zoom; each frame then copies that canvas whole, at
whole pixels, as far along as the drift has come: the copy without a source rectangle (Cost). It
draws 30 frames a second at most, none while the tab or the canvas is hidden, and under reduced
motion none after its still; a window resized bakes anew once it has held its size for 150 ms. On
the Cost section's bench — this M4, the page's main thread slowed four times, the software Canvas
path of `SHOTS_SOFTWARE_GL`, 1440 × 820 CSS pixels at density 1, Blackout's lab, the scene's way
against every pass run each frame six rounds each, every round starting at the other — medians, ms:

| Way | Work a frame, mean | p95 | Frames p95 |
| --- | --- | --- | --- |
| The bake copied (the menu's) | 1.07 | 1.50 | 16.7 |
| Every pass run each frame | 17.42 | 20.60 | 16.8 |

The bake itself took 259 ms there, slowed four times, once for the size, and 44 to 73 ms in the
walkthrough's browser at its own speed. Every pass run each frame drew at the screen's pace in four
rounds of six and fell to 33.3 ms p95 in the other two. The walkthrough's quiet window on the menu,
the scene drifting, held the screen's pace in Blackout and Systemcheck, with `SHOTS_SOFTWARE_GL` and
without: 16.7 ms p50 and 16.7 to 16.8 p95, the light working out no sight a frame there
(`lightWork`).

## The hero (world/menu/hero.ts, heroArt.ts, heroStage.ts, lamp.ts, lampArt.ts, MenuHero.tsx)

The menu's foreground belongs to the player's own crew figure. It stands large at the stage's
right in front of the drifting lab, as the hero of God of War III's title screen stands before its
world, the menu at the left — not a copy of anything: the lab's night-shift worker in the colour
the profile shows, with the hand lamp. It is drawn with the world's own vector drawing and poses
(art.ts `drawScientist`, figure.ts `figurePose`), facing the menu at three quarters, on a canvas of
its own at the stage's density. It stands on the scene's floor: under its boots a figure's shadow
as a lit room throws it, and round them a soft drop shadow thrown a little to the bottom right,
away from the key light, which a figure's own blob is too small to give at this size. The profile
keeps its small figure: it is the player's badge — the name, the colour, the account — and
stands for the hero where the hero is left out; the hero is the player in the scene. Both wave at
a new name.

**Size.** The hero stands 42 % of the stage's height tall, held to 4 to 6 scene tiles — 0.9 of a
run's tile in a window as tall (viewport.ts `tileCss`), as the drift frames a lab that fills the
window; a lab too small to fill it the drift zooms in on until it covers the window (drift.ts
`sceneShot`), and the hero does not grow with that zoom — and to the room the stage leaves
it — across, from the menu's column (its items, the run's card, the lead line) and from the widest
panel once the hero has stepped half a tile aside for it, to the stage's right edge or the window's
safe area, 12 px clear of each; down, from under the profile to the floor that the stage's padding
or a home bar leaves. Its feet stand five sixths across the stage, in the right third's middle,
moved only as far as that room asks. It stands only where it can stand three and a half tiles tall
at least (hero.ts `FEWEST_TILES`); on a phone held sideways or upright, and wherever the room holds
fewer tiles of it, it is left out and the profile's figure stands for it. Below about 1200 px across
the room beside the widest panel — 760 px from the stage's padding — sets its size, whatever the
window's height, while a tile grows with that height: the taller the window, the wider it has to be
for the hero. It stands from these widths on, from about 1100 px across on a laptop:

| Window's height | Narrowest window it stands in |
| --- | --- |
| 600 | 1038 |
| 720 | 1080 |
| 768 | 1097 |
| 820 | 1115 |
| 900 | 1144 |
| 1080 | 1207 |

How tall it stands, the menu laid out as menu.css lays it out:

| Window | Tiles | CSS px |
| --- | --- | --- |
| 1920 × 1080 | 5.1 | 428 |
| 1440 × 900 | 5.0 | 352 |
| 1440 × 820 | 5.0 | 319 |
| 1366 × 768 | 4.9 | 297 |
| 1280 × 720 | 4.9 | 277 |
| 1180 × 820 | 4.3 | 275 |
| 1100 × 700 | 3.9 | 213 |
| 1080 × 720 | 3.5 | 197 |
| 1024 × 768, 1024 × 640 | left out | |
| Narrower, a phone | left out | |

At 1024 px across the room beside the panel would hold a hero 154 px tall at any height, 2.6 tiles
at 768 px of height and 3.1 at 640: too small to stand for the player beside the profile's figure.
The sizes test measures five windows off the stylesheets, the hero resting and stepped aside,
against the menu's column, the profile, the widest panel and the safe areas, and the widths above
(test/menuHeroSizes.test.ts); the walkthrough measures it in the browser at 1440 × 820, 1280 × 720
and 1100 × 700, with a panel open and shut, and finds it left out at 1024 × 768 (tools/shots.mjs
`checkHero`).

**Poses.** Standing, it breathes, its body riding a pixel over its legs; its glances are a figure's
(Figure animation), every 4 to 7 s, turned less than half as far and in steps of 0.1 rad, its look
kept on the menu's side; a light crosses its visor while the microphone sends, open or held; it
waves once a new name has settled. It holds the lamp before its chest in both hands, the front arm
raised from it for the wave. An item of the menu hovered or given the focus — the one under the
pointer before the one in the focus — turns its head to it, 0.6 of the way from its head to the
item, in the walk cycle's three turn steps of 150 ms; a run's card first in the menu holds its look
while nothing else does. While a panel lies open over the menu it steps half a scene tile toward
the stage's edge over the panel's 200 ms, easing, its legs in their cycle, and back as the panel
goes. As the menu goes for the lobby — „Runde eröffnen", a code, a round joined — it turns away
toward the lab in the same steps while the doors close over it. Under reduced motion it stands in
one still pose: no breath, glance, light or wave, no head turned and no back turned; it steps aside
at once.

**The beam.** The lamp throws its beam onto the lab behind the menu, laid on the scene's canvas
over the drift's copy: a soft cone 0.4 rad across, its light falling off along it to 1.1 times the
hero's height and ending short of the menu's column, so that it never lies over the text; a warm
core along its middle in the lamp's tungsten, as the world's lamp beam has it (The lamp's beam);
and the dust of particles.ts drifting through it, drawn only where it lies in the cone. It sweeps
from the floor before the hero up across the lab and back, one pass in 12 s, slowing at both ends;
where it comes to the line toward the item hovered or in the focus it holds there for a beat, 1 s,
its sweep's clock standing still meanwhile. The lamp in the hero's hands tilts with it in steps of
3°, its lens alight with a small glint at its rim. Under reduced motion the beam stands still,
pointing a little up into the lab, without dust.

**The entrance.** On the first menu of a page the hero walks in from beyond the stage's right edge
over 1.2 s, slowing to a stop, its legs in the walk cycle as far as the ground it covers, and turns
to the menu in the turn's steps as it stops; 350 ms later the cold open's click — its relay click,
quietly, as one of the menu's sounds — and the lamp comes on over the cold open's 300 ms, the beam
with it. A browser lets a page sound only after its first gesture: on a page just opened the lamp
comes on without its click. Back from the lobby, on every later menu of the page and under reduced
motion it stands there from the start, its lamp on. The walkthrough holds the entrance where it
wants it for its still (`window.__heroHold`, read only under `?trace=1`).

**What it costs.** Filling the cone with its gradients every frame cost 1.3 ms a frame on the bench
below with the radial falloff alone, 2.7 ms on a busier machine, and several times that with the
conic edges. The beam is baked instead: once for each reach, a master of the cone, its light across
from a conic gradient and along from a radial one; turned to the beam's angle once a degree,
without smoothing, into a canvas the size of the wedge's own box; and copied each frame 1:1 at
whole pixels. The hero is laid from two layers kept between frames — its legs with its shadows, and
everything over them drawn without the breath, the legs cut out of it — each redrawn only where
what it shows has changed: a glance's step, the lamp's step, the wave, the colour, the size; the
breath only moves the upper layer by whole pixels. The light crossing the visor while the
microphone sends is laid over the two on each frame, alone (art.ts FigureLayer `shimmer`), where
the upper layer would hold it — within that layer only while the front hand waves, which passes
before the visor and draws the layer anew on every frame anyway. Walking in, it is drawn
whole each frame, for 1.2 s once a page. Its loop draws 30 frames a second at most, none while the
tab or its canvas is hidden, and under reduced motion none after its still until something it shows
changes. Left out as the stage is measured, and gone with the menu, the hero lets go of its lamp and
its canvases at once, and the scene lets its beam's go, its lab drifting on through the lobby
without them. On the menu's bench — this M4, the page's main thread slowed four times, the software
Canvas path of `SHOTS_SOFTWARE_GL`, 1440 × 820 CSS pixels at density 1, Blackout's lab drifting, the
scene's frame alone, with the beam, with the hero and with both, six rounds each, every round
starting at another — medians, ms:

| Frame | Work a frame, mean | Over the scene | p95 | Frames p95 |
| --- | --- | --- | --- | --- |
| The scene alone, as main draws it | 1.13 | | 1.60 | 16.8 |
| With the beam | 1.47 | +0.34 | 2.90 | 16.7 |
| With the hero | 1.43 | +0.30 | 3.40 | 16.8 |
| Both, as the menu draws | 1.77 | +0.64 | 4.30 | 16.7 |

Round by round the beam took +0.19 to +0.56 ms, the hero +0.11 to +0.72 and both +0.43 to +0.92.
The hero's p95 is a layer drawn anew — about 20 times in the 6 s, at each of the lamp's steps and
each glance's, some 2 ms of work each there — and its frames held the screen's pace. The
walkthrough's quiet window on the menu, the hero standing and its beam sweeping over the drifting
lab, held the screen's pace in Blackout and Systemcheck, with `SHOTS_SOFTWARE_GL` and without:
16.7 ms p50 and 16.7 to 16.8 p95, within the menu's own gate (`MENU_P95_MS`).

With the microphone sending, the same bench measured the scene, the beam and the hero together,
the microphone off and on, each round also running the hero as it was before its visor's light
was laid apart (e6d09ed), when that light drew the whole upper layer anew on each of the hero's
frames; the machine's 1-minute load from other work stood at 4 to 17 meanwhile. Medians, ms:

| Frame: the scene, the beam, the hero | Work a frame, mean | p95 | Upper layer drawn in 6 s |
| --- | --- | --- | --- |
| The scene alone | 1.07 | 1.50 | |
| Microphone off | 1.97 | 4.50 | 19 |
| Microphone on | 2.24 | 4.60 | 19 |
| Microphone off, before | 1.90 | 4.30 | 18 |
| Microphone on, before | 3.78 | 5.60 | 180 |

The sending microphone costs +0.27 ms a frame over the silent one, round by round +0.10 to +0.46
and +0.86 in the last round as the load rose, where it cost +1.88 (+1.59 to +2.15). What is left
is the light's band, laid on each of the hero's frames, and the canvas laid anew with it: the body
rides up and down with the words, so the canvas is laid on each frame while the microphone sends,
180 times in the 6 s instead of 64. Beam and hero together came to 0.90 ms over the scene with
the microphone off and 1.17 with it on at that load; the quieter bench above put them at 0.64
silent. Laid apart, the light looks as it did: on the Canvas path the hero's canvas matched the one
drawn before in 46 speaking frames at density 1 and at 2, but for one pixel one level off in two
of them at 1 and in one at 2.

## Chrome (ui.css, styles/lobby.css, finale.css, pause.css, settings.css)

Everything round the world — the top bar, the strip under a run, the lobby's panel, the end
screen's report, the pause menu and the settings — wears the main menu's panel: its near-black
(`rgba(9, 14, 19, 0.97)`), a hairline of `--line-2`, corners of 14 px, the menu's shadow where it
stands over a scene and none where it stands beside the world, whose foot a shadow would darken.
Michroma heads it and does nothing else: the bar's name, the lobby's mission, the report's
sections, the pause menu's title and items (the menu's own), the ask before giving a seat up and
the settings' title; labels stay in the mono, upper case and spaced, running text in the system
sans, at the sizes Type and targets gives. The room's code and its invite link stand as one round
chip, the code in teal to say aloud and the link behind a hairline; beside it a chip counts the
audience — the eye, the count, „2 Zuschauer" in its label — which the server tells the room as a
watcher comes or goes (`audience`). The connection's lamp stays as it was. Every way out carries
the icon set's glyph (screens/Icon.tsx: „Raum verlassen" and „Zuschauen beenden" the exit, „Zur
Lobby" the crew), never an emoji. A phone upright keeps the logo's mark without its word, so that
the bar never wraps.

The world's canvas takes what the chrome leaves, and its zoom follows its height (Framing), so the
chrome keeps its frame: the bar its height, the strip its 58 px on a wide window and its three rows
of 20, 27 and 40 px under 820 px — where the menu is the gear's alone, the row having no room for a
fourth button — and a phone held sideways its one row of 44 px. Measured against main (scratchpad
`pause/chrome-check.mjs`, 14.11.2026) in a Systemcheck room on seed 5 under reduced motion — the
host's laptop at 1440 × 820, 1280 × 800, 960 × 760 and 420 × 760, the guest's touch phone at 844 ×
390, 932 × 430 and 420 × 760 — the top bar, the strip or the row and the world's canvas stand on
the same pixels as on main at every size, its backing too, and the world's own pixels, read back
from its canvas, differ from main's only in the pulsing halo of the station up next, 0.05 to 2.1 %
of them, as main's differ from themselves a run later, 0.0 to 1.6 %.

**The settings** stand in five tabs, as Deep Rock Galactic's and Helldivers 2's do: „Ton" (Gesamt —
the sound switch is its mute —, Musik, Effekte, Funk and Umgebung, each a slider that ticks through
its bus as it moves, beside a mute; the talk key), „Bild" (the text size, less motion, the light by
WebGL or by Canvas, the full screen), „Steuerung" (the key table, the controller and its live test,
the symbols its prompts show, the stick's dead zone from 5 to 40 %), „Zugang" (a pattern of the
screen's dark over each crew colour but the first on the dots in the chrome — a hole, bars across
and down, stripes, a ring, a half, a cross —, and the size of the radio's and the opening's lines
on larger screens) and, with the pass's account, „Konto" (the name the account takes, its colour as
the lobby chose it, „Konto löschen"). The tabs read in the labels' mono; the card keeps one height
for every tab, so that the bar stands still while a tab's controls scroll under it, and holds the
bar whole on a phone held sideways at 932 × 430. Every tab but „Konto" has its „Zurücksetzen" at
its foot; every change takes at once and is kept on the device. The arrows step along the bar, Home
and End to its ends, and a controller's D-pad opens each tab its focus comes to.

## Type and targets (styles/devices.css, test/deviceTargets.test.tsx)

Every word on a device is set by its role, at the normal text size and in a laptop's 720 px of
height at least:

| Role | Least size | Token | Where |
|---|---|---|---|
| Engraved in the metal | 11 px | `--type-engraving` | AUS/EIN, STUFE, KABEL, RACK, the way back, what the machine does |
| A label, an LED's words | 12 px | `--type-label` | the plate, PARTNER, key legends, unit plates |
| Read off its face | 14 px | `--type-body` | the terminal's table and log, wire numbers |
| A readout | 18 px | `--type-readout` | the meter's V, probe digits, the maze's display |

A taller window adds a little to each (0.3 to 0.8 px for every 100 px of height, up to 12, 13,
15 and 22 px), and the text size multiplies all of it (0.9, 1, 1.15). Readouts that are the
device's one figure keep their own size: the radio's frequency 32 px, the relay's instruction
24 px and its seconds 26 px, the token device's six digits twice the readout (36 px at least,
28.8 on a phone held sideways), the unlit segments „888 888" faint behind them. Words drawn in an SVG grow with their drawing: the Netzplan's
names stand 11 units high (12 at most at the large text size, as much as their box holds right
of its LED), the meter's scale 11 units, 13 on a phone, where its dial is drawn smaller.

The Signalkette's signs say no word, but where its display has lost its colour (core
`greyFrom`) the pattern is all a sign has left, and it is read as a readout is: the signs come up
grey (#b8b8b8) at 64 px on every screen — 44 and 36 px in colour — their pattern bold and near
black over them, 9.4:1 against the grey, so that every cell of it measures a readout's 18 px or
more: dot to dot, stripe to stripe and the ring across, 6.9, 6.9 and 9.6 of the glyph's 24 units
(SignalPanel.tsx `BOLD`; client test/signalGrey.test.tsx measures them through the stylesheets at
1280×720, 1440×820 and on phones at 932×430, 844×390 and 420×760). The dots stand as a hexagon
on the circle, a five on the square, four on the triangle; the stripes rise to the right as
Abb. 2 draws them; every mark keeps clear of its form's edge. The status strip lights ANZEIGE ·
FARBLOS beside BETRIEB (signal-grey.png, and signal-grey-phone-932.png on a large phone).

Under the label plate and its LED every device engraves, in a row of its own, what the machine
at that console does — „DAS PRÜFPULT MISST DIE SPANNUNG DES GEWÄHLTEN KABELS", „DER KASTEN TRENNT
KABEL DER NOTSTROMVERSORGUNG" — one line of 56 characters at most, which a narrow window wraps
rather than runs off the bezel (the module's `plate`, core puzzles/module.ts; console-plate.png);
a phone held sideways shows it beside the device instead (below). It names its machine as the
subject: a bare „TRENNT KABEL …" would read as an order to the crew. It says nothing an answer
could be read from, and the audience's device, at no console, carries none.

Every control on a device is a target: 36 px each way under a mouse, 44 under a finger
(`--target`; Apple's 44 pt, WCAG 2.2's enhanced 44 × 44) — terminal keys, rack switches, lever
grips, probe keys, the way back and the tabs under the chassis, the relay console's switches,
dials and buttons. Where a target's height would push lines apart — the terminal's prompt, the
engraved way back, the relay's „Ablauf nachlesen" — its box reaches over the chassis round it
and the line keeps its place. The rack and its Netzplan stand side by side, and a device's frame
takes the window's height but the dim's edge: every device stands whole in 720 px of height.

Around the devices: the HUD's smallest words stand at 12 px (the Laborkennung's heads, ALARME,
„unterwegs"). On the canvas, room names stand at 13 px on a dark plate that keeps them at 4.5:1
or more over the brightest lit floor (WCAG 2.2; FLUR on the lit corridor read 1.3:1 without
it); the E prompt, captions, chat bubbles, the carry line and the hatch's sign at 12 px, the
arrows' captions at 11, a prop's label within 10 to 12 and a name tag within 11 to 14 whatever
the zoom — every one of them times the text size. Where two prop labels would cover each other,
the one that matters less moves a line down or is left out (labelLayout.ts).

## A phone held sideways

844 × 390 px under a finger, and 932 × 430 as today's largest phones stand. A touch screen held
sideways and 500 px tall or less — the height every rule for it in the stylesheets reads
(screens/hudFold.ts `foldsHud`) — folds the objective bar and the crew strip into one row along
the world's top edge, a fingertip's 44 px tall: the stations' LEDs over the goal in one line,
cut short where it runs out, what the crew still has to bring after it; then the crew as
coloured dots, ringed while one speaks and ticked off on the hatch in the escape, what one does
beside the dot for three seconds after it changed and no longer (`freshTags`; names and doings
in the dots' labels); the Laborkennung's value; the clock with the alarm marks; and the
microphone's switch, the notepad, the info panel and the menu by their icons, a fingertip each
(a pattern over each dot where the settings' „Farbmuster" asks for it, Chrome). A line on
the air takes the goal's place for as long as it is up, two lines of it at most, and adds no
height, so the zoom stands still as it comes and goes (insets.ts); an alarm or an emergency
stands under the row while it lasts. With no strip under it the world's canvas takes the
window's height but the top bar's.

The steering pad lies under the left thumb: three by three cells of 48 px, the eight round its
middle walking the eight ways, the corners two keys at once; a finger that slides over it turns
the walk without lifting (touchPad.ts). The right thumb's buttons stand two by two, 52 px each
and 8 px apart: the action in the corner where the thumb rests, „Sprint" beside it, talk over
the action, the chat over the sprint — the load's button in the chat's place while hands are
full. Both stand 12 px off the world's edges, the pad at 85 %, the buttons at 60 % so that the
lab shows through them, whole while a finger is on one and two seconds after the last lifts
(world/cluster.ts). The camera lifts the avatar until its feet stand on the pad's top edge
(viewport.ts `liftAbove`); the minimap stands 56 px tall at least. The quick chat opens beside
the buttons, two phrases a line, the notepad between the pad and the buttons, and neither
reaches under the row.

Measured in Blackout (seed 5) on the walkthrough's touch window at density 1, the microphones
on (`scratchpad/phone/bands.mjs`), main against N-phone, with a line on the air in brackets:

| | 844 × 390 before | after | 932 × 430 before | after |
| --- | --- | --- | --- | --- |
| World canvas, CSS px | 826 × 289 | 826 × 345 | 914 × 329 | 914 × 385 |
| Objective bar | 39 (69) px | 44 (44) | 39 (69) | 44 (44) |
| Crew strip under the world | 52 px | none | 52 | none |
| Band of world below the bar | 251 (222) px | 302 (302) | 291 (262) | 342 (342) |
| — of the window's height | 64.4 (56.8) % | 77.4 (77.4) | 67.7 (60.8) | 79.5 (79.5) |
| Pad and buttons over the band | 16.3 (18.4) % | 13.6 (13.6) | 12.7 (14.1) | 10.8 (10.8) |
| A tile | 32.1 px | 38.3 | 36.6 | 42.8 |
| Tiles across × down | 25.7 × 9 | 21.5 × 9 | 25.0 × 9 | 21.4 × 9 |
| Tiles below the bar | 7.8 (6.9) | 7.9 (7.9) | 8.0 (7.2) | 8.0 (8.0) |
| Figure | 27.3 px | 32.6 | 31.1 | 36.4 |

The tile follows the canvas's height (Framing): the taller canvas draws the lab larger, the
figure a fifth taller, the same eight tiles below the bar — with a line on the air too — and
four fewer across. The buttons cover what the row of four did, 112 × 112 px against 238 × 52,
but in the corner, see-through, and the band they lie on is a fifth taller.

A device takes the window: the device on the left, the Laborkennung, a newcomer's line and what
the machine does in a column of their own beside it — the head has no row to spare for the
engraved line, which the rack's and the meter's tabs paid for by 11 to 17 px of scrolling —
the bezel slimmer; every control in reach without scrolling,
and a list that runs long scrolls in its own box — the terminal's log, kept at its newest line.
The terminal's keys stand in a column beside its screen — the Zugangskontrolle's too, its numeric
pad there while it asks for a token, and its token device's display beside the TERMINAL lamp —,
the rack's units a fingertip high with the Netzplan beside them, the meter's smaller dial beside its keys and paper, the Signalkette's
keys lower with the done lamps beside the status row, the radio's lamp beside its dial. The way
back and the notepad hang as steel tabs under the chassis. The relay console stands in two
columns: the emergency, its procedure and the instruction to read out on the left, the
console's controls on the right. Measured again on N-phone at 844 × 390 and 932 × 430 (the
readability package's m5 and v-relay probes, copied to `scratchpad/phone/m5/`), every console of
Blackout's six devices and the relay console stands whole, nothing scrolling, no control under
44 px, as on main; the Netzplan's names read 10.7 px there, drawn a little under their 11 units.

A source's pages lie open one at a time in a window 500 px tall or less, under a mouse too
(Reading.tsx `SPREAD_QUERY`), and a page keeps its 30 em across at the body's own size —
`--type-body`, 14 px; 12.6 and 16.1 at „Klein" and „Groß" — and takes the height the frame
leaves it (book.css). Its text scrolls inside the sheet between the running head and the foot
line, the outer margin with it, so a block's „Notieren" stays beside its block. The column is
the 25.2 em pages.ts paginates for: the pages break as in any window that shows one page at a
time — page 3 is page 3, the bookmark and the thumb tabs point where they did — and a leaf
turns over as before. Where the frame is 700 px wide, the source's name, the Laborkennung, the
turn and the way to put the book down stand in a column of 13 rem beside the sheet, which then
takes the window's height; in a narrower frame they stand over and under it. The last shift's
slip lies beside the sheet on its left where the frame has room, over the page's head where it
has not — a clipboard's Post-it under the sheet — and stands back in a frame under 20 em tall.
With the notepad up the frame is the window's left two thirds (putdown.css): the frame's head
stands back there, the pad taking the Laborkennung over, and so does a slip with no room
beside the sheet. Measured on Blackout's Archiv book (seed 5) at the normal text size, main
against N-phone (`scratchpad/phone/bookphone.mjs`), with the notepad up in brackets:

| | 844 × 390 before | after | 932 × 430 before | after |
| --- | --- | --- | --- | --- |
| Pages in view | 1 | 1 | 2 | 1 |
| A sheet, CSS px | 138 × 194 | 420 × 362 (420 × 308) | 167 × 234 | 420 × 402 (420 × 348) |
| Body | 4.6 px | 14 | 5.6 | 14 |
| Text column in view | the page's 171 px | 292 (238) px | the page's 206 | 332 (278) |

A page's column runs to 37 em, 518 px at 14 px: the phone shows 15 lines of it at a time, 12
beside the notepad, and scrolls the rest. Where 33.1 em of the body do not fit across the frame,
the sheet takes a smaller em: 11.8 px beside the notepad on a 667 × 375 phone. The walkthrough
reads the cabinet's pages so on the guest's phone, every page turned through
(book-phone-landscape.png), and the clipboard beside the notepad
(reading-notepad-landscape.png). A phone held upright, 560 px across or less, reads its pages
the same way, the notepad's drawer down or up, and 480 px across or less the sheet gives up paper
rather than its em — 0.7 em at the gutter, 2.7 outside, its thumb tabs standing back — so that a
420 × 760 phone sets the body at 14 px where it set 12.3, and 5.7 over the drawer
(book-phone-notepad.png).

## Cost

Floors, walls, wall props and furniture are sprites baked once per zoom level and light
(`atlas.ts`) and blitted, one per tile, as the floor always was; the faint steady lights are
baked together and laid over the picture in one go. A bake never reads pixels back from a
canvas: on a GPU that stalls the frame. The grain is one canvas per tile size, laid over each
tile in one draw.

What the graphics package's work costs is measured on this machine (an M4) with a bench that
draws real Blackout frames through the game's own assembly and passes at the screen's pace — a
frame each animation frame, the clock running as in the game, Anna pacing a fifth of a tile
either way of her tile as the walkthrough paces — the canvas flushed after each frame and the
page's main thread slowed four times, on the software Canvas path the walkthrough's
`SHOTS_SOFTWARE_GL` composes on, at 1440 × 600 CSS pixels and a density of 1: the escape by the
hatch, the dark Flur, the lab lit before the blackout, the Labor lit and the audience's whole
lab in the escape, the base and the change six rounds each, every round starting at another
build. The whole package costs a frame there +0.1 to +0.2 ms in the dark Flur and the lab lit
before the blackout, +0.35 ms by the hatch in the escape (19.2 ms against 18.8), +0.45 ms in
the Labor lit and +0.6 ms for the audience's whole lab in the escape — at the M4's own speed a
quarter of that. The alarm's knock is apart (Camera). A bench that draws its frames back to
back counts what the clock and the walk move only once in tens of frames instead of every
fourth, and misses what pacing reuses: it saw 0.1 ms where the swaying lamp's sight cost 0.9
(Figures). The escape is the walkthrough's dearest window — the light and the darkness over a
lab lit red take half its frame — and CI's runners differ by a third in speed: on the slower
ones it ran at 50 ms p95 before this package too.

**The escape's headroom (L-polish).** Main against the package on that bench, eight scenes six
rounds each, every round starting at another build, medians — a frame's work on the main thread
slowed four times, mean and p95, and the time from one animation frame to the next, p95, ms:

| Scene | Work before | Work after | Frames before → after |
| --- | --- | --- | --- |
| Escape by the hatch | 18.45, 20.40 | 15.05, 16.55 | 33.4 → 16.8 |
| Escape, a drone flying in the Ost-Flur | 18.95, 20.90 | 16.09, 18.25 | 33.4 → 16.8 |
| The escape's first second | 18.39, 20.10 | 15.21, 17.25 | 33.4 → 16.8 |
| The dark Flur | 10.50, 11.95 | 9.66, 10.95 | 16.8 → 16.7 |
| The lab lit before the blackout | 9.48, 10.65 | 8.38, 9.60 | 16.7 → 16.7 |
| The Labor lit | 12.78, 14.40 | 11.24, 14.00 | 16.8 → 16.8 |
| The Labor's rooms coming on | 13.04, 14.80 | 11.00, 12.65 | 16.7 → 16.8 |
| The audience in the escape | 6.91, 8.00 | 6.92, 8.05 | 16.7 → 16.8 |

Main's three escape scenes reached 33.4 at p95 in all six rounds; the package's reached it once
each, the drone and the first second in the fifth round, which ran slower for both builds. The
walkthrough itself cannot show the step down: under `SHOTS_SOFTWARE_GL=1` and
`SHOTS_CPU_SLOWDOWN=4` its three pages share the cores and each one's main thread stays busy
throughout, so the escape's window read 33.3 ms p50 and 33.4 p95 in three Blackout runs of each
build taken in turn. The package's drew more frames in it — 93, 93 and 82 against main's 87, 72
and 71, and 130, 126 and 127 pacing after the game screenshots against 117, 117 and 114.

What it took were three copies the software canvas made dearer than they had to be. The map
baked whole was copied with a source rectangle, which sends a copy down the canvas's filtered
path: 1.6 to 1.8 ms at 1440 × 600 against 0.74 for the same pixels copied whole (tileCache.ts
`drawTiles`), in every scene. The darkness was filled with `copy` and every lit run cleared and
filled again; now each pixel is filled once, the dark round the lit tiles in one even-odd path
and each lit share over its own tiles (render/darkness.ts `fillDarkness`). And the light that
holds still — the lit rooms' ceiling lights, the steady glows of screens and racks, the open
hatch — was laid from three bakes each added onto the picture, 2 ms a copy against 0.75 for a
plain one; their bakes stay as they were and are added up at whole pixels into one, which alone
is laid on, and added up again only as one of them is baked anew (render/light.ts
`laySteadyLight`, render/bakes.ts `layAdded`). Stills of the eight scenes on the bench's own
clock, the canvas flushed after each pass, came out identical but in the escape, whose red tint
now lies over the steady glows too: there at most 11 % of the pixels move by more than 2 of 255,
0.34 on average away from edges, the most — 20 — at the hearts of glows where a channel
saturates. Unflushed, two stills of the Labor differ in 19 pixels of the generators' green LEDs
by up to 8: where the canvas flushes what it was asked to draw moves those, the base's as well.
Tried and left: drawing only the lab's things near the camera saved nothing measurable. Every
window of the walkthrough logs what the light worked out anew meanwhile — a line `light`, the
sights a frame and the bakes (render/census.ts) — so that a cache that stops holding shows in
CI's log before it shows in the frames.

**What a window measures (M-ciwin).** CI's escape window read 49.9 to 50 ms p95 on both looks in
three runs, while one client's frame of the scene comes to 16.8 ms on the bench above, its main
thread slowed four times: the walkthrough's three pages — the host, the guest's phone, the audience
— drew the escape at once on the runner, which composes every page in software in its one GPU
process (0.93 to 0.95 cores in that window; `compositing disabled_software` in the log's first
line, as this machine's headless shell composes without `SHOTS_SOFTWARE_GL`, which composes on
SwiftShader's GL for a tenth of that). Every window now measures one client: while a look runs,
every other page stands frozen — its animations stopped, for a page's compositor plays them on past
any pause of its script; its main thread paused in the debugger at its next line of script; its CPU
throttle lifted, for Chromium's throttle holds a thread back by keeping it spinning — and is thawed
once the look is over, the server's messages waiting for it (tools/freeze.mjs; Chromium's own
freeze, `Page.setWebLifecycleState`, leaves a page on screen running, as every page of a headless
run is). Each window logs a line `frozen` with the pages it froze, and the `pages` line shows them
at 0.02 to 0.08 cores. Without `SHOTS_SOFTWARE_GL` and at `SHOTS_CPU_SLOWDOWN=4` this machine fails
the escape as CI does, 50.1 ms on both looks with the GPU process at 0.94 cores; measured back to
back in one run, the window read 50.0 ms p95 with every page running and 33.4 with the others
frozen, the GPU process down from 0.85 cores to 0.53 and the renderers from 3.4 to 1.2 — at 3× 33.4
against 16.8, at 5× 66.6 against 33.4. With the others' scripts paused but their animations
playing, the red edge (`.vignette--escape`, finale.css) still took 0.32 of the window's 0.46
GPU-process cores: 0.22 for the guest's edge, breathing on its compositor, and 0.1 for the host's
own; with no edge on any page the GPU process took 0.14, as in the other windows, and the window
still read 33.4 ms p95 — what the escape costs over the other scenes at 4× is the host's main
thread, not the edge. With the frozen pages' animations stopped the window's GPU process takes 0.24
cores. Under `SHOTS_SOFTWARE_GL=1` the pages share little: there the escape reached 50 ms only at
5× and 6×, where the host's own frame comes to 33 and 50 ms with the others frozen.

**What the gate allows (H-1).** A gated window passes where its p95 is at most 40 ms
(`SHOTS_FRAME_P95_MS`) or twice the p95 of the run's quiet pacing window — the host pacing in
its tile after the game screenshots — whichever is more; over that, it is looked at once more a
second later and fails only on both looks (tools/framegate.mjs). CI on c23afc5, the same code as
the green 65e3e1e, read the Systemcheck's escape at 33.4 ms p50 and 50.1 p95 on both looks: the
whole runner drew at half the screen's rate. A runner pacing at 33.4 ms may reach 66.8 ms
there; a runner at the screen's rate paces at 16.8, so
40 ms stays its bound, and an escape grown dearer there still fails. The 40 ms floor
also bounds what a regression in the pacing scene itself could hide: the pacing window is gated
against 40 ms alone, as is every window before it (the lab lit before the blackout), and one
that fails sets no pace. The log names both numbers, „p95 50.0 ms, allowed 66.8 (2 × pacing
33.4)", and a line `pace` what the pacing window set.

**The frame in CSS pixels (N-camera).** The walkthrough's host window at 1440 × 820 now shows
24.3 × 11.5 tiles of 58.2 px where main showed 22.2 × 10.5 of 63.7 — more tiles, each smaller —
and at density 2 the same 24.3 × 11.5 where main drew the whole 27-tile width (Framing). Its
frame windows did not move: in Blackout, main and the branch run back to back, every gated
window held 16.7 to 16.8 ms p95 under `SHOTS_SOFTWARE_GL=1` but the open Notstrom-Kasten
panel, 33.4 ms on both, and 16.7 to 16.8 ms without it; the branch's Systemcheck held 16.7 to
16.8 ms, its open Signalprobe panel 33.4 under software GL. The looks at density 2, for
information, held 16.7 to 16.8 ms on the branch, where main's escape at 2 reached 33.4 without
software GL. On the paced
bench above, copied to `scratchpad/camera/bench/` at the host's 1414 × 669 canvas and built twice
from the branch, once with main's rule patched back in, six rounds interleaved at density 1, the
work of a frame came out alike — medians, the branch against main: the escape by the hatch 16.6
against 16.3 ms, the dark Flur 11.1 against 11.3, the lab lit before the blackout 10.5 against
10.6, the Labor lit 14.1 against 14.8 — while the rounds swung by 4 ms from one to the next as
the machine's load rose from 2.7 to 6.7; round by round the escape came out 0.4 ms cheaper in
five rounds of six, the light and its glows going by their area in pixels, which shrinks with the
tile. At density 2, four rounds, the escape came out alike and the dark Flur 0.9 ms dearer in
every round (36.6 against 35.7), its tiles 11 % larger than main's there; a frame at density 2
takes 32 to 51 ms on that slowed software path either way.

**The bigger lab (N-xxl).** The frame shows as many tiles as before on every screen, but a light
that holds still is baked over its whole box, and a lab of 36 × 22 lit whole — the escape, the
audience, a run won — is a box of 36 tiles: on a laptop at density 2, 116.3 px a tile, a canvas
4187 px wide. Bakes were held to 4096 px a side; past that a box was baked at fewer pixels a
tile and every frame copied it scaled, through the canvas's filtered path, and laid its parts
one by one where they had been added up into one. The walkthrough's look at the escape at
density 2 went from 16.8 to 33.4 ms p95 with the new map, the paced bench's escape frame at
density 2 from 42 to 82 ms of work on the main thread slowed four times, the light pass alone
from 27 to 66. A bake is now held to the pixels of a square 4096 px a side and to 8192 px on its
longer side (baked.ts `bakeable`): the lab's 4187 × 2559 bakes pixel for pixel, no canvas holds
more than before, and a 4K screen at density 2 still bakes the lab smaller, as it did the old
one. On that bench, built once with main's 27 × 17 map and once with the new one, the same client
in both, three rounds interleaved, means of the frame's work — at density 2: the escape by the
hatch 45.4 against 42.7 ms, its first second 45.6 against 42.9, the dark Flur 34.0 against 32.0,
the lab lit before the blackout 30.3 against 29.1, the audience's whole lab 18.5 against 19.3;
at density 1: 14.1 against 13.2, 14.2 against 13.3, 10.2 against 9.5, 9.2 against 9.0 and 6.3
against 6.5 — every frame still at the screen's 16.7 ms there, and the audience's zoom smaller
for the larger lab. The walkthrough's windows held what they held on main: 16.7 to 16.8 ms p95
in Blackout, the open Notstrom-Kasten panel 33.4 under software GL as before, the looks at
density 2 16.8 ms.

**Graphics 2 (N-graphics2).** Each of the seven items was measured on the paced bench against
the commit before it, six rounds interleaved, every round starting at another build, the
medians of a frame's work on the main thread slowed four times; each section above names its
cost, and what was cut down to keep every effect within 0.5 ms (Beacons, Colour grade, The
lamp's beam, Drones). The bench gained scenes for them: both of the crew pacing in the dark Flur,
a drone patrolling it, two figures behind the Archiv's shelves and behind the server racks.
Against main the whole package could be benched only with the machine's swap near full and a
browser outside the bench busy, both builds three to four times slower than in the items' own
benches, so that only their ratio holds, rounds interleaved: the dark Flur +19 % of its frame,
both pacing +17 %, the Labor +15 %, the lab lit before the blackout +8 %, the audience's whole
lab +4.5 % (four rounds); the escape by the hatch +8.5 %, its first second +7 %, the drone's escape
+10.5 % (six rounds) — at the items' own speed about 2 ms in the dark Flur and 1.3 ms in the
escape. In the one round before the load came, the escape by the hatch took 15.4 ms of work on
main against 16.6 on the branch, its frames 16.8 against 33.2 ms at p95: within the 33.4 ms the
escape is allowed at 4×, but at its edge — where the 16.7 ms of the screen's pace run out, a
frame waits for the next. The walkthrough's gated windows, main against
the branch, run in turn: Blackout under `SHOTS_SOFTWARE_GL=1` 16.8 → 16.8 ms p95 in the lab lit,
16.7 → 16.8 pacing, 33.4 → 33.4 at the open Notstrom-Kasten panel (as on main), 16.7 → 16.7
after the station step, 16.8 → 16.8 in the escape; without it 16.7 to 16.8 ms in every window
on both; the Systemcheck 16.7 to 16.8 ms on both, its open Signalprobe panel 33.4 under software
GL on both. Every still of the world changes — the grade alone moves every pixel a little — and
those are the new baselines; the join and lobby screens stay within what two runs of main differ
by (their room codes and the lobby figures' idle loops), the editor's only in its tool glyphs for
the drone and the furniture, drawn with the world's own art.

## Open

What the graphics and gameplay packages left for later, one line each:

- **The light layer cannot be measured on a software renderer** (L-graphics): under
  `SHOTS_WEBGL=1` SwiftShader takes 83 to 133 ms a frame, as it did before the package, so CI
  keeps the Canvas pass, and the layer was measured only on this machine's M4 GPU, through a
  headless copy of the walkthrough started with the Metal flags of the paced bench (Cost).
- **The escape on CI's slower runners** (L-graphics, L-graphics-fix): after the graphics merge
  CI's escape window failed at 50 ms twice, the swaying hand lamp defeating the sight cache —
  fixed in L-graphics-fix (Figures). A client build of 3.3 s and more still marks the runners on
  which the window runs at the edge whatever the commit. The escape's frame is almost a fifth
  cheaper since L-polish (Cost); since H-1 the gate holds it to twice the runner's own pacing
  where that is more than 40 ms (Cost, „What the gate allows"). The escape's main thread could
  still come down further: the light and dark passes, a frame at half rate (audit addenda).
- **Edits outside the graphics package's files** (L-graphics): the hooks in GameWorld.tsx,
  assemble.ts and sim.ts — `blackoutAt`, the partner's cadence — and
  decor.ts were changed outside the files the package owned, for whoever works there next to
  look over.
- **Kept on purpose** (L-gameplay): on a controller, A presses Space only on a control made to
  be held — the button module's face, `data-pad="hold"` — and clicks every other one
  (gameplay.md, „A controller").
- **The escape at 4× after Graphics 2** (N-graphics2): the package takes about 1.3 ms of the
  escape's frame on the paced bench, which leaves it at the edge of the screen's pace there —
  16.6 of 16.7 ms in the one clean round, its frames 33.2 ms at p95 against main's 16.8, within
  the 33.4 allowed. Benched again on a quiet machine, the dearest parts to look at first are the
  partner's flashlight and your beam's warm core (The lamp's beam).
- Done in L-polish: a station's device fades out as it came (Interface); the controller pings
  with ◀ and opens the quick chat with ▶; the Bestenliste's mission tabs keep to one row that
  scrolls, so that the screen fits 1280 × 720 and a phone.

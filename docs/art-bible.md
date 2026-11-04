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

Props fit the tile grid: one tile each, standing props never taller than their tile, so a
crew member in front always overlaps them correctly. Labels sit under props in the world's
text, as they always have. Wall props hang on the face of a wall tile, never on a floor tile.
A note of the last crew (`map.notes`, art.ts `drawPinnedNote`) is a sheet of `PAPER` in blue
ballpoint with a dog-ear: pinned with a red pin to the face that looks into the floor it is read
from, or lying turned on the floor; until somebody reads it, a faint `READ_BLUE` glow calls.

## Motion rule

Ambient motion is slow and small: fans turning, screens scrolling, LEDs blinking, the core
pulsing, steam rising, dust drifting in the light cones. It steps at most 15 times a
second (`ANIM_HZ`), and nothing moves faster than a walking crew member (4.2 tiles/s) except
the sparks of a short. Under reduced motion nothing turns, scrolls or flies; lights still blink.
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

## Framing (world/viewport.ts `tileCss`, insets.ts)

The frame is a decision in CSS pixels, not an accident of the screen: every screen shows the
same world whatever its density. A tile stands the world canvas's CSS height over 11.5 where the
canvas stands 600 px or taller — a laptop's or a desktop's — and over 9 below that, a phone held
sideways, whose figure has to stay readable; never under 28 px, so the figure keeps 24, nor over
96 on a tall monitor. The canvas draws it at its own density (Crispness).

Below the objective bar the frame keeps a band that holds a drone's reach twice from top to
bottom with a mouse and keys — 9 tiles for Blackout's 4.5-tile cone at „Normal": the avatar in
its middle sees a cone's end before the cone sees it — and one and a half times (6.75) on a
touch screen, whose HUD keeps to a quarter of the canvas (A phone held sideways). Where the tile
count would leave the band shorter, the band wins and the tiles shrink until it holds: a
1280 × 720 window shows 11.6 tiles of height, 9 of them below the bar. The bar counts with a
line on the air — its steady row, the clock and the goal's title, padding and all, and the row a
radio line takes, measured on a banner set into the bar unseen and taken out in the same moment —
so that a line coming or going never moves the zoom; what comes and goes under the goal's title,
a station's missing part or the escape's checklist, does not count either: with a line on the
air over the escape's checklist a 1280 × 720 window keeps about 8.8 tiles below the bar. Where
the canvas is too small for both, the 28-px floor wins over the band. „Hart" stretches the
drones' cone to 5.2 tiles and the band holds 1.7 of them; the frame stays the same at every
difficulty.

The camera follows as it did — a little ahead of a walker, 0.6 tiles eased in over τ 0.1 s, the
view easing after the avatar over τ 0.17 s, held at the lab's edge. The lab, 27 tiles wide, is
wider than the view on every screen now, 24 to 26 tiles, so the camera follows sideways on every
screen, but only in the lab's middle columns: it stands held at a side wall on 88 % of
Blackout's floor tiles at 1440 × 820 and 97 % at 1280 × 720 and on the phone (before: 80 % at
1440 × 820 and density 1, 97 % at density 2, where the view was the lab's whole width). Up and
down it follows on 43 % of them on a laptop, 71 % on the phone. A canvas wider than 2.35 : 1
shows the lab whole across with the dark beyond its walls at the sides: the zoom that kept the
lab over the whole canvas is left to the opening's shot. Measured in Blackout (the audit's camera
script, copied to `scratchpad/camera/`; the canvas's box inside its 1-px border; with a line on
the air in brackets):

| Window | Density | Canvas | CSS px a tile | Tiles across × down | Below the bar | Figure |
| --- | --- | --- | --- | --- | --- | --- |
| 1440 × 820 | 1 and 2 | 1414 × 669 | 58.2 | 24.3 × 11.5 | 10.1 (9.3) | 49.4 px |
| 1280 × 720 | 1 and 2 | 1254 × 569 | 48.9 | 25.7 × 11.6 | 10.0 (9.0) | 41.5 px |
| phone held sideways, 844 × 390 | 3, drawn at 2 | 826 × 289 | 32.1 | 25.7 × 9.0 | 7.8 (6.9) | 27.3 px |

Before, the same screens showed 22.2 × 10.5 tiles at 1440 × 820 and density 1 but the lab's whole
27-tile width × 12.8 at density 2, 23.1 × 10.5 and 27 × 12.3 at 1280 × 720, and 27 × 9.4 on the
phone. A desktop's 1920 × 1080 window, its canvas some 1894 × 929, comes out by the rule at
80.8 px a tile, 23.4 × 11.5 tiles.

## Camera (render/camera.ts, render/aberration.ts, vignette.ts)

As a station's panel opens over the world the camera leans in 1.08 times over 200 ms, eased
out, and back out as it shuts, from wherever it stood. The hatch grinds open with dust falling
off its rim (Atmosphere).
An alarm knocks the picture's colours apart for 150 ms: the finished frame's red pushed one way
and its blue the other, 4 CSS px at first and closing in as the knock fades — two offset passes
of the finished frame, each cut down to one colour and added over the picture's two sides, a
twelfth of its width each, where a tube's convergence is worst and the eye looks least; the
middle, where the crew stands, stays sharp, and the alarm's red strobe hides the light the
passes add. The red edge of the last minute breathes with the pressure: 1.5 s a breath as the
minute begins, 0.95 s in its last 20 s, 0.8 s and deeper through the escape. Under reduced motion
the zoom is a cut, there is no knock and the edge holds still. Cost: the zoom nothing once it
has settled (the map baked once more at the new zoom as the panel opens and as it shuts); the
knock 0.9 ms a frame for its 150 ms on the software Canvas path and nothing between alarms —
kept to the sides for that: across the whole picture, its own colours faded, it cost 3.4 ms; the
red edge nothing, its opacity the compositor's.

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
lifting, the camera leaning back out behind it — the game screen keeps it up that long
(screens/Game.tsx, PutDown.tsx `useLeaving`), inert, its keys and presses reaching nothing. A
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
up to 38 characters of the pencil's — the terminal's table runs 36, the Signalkette's legend 31
— which the pad holds whole on a phone 420 px wide (its margin moved in to 24 px there); a wider
one is set as running text (gameplay.md). The pad in the world's corner is 390 px wide at text
size 1 and grows with it; the strip beside a page keeps its width (`--note-strip`), so in a
narrow window at the large text size a table may scroll sideways in its own box.
notepad-captured.png and notepad-captured-phone.png show the legend and the Laborkennung in it.

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
24 px and its seconds 26 px. Words drawn in an SVG grow with their drawing: the Netzplan's
names stand 11 units high (12 at most at the large text size, as much as their box holds right
of its LED), the meter's scale 11 units, 13 on a phone, where its dial is drawn smaller.

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

844 × 390 px under a finger. In the world the steering pad lies under the left thumb: three by
three cells of 48 px, the eight round its middle walking the eight ways, the corners two keys at
once; a finger that slides over it turns the walk without lifting (touchPad.ts). The actions —
E, sprint, drop, chat, talk — lie under the right thumb, 52 px each. The objective bar covers a
quarter of the canvas's height at most, a line on the air included; the minimap stands 56 px
tall at least; the camera lifts the avatar clear of both thumbs' controls.

A device takes the window: the device on the left, the Laborkennung, a newcomer's line and what
the machine does in a column of their own beside it — the head has no row to spare for the
engraved line, which the rack's and the meter's tabs paid for by 11 to 17 px of scrolling —
the bezel slimmer; every control in reach without scrolling,
and a list that runs long scrolls in its own box — the terminal's log, kept at its newest line.
The terminal's keys stand in a column beside its screen, the rack's units a fingertip high with
the Netzplan beside them, the meter's smaller dial beside its keys and paper, the Signalkette's
keys lower with the done lamps beside the status row, the radio's lamp beside its dial. The way
back and the notepad hang as steel tabs under the chassis. The relay console stands in two
columns: the emergency, its procedure and the instruction to read out on the left, the
console's controls on the right.

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
  assemble.ts and sim.ts — the zoom, the station, `blackoutAt`, the partner's cadence — and
  decor.ts were changed outside the files the package owned, for whoever works there next to
  look over.
- **Kept on purpose** (L-gameplay): on a controller, A presses Space only on a control made to
  be held — the button module's face, `data-pad="hold"` — and clicks every other one
  (gameplay.md, „A controller").
- Done in L-polish: a station's device fades out as it came (Interface); the controller pings
  with ◀ and opens the quick chat with ▶; the Bestenliste's mission tabs keep to one row that
  scrolls, so that the screen fits 1280 × 720 and a phone.

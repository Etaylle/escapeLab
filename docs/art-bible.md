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

## Interface (styles/interaction.css)

A panel over the world — a station's device, a source's pages, a note — grows from 0.98 to its
size as it fades in, over 150 ms; a sheet put down slides out as before, and a station's device
goes as it came, shrinking back to 0.98 as it fades out over the same 150 ms, the dim behind it
lifting, the camera leaning back out behind it — the game screen keeps it up that long
(screens/Game.tsx, PutDown.tsx `useLeaving`), inert, its keys and presses reaching nothing. A plain button gives a
pixel as it is pressed and darkens a little; a device's keys, levers and wires keep their own
press. Keyboard focus shows as a 2 px teal ring, never for a click; hover affordances belong to
a mouse. The type keeps its hierarchy: titles in the system sans, bold (the page's 27 px, the
station's line 20 px); labels in the mono, upper case and spaced 2 px (13 px heads, 12 px panel
labels, 10 px marks); figures in the mono with tabular digits (the clock 30 px, 36 px at the
end); running text in the system sans at 15 to 16 px; the world's own text in the mono, bold,
with a dark halo, held within 10 to 14 CSS px whatever the zoom. Under reduced motion every move
is a cut or a cross-fade: a panel only fades in, a device stepped back from goes at once, a press
only darkens.

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

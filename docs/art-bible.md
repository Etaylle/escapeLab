# EscapeLab — art bible

The world is a 1980s research lab seen from above, in three quarters, mostly in the dark.
Three references set the bar: **Among Us** for chunky, readable shapes and a crew you tell
apart by colour at a glance; **Escape Simulator** for rooms dense with believable props;
**Alien: Isolation** for retro instruments — phosphor screens, tungsten light, gauges and
warning stripes. Every rule below is enforced by the code; where a test checks it, it says so.

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
`LABEL`. The crew's eight colours stay as the server hands them out (`CREW`).

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

## Motion rule

Ambient motion is slow and small: fans turning, screens scrolling, LEDs blinking, the core
pulsing, steam rising, dust drifting in the flashlight's beam. It steps at most 15 times a
second (`ANIM_HZ`), and nothing moves faster than a walking crew member (4.2 tiles/s) except
the sparks of a short. Under reduced motion nothing turns, scrolls or flies; lights still blink.
`test/particles.test.ts` checks the cap of 80 particles, the 15 Hz step and the speeds.

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

## Cost

Floors, walls, wall props and furniture are sprites baked once per zoom level and light
(`atlas.ts`) and blitted, one per tile, as the floor always was; the faint steady lights are
baked together and laid over the picture in one go. A bake never reads pixels back from a
canvas: on a GPU that stalls the frame. The grain is one canvas per tile size, laid over each
tile in one draw.

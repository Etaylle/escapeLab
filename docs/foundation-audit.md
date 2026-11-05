# Foundation audit · Blackout im Labor

Read-only audit of main `9803a55`, built in `.worktrees/audit` (branch `M-audit`, nothing committed),
production server on port 3341. My measurement scripts drove headless Chromium on the Mac's GPU;
the walkthrough (`tools/shots.mjs`) ran as CI does, without it.
Evidence paths are relative to this folder (`scratchpad/audit/`). Every number below was measured
in this session or read from the run log, except values marked (code), which are constants read
from the source; references carry their source in `references-raw.md`
([P] primary, [S] secondary, [W] weak).

## The ten findings that matter most

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | **The camera's scale depends on the screen's pixel density.** The same 1440×820 window shows 22×10.5 tiles at density 1 (every harness screenshot) and the whole 27-tile width × 12.8 at density 2 (a MacBook); the figure shrinks from 54 to 45 CSS px. A phone held sideways shows 27×9.3 tiles with a 26-px figure. | wrong foundation | `m2-camera/` |
| 2 | **No human crew has got past station 3.** Seven human Blackout runs are logged (20–26 Oct), none won. The lever took 70–164 s (scripted crew: 25 s) and was never solved in the two Entspannt runs of 25 and 26 Oct (1215 s each); the project notes record one of them as the user alone in two browsers. Notstrom took 59 and 107 s on the old map and stayed unsolved for 710 s on the XL map. The Signalkette was never solved. | round off (curve) · question (timer) | `m10-runs/blackout-runs.json` |
| 3 | **The in-game voice is quietest where talking is required.** The Signalkette's consoles stand 14.4 tiles apart without line of sight: the voice arrives at 5 % (−25.6 dB). The Notstrom box and meter talk through a wall at −10.6 dB. We Were Here's walkie-talkie has no distance fade. | wrong foundation (remote play) | `m7-voice/results.json` |
| 4 | **A plate door that shuts on a walker freezes them.** In 4 of 4 trials on the LAN, and 1 of 4 at 200 ms round trip, the walker could move neither forward nor back until someone stood on the plate again. The server would let them out; the client's collision does not. | defect, round off | `m4-net/results-all.json` (`plateDoor`) |
| 5 | **The partner's figure judders.** Its on-screen step varies from 0 to 7.2 px per frame (should be a steady 4.5) and it trails by 153 ms on localhost. 40 of 95 broadcasts repeat the walker's last position, and no message carries a timestamp. Replayed with a timestamp and a 150 ms buffer, the same recording's variation drops from 0.44 to 0.25 at the same delay. | round off (protocol) | `m1-movement-gpu/`, `a1-analysis/` |
| 6 | **The client promises what the server then refuses.** E pressed as the prompt appears failed 3 of 8 times on the LAN and 8 of 8 at 200 ms round trip („Zu weit weg — nur direkt an der leuchtenden Station."). The E chirp plays before the server answers. A refusal's text lies under the open device and half a second of walking wipes it. | round off | `m4-net/results-b-all.json`, `m9-verify/`, `census-feedback.md` |
| 7 | **One-tile openings catch the body.** A single key gets through only within ±0.22 tiles of the centre (44 % of the width); beyond that the figure stops dead. The map has 15 such openings and no corner nudge (Celeste nudges up to 4 px). Against a wall the steps keep sounding: 2 s of pushing made 15 footfalls. | round off | `m1-movement-gpu/results.json`, `m3-space/`, `m9-verify/results.json` |
| 8 | **The touch layout puts movement and actions under one thumb.** The four 42-px arrow buttons sit with Sprint, ⚡ and chat on the right (x 499–822 of 844), walk only in four directions, and a sliding finger does not change direction. The HUD covers 32 % of the canvas height; the minimap is 41×26 px. | round off | `m2-camera/phone-844x390-dpr3-touch.png`, `m5-panels-phone/` |
| 9 | **Device type and controls are small, and two manuals break across a page turn.** Device text runs at a median of 11–13 px (some 8–10 px); terminal keys are 52×34 px and lever grips 88×30 px. The rack scrolls inside its frame at 1280×720, and on a phone held sideways all six devices do. The Morsetafel splits 11 + 2 rows over a turn, the Serverraum's codes 2 + 4 items, and at the large text size the book's lines are cut off at the sheet's edge. The KTANE manual gives each module one page. | round off | `m5-panels-desktop/results.json`, `m8-manual/results.json`, `m9-verify/book-scale-1.15-turn-1.png` |
| 10 | **Clocks follow each device, not the server.** A device whose clock runs 5 s ahead shows the mission clock 5 s off (14:50 against 14:55). While the run stands paused the partner's clock keeps counting (14:31 to 14:25), then jumps back (14:29). On one machine the start line plays twice, 4.4 s apart. | round off | `m4-net/` |

Measurements took about 24 minutes of active run time (31 with an accidental second walkthrough), spread over 1 h 23 min of wall time (11:38–13:01). The rest went to waiting for a load below 4 while another agent's walkthroughs and the user's own work ran.

---

## 1 · Movement

- **Measured.** Walk 4.20 tiles/s, which is 4.9 body heights/s (the figure is 0.85 tiles tall). Sprint 5.46 tiles/s (×1.30, no stamina). Full speed from the first frame (0.070 tiles = one frame's step), stop within the same frame, diagonals normalised (4.20). Diagonal push along a wall slides at 2.97 tiles/s.
- **Corners and walls.** A 1-tile opening passes only within ±0.22 tiles of its centre with one key (11 trials). Off-centre, the figure stops dead at the wall; pressing the diagonal slides it in (2 of 2). Pushing into a wall for 2 s still made 15 footfalls.
- **Latency.** Key to the first moved frame: p50 8.6 ms, p95 15.7 ms. Key to next paint (Event Timing): p50 24 ms, p95 32 ms, at a steady 16.7 ms frame.
- **Partner's figure.** Sent every 80 ms, rebroadcast every 66–80 ms, eased by an exponential chase. Step per frame 0–7.2 px, median 3.9, against an ideal 4.5 (variation 0.44); 153 ms behind (p50); no overshoot at a wall, so no rubber band.
- **Touch and controller.** The pad is four 42-px buttons, four directions, no slide between them. The stick has a 0.2 radial dead zone and walks as far as it leans (code).
- **Reference.** Overcooked: "1 button to pick up, 1 button to interact and a thumbstick to move" [P]. Celeste: 0.1 s coyote time, 4 px corner correction [P, source code]. Source: draws others 100 ms in the past [P]; Fiedler sizes the buffer at about 3× the send interval [P].
- **Verdict.** Sound: speed, instant start and stop, input latency. Round off: corner nudge, remote smoothing, wall feedback, touch pad.
- **Target.** Nudge the body into an opening when it overlaps by 0.3 tiles or less. Stamp each position with its sample time and draw partners 150 ms behind. Stop the steps against a wall. Put an 8-way pad of ≥ 48 px under the left thumb.

## 2 · Camera

- **Rule (code).** Device px per tile = min(170, max(cover, min(88, height ÷ 10.5))). Because it counts device pixels, density changes the framing.
- **Measured (CSS px per tile · tiles across × down).** 1440×820 @1: 63.8 · 22.2×10.5. 1440×820 @2: 52.4 · 27×12.8. 1280×720 @1: 54.3 · 23.1×10.5. 1280×720 @2: 46.5 · 27×12.3. Phone 844×390 @3 (drawn at 2): 30.7 · 27×9.3.
- **Pinned at the map's edge.** Sideways on 80 % of floor tiles at 1440 @1 and 97 % at @2 and on the phone; up and down on 42–57 %. So the 0.6-tile lead (τ 0.1 s, code) and the follow (τ 0.17 s, code) rarely act.
- **Free band below the objective bar.** 8.6 tiles at 1440 @1, so half the band (4.3) is shorter than the drone's 4.5-tile cone. On the phone the band is about 5 tiles. The danger sense covers 5 tiles, but its edge glow hides while a panel or book is open (code).
- **Rooms at that scale.** A 7×5 room fills 0.32 × 0.48 of the view at 1440 @1 and 0.26 × 0.39 at @2.
- **Reference.** Among Us: a vision circle centred on the feet, walls block it, host-set 0.25–5× [S]; no look-ahead is documented. Keren (GDC 2015): camera window, lerp smoothing, projected focus, avoid sudden speed changes [P]. Unrailed's view width depends on the aspect ratio, and Unrailed 2 added an optional close follow camera [S].
- **Verdict.** Wrong foundation: framing is an accident of the screen rather than a decision.
- **Target.** Fix the framing in CSS px (for example 11–12 tiles of height on every screen, at least 2× the drone's reach across), and run the harness at density 2 as well as 1.

## 3 · Scale and space

- **Bodies (code).** Figure 0.85 × 0.62 tiles; collision box 0.56 tiles; players pass through each other.
- **Rooms.** Archiv and Maschinenraum 7×5, Labor and Reaktor 6×5, Serverraum 9×5 (split by two pillars into halves joined by three 1-tile gaps). Furniture takes 18–28 % of each room's tiles.
- **Corridors and doors.** Flur 21×3, Ost-Flur and Süd-Flur 3 wide. All 15 doors and openings are 1 tile wide, pillar gaps included.
- **Walk times (8-way, 4.2 tiles/s).** Every spawn is 2.5–2.9 s from the lever. The longest leg of the plan is 7.8 s (fuse to the reactor). Reactor to hatch takes 8.8 s through the Labor and 9.2 s past the Serverraum (37.1 and 38.8 tiles). The whole plan walks about 43 s per player; in the walkthrough the two walked 16 % and 13 % of its 396 s.
- **Shape.** The loop closes only after station 5; until then it is a tree. The Archiv with the hatch is a dead end; the Ost-Flur is reachable only through the Serverraum.
- **Meeting.** The plan puts both players in one room at the lever, in the Serverraum (8 tiles apart), at the radio (5 tiles), at the reactor and on the run out. Notstrom and Signalkette keep them in different rooms.
- **Reference.** The Skeld at 1×: Cafeteria→Reactor ≈ 11 s, Navigation→Reactor 18–20 s [W]. Overcooked shows the whole kitchen on one screen.
- **Verdict.** Sound: corridors pass two easily; legs stay under 8 s, about half the Skeld's. Round off: fifteen 1-tile openings combined with corner catching.
- **Target.** Two-tile doorways on the main ways, or the corner nudge from item 1.

## 4 · Interaction model

- **Reach (code).** The server counts a player present at 1.6 tiles (gone at 2.0) and accepts E at 1.6; the client prompts at 1.5. Items 0.90 (client) and 0.95 (server); plates press at 0.55 and let go at 0.75.
- **Prompt and glow.** One target at a time, chosen by distance alone: „[E] Bedienen / Lesen / Durchsuchen / Aufschließen / … aufnehmen / … einsetzen". A 12-px teal pill on the canvas; the named object gets a breathing silhouette glow.
- **Press or hold.** Every action is a press except walking, sprint and talk; plates hold by standing. No input buffering and no cooldown on E.
- **Timing.** E to the panel takes 1–17 ms on the LAN and 207 ms at a 200 ms round trip. Pressing E the moment the prompt appears while walking up opened the panel 5 of 8 times on the LAN and 0 of 8 at 200 ms, each refused with „Zu weit weg — nur direkt an der leuchtenden Station." The prompt shows at 1.5 tiles, but the server judges a position up to 80 ms old.
- **Closing.** No ✕: E, Esc or a step puts a sheet down (220 ms slide); a device closes with Esc only („[Esc] Zurücktreten").
- **Second person.** The world shows A/B discs, minimap dots and an edge arrow to the free console. The device shows a partner LED: green „PARTNER Ben · Pult B", red „KEIN PARTNER". An input alone gets „Eingabe gesperrt: Am anderen Pult und bei den Regeln steht niemand." in the top banner, which lies under the open device (rendered: the device is the topmost element at the banner's centre) and is gone after half a second of walking.
- **Reference.** Portal 2 teaches the ping first and gives a countdown so that "both players see the GO at the same instant" [P]. KTANE cut an on-screen highlighter: "Bland was better" [P]. Alien: Isolation keeps external information diegetic [P].
- **Verdict.** Sound: one context key, silhouette glow, closing without ✕. Round off: refusals invisible, E unbuffered at 80-ms-old positions, no shared countdown at the sync stations.
- **Target.** Refusals spoken by the device's own display; buffer E for 150 ms; a shared 3-2-1 for the lever and the reactor.

## 5 · Mini-game presentation

- **Panels.** 680 px wide, 384–739 px tall: 22–43 % of a 1440×820 window, 28–49 % of 1280×720; the rack scrolls inside its frame at 1280×720. On a phone held sideways every device is a 680×359 box (74 % of the screen) that has to be scrolled: the terminal's keys sit below the fold.
- **Type.** Device text median 11–13 px, smallest 8–10 px (engravings, labels), largest 14–32 px (Morse readout 32, seven-segment 30). Fixed sizes that follow the text-size setting but not the window.
- **Controls.** Terminal keys 52×34 (13 of 13 under 44 px; 14 of 14 on the phone), lever grips 88×30, rack switches 36×34 (8 of 8 under 44 px on the phone). Probe keys are ≥ 52 px and signal keys ≥ 70 px tall.
- **Feedback (100 ms bursts).** A wrong move puts „ALARM · Fehlversuch · −N s" in the device head within 51–81 ms, with a 240 ms jolt and three red flashes. A lone pull drains a 2 s ring and springs back with „Zug verfallen — nur zu zweit zugleich". Solved: LED sweep of about 380 ms and a self-close at 500 ms (code), matching the lever's panel gone 932 ms after the first of two pulls 400 ms apart.
- **Each console alone.** Box colours or meter volts; sender signs or receiver keys; terminal codes or rack power. Each half reads as a device, but neither says what the task is.
- **First-timers.** Notstrom took people 59 and 107 s when they solved it; the user found the Serverraum overwhelming.
- **Manual.** 3–5 content pages per source (about 290–430 words). Morsetafel 11 + 2 rows over a page turn; Serverraum codes 2 + 4 items. At the large text size the lines run past the sheet's right edge and are cut off on every page.
- **Reference.** KTANE: 23 pages, one module per page, Who's on First on two [P]. Spaceteam: one instruction at a time per player [S]. XAG 101: 18 px at 1080p on PC [P]; Apple 44 pt, Material 48 dp targets [P].
- **Verdict.** Round off. The devices look and sound like hardware; type, targets and page breaks need tuning.
- **Target.** Body text ≥ 14 px, readouts ≥ 18 px, targets ≥ 44 px, one station per book spread with tables whole.

## 6 · Information flow in co-op

- **Who sees what.** The station's instance only at its console, the rules only at their source, the Laborkennung only after the sign, the partner as a minimap dot and a crew-strip tag („am Pult B", „liest").
- **Channels.** Push-to-talk voice with distance falloff (code: full within 4 tiles, 15 % beyond 10, ×0.35 through walls); quick chat with 8 fixed phrases; ping rings with an edge arrow; a private notepad.
- **Forced talk.** Four of six stations need it (Notstrom, Signalkette, Serverraum, Frequenz); the lever and the reactor need only timing. None of the 8 phrases can carry a station's data, and „Alle an die Ventile!" names valves Blackout does not have.
- **Voice where it is needed.** Signalkette A↔B −25.6 dB; Notstrom box↔book −25.6 dB, box↔meter −10.6 dB; Serverraum terminal↔rack −7.3 dB; radio↔cabinet −1.3 dB.
- **Dead air in the plan.** Ben waits 7.7 s at the reactor while the fuse comes (33 s from Frequenz to reactor in the scripted run, with drones). Anna waits 5 s before the Notstrom door. At the box Anna idles while every round is measured.
- **Reference.** We Were Here: the walkie-talkie works while held, with no distance [P]. KTANE: every decision should "promote interesting communication" [P]. Operation: Tango: "Downtime in asymmetrical co-op is never an option!" [P].
- **Verdict.** Wrong foundation for remote crews (falloff fights the two-place stations). Sound for a crew side by side.
- **Target.** Full-volume radio between the consoles and the source of the armed station; falloff everywhere else.

## 7 · Feedback consistency

- **Sound.** Every device action has a sound and a picture: press, reject, alarm, solve.
- **Gaps.** The E chirp says yes before the server does. Refusal text hides under devices and is wiped by the next position message. Walls are silent. Q, chat sent and received, page turns, the Laborkennung, the notepad and reaching the hatch are silent. The solve chunk plays only at the consoles; the reader gets a silent stamp, and their room's lights wait until they put the book down. The drone warning reuses the ping recording.
- **HUD before the world (code).** On a solve the objective bar changes at 0 ms, the room lights at 500 ms (after the panel closes) plus 500 ms warm-up, the radio at 1000 ms. Doors and the escape start under the dimmed panel. The Laborkennung toast can trail the sign by 7 s.
- **Reference.** Ken Birdwell (Valve, 1999): "the game world must acknowledge players every time they perform an action" [P]. Swink, *Game Feel* [P].
- **Verdict.** Round off.
- **Target.** Sounds that wait for the server's answer, refusals on the device, a wall thud with the steps stopped, HUD changes timed with the world.

## 8 · Difficulty and pacing

- **Budget (mission data).** 900 s at Normal (alarm limit 5), 1215 s at Entspannt (no limit), 720 s at Hart (limit 3).
- **Scripted crew (seed 5), this audit's walkthrough.** Won 376.3 s after the lights went out, 483.7 s left, one alarm (a deliberate wrong key). Lever 25.0 s, Notstrom 198 s (harness captures included), Signalkette 18.5, Serverraum 35.9, Frequenz 26.3, Reaktor 32.9, reactor to hatch 27.9 s while waiting out the drones. A second run won in 382 s; the last four logged wins took 376–378 s.
- **People.** 7 runs, 0 won. Lever 70–164 s in three runs, never solved in the two Entspannt runs (one of them the user alone in two browsers). Notstrom 59 and 107 s (old map), unsolved after 710 s (XL map). Signalkette never solved (4 alarms + 1 hint; 1 alarm + 1 hint).
- **Pressure after station 3.** Drones wake (station 3: 1.7 tiles/s, 4.5-tile cone; station 4: the Labor drone). Relay emergencies start at once, then every 150 s, 45 s each, −60 s if missed. Penalties run 20–30 s per wrong move (60 s from the third short circuit), 15 s per drone sighting.
- **Reference.** Portal 2's first co-op course "held back on the vast majority of player actions" [P]. Escape Academy: first room 10 minutes, levels 15–30 [S]. Escape Simulator: the 15-minute timer is "an optional challenge, not a fail condition" [P].
- **Verdict.** Round off the curve; question in item 12 about the timer.
- **Target.** A first-timer crew finishes station 2 inside 5 minutes; measure it in `runs.jsonl` before tuning further.

## 9 · First minute

- **Opening (code).** 32.7 s: a 1.5 s location card, a 28.2 s pan, a 3 s hold. The PA lines are atmosphere only, so a player who skips with Space („(0/2)") misses nothing that matters. Lights go out once everyone has skipped.
- **After the bang (code).** Title 1.5 s, control back at +1.9 s, HUD at +2.2–2.5 s, then the first radio line (10.4 s): „Geht zuerst ans Notlicht, der Hauptschalter im Flur braucht zwei Leute."
- **First prompt.** „[E] Bedienen" at the lever comes no earlier than bang + 4.3 s. A player spawned in the Archiv is first offered the SICHERUNG and the sign.
- **First win.** In the walkthrough both skipped, the lights went out 7.4 s into the run, the start line spoke 10.1 of its 10.4 s, and the lever fell 25.0 s after the blackout. People took 70–164 s, and never managed it in the two Entspannt runs.
- **Reference.** Portal 2's first room: look up, look down, walk to a painting, then jump [S]. Half-Life's tram: about 5.5–6 minutes of exposition with no prompts [S/W].
- **Verdict.** Sound opening; round off the first win.
- **Target.** First win inside 30 s for people: a longer window (for example 4 s) or a shared countdown.

## 10 · Readability and UI shell

- **HUD.** DOM text 9–24 px; the Laborkennung chip's headers are 9 px, „ALARME" 10 px, „unterwegs" 11 px. Every HUD text reaches 4.5:1 over the dark world (computed from the rendered colours).
- **Text size setting.** Canvas text stays fixed at 11–13 px (room names 13, prompts 12, arrows 11): at 1.15 the HUD grew by 15 %, the canvas labels did not change. The book's text grows but its sheet does not, so lines are cut off at the right edge.
- **Canvas contrast (from screenshots).** Prompt pill about 10.9:1. Room names in the dark 4.5–5.5:1, but „FLUR" over the lit floor about 1.3:1. Labels collide on the phone („HALTEN · TÜKLEMMBRETT").
- **Density.** The objective bar covers 120 of 671 canvas px at 1440×820 (18 %), 91 of 285 on the phone (32 %), where the touch cluster also covers 40 % of the lower half.
- **Modal stack.** Error banner 40 < device or sheet 55 < notepad 58 < relay console 59 < overlays 60 < settings 61, so refusals hide under any open device.
- **Reference.** XAG 101: 18 px at 1080p on PC, 26 px on console, scalable to 200 % [P]. Game Accessibility Guidelines: 28 px minimum at 1080p [P]. WCAG 2.2: 4.5:1 [P]. Dead Cells: "visuals have to reflect the degree of importance of each information" [P].
- **Verdict.** Round off.
- **Target.** Canvas labels follow the text size, a halo or plate under every room name, the HUD's smallest text 12 px.

## 11 · Netcode and robustness

- **Reload.** The partner saw the run pause for 56 ms; the reloaded player was back in the world after 187 ms, on the same spot.
- **Silent line (lid shut).** The run paused 24.7 s after the line went silent (pings every 10 s, dropped on the second missed pong) and resumed 1.0 s after it came back. Those 24.7 s ran off the real clock. During the pause the partner's HUD clock kept counting down (14:31 to 14:25) and jumped back to 14:29 on resume.
- **Clock.** No server-time offset: a device clock 5 s ahead showed 14:50 while the partner's showed 14:55.
- **200 ms round trip (delay proxy).** E to panel 207 ms; the partner's position arrives 234 ms after it was sent (p50, p95 265 ms); the plate-door freeze in 1 of 4 trials, against 4 of 4 on the LAN.
- **Two browsers on one machine.** Every sound plays on both pages. The start line began 4.4 s apart (the sign's toast holds one page's line back); the lever's line 6 ms apart.
- **Reference.** Claypool & Claypool (CACM 2006): about 100 ms tolerable for first-person, 500 ms for third-person views [P]. Overwatch launched at 20.8 Hz updates [S].
- **Verdict.** Round off: reconnect, pause and resume work; the door freeze is a defect; clocks need a server offset and must stop with the run.
- **Target.** Server time in every view (offset estimate), the door's start-tile rule on the client, a sample timestamp in `pos`.

## 12 · Foundation questions (no decisions)

| Question | Trade-off | Evidence that would settle it |
|---|---|---|
| What should one screen show: a fixed radius round the player (Among Us) or most of the level (Overcooked)? | Tension and searching against overview and calm | One playtest crew per framing, timed per station, on a density-2 laptop |
| Should speech at a working station go by radio at full volume? | Proximity sells the place; distance kills the talk the stations demand | One remote crew on the Signalkette with in-game voice only, with and without the radio |
| Must the reader stand at the source while the other works (manual-only + presence)? | Forces talk (KTANE) but pins both bodies and costs walking; KTANE's expert holds the manual | Time from „station armed" to first correct input, source fixed against carried |
| Is the 2 s window right for the lever and the reactor? | Real sync feeling against latency and a solo two-window tester | Lever times in the next five human runs; a shared countdown as the alternative |
| Should a first run fail on time at all? | Urgency against learning; Escape Simulator makes its timer optional | Human win rate and quit points over ten runs with the timer and without |
| Is Notstrom the right second station? | It stacks book, sign, plate door and two consoles before any easier handbook station | First-attempt times per station from `runs.jsonl` |
| Does the third spawn earn its place? | Supports three players, but the stations are built for two | One three-person run: the third player's idle share |
| Is the 27×17 loop the right size? | Short legs (≤ 8 s) against the "more space" the user asked for; the loop opens only at station 5 | Walking share and meeting count from position telemetry of real runs |

---

## Evidence and scripts

| Item | Files |
|---|---|
| Movement | `m1-movement.mjs`, `m1-movement-gpu/` (results, frame logs, remote bursts `remote-burst-*.png`), `a1-remote-alternatives.mjs`, `a1-analysis/` |
| Camera | `m2-camera.mjs`, `m2-camera/` (five screenshots, results) |
| Space | `m3-space.mjs`, `m3-space/results.json` |
| Netcode | `m4-net.mjs`, `m4b-net.mjs`, `m4c-net.mjs` (delay proxy in each), `m4-net/` (`results-all.json`, `results-b-all.json`, `results-c-reload-silent.json`, `pause-anna.png`) |
| Panels | `gallery-missions.mjs` (six one-station missions in `custom-missions/`), `m5-panels.mjs`, `m5-panels-desktop/` and `m5-panels-phone/` (results, a screenshot per device and size, 100 ms bursts `*-lone-*`, `*-solved-*`, `*-cut-*`, `*-key-*`, `*-cmd-*`, `*-send-*`) |
| Readability | `m6-readability.mjs`, `m6-readability/` |
| Voice | `m7-voicegain.mjs`, `m7-voice/` |
| Manual | `m8-manual-pages.mjs`, `m8-manual/` |
| Renders of census claims | `m9-verify.mjs`, `m9-verify/` |
| Runs | `m10-runs/blackout-runs.json` |
| Walkthrough | `harness-black/` (99 captures), `logs/harness.log`, `data/runs.jsonl` (this server's two run reports) |
| Code census | `census-minigames.md`, `census-feedback.md`, `census-interaction-ui.md` |
| References | `references-raw.md` |
| Helpers | `lib.mjs`, `server.sh`, `audit-server-3341.mjs`, `quiet.sh`, `run-chain.sh` |

---

## Stand nach N-foundation

Branch `N-foundation` (on main `b606247`): one commit per item, then one per finding of a code
review of the branch. Measured on 2026-11-01 with the audit's scripts, copied to
`scratchpad/foundation/` and pointed at port 3351, on a quiet machine (1-min load under 4, no
other walkthrough), the base (`b606247`, built beside it) run alongside. The plate door, E on
arrival and the partner's figure were measured again on the branch head after the review, the
partner's figure with the base between its runs (A B A B); the other rows on their item's own
build, which the review's fixes leave alone. Findings by the numbers of the table above.

| # | What | Measure | Before | After |
|---|---|---|---|---|
| 5 | Partner's figure, drawn 150 ms in the past | step variation (m1 metric) | 0.435, 0.430 | 0.271, 0.281 |
|   |   | the same, where the walker also walked 150 ms before | 0.345, 0.342 | 0.086, 0.115 |
|   |   | broadcasts repeating the walker's last sample | 39 of 95, 39 of 95 | 2 of 56, 3 of 56 |
|   |   | lag behind the walker, p50 | 153, 149 ms | 153, 152 ms |
| 4 | Plate door shutting on a walker (8 trials) | frozen on the LAN · at 200 ms | 8 · 0 | 0 · 0 |
| 7 | One-tile opening, the audit's 11 trials and ±0.45 | passed | 5 of 13 (to ±0.20) | 13 of 13 (to ±0.43) |
| 7 | W held 2 s against a wall | footfalls · thuds | 15 · – | 1 (the 0.21 tiles to it) · 1 |
| 10 | A device whose clock runs 5 s ahead | clock against its partner | 5 s off, 0 of 10 alike | 1 ms off, 9 of 10 alike |
| 10 | A run paused by a silent line | counted 6 s in · jump on resume | 6 s · +5 s | 0 ms · −4 ms |
| 6 | E the moment the prompt shows (one judged press per run) | opened on the LAN · at 200 ms | 4 of 8 · 4 of 8 | 8 of 8 · 8 of 8 |
| 6 | A refusal at an open device | where it shows | banner under the device, wiped by walking | the device's head, on top |
| 11 | The start line on two pages, one spawned at the sign | apart | 4.41 s | 0.89 s (each screen's cold open) |
| 11 | A message sent while the socket reconnects | – | throws | held for a socket on its way, sent once its session is back |

**After review.** A review of the branch found two bugs, four risks and five smaller faults. Each
has its own commit, and a test that fails without it gives its numbers:

| Finding | Before | After |
|---|---|---|
| E pressed just before reach of a station already open | up to 8 chirps and panel opens | 1 |
| The spot E was pressed on, echoed to a player 1.6 tiles further on | pulled back to it | kept as sent, nothing pulled |
| A frame's moment on the server's clock after a minute asleep | partners drawn 60 s late | on time |
| A partner's samples kept on a 300 ms line over ten minutes | 7 500 | 12 |
| A step into a door that shut first on the server | let out the far side | back the way it came |
| A puzzle press made while the line was down | sent once the line is back | dropped with one warning |
| Messages waiting where the server refuses the session | each one „Noch in keinem Raum." over the reason | dropped with one warning |
| Countdown beeps over a 10 ms clock correction | 7, 6, 7, 6, 5 | 7, 6, 5 |
| The note slip 20 s into a pause | offers the note 10 s early | still 10 s |
| A drone woken held still, a spectator coming in | reaches the crew up to 1 s late | on the next 80 ms tick |

**What changed.** Every `pos` carries the frame it was walked in and the server relays it with
its receipt; each screen draws a partner 150 ms behind on the server's clock, straight between
the samples round that moment, at most 100 ms past the newest, a walk after a long stand setting
off as late as its pace allows (`world/trail.ts`); positions fan out only when a sample is new, a
step was refused or a drone moved, and once a second besides. An avatar walks — and is sent as
walking — only while it covers ground. The client lets a body out of a door that shut on it as
the server takes the step. A body caught on the edge of an opening slides into it (up to 0.3
tiles); against a wall the steps stop and it thuds once a push. Views carry the server's time,
the page asks for it (median of five round trips) and every countdown to a moment the server set
reads that clock, standing still while the run is paused. E goes out with the spot it was
pressed on, is judged there, waits 150 ms for reach when pressed early, and chirps on the
server's yes; refusals are said in the device's head and on the prompt pill, not in the banner,
which no position wipes any more. An emergency cleared chimes, a missed one is silent but for its
alarm; the reader hears a solve quietly and sees its room light up behind the book; Q, page
turns and the notepad sound; the radio goes on the air before the sign's note. A message waits
only for a socket on its way — still connecting, or waiting for its session — and goes out once
the server has the session back; while none is on its way it is dropped with one warning, so
nothing done blind lands once the run goes on.

**Not reached, and why.** The m1 step variation stays above the 0.25 the audit's replay
promised: 0.271 and 0.281. The metric counts the frames where the walker is walking now, and
150 ms later the figure faithfully replays the walker's own stops — the start and three 80-ms
turns of the script, 25 of about 238 frames; where the walker also walked 150 ms before, the
variation is 0.086 and 0.115. The audit's own timestamped replay lands on either side of the
target with the recording: 0.218 and 0.224 on today's base recordings, 0.258 and 0.266 on the
branch's own, where the branch's `trail.ts` replayed gives 0.271 and 0.282, as drawn live. Left
on each device's own clock: the opening, the cold open, the briefing and the end's timeline,
which animate from server moments but count nothing down.

**About the scripts.** m4b's arrival trials judge a press only until one succeeds: the lever
stays switched on, and every later press opens its panel without asking the server — the audit's
5 of 8 on the LAN were three refusals, one press taken and four that asked nothing (its 0 of 8 at
200 ms were all judged). `m4e-arrival.mjs` presses once per fresh run. m4's clock test shifts
`Date` only; the copy shifts the page's time origin with it, as on a device whose clock runs
ahead. Since the review a frame's moment goes over from the server's time now, so a `Date`-only
shift draws the partners on time as well (`clock.test.tsx`).

**Walkthrough.** On the branch head `tools/shots.mjs` played both missions to the end, with
`SHOTS_SOFTWARE_GL=1` and without: Blackout 99 captures, 3 skipped, 0 failed (won 383.6 s and
377.3 s after the lights went out), Systemcheck 76 captures, 9 skipped, 0 failed (won in 3:34 and
3:33). Every frame window gated at 40 ms held at 16.8 ms p95 or less.

---

## Stand nach N-readability

Branch `N-readability` (on main `3134e78`): one commit per item — the book's pages
(`c1cc5c6`), the canvas text (`8fba064`), the phone's controls (`345fe96`), the devices' type
and targets (`a92705b`), these notes — and two the walkthrough asked for: the minimap 56 px
tall for a wide map too (`1280e43`), the phone shots' names (`ea60b87`). Measured on 2026-11-01
with the audit's scripts, copied to `scratchpad/readability/` and pointed at port 3372, on a
quiet machine (1-min load under 4, no other walkthrough), the base (`3134e78`, built beside it)
run by the same scripts in the same hour. Findings by the numbers of the table above.

| # | What | Measure | Before | After |
|---|---|---|---|---|
| 9 | Device text, Blackout's six devices (m5) | smallest · median, px | 8 (the rack's I/O) and 10 · 11–13 | 11.1 · 11.2–14.3 |
| 9 | Controls under a pointer's 36 px (m5, per window) | count | 31 (keys 52×34, grips 88×30, switches 36×34, the way back 13 px high) | 0 |
| 9 | The rack at 1280×720 | panel · scrolls | 739 px · 77 px, a control out of view | 471 px · no |
| 9 | Devices on a phone held sideways (m5) | scroll · under 44 px · out of view | all 11 consoles in a 680×359 box · 42 of 71 · 50 | none · 0 · 0 |
| 9 | The terminal on that phone | controls out of view | 14 of 14 | 0 |
| 9 | The relay console on that phone · at 1280×720 | scrolls | 319 px, all 13 controls out of view · 16 px | 0 · 0 |
| 9 | Morsetafel · Serverraum codes (m8) | over a page turn | 11 + 2 rows · 2 + 4 items | whole · whole, at 0.9, 1 and 1.15 |
| 9 | The Archiv's book at the large text size (v-book) | pages running past the sheet | 3 of 3, in each of three windows | 0 |
| 10 | The HUD's smallest words (m6) | px | 9 (the Laborkennung's heads), 10 (ALARME), 11 („unterwegs") | 12 |
| 10 | ALARME at the large text size | px | 11.5 | 13.8 |
| 10 | FLUR on the lit corridor | contrast | 1.26:1 (1.82 in its box) | 4.96:1 on its plate |
| 8 | Steering on a phone held sideways (v-phone) | — | four 42-px arrows on the right, 4 ways | nine 48-px cells at x 22–168, 8 ways, a slide turns |
| 8 | The objective bar · with a line on the air | share of the canvas | 20.5 % · 31.8 % | 13.5 % · 23.9 % |
| 8 | The minimap on that phone | px | 54×34 (41×26 under a line) | 135×85 (the Systemcheck's 152×56) |

**What changed.** Every word on a device takes its role's size from four tokens on the root —
engraved 11 px, a label 12, read off a face 14, a readout 18 in 720 px of height, a little more
in a taller window, all times the text size — and every control is a target, 36 px under a
pointer and 44 under a finger (`docs/art-bible.md`, „Type and targets"). The rack and its
Netzplan stand side by side; the terminal's prompt, the way back and the relay's „Ablauf
nachlesen" reach their target over the chassis round them; the station and relay frames take
the modal's whole height. On a phone held sideways a device takes the window, the Laborkennung
and the coach line in a column beside it, a long list scrolling in its own box (the terminal's
log, kept at its newest line); the relay console stands in two columns. The book's pages are
estimated at the reader's text size, tables and rule lists move whole to the next page, a
heading never ends a page, and a station's rules open on a spread where a page alone would not
hold them. The canvas text follows the text size, room names stand on plates, prop labels give
way to each other. On the phone the steering pad lies under the left thumb, the actions under
the right, the objective bar a quarter of the canvas at most.

**Not reached, and why.** Targets are asserted for Blackout's devices and its relay console
(`test/deviceTargets.test.tsx`) and measured there (m5, `v-relay.mjs`); the other missions'
devices keep the sizes their layouts give them, and only their type floor is tested. The
walkthrough's phone shots cover the devices the guest's phone opens — the lever, the meter,
Signalkette console A, the rack, the reactor, and the relay console when an emergency comes; the
box, the receiver, the terminal and the radio panel are worked in the host's window, and m5
measures them on the phone, `v-relay.mjs` the relay console.

**About the scripts.** m5 also counts the controls under 36 px, the modal's own scroll and the
controls out of view, and reads SVG text as drawn — its set size times the drawing's scale —
where the audit took 0.8 of its box's height, which reads an 11-px label as 10.4 px; no base
minimum came from SVG text. m6 measures a room name in the box of its plate at the name's
anchor: a name the canvas leaves out — under the radio line (ARCHIV, 2.99), the minimap
(OST-FLUR) or, at the large text size, a prop's label (the second FLUR, 1.21) — measures what
lies there instead. The gallery gained „Audit relay", Blackout's relay emergency 2 s into a run;
`v-relay.mjs`, `v-phone.mjs`, `v-book.mjs`, `v-parts.mjs` and `v-netzplan.mjs` are new probes.

**Walkthrough.** `tools/shots.mjs` played both missions to the end, with `SHOTS_SOFTWARE_GL=1`
and without, on a server whose custom missions started empty (the audit's six gallery missions,
left on the server of the last package's run, had made its join screen scroll by 79 and 179 px):
Blackout 108 captures, 4 skipped, 0 failed (won 400.7 s and 387.6 s after the lights went out),
Systemcheck 79 captures, 9 skipped, 0 failed (won in 3:39 and 3:36). Every device the guest's
phone opened stood whole sideways, every control in view and 44 px at least
(`device-phone-*.png`); no relay emergency came in either Blackout run, so its shot is skipped.
No screen scrolls, the join screen at both laptop sizes included. Every frame window gated at 40
ms held at 33.4 ms p95 or less under software GL and 16.8 ms without. Blackout ran on
`a92705b`'s client with `ea60b87`'s harness — `1280e43` leaves its 27×17 map's minimap as it was
in every window — the Systemcheck on the head. The smoke passed; core 1392, server 250, client
2714 and tools 77 tests pass.

---

## Stand nach N-camera

Branch `N-camera` (on main `4767fba`): one commit per item — the frame in CSS pixels
(`ff056d6`), the band below the objective bar (`b91489b`), the walkthrough at density 2
(`b914e90`), the pixel checks with these notes, the framing in the art bible and the backlog.
Measured on 2026-11-04 with the audit's camera script, copied to `scratchpad/camera/` and pointed
at port 3421, on a quiet machine (1-min load under 4, no other walkthrough), main (`4767fba`,
built beside it) run by the same script the same morning. The copy reads CSS px a tile at the
density the canvas draws at — 2 on a 3× phone, where the audit's copy divided by 3 and logged
20.4 (its table carried 30.7) — inside the canvas's 1-px border, and measures each screen twice:
at the audit's moment, a line on the air, and once none is. Finding 1 of the table above.

| Screen | CSS px a tile | Tiles across × down | Below the bar, a line on the air · none | Figure |
|---|---|---|---|---|
| 1440 × 820 @1 | 63.7 → 58.2 | 22.2 × 10.5 → 24.3 × 11.5 | 8.5 · 9.2 → 9.3 · 10.1 | 54.2 → 49.4 px |
| 1440 × 820 @2 | 52.4 → 58.2 | 27 × 12.8 → 24.3 × 11.5 | 10.3 · 11.3 → 9.3 · 10.1 | 44.5 → 49.4 px |
| 1280 × 720 @1 | 54.2 → 48.9 | 23.1 × 10.5 → 25.7 × 11.6 | 8.1 · 9.0 → 9.0 · 10.0 | 46.1 → 41.5 px |
| 1280 × 720 @2 | 46.4 → 48.9 | 27 × 12.3 → 25.7 × 11.6 | 9.5 · 10.5 → 9.0 · 10.0 | 39.5 → 41.5 px |
| phone 844 × 390 @3 | 30.6 → 32.1 | 27 × 9.4 → 25.7 × 9.0 | 7.2 · 8.2 → 6.9 · 7.8 | 26.0 → 27.3 px |

Held at a side wall (`pinned.ts`: the client's own `clampCamera` over every floor tile, the bar at
rest): at 1440 × 820 on 80 % of the floor's tiles at density 1 and 97 % at 2 before, 88 % at both
after; at 1280 × 720 88 % and 97 % before, 97 % after; on the phone 97 % before and after. Up and
down 57 % on a laptop after (57 % and 73 % at 1440 × 820 before), 29 % on the phone.

**What changed.** A player's frame is set in CSS pixels (client `world/viewport.ts` `tileCss`): a
tile stands the world canvas's CSS height over 11.5 from 600 px up, over 9 below, within 28 and
96 px, drawn at the canvas's density (render/backing.ts, at most 2). Below the objective bar the
frame keeps a drone's 4.5-tile reach twice with keys and 1.5 times on a touch screen; where the
tile count would leave the band shorter the band wins — at 1280 × 720 — and the bar counts with
a line on the air: its steady row, the clock's column or the goal down to its title, and the row
of a radio banner set into it unseen and taken out in the same moment (`world/insets.ts`), so the
zoom never moves with a line. The audience keeps the whole lab; the opening's shot keeps the lab
over the whole canvas. The walkthrough logs each screen's frame (camera-1440.png,
camera-1280.png, camera-dpr2.png, camera-phone.png) and in Blackout looks at the lit lab, the
first station's open panel and the escape on the host's page drawn at density 2 as well —
switched through CDP, as Playwright fixes a context's density once it is made and a third player
would change the crew the pinned draw is played by — a frame window there for information, a
shot at the page's own pixels, and a failure where the frame at 2 lies more than 0.2 tiles from
the one at 1. The same harness on main's client fails exactly those four checks, 9.51, 4.81, 4.45
and 4.81 tiles apart.

**Reading the rule.** The plan counted the view's height „below the objective bar"; the rule
reads the canvas's whole CSS height and lets the bar in through the band. Counted on the band
alone, 1440 × 820's 588 px would fall under 600 and show 10.2 tiles of height, and the phone 10.3
with a figure of 24 px against 26 before — against the decision's 11.5 on a laptop and fewer,
larger tiles on a phone held sideways — and every line on the air would move the zoom.

**Pixel checks.** The join screen, the Bestenliste, the editor and the lobby — 13 screens at
three sizes, each build on a fresh server, with reduced motion and the room code written over
(`screens-check.mjs`) — came out pixel for pixel the same on main and the branch; the client's
bundle differs in its world chunk alone (the shell chunk, the stylesheet and core alike but for
chunk names, the service worker but for its version). The walkthrough's captures, main's Blackout
run against the branch's: 117 of 122 differ — the world's own shots by 23 to 84 % of their pixels,
the tile; devices and pages over the dimmed world by 2 to 40 %; the audience's whole lab
(spectate.png, dpr2.png) by under 1 %, live drones and the clock; the join screen and the lobby
where the run's content does: a best time from the run before, the room code, the figures'
glances. The art
bible's Crispness and Cost sections carry the new baseline.

**Not reached, and why.** The band holds 9 tiles with one line on the air, not with more: an
emergency's alert or an alarm over a line, or the escape's checklist under the goal's title
(about 8.8 tiles at 1280 × 720 with a line), take it lower while they stand; counting them would
zoom the world as they come and go. „Hart" stretches the drones' cone to 5.2 tiles: the frame
holds the normal difficulty's reach twice and stays the same at every difficulty. The camera
follows sideways only in the lab's middle columns: the decision's 11.5 tiles of height show 24 to
26 of the lab's 27 across — T-5, the larger rooms, is where that changes. A canvas wider than
2.35 : 1 shows the lab whole across, dark beside its walls.

**About the scripts.** In `scratchpad/camera/`: `m2-camera.mjs` (the copy above), `bar-parts.mjs`
(the bar's rows, CSS px), `probe-line.mjs` (the unseen banner against a real line on the air: 38.3
px at a laptop's size and 25.5 on the phone, both alike), `pinned.ts`, `screens-check.mjs`, and
`bench/`, the polish package's paced bench at the host's 1414 × 669 canvas and both densities,
built from the branch's tree twice, once with main's rule patched back in (art bible, Cost).

**Walkthrough.** On the branch head `tools/shots.mjs` played both missions to the end, with
`SHOTS_SOFTWARE_GL=1` and without: Blackout 122 captures, 5 and 4 skipped (the fifth a solved
device shot late under load), 0 failed (won 432.7 s and 427.7 s after the lights went out);
Systemcheck 84 captures, 13 and 12 skipped, 0 failed. At density 1 every gated window held
33.4 ms p95 or less under software GL — the open station panels, as on main — and 16.8 ms
without; the looks at density 2 held 16.8 ms or less. Main's client, run back to back with the
branch's by the same harness, held the same windows in Blackout. The smoke passed; core 1507, server 266, client 2829 and
tools 85 tests pass.

---

## Stand nach N-xxl

Branch `N-xxl` (on main `b14c6cd`), T-5 of the backlog on the user's word that the rooms can be
larger: one commit per item — the map (`305f80e`), the drones' beats (`d896ead`), the clock's
share in the walkthrough's log (`9a473b0`), the camera's tests on the larger lab (`081391e`), the
harness, the smoke and the bakes (`580972d`), these notes. Measured on 2026-11-05 on a quiet
machine (1-min load under 4, no other walkthrough) with the audit's camera script and a travel
probe, copied to `scratchpad/xxl/` and pointed at port 3451; main's lab, saved on the same server
as a scratch mission, measured by the same scripts in the same quarter of an hour. The walks are
the plan's, the eight ways a player steers at 4.2 tiles a second, round furniture and the doors
shut at the time (`scratchpad/xxl/design.mts`; core's missionMaps test holds each under 12 s).

| What | Measure | Before | After |
|---|---|---|---|
| The lab | tiles · floor tiles | 27 × 17 · 289 | 36 × 22 · 544 |
| Rooms · corridors | tiles | 6–7 × 5, the Serverraum 9 × 5 · 3 wide | 9 × 7, the Serverraum 11 × 7 · 4 wide |
| Openings one tile wide | count | 15 | 6 |
| Furniture in a room | pieces | 6–12 | 10–12 |
| The plan's longest walk | s | 9.2, the escape | 11.7, the escape |
| The plan walked, Anna · Ben | s | 43.2 · 41.3 | 55.5 · 53.9 |
| The escape by the Labor · by the Serverraum | steps on the grid | 40 · 40 | 52 · 52 |
| The walkthrough's win, after the lights went out | s | 403.1 and 417.6 | 461.7 and 467.1 |
| Left on the clock at „Normal" | s · share of 900 | 412.4–427.0 · 46–47 % | 377.9–383.3 · 42–43 % |
| Walking in the walkthrough, host · guest | s | 61.0–65.0 · 51.3–56.0 | 79.8–80.1 · 65.5–65.9 |
| Held at a side wall (`pinned.ts`) | share of the floor, 1440 × 820 · 1280 × 720 · phone | 88 · 97 · 97 % | 63 · 69 · 69 % |
| Held at the top or the bottom | the same | 57 · 57 · 29 % | 39 · 39 · 21 % |
| The view's travel from wall to wall | tiles, 1440 × 820 · 1280 × 720 and phone | 2.7 · 1.3 | 11.7 · 10.3 |
| Walking the Flur east (`m2-travel.mjs`, 1440 × 820) | frames the camera moved in · its travel | 14 % · 2.7 tiles of 20 | 42 % · 11.7 tiles of 28 |
| The minimap (m2) | CSS px, 1440 × 820 · phone | 189 × 119 · 135 × 85 | 180 × 110 · 126 × 77 |

The legs, seconds before → after: Anna's start → the lever 2.9 → 4.0, Ben's 2.5 → 3.6; the
lever → the book 3.6 → 4.9, → the Laborkennung 1.4 → 1.8, → the plate 2.1 → 2.8; the lever → the
fuse box 3.2 → 4.2; the plate → the meter 1.1 → 1.5, → the clipboard 1.6 → 2.4, → console A of
the Signalkette 2.8 → 4.3; the fuse box → its console B 1.9 → 2.4; console B → the terminal 7.1
→ 8.7; console A → the locker 3.8 → 4.5, → the rack 1.4 → 1.5, → the key 0.5 → 0.7, → the
cabinet 7.6 → 8.7; the terminal → the radio 7.5 → 9.4, → the spare fuse 4.0 → 5.1, → its slot
7.8 → 10.3; the cabinet → the reactor 4.1 → 5.8; the escape by the Labor 8.8 → 11.4, by the
Serverraum 9.2 → 11.7 (`docs/gameplay.md`, „Walking Blackout's lab").

**What changed.** The lab keeps its ring, its station chain, its stories and its names at 36 × 22
(`docs/art-bible.md`, „Blackout's lab"): rooms of 9 × 7, the Serverraum 11 × 7 with its pillars,
corridors four wide; the main ways open two tiles wide, and only the doors that are devices — the
plate door, the Serverschott, the Labor's and the Reaktor's — stay one tile. The loop closes
after the fifth station as before; the hatch lies in the Archiv's corner. The three starts keep
their order and lie out of each other's sight, every source keeps as many places, moved with its
room, so seed 5 draws as before and stays pinned; the plan fixture moved with them. Every room
stands eight pieces of its own kind at least (core missionMaps), every corridor a wall prop in
four tiles at least (client dress), the Ost- and Süd-Flur on a buttress each. The Flurwache paces
the long Flur, the Laborwache the Süd-Flur and the Labor's east side, at the reach and pace they
had; the patrol tests find a haven by every place the plan works at, stage by stage, and the
camera plate, the Serverschott's front and the Süd-Flur watched. The time limit stays 900 s: the
plan leaves 42–43 % of it, over the 40 % below which it was to be weighed anew, and the
walkthrough's log now gives the share. The walkthrough and the smoke read every place from the
mission. A bake is held to 4096² pixels and 8192 a side, so the lab lit whole bakes pixel for
pixel at density 2 (art bible, Cost).

**Not reached, and why.** The corridors carry pipes, cable trays, posters, vents, extinguishers
and clocks, no lockers: the dressing has no locker on a wall, and one standing in a corridor would
read as the Spind, the Serverraum's source of rules. A buttress narrows its corridor to three
tiles for a tile, the Flur's two as well, where they keep its ends out of each other's sight. The
camera still stands held at a side wall on 63 to 69 % of the floor: the rooms at the lab's ends
lie within half a view of its walls. The escape takes 11.7 s of the 12 allowed, and the crew
walks three tenths longer: the 42 % left is the scripted crew's, which walks without looking for
anything; a crew playing it first takes longer (N-6).

**About the scripts.** In `scratchpad/xxl/`: `design.mts` (the map's checks: the rooms and their
furniture, the plan's walks, both ways out, the corridors' props, the starts' sight), `pinned.ts`
(pointed at a mission file), `m2-camera.mjs` (reads the lab's size from the view), `m2-travel.mjs`
(new: Ben walks the Flur's longest open row east with D held, the camera's point, its lead and
his position logged every frame), `old-lab.mjs` (main's lab as the scratch mission „Altes Labor"),
`bench/` (the paced bench built with main's map and the new one, the bake rule both ways).

**Walkthrough.** On the branch `tools/shots.mjs` played both missions to the end, with
`SHOTS_SOFTWARE_GL=1` and without. Blackout: 125 captures, 3 skipped — the servers probe, which
Blackout plays itself, locker.png and next-mission.png, all three skipped on main too, where the
relay emergency's phone shot was skipped as well, as none came — 0 failed; won 467.1 s and 461.7
s after the lights went out with 377.9 and 383.3 s left, one drone alarm each, on the way out to
the hatch, none before. Systemcheck: 87 captures, 12 skipped, 0 failed, the same captures and
skips as main. A first Blackout run without software GL failed one check, the minimap's goal
dot: on the larger lab's 5-px cells the probe sampled the dot's rim; it samples the pixel the
dot's middle lies in now. Every gated window held 16.7 to 16.8 ms p95 but the open
Notstrom-Kasten and Signalprobe panels under software GL, 33.4 ms as on main; the looks at
density 2 held 16.7 to 16.8 ms, where the new map before the bake fix took the escape's to 33.4.
`art-overview.png` shows the lab whole. The smoke passed ten times on the branch's head, over
all three pairs of starts; core 1532, server 268, client 2867 and tools 87 tests pass.

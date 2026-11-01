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

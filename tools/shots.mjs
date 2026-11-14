/**
 * Visual check: drives two real browsers through menu → lobby → running
 * mission and captures the result at several window sizes, so layout work
 * can be looked at instead of guessed.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers \
 *     [SHOTS_MISSION=Systemcheck] [SHOTS_FRAME_P95_MS=40] [SHOTS_CPU_SLOWDOWN=4] \
 *     [SHOTS_SOFTWARE_GL=1] [SHOTS_WEBGL=1] [SHOTS_HEADED=1] [SHOTS_AUDIO_OFF=beds,music] \
 *     [SHOTS_PROFILE=1] [SHOTS_SERVER=packages/server/src/index.ts] \
 *     [SHOTS_ONLY=screens,intro] [SHOTS_SKIP=perf] \
 *     node tools/shots.mjs [baseUrl] [outDir]
 *
 * Groups (tools/groups.mjs): every capture, and every label a skip line carries, belongs to one of
 * sixteen groups; SHOTS_ONLY and SHOTS_SKIP, each a comma-separated list of their names, pick those
 * a run plays — a quick proof of one part. The drills, each in a room of its own before the
 * walkthrough: editor, art, drones (the danger sense, a drone close by), reconnect, restart, and
 * in a Systemcheck run the Serverraum's scratch mission, devices', and the Zugangskontrolle's,
 * access. The walkthrough's own stages:
 * screens (the menu and its sound, the history, the lobby, the run started from it), intro (the
 * opening to blackout.png, the cold open at density 2 with it) and run (the mission to the won
 * card: the lit rooms, the finds, the audience's way in, the escape, the end, and after the won
 * Systemcheck the account's runs and its deletion). Within the run: devices (every station's panel
 * and its phone held sideways), reading (the sources, the sign, the notes, the notepad, the books,
 * highlight.png), hud (the game at every window size, its panels, controls, minimap and sprint),
 * graphics (the light, the glow at a console, the figures, panel-close.png, the camera and
 * density 2), audio (the beds, the radio's lines, the partner's side, the music, the nudge), voice
 * (the microphones and the links) and perf (the frame windows). These need run and pull it in;
 * SHOTS_SKIP=run refuses them. Every group left out, refused or pulled in gets one line as the run
 * begins, and what it would have captured counts as neither skipped nor failed. The walkthrough
 * plays its stages only as far as the groups on reach — screens alone stops once the run is up,
 * intro after blackout.png — a stage whose group is off still opening the pages and the room,
 * starting the run, skipping the opening or walking on, as the next one needs. A capture or a check
 * belongs to the group of the step that takes it — checkGroup holds every capture to its step's
 * gate, so that every run proves the table — and where that step is another group's, it comes only
 * with that group on as well: perf's frame windows in screens' step (the menu), in intro's (the
 * opening's shot, the lit lab and its look at density 2) and in graphics' (the open panel and the
 * escape at density 2); voice's links after the guest's reload, which reading's notepad does; and
 * hud's Info button after a sign read on the way, reading's too, where nobody starts at the sign.
 * Without either variable every group plays, as before; the summary names the groups played, the
 * line before it the seconds each took. What each costs on a machine: the README, „Nur ein Teil des
 * Rundgangs (Gruppen)".
 *
 * SHOTS_MISSION names the mission card to start (default Blackout); the
 * crew is two players. Where the first station is a sync station, both
 * press it together, and the run fails unless it solves and each page's
 * LED strip shows it done — as the page noted on its own clock from before
 * the presses, so that the radio's banner over a phone's strip later hides
 * nothing; right after the
 * presses device-solved.png catches the solved device, its status strip
 * sweeping green, before it closes itself — the run fails where any sync
 * station never shows solved, is gone before it is looked at, lies under an
 * overlay, or does not close itself. A shot that lands only after the device
 * closed itself — the machine under load — fails nothing: the next sync
 * station of the run is shot instead, and where that one is late too, or
 * none follows, device-solved.png is skipped with the times measured.
 * Where the station after it has two consoles, each takes one and
 * both panels are captured; a Signalkette, as in the Systemcheck, they work
 * from both sides until it solves too.
 * Where the first station has two consoles, as Blackout's Notstrom-Kasten,
 * the guest holds the plate door for the host on the way to console A where
 * needed, then both consoles are captured and the meter measures every wire
 * once; nothing is cut. The first reading that moves the needle is shot
 * with its swing held 60 ms in by the page — the needle's own transition
 * paused there, so that a shot coming late under load still shows it on its
 * way — and the page has to say the needle swung, stood still through the
 * shot and on its way to the reading (meter-swing.png), or the run fails.
 *
 * The opening: a title comes on as a phosphor screen does, once a page
 * load — the game's on the start screen, the mission's in the lobby
 * (lobby-title.png). Every run opens on a location card (intro-card.png): the
 * plant, the wing and the shift for a mission with an intro, a mission's name
 * without one, the HUD out under it — a name card lets it back as it goes.
 * Blackout's intro shows the lab with its power on as a film:
 * intro-pan.png once the loudspeakers' first line stands subtitled between the
 * two black bars, the skip beside it, the camera running across the lab — the
 * host's frames over the shot sampled for information alone. The host skips
 * with Space and the guest's phone counts it (intro-skip.png, „(1/2)"); the
 * guest's phone, turned sideways as a large phone is (932×430), shows the shot
 * between its two bars, the skip line and a subtitle whole in the window and
 * nothing of the HUD (intro-phone-932.png), or the run fails.
 *
 * Cold open: while NORMALBETRIEB shows, the host's window grows to 1440×1000
 * and the host, free, steps into its room — its frames meanwhile the sample
 * of the lit scene — and cold-open.png catches the host's room lit whole and
 * warm: the run fails unless the floor of the host's own room comes out
 * bright on the canvas and the Serverraum's and the Labor's dark, tile by
 * tile through the camera the traced page reports. A player spawned at the
 * Laborkennung gets its note once its opening no longer fills the screen
 * (sign.png). Then the guest taps the opening away too: the whole crew done,
 * the lights go out at once, long before the intro's own end, and the
 * mission's title lands — on the guest's phone between the bars of the shot
 * it cut (intro-title-phone.png), on the host's window at the bang after the
 * flicker (intro-title.png), nothing of the HUD under either. On the host's
 * window the HUD comes back once the title has gone, the clock flashing as it
 * comes and mission control waiting for it. Two seconds after the clock comes
 * into sight comes blackout.png, the emergency lamps red. Then both go to the first station,
 * a main switch — whoever is locked in let out over a plate first — where the lamp over it turns
 * as a beacon: beacon-sweep-a.png and beacon-sweep-b.png a second apart, its lobe turned between
 * them as far as the page's probe says its clock turned it and the picture round the lamp
 * changed (sweep.mjs), or the run fails; grade-blackout.png shows the host's window in the
 * blackout's cool grade, which the probe has to name; beam-core.png the host's beam turned down
 * the longest free floor, its core brighter than its flanks (beamcheck.mjs); pose-console.png
 * the host back at the switch, both hands up on its panel, as the probe has to pose it. E
 * opens its panel for each (lever.png, every lamp lit, the player's own name
 * under the own lever). Where the view gives a press its expiry, the host throws alone:
 * lever-ring.png catches the ring round its grip draining; 1.3 s in,
 * lever-countdown.png and lever-countdown-partner.png catch the count beside
 * the levers on both pages — the digits no more than one apart, the partner's
 * naming who pulled, its crew strip tagging the host „zieht" — and the lever
 * has to spring back once the window shuts, the device saying so and the
 * count gone from both. Then both
 * throw together, the run fails unless the lights come up, and lit-flur.png
 * shows the room it lit, the panel closed by itself. The log says how long
 * the lever took from the blackout. A mission without an intro skips all of
 * this.
 *
 * The menu: the host's page opens on the start screen as a game's menu over its living scene — the
 * lit lab of the first mission baked for the window and drifting (client world/menu/) — menu.png,
 * walked by the keys: an arrow down and up the items, Enter opening „Einsatz starten" with the
 * picked mission's card in the focus, Esc back on the item. Its quiet window, the scene drifting,
 * is gated like every other and under SHOTS_SOFTWARE_GL has to keep the screen's pace (16.8 ms
 * p95). At 1280×720 it has to fit as at 1440×820 (menu-1280.png), the scene baked anew for each
 * size. menu-missions.png shows „Einsatz starten" open, the tutorial's card saying „Erster Einsatz?
 * Hier starten" in a line of its own and no tooltip over the cards; the mission picked comes in as
 * the scene behind. „Runde eröffnen" closes the lab's doors over the menu and opens them on the
 * lobby: menu-to-lobby.png holds them two thirds shut, the menu between them (the pause trick of
 * the device's fade); the lobby has to stand over the menu's scene drifting on. The guest's phone
 * shows the menu upright (menu-phone.png), the profile under the title, and turned sideways —
 * 932×430 (menu-phone-932.png), 844×390, and what an iPhone's notch leaves, 750×369 and 667×375 —
 * the menu left whole beside the scene, the title and the profile right; every target a fingertip's
 * 44 px at least, nothing cut off. A second crew's room — Cem's, of the other mission — and the
 * host's stand in a fourth page's „Offene Runden", every crew member as a figure, painted
 * (menu-open-rounds.png); Cem's door wipes are timed as his page draws them, into the lobby and,
 * „Raum verlassen", out of it — shut over the lobby, the page loaded anew, open on the menu — none
 * asking more than 400 ms. The audience types the room's code in small letters into „Beitreten"
 * (menu-join.png): it has to stand in capitals, in a field no browser fills from its passwords. In
 * the reconnect drill a new tab of Anna's browser, her run standing paused, opens the menu on the
 * run's card, first and lit, every other item dimmed (menu-bound.png). The menu's sound waits for
 * the first key, the speaker's lamp lit, and plays after it; the lobby keeps it at its weight,
 * chimes as the round comes up and chirps as Ben says ready; the run's start ends it. The won card
 * asks for its sting and its theme (end music), which go as the next run opens.
 *
 * On the way, both open the Bestenliste from the menu (history.png,
 * history-phone.png): measured like the menu, at 1280×720 too, and on
 * the phone for running out sideways. The host's lobby, with its strip of
 * mission cards, is captured on a phone held sideways as well
 * (lobby-landscape.png). Once the sign is read, the guest's phone is turned
 * sideways and the HUD's Info button has to lie whole inside the window —
 * where the host read the sign, in the host's window at that size too — or
 * the run fails: the Laborkennung's chip may never push it off the screen.
 * With the game's screenshots the guest's phone held sideways
 * (game-phone-landscape.png) has to fold the objective bar and the crew strip
 * into one row of 44 px at most, the band of world below it 65 % of the
 * window's height at least, its right thumb's buttons two by two, see-through
 * until touched, the controls 30 % of the band at most (pad-left.png) — and so
 * on a large phone held sideways, 932×430 (game-phone-932.png) — or the run
 * fails.
 *
 * The Systemcheck on its pinned seed is played to the end: after the
 * Signalprobe the guest holds the Kontrolle's plate beside the locker — the
 * rules — while the host cuts the wiring box's wire; the seed pins the box,
 * so the walkthrough carries its answer (PINNED_WIRING) and fails, naming the
 * seed, where the box shows other wires. Both press the Synchronkalibrierung
 * together, the hatch opens and the siren sounds: the guest steps onto the
 * hatch, the host's frames are sampled on the way to it, and escape.png
 * shows the red light, the open hatch, the clock amber and the checklist
 * with the guest ticked off. The host steps on, the run is won: pullback.png
 * catches the world lit and the camera pulling back, won.png the title card
 * with the crew outside, end.png the whole end screen, won-phone.png the
 * guest's card on a phone, won-landscape.png on the phone held sideways — in
 * two columns, the facts in the window, the top bar on one line; the
 * audience's page has to show the same card (won-audience.png).
 * The won tutorial leads on to Blackout: next-mission.png shows the end
 * screen's „Weiter: Blackout im Labor" beside „Nochmal", both click it — the
 * guest first, the host's click naming the mission — and the run fails
 * unless Blackout opens on both pages with the power on. Then a second tab of
 * the host's browser opens „Meine Einsätze" off the menu (my-runs.png): the
 * Systemcheck just won leads the list with its crew and a rank, the page fits
 * a phone sideways. Its settings delete the account at the second word
 * (account-delete.png the first answered), the profile says „Gast" with no
 * name, and „Meine Einsätze" lists nothing more — or the run fails.
 *
 * Blackout on its pinned seed is played to the won card too, with the
 * answers tools/fixtures/blackout-plan.json carries (core's
 * test/blackoutPlan.ts keeps them the solvers' own), each instance checked
 * against them first — the run fails naming the seed where one differs: the
 * Notstrom-Kasten's wires, serial and readings round by round and its cuts,
 * every stage of the Signalkette at consoles with the legend (a key a row
 * and a shape; the deliberate wrong one gives figure-flinch.png) — its last
 * one without colour, the sending console's device shot as it starts in the
 * host's window (signal-grey.png) and with that window held as a large phone
 * sideways, under a finger (signal-grey-phone-932.png): the strip grey, its
 * signs grey at 64 px, ANZEIGE · FARBLOS lit, nothing of the colour in the
 * device and the phone holding it whole, or the run fails — the
 * Serverraum's table and moves (servers-manual.png from its locker, the
 * host's window showing the guest reading it as pose-reading.png,
 * servers-a.png and servers-b.png from its consoles, servers-solved.png),
 * the cabinet read at the large text size (book-morse-1.15.png: the
 * Morsetafel whole on its page, the Frequenztabelle facing it, no line cut)
 * and then on the guest's phone held sideways (book-phone-landscape.png: one
 * page at a time, the body 14 px at least, the text scrolling inside the
 * sheet to its last line on every page and past its edge on none) and held
 * upright, the notepad's drawer down and then up under the frame
 * (book-phone-notepad.png: the same, the drawer along the foot),
 * the radio panel's lamp and dial, the spare fuse carried from the Archiv to
 * the reactor and the reactor pressed together. Every device the guest's
 * phone opens on the way — the lever, the meter, console A of the
 * Signalkette, the rack, the reactor and the relay console where an
 * emergency comes — is also shot with the phone held sideways
 * (device-phone-<station>.png): the device whole in the window, nothing of
 * it scrolling, every control in view and 44 px at least each way once the
 * device's opening has ended on the page's clock — the
 * first of them on a large phone too (device-phone-932-<station>.png) — or the
 * run fails. From the Signalkette on the
 * drones are awake: every walk goes from haven to haven past them — the
 * tiles no drone ever looks at — as a crew times its run past a patrol:
 * their flights foretold from the positions stream as the server steps them
 * (tools/patrol.mjs), each stretch run in one go once no cone would meet it,
 * and every sighting logged as it comes. A relay
 * emergency is weathered from both pages, each instruction carried out at
 * the console it names, and a station that has to stay open is opened only
 * once the next emergency will not cut it short. Then both run for the
 * hatch round the loop, and escape.png, pullback.png, won.png, end.png and
 * won-phone.png come from Blackout as they do from the Systemcheck; the log
 * says how long the win took from the blackout, what was left on the clock
 * and how many alarms it cost. Blackout leads on to no other mission. In a
 * Blackout run the Serverraum's scratch mission below is left to the
 * Systemcheck's: Blackout's own Serverraum takes its captures.
 *
 * Notes of the last shift: after the lever, the host walks up to the nearest
 * note the crew has found and presses E; note.png shows its slip, which has
 * to carry the words the view gives the reader there, and the run report
 * has to log it read for nothing, or the run fails. A map without notes
 * skips it. A note asked for at a source (hint-*.png) is taken down with
 * the slip's own „Notieren" once it is written in: it has to come into the
 * notepad word for word under „… · Notizen der letzten Schicht", or the run
 * fails.
 *
 * A first crew: the host's device has won no run, so the mission panel labels
 * the tutorial's card „Erster Einsatz? Hier starten" and the room it opens
 * stands on „entspannt", the lobby saying why (lobby-first.png); the host
 * picks „Normal", which the walkthrough plays. The editor's, the Serverraum's
 * and the art tour's pages stand for devices that have won a run before.
 *
 * Writing while reading: each player reads an open source — a clipboard
 * first — brings the notepad up beside it (N, or its tab on the guest's
 * phone) and takes a block down with „Notieren" (reading-notepad.png,
 * reading-notepad-phone.png); at the first station with two consoles the pad
 * comes up beside each open device (device-notepad.png,
 * device-notepad-phone.png). The pad has to stand beside the page — a strip
 * down the right edge from top to foot, a drawer along a phone's foot from
 * side to side — the block has to come in at the pad's foot as a capture
 * under a head naming the source („Klemmbrett · Legende"), and E has to put
 * the source down again, or the run fails. Before it is put down the guest
 * turns the phone sideways (reading-notepad-landscape.png): a book on its
 * pages one at a time, the body 14 px at least, the text scrolling inside the
 * sheet to its last line and past its edge nowhere, the frame not scrolling,
 * the pad a strip beside it — or the run fails. The host, who noted the
 * Signalkette's legend, then takes the
 * Laborkennung over too: notepad-captured.png shows both in the pad's own
 * look, and notepad-captured-phone.png at the phone's size — the writing in
 * the hand shipped with the game, the legend's columns whole on their ruled
 * lines, every text 15 px or more and 4.5:1 against the paper, or the run
 * fails. After the station step the crew leaves the station that is
 * up quiet until the Leitstelle names the next place (nudge.png,
 * nudge-phone.png): its line in both banners, spoken by its recording.
 *
 * Stepping back: the first player to step back with Esc from a station standing
 * open — the station step's operator, else the Signalkette's sender — sees the
 * device fade out as it came, over 150 ms: the page records the panel on its own
 * clock meanwhile — when it began to leave and when it was gone, as its DOM
 * changed, and at each frame it drew the panel's opacity and how far the fade
 * had run — and it has to leave inert, its opacity only falling, gone within
 * 100 to 600 ms of the page's clock, and midway on each frame drawn between
 * half and nine tenths into the fade; where the page, under load, drew no frame
 * there, the midway frames are skipped with the times it drew them (the shot
 * below still judges the fade). For the shot (panel-close.png)
 * the station is opened anew and stepped back from with the fade held 120 ms
 * in and the game's timer that lets the panel go kept back until it is taken —
 * a screenshot asked for at once draws the fade's first frame, the panel whole,
 * and one under load can come after the panel has gone — and it has to lie
 * between the panel open and gone, taken again where it does not, up to three
 * times — or the run fails.
 *
 * The glow: what the E prompt names glows in its own shape, no box round it
 * (client world/render/highlight.ts). As each player stands in reach of the
 * source it is about to note from — a clipboard first — highlight.png (and
 * highlight-phone.png on the guest's phone) catches it glowing, and the
 * traced page hands back the halo's bake and the silhouette it was baked
 * from (`window.__escapelab.highlight`, checked by tools/glowcheck.mjs): the
 * halo has to come out strong, every pixel of it that glows within its
 * spread and three sigma of its blur of the silhouette, and the corners of
 * the box the old outline drew round the source's tile dark — or the run
 * fails; where no glow comes within 3 s a step re-sends the player's place
 * and it gets 4 s more. At the first station with two consoles,
 * highlight-console.png checks console A the same way as its player arrives:
 * in Blackout the Maschinenraum is still dark there, the console lit by the
 * player's own lamp alone. Before figure-carry.png the host stands beside the
 * fuse, 0.6 tiles off its middle, well in reach, not on it: it bobs a pixel
 * of the art over two seconds, and fuse-bob-1.png, taken as it stands highest
 * or lowest, and fuse-bob-2.png, taken as it next stands the other way, have
 * to show it on either side of its middle — the page's lifts, and the part's
 * own pixels on the canvas, its silhouette off the glow's probe, moved down
 * or up by as much (glowcheck.mjs `bobVerdict`). Where they show no bob the
 * host steps back onto its spot and a second pair is taken within 4 s; where
 * that shows none either, the run fails.
 *
 * Settings, minimap, sprint: after info-panel.png the host opens the settings with the gear in
 * the top bar (settings.png) — the clock has to run on under them, Esc has to close them.
 * minimap-goal.png shows the world with the minimap pointing at the goal, a pulsing dot at each
 * console of the station up next, which has to show in the goal's colour on the canvas where the
 * traced page puts it (`window.__escapelab.minimap`), unless the crew stands on it. Then the host
 * runs out along the longest open stretch from its tile, Shift held — sprint.png catches the run,
 * the camera leading — and walks back: the log gives both paces and both footfall rates, timed
 * in the page (`self`, `footfalls`), and the run fails unless the sprint is about 1.3 times the
 * walk and its footfalls come faster. The Serverraum's terminal (servers-a.png) has to end its
 * table on BRAUCHT, what each service needs running first, and the rack has to show none of it.
 * The first command at the terminal is typed as a player types it: the prompt has to hold the
 * focus as the terminal opened, a click on its screen takes the focus away and the keys typed
 * next have to land at the prompt all the same, Tab completes the command and then the service,
 * and once Enter has sent it the prompt has to hold the focus again, or the run fails; in a
 * Blackout run terminal-typing.png catches the line half typed, the cursor after it.
 *
 * The base URL is the Vite dev server by default (`pnpm dev`), or the
 * production server (`pnpm build && pnpm start`, http://localhost:3001) as in
 * CI. The host's page opens with `?trace=1`, so the world keeps its frame
 * durations (animation frame to animation frame, 16.7 ms at 60 Hz). Four
 * times the run resets them and samples two quiet seconds, with no
 * screenshot, resize or click in them: the host pacing inside its tile after
 * the game screenshots, idle at an open station panel, pacing again after the
 * station step, and pacing beside the open hatch in the escape — and in a
 * mission with an intro once more, shorter, in the lit lab before the
 * blackout, and over the opening's shot for information alone. Each sample
 * measures what a frame costs one client: while it runs, every other page of
 * the run — the guest's phone, the audience — stands frozen, its animations
 * stopped, its main thread paused in the debugger and its CPU throttle lifted
 * (freeze.mjs; Chromium's own freeze leaves a page on screen running, and a
 * paused page's compositor plays its animations on), and is thawed once it is
 * over, its messages waiting for it; a line `frozen` names them. Otherwise a
 * runner's few cores and its one compositor would be shared by every page
 * drawing the same scene, and a window would measure the sharing, not the
 * game. Each sample
 * logs p50 and p95, and a line `light` with what the host's light worked out
 * anew meanwhile — the sights a frame and the bakes (client
 * world/render/census.ts, lightwork.mjs): a lamp on the move takes a sight a
 * frame, the host's own as it paces and each drone's as it flies, and nothing
 * is baked while the light holds still. A window may reach SHOTS_FRAME_P95_MS
 * (default 40) at p95, or twice the p95 of the run's own pacing window — the
 * first, after the game screenshots — whichever is more (framegate.mjs): a
 * slow runner draws every scene at its own pace, the pacing included, and
 * only what a scene costs beyond twice that pace is the game's, while a scene
 * that grows dearer on a runner at the screen's rate still trips the 40 ms.
 * Every window before the pacing window, and that window itself, keeps the
 * 40 ms alone; a line `pace` says what the pacing window set. A p95 over the
 * allowance has the window sampled once more after a second's pause, the
 * same scene for as long, and fails the run only when that one is over too:
 * a runner's hiccup spoils one window, the game's cost both. The line logs
 * the p95, what it was allowed and why — „p95 50.0 ms, allowed 66.8 (2 ×
 * pacing 33.4)" — and the second look's p95. Any step that throws fails the
 * run too.
 * SHOTS_CPU_SLOWDOWN (default 1) slows every page's main thread that
 * many times (Chromium's CPU throttling), so a fast machine measures the
 * frames as a CI runner without a GPU would; SHOTS_SOFTWARE_GL=1 composes the
 * pages on SwiftShader, so that the compositor's share shows too.
 * SHOTS_PROFILE=1 opens the traced pages with `?profile=1` as well: every
 * sample then logs a line `passes` with what each pass of the world's picture
 * cost a frame, p50 and p95 (client world/render/profile.ts). The first
 * line says what draws the pages. A capture the draw leaves out is logged as
 * `skipped:` with why, and fails nothing. A line `walking` says how long each
 * avatar walked, keys held down, against the time since the run came up: the
 * walking share a mission's time limit is weighed by. A walk whose way is
 * shut on its page waits up to 10 s for a door the server opened — after a
 * solve, a plate or a key — to open there too, and a line `door` says how
 * long it waited; where no way comes, the walk fails naming the doors as the
 * page shows them. E at a console, a source or a note of the last shift waits
 * up to 6 s for the page's view to count the player there — the server writes
 * that a stream tick and a round trip after the avatar stops — then gets up to
 * 6 presses over 6 s (tools/presence.mjs). A line `presence` names a count
 * that took a second or more, or never came; where nothing comes up, it says
 * where the server has the player and facing which way, what the view counts
 * them at, and how far each place of the target lies, whether a console's lies
 * in sight and whether the player has found it. Each step after a solve that
 * plans its walks from both pages' views first waits up to 10 s for both to
 * show the solve, and a line `catch-up` says how long one lagged. The last
 * line counts the captures taken, skipped and failed; the exit code is 1 when
 * any failed.
 *
 * Camera: the world's frame is fixed in CSS pixels (client world/viewport.ts),
 * so a window shows the same tiles at every density. After the game
 * screenshots camera-1440.png, camera-1280.png and camera-phone.png show the
 * host's window at 1440×820 and 1280×720 and the guest's phone sideways, and
 * camera-dpr2.png the host's 1440×820 drawn at density 2, each with a line
 * giving its CSS px a tile, its tiles across × down and the band below the
 * objective bar. In Blackout its key scenes — the lit lab before the
 * blackout, the first station's open panel, the escape — are looked at on the
 * host's page drawn at density 2 as well, right after their own window: a
 * frame window there for information alone, and a shot (cold-open-dpr2.png,
 * panel-dpr2.png, escape-dpr2.png). The run fails where a window's tiles
 * across or down at density 2 lie more than 0.2 from density 1's. The page is
 * drawn at 2 through CDP, its window's size kept: Playwright fixes a context's
 * density once it is made, and a player of a context of its own would change
 * the crew the pinned draw is played by.
 *
 * Light: every world's light takes the WebGL light layer or the Canvas pass
 * (client world/gl/path.ts): a software renderer — headless Chromium's
 * SwiftShader, as on CI — keeps the Canvas pass. Before the frame sample
 * after the game screenshots the host's light probe is read and logged; under
 * SHOTS_SOFTWARE_GL anything but the Canvas pass fails the run. SHOTS_WEBGL=1
 * adds ?gl=1 to every page, which forces the layer on, software renderer or
 * not: the probe then has to report it, or the run fails. At the blackout.png
 * and lit-flur.png moments the host's world is measured both ways — the mean
 * luma of its canvas on the layer and, three frames later, on the Canvas pass,
 * which may lie at most 10 % apart, or the run fails — and light-gl.png and
 * light-gl-flur.png are shot on the layer, right before blackout.png and
 * lit-flur.png, which under SHOTS_WEBGL are shot on the Canvas pass: each pair
 * shows the same moment both ways. On SwiftShader the layer's frames may well
 * pass the budget (raise SHOTS_FRAME_P95_MS to log them without failing);
 * SHOTS_HEADED=1 opens real windows instead, drawn on the machine's GPU, to
 * measure the same frame windows there.
 *
 * Voice: Chromium runs with a fake microphone that needs no prompt (its beeps
 * are the voice), and both players switch theirs on in the lobby. Both pages
 * open with `?trace=1`, so their voice links can be read off
 * `window.__escapelab.voice`. In the run both ends of the link have to reach
 * `connected`, and while the host holds V for two seconds the speaking mark
 * has to show for the host on both pages (voice.png, voice-phone.png). After
 * the guest's reload the link has to come up again. Any of these that fails,
 * fails the run. At the first station with two consoles, both manned, the
 * station's intercom has to carry each player's voice to the other in full,
 * and each device's PARTNER LED has to say „· Funk" (partner-funk.png).
 *
 * Sound: the pages' audio probe (`window.__escapelab.audio`, client
 * world/ambience.ts, music.ts, radioVoice.ts, spatial.ts) is read as the run
 * goes. After the blackout — in a mission without an intro, once the briefing
 * is over — the bed of the host's room has to be dead, its powered layer
 * down; once the lever or a sync station has lit the room its player stands
 * in, that bed has to be alive again. The line that comes over the radio with
 * each of those solves — and the Leitstelle's first line, heard on the guest's
 * page from the blackout or the briefing's end on — has to be spoken by a
 * recording from the manifest the server hands out, saying the banner's line,
 * for 200 ms a word at least and a second at the least; the first line after
 * the Leitstelle's opening squelch, and no other line. In the
 * escape the music's pressure has to stand at 0.8 or more, a pressure stem
 * up and the calm stem gone under the siren. Wherever the partner stands half a tile
 * or more to one side (after the blackout, at the hatch — and after the lever,
 * where the guest walks three to five tiles along the corridor for it and
 * back) the probe's pan has to point there, and that has to be checked once a
 * run at least. Once a run the radio's chain is rendered offline in the page on
 * white noise: above 4 kHz it has to come out at least 10 dB under the band
 * from 300 Hz to 3.4 kHz, and 15 dB further down than the noise was
 * (spectrum.mjs); and on the mission's opening line, its first three seconds:
 * above 4 kHz and below 300 Hz each at least 10 dB further down against that
 * band than in the recording. Any of these that fails, fails the run.
 *
 * What the sound costs: after every frame sample a line `cpu` gives the cores
 * each kind of the browser's processes kept busy meanwhile (CDP SystemInfo)
 * and what the host's audio thread renders (the probe's census: sources
 * playing, nodes wired into the output, beds built); a line `pages` gives each
 * page's renderer CPU, its main thread's task time — for a page frozen
 * meanwhile only `frozen` and its CPU, its pause counting as one long task —
 * Chrome's count of its live audio nodes (wired, or waiting to be collected)
 * and its heap; a line `sound
 * js` the main thread's milliseconds a second each sound system took. With
 * SHOTS_AUDIO_OFF=beds,music,spatial,reverb those systems stay off on every page
 * (`?audio-off=`), to tell their cost apart — their sound checks then fail.
 *
 * What the sound keeps: at the first station and in the escape a line `audio` gives, for each
 * page, the PCM it keeps decoded (`audio.decodedBytes`, client world/audioMemory.ts) by who
 * holds it, the voices and loops of the budget against their caps, the buffer sources playing,
 * the music's streams with how late the latest came in and how far one lags, the room's reverb
 * and the brickwall's hold. A page over 30 MB, or a budget over its caps, fails the run.
 *
 * Editor: before the walkthrough a page of its own opens the editor from the
 * menu, paints a 7 × 5 room, places a start and a station and
 * captures what the validator says (editor.png, and the layout at
 * 1280×720 and on a phone); the „Notiz" tool is refused deep in the rock,
 * with the status line's word why, and pins a note to the wall over the room;
 * a second start and a book make the mission sound, it is saved as
 * custom-probe and has to show among the menu's missions.
 * Then the editor, opened at /editor, imports tools/fixtures/probe-mission.json
 * („Probe", custom-probe) and starts a test run from it: the lobby has to
 * show the probe (editor-play.png), „Zurück zum Editor" in the top bar has
 * to bring the editor back with the draft, and the link „Teilen" makes —
 * off the clipboard, or out of the box the editor marks it in — has to open
 * the same mission in a page of its own (editor-shared.png). custom-probe is
 * deleted again through the API whatever happened before.
 *
 * Serverraum (a Systemcheck run): the editor, opened at /editor?seed=4, imports
 * tools/fixtures/servers-probe.json („Serverprobe", custom-serverprobe) and
 * starts its test run, pinned to that seed; a second page joins by code.
 * The player nearer the terminal searches the locker and reads the rules
 * (servers-manual.png), both man their console (servers-a.png, the
 * terminal; servers-b.png, the rack — each has to fit sideways at
 * 1440×820, 1280×720 and 420×760), and the terminal has to open on the
 * table tools/fixtures/servers-plan.json was made for, or the run fails,
 * naming the seed. Then the plan — core's solver's own, as core's test of
 * the module keeps it — is played to the solve, the first command typed at
 * the prompt and the rest put together on the keys; the run fails unless it
 * solves without an alarm, and servers-solved.png catches the device as it
 * stands done. The log says how long the moves took. The mission is deleted
 * again whatever happened.
 *
 * Zugangskontrolle (a Systemcheck run): the editor, opened at /editor?seed=4,
 * imports tools/fixtures/access-probe.json („Zugangsprobe",
 * custom-zugangsprobe) and starts its test run; a second page joins by code,
 * both touch screens. The player nearer console B switches the station on at
 * the token device; the other reads the list of this shift's accounts at the
 * clipboard (access-list.png) — it has to be the one
 * tools/fixtures/access-plan.json was made for — and takes the terminal,
 * which has to ask for the plan's doors (access-terminal.png; the device in
 * access-token.png, its digits the view's token). On a large phone held
 * sideways the terminal has to stand whole, nothing scrolling, every control
 * 44 px (access-phone-932.png), the token device the same. Then each door of
 * the plan: the login — the first typed letter by letter, Tab completing
 * `login` —, the token read off the device once it shows the account with
 * four seconds left at least and sent — the first typed in two groups, the
 * next on the pad —, the door released on its key; the station has to solve
 * without an alarm. The device never opens on the first door's account, so
 * the first door waits a period or two (15 s each in the probe). The log says
 * how long the device kept each account waiting. The mission is deleted again
 * whatever happened.
 *
 * Art (a Blackout run only): before the walkthrough, a scratch copy of
 * Blackout — custom-blackout, ten seconds of power before the lights fail,
 * its two starts in the Archiv and the Maschinenraum — is saved through the
 * editor's route and played by two, the audience watching from the lobby on:
 * art-overview.png catches the audience's whole lab lit, room-archive.png and
 * room-machine.png each player in the room it starts in, lit (1440×1000) —
 * decals-lab.png the Labor beside the Maschinenraum, the marks on its floor — and
 * art-dark.png the Maschinenraum two seconds into the dark, its standby glows
 * and the flashlight; then its player walks to the room's east end and
 * standby-dark.png shows the generators asleep behind them, out of the lamp's
 * reach, glowing in the dark. The copy is deleted again whatever happened. Every walk
 * goes round the map's furniture (map.decor), which nobody walks through.
 *
 * Reconnect (a Blackout run only): before the walkthrough, a room of its own for three —
 * Anna, Ben and Cem, each in a browser context of its own, the microphones on, the opening
 * skipped. Ben's network goes (`context.setOffline`): Anna's page has to wait for him
 * (pause-waiting.png) and offer the way on without him 60 s into the pause, 3 s late at most;
 * she presses it, and the clock has to run again (continue-without.png). Ben's own page has to
 * say its line is lost, the next try counted, and offer its three ways on
 * (reconnect-overlay.png). His network back, Anna's page has to say „Ben ist zurück"
 * (back-toast.png) and the voice links have to come up again. A new tab of Ben's browser has to
 * open on the run's card (rejoin-card.png) and go back to the run, his first tab told that the
 * seat went to the other; his network gone once more, a phone named Ben asks for the seat by
 * the room's code and his name, Anna's pause card asks her (takeover-ask.png) and she lets it
 * in; it has to sit down, and his browser, back, has to be refused (takeover.png). Any
 * step that fails, fails the run; the log says how long the drill took.
 *
 * Restart (a Blackout run that owns its server, SHOTS_SERVER): after the reconnect drill, the
 * same crew of three in a room of its own; the server gets SIGTERM, as Render sends it before a
 * deploy, and has to exit 0, every page's own card saying „WARTUNG · Der Server startet neu"
 * (restart-maintenance.png); started again on the same port with the same ROOM_SECRET, every
 * page has to be back in the run within 15 s (restart-recovered.png), the clock where it
 * stood. Where the run does not own its server, the drill is skipped, the reason logged.
 *
 * Figures: the crew stands as client world/figure.ts poses it, and four shots
 * at 1440×1000 show it. lobby-idle.png catches a lobby figure turned in a
 * glance round the room, when the figures' probe (`?trace=1`,
 * `window.__escapelab.figures`) says one is — and says so again after the
 * shot, or it is taken again on the next (figureShot). After Blackout's lever
 * the host picks up the fuse lying in the Archiv, is shot holding it before
 * the chest (figure-carry.png) and puts it down again with Q; then it walks into the aisle behind
 * the nearest shelf and stands pressed up to it (depth-behind-shelf.png): the shelf drawn again
 * over its lower part, its name over all of it — the graphics probe has to say the shelf hides
 * it, or the run fails (client world/depth.ts). At the
 * Systemcheck's Signalkette the sending side closes its panel and the pressing
 * side presses one wrong sign on purpose — the one alarm the run spends — and
 * the sender's world is shot the moment the alarm comes in, asked for within
 * 200 ms of it, the crew mid-flinch (figure-flinch.png). The won card, scrolled
 * back to its top so that its figures move in the window, is shot with a
 * figure in the air, before and after the shot (figure-celebrate.png), and
 * the audience's card has to show its crew celebrating too. A mission the
 * walkthrough does not take that far skips what it leaves out.
 */
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium, request } from 'playwright';
import {
  AGAIN_AFTER_MS,
  allowanceOf,
  gateWindow,
  loadText,
  p95Text,
  paceOf,
} from './framegate.mjs';
import { withOthersFrozen } from './freeze.mjs';
import { ART_PX, bobVerdict, GLOWING, glowAtCorners, haloAgainst } from './glowcheck.mjs';
import {
  GROUP_NAMES,
  groupClock,
  misfiled,
  planGroups,
  reaches,
  spentText,
  stepGates,
  summaryText,
} from './groups.mjs';
import { lightWorkText } from './lightwork.mjs';
import { drawnText, fadeOf, fadeVerdict, meanLuma, midway } from './panelfade.mjs';
import { beamLight, beamPatches, beamVerdict } from './beamcheck.mjs';
import { changedShare, sweepOf, sweepVerdict } from './sweep.mjs';
import {
  arrivals,
  cornersOf,
  flights,
  havens,
  RUN,
  spottedOn,
  stretchOf,
} from './patrol.mjs';
import { deviceVerdict, stripVerdict, swingVerdict } from './pageclock.mjs';
import { percentile } from './percentile.mjs';
import { decodePng } from './pixeldiff.mjs';
import {
  armedTarget,
  consoleTarget,
  COUNT_WAIT,
  lagging,
  noteTarget,
  presentAt,
  PRESSES,
  pressSaid,
  pressUntilShown,
  sourceTarget,
  stateSaid,
  targetSaid,
} from './presence.mjs';
import { bandPowers, decibels } from './spectrum.mjs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? '/tmp/escapelab-shots';
const MISSION = process.env.SHOTS_MISSION || 'Blackout';
const FRAME_P95_MS = frameBudget(process.env.SHOTS_FRAME_P95_MS);
/**
 * How many times slower than this machine every page runs: SHOTS_CPU_SLOWDOWN,
 * 1 when unset. Chromium's own throttle (CDP Emulation.setCPUThrottlingRate)
 * slows each page's main thread, so a fast machine measures the frame budget
 * as a CI runner, with no GPU and little CPU, would.
 */
const CPU_SLOWDOWN = cpuSlowdown(process.env.SHOTS_CPU_SLOWDOWN);
/**
 * Whether the pages are composed without a GPU, SHOTS_SOFTWARE_GL=1: on
 * SwiftShader, ANGLE's GPU in the CPU, so that what composing costs — off the
 * page's main thread, where SHOTS_CPU_SLOWDOWN does not reach — shows here as
 * on a CI runner. The canvas and the tiles are still drawn in software, as
 * there: a canvas on SwiftShader makes every frame of the world take some
 * 120 ms on this kind of machine, while CI's runner keeps the world at 60 fps.
 */
const SOFTWARE_GL = switchedOn('SHOTS_SOFTWARE_GL', process.env.SHOTS_SOFTWARE_GL);
const SOFTWARE_GL_FLAGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu-rasterization',
];
/**
 * Whether every page asks for the WebGL light layer, SHOTS_WEBGL=1: ?gl=1
 * forces it on even on a software renderer, so that its look and its frames
 * can be told apart from the Canvas pass's.
 */
const WEBGL = switchedOn('SHOTS_WEBGL', process.env.SHOTS_WEBGL);
/** Whether the browser opens real windows, SHOTS_HEADED=1: drawn on this machine's GPU. */
const HEADED = switchedOn('SHOTS_HEADED', process.env.SHOTS_HEADED);
/**
 * Whether the traced pages time each pass of the world's picture, SHOTS_PROFILE=1: ?profile=1
 * (client world/render/profile.ts), and every frame sample logs a line `passes` with each
 * pass's p50 and p95 per frame. A profiled frame reads a pixel back after every pass, which
 * costs a little of its own: its frame windows run a little slower than without.
 */
const PROFILE = switchedOn('SHOTS_PROFILE', process.env.SHOTS_PROFILE);
/**
 * The client's sound systems switched off on every page, SHOTS_AUDIO_OFF=beds,music,spatial
 * (`?audio-off=`, client world/audio.ts): to tell what each costs the frames. None when unset;
 * the sound checks fail for a system switched off.
 */
const AUDIO_OFF = audioOff(process.env.SHOTS_AUDIO_OFF);
/**
 * The groups this run plays (tools/groups.mjs `planGroups`): those SHOTS_ONLY names, or every
 * group, less those SHOTS_SKIP names — a group that needs another pulls it in, or is refused
 * where SHOTS_SKIP names that one. `lines` say which groups the run leaves out or pulls in.
 */
const PLAN = planGroups(process.env.SHOTS_ONLY, process.env.SHOTS_SKIP);
/** The time each group of the run takes (`inGroup`), for the line before the summary. */
const timeByGroup = groupClock();
/** The gate of the step running now (`inGroup`, `whenOn`), which `checkGroup` holds captures to. */
const gates = stepGates();
/**
 * The server the run starts and owns, SHOTS_SERVER=<entry>: node runs the entry — one in
 * TypeScript with the tsx loader — from packages/server, on BASE's port with ALLOW_SEED=1 and TLS
 * off, its rooms' snapshots sealed with a ROOM_SECRET of this run's own; its log goes to
 * server.log under OUT, and the run stops it at its end. Only a server the run owns can the
 * restart drill take down and bring back; without one the run talks to whatever answers at BASE,
 * and the drill is skipped.
 */
const SERVER_ENTRY = process.env.SHOTS_SERVER ? resolve(process.env.SHOTS_SERVER) : null;
const SERVER_DIR = fileURLToPath(new URL('../packages/server/', import.meta.url));
/** The key every start of the owned server seals with: a restart opens what the last sealed. */
const ROOM_SECRET = randomBytes(32).toString('hex');
/** How long the owned server may take to answer /health once started, ms. */
const SERVER_UP_MS = 60_000;
/** How far a frame's mean luma on the light layer may lie from the Canvas pass's, as a share. */
const LUMA_TOLERANCE = 0.1;
/**
 * The seed the host's room is pinned to (`?seed=`, taken by a server with
 * ALLOW_SEED=1 as `pnpm dev` and CI set it), so that who starts where, where
 * the sources lie and every station repeat from run to run. SHOTS_SEED
 * overrides it; another mission goes unpinned, and the skips below still say
 * what its draw left out. Found by printing the core's draw of a crew of two
 * for seeds 1…50 and replaying the steps below that depend on it, in a room:
 *
 * - Blackout 5: Anna starts in the Archiv by the sign (3,3; sign.png, once she
 *   has skipped the opening), Ben at the Flur's west end (1,12); the book lies
 *   at (8,1), the Klemmbrett at (11,12) west of the lever, the locker at (16,2),
 *   the cabinet at (11,15). With the power on, Anna's step into the Archiv
 *   lights it round her while Ben watches the opening on (cold-open.png).
 *   Nobody starts behind a door: both walk up to the lever in the middle of
 *   the Flur (lever.png). Then Ben reads the book (reading), holds the plate
 *   for Anna on her way to console A of the Notstrom-Kasten, works console B
 *   and asks for the notes (console-*, hint-*). The map grew twice — to 27×17,
 *   then to 36×22 — and kept three spawns in this order — Archiv, the Flur's
 *   west end, its east end (29,12) — and as many spots for every source, so
 *   seeds draw as before. Anna and Ben by seed: 1 Flur west and Archiv, 3 Flur
 *   east and Archiv, 5 Archiv and Flur west, 7 Flur west and Flur east, 8
 *   Archiv and Flur east, 9 Flur east and Flur west.
 * - Systemcheck 1: the usual, Ben by the first station and the sign works it,
 *   Anna by the locker reads it.
 */
const SEEDS = new Map([
  ['blackout', 5],
  ['systemcheck', 1],
]);
const SEED = seedFor(process.env.SHOTS_SEED, SEEDS.get(MISSION.toLowerCase()));
/**
 * Blackout as its mission file has it: its drones' beats, its emergencies' schedule, and every
 * place its walks and captures go to — read from here, never carried as tiles of their own.
 */
const BLACKOUT = JSON.parse(
  readFileSync(fileURLToPath(new URL('../missions/blackout.json', import.meta.url)), 'utf8'),
);
/**
 * The Systemcheck's wiring box (Kabelprüfung) as its pinned seed draws it:
 * the wires' colours from the top, and the one the printed list for three
 * wires says to cut, counted from the top — gelb, gelb, gelb: rule 2, the
 * last wire is yellow, cut the first. Found by drawing the box from the
 * seed with the core's own module; a seed that draws another box fails the
 * run by name.
 */
const PINNED_WIRING = new Map([[1, { colors: ['gelb', 'gelb', 'gelb'], cut: 1 }]]);

/**
 * The host's window for cold-open.png: as wide as a laptop's, a little
 * taller, so that both starts of Blackout's draw fit in it.
 */
const COLD_OPEN = { width: 1440, height: 1000 };

const SIZES = [
  { name: 'laptop-13', width: 1440, height: 820 },
  { name: 'split-screen', width: 960, height: 760 },
  { name: 'phone', width: 420, height: 760 },
  // A phone held sideways, as a run turns it. Only a touch window shows its layout (the query
  // asks for a coarse pointer), so the guest's phone is turned, not the host's window.
  { name: 'phone-landscape', width: 844, height: 390, hasTouch: true },
  // A large phone held sideways, as today's largest are: the game, one device and the opening.
  { name: 'phone-932', width: 932, height: 430, hasTouch: true },
];

/** Avatar speed in tiles per second, as the client walks. */
const SPEED = 4.2;
/** How much faster it runs with Shift held (core map.ts SPRINT_FACTOR). */
const SPRINT_FACTOR = 1.3;
/** How close to a tile centre a step has to land, in tiles. */
const STEP_TOLERANCE = 0.15;
/** How far the glow's halo spreads, then how wide it blurs: px at 64 px a tile (client HALO). */
const HALO_SPREAD = 1.5;
const HALO_BLUR = 6;
/** The box the old outline drew round a source: its tile and 0.06 more, tiles round its middle. */
const OLD_BOX = { x: -0.56, y: -0.56, w: 1.12, h: 1.12 };
/** How long a frame sample runs, in ms. */
const SAMPLE_MS = 2000;
/**
 * Chromium's switches for the voice: a fake microphone (it beeps) handed out
 * without a prompt, links between two pages on this one machine even with no
 * network, and sound that plays without a click first.
 */
const VOICE_FLAGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--allow-loopback-in-peer-connection',
  '--autoplay-policy=no-user-gesture-required',
];
/** How long the voice links get to come up, in ms. */
const LINK_MS = 15_000;
/** How long a page gets to switch its microphone on, in ms. */
const MIC_MS = 15_000;
/** How long a started run gets to show on both pages, in ms. */
const START_MS = 20_000;
/** How long the host holds V, in ms. */
const TALK_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The p95 frame duration the run fails above, in ms: SHOTS_FRAME_P95_MS, or
 * 40 when unset, loose enough for a shared CI machine.
 */
function frameBudget(text) {
  if (text === undefined || text === '') {
    return 40;
  }
  const ms = Number(text);
  if (!(ms > 0)) {
    throw new Error(`SHOTS_FRAME_P95_MS has to be a number of milliseconds above 0, not "${text}"`);
  }
  return ms;
}

/** The slowdown of every page: SHOTS_CPU_SLOWDOWN, a factor from 1 up, or 1 when unset. */
function cpuSlowdown(text) {
  if (text === undefined || text === '') {
    return 1;
  }
  const rate = Number(text);
  if (!(rate >= 1)) {
    throw new Error(`SHOTS_CPU_SLOWDOWN has to be a factor of 1 or more, not "${text}"`);
  }
  return rate;
}

/** The sound systems SHOTS_AUDIO_OFF names, comma-separated; throws for one it does not know. */
function audioOff(text) {
  const named = (text ?? '').split(',').filter((name) => name !== '');
  const unknown = named.find((name) => !['beds', 'music', 'spatial', 'reverb'].includes(name));
  if (unknown !== undefined) {
    throw new Error(`SHOTS_AUDIO_OFF names beds, music, spatial and reverb, not "${unknown}"`);
  }
  return named;
}

/** Whether the switch `name` (`text`, its value) is on: 1 is on, 0 or unset off. */
function switchedOn(name, text) {
  if (text === undefined || text === '' || text === '0') {
    return false;
  }
  if (text !== '1') {
    throw new Error(`${name} has to be 1 (on) or 0 (off), not "${text}"`);
  }
  return true;
}

/**
 * Logs what draws the pages — the GL renderer, and whether compositing and the
 * 2D canvas run on it or in software. Under SOFTWARE_GL anything but pages
 * composed on SwiftShader stops the run: its frames would not measure that.
 */
async function logRendering() {
  const cdp = await browser.newBrowserCDPSession();
  const { gpu } = await cdp.send('SystemInfo.getInfo');
  await cdp.detach();
  const renderer = gpu.auxAttributes?.glRenderer ?? gpu.devices?.[0]?.deviceString ?? 'unknown';
  const status = gpu.featureStatus ?? {};
  const compositing = status.gpu_compositing ?? 'unknown';
  console.log(
    `gpu                ${renderer}: compositing ${compositing}, ` +
      `2d canvas ${status['2d_canvas'] ?? 'unknown'}` +
      (SOFTWARE_GL ? ' (SHOTS_SOFTWARE_GL)' : '') +
      (WEBGL ? ' (SHOTS_WEBGL: ?gl=1 on every page)' : '') +
      (HEADED ? ' (SHOTS_HEADED: real windows)' : ''),
  );
  if (SOFTWARE_GL && (!/SwiftShader/.test(renderer) || compositing !== 'enabled')) {
    throw new Error(
      `SHOTS_SOFTWARE_GL=1, but the pages are not composed on SwiftShader (renderer ` +
        `"${renderer}", compositing ${compositing}): check that ` +
        `${SOFTWARE_GL_FLAGS.join(' ')} still selects it in this Playwright build`,
    );
  }
}

/**
 * A device that has won a run before (client firstRun.ts): a room it opens starts on normal,
 * as the scratch runs of the editor, the Serverraum and the art tour are counted. Only the
 * walkthrough's own host plays a first run, and picks normal in its lobby (`captureFirstRun`).
 */
async function wonBefore(context) {
  await context.addInitScript(() => globalThis.localStorage.setItem('escapelab.won', '1'));
}

/** Each page's CDP session holding its CPU throttle, under SHOTS_CPU_SLOWDOWN (`openPage`). */
const throttleSessions = new WeakMap();

/** A new page in `context`, its main thread slowed down CPU_SLOWDOWN times before it loads. */
async function openPage(context, name = 'page') {
  const page = await context.newPage();
  named.set(page, name);
  if (CPU_SLOWDOWN > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    throttleSessions.set(page, cdp);
  }
  return page;
}

/**
 * The seed of the host's room: SHOTS_SEED where set, else `pinned`, the
 * mission's; null for none, which leaves the room to chance.
 */
function seedFor(text, pinned) {
  if (text === undefined || text === '') {
    return pinned ?? null;
  }
  if (!/^\d{1,10}$/.test(text) || Number(text) > 0xffffffff) {
    throw new Error(`SHOTS_SEED has to be a whole number from 0 to 4294967295, not "${text}"`);
  }
  return Number(text);
}

/** `url` with `?seed=` where this run has a seed: the room the host opens there is pinned to it. */
function seeded(url) {
  if (SEED === null) {
    return url;
  }
  const withSeed = new URL(url);
  withSeed.searchParams.set('seed', String(SEED));
  return withSeed.href;
}

/** What the run did, for the summary at its end. */
const tally = { taken: 0, skipped: 0, failures: [] };

/** The browser of this run; closed at its end, however that comes. */
let browser = null;

/** Whether a frame sample was taken at an open station panel; a run without one says so. */
let panelSampled = false;

/** Saves what `page` shows as `name` in the output folder, and counts it. */
async function capture(page, name) {
  await page.screenshot({ path: join(OUT, name) });
  taken(name);
}

/** Counts a capture saved as `name`, its group checked (`checkGroup`). */
function taken(name) {
  checkGroup(name);
  tally.taken += 1;
}

/** Logs a capture this run leaves out, and why, its group checked (`checkGroup`). Fails nothing. */
function skip(label, why) {
  checkGroup(label);
  console.log(`${label.padEnd(18)} skipped: ${why}`);
  tally.skipped += 1;
}

/**
 * Fails the run where a capture, or the label of a skip line, belongs to no group
 * (tools/groups.mjs), or to another than the step that took it runs under (`gates`): a step
 * left ungated, or a capture misfiled — so that every run, a full one too, proves the table.
 * A name the scan of the source cannot read (tools/groups.test.mjs) is held to it here.
 */
function checkGroup(label) {
  const wrong = misfiled(label, gates.now());
  if (wrong !== null) {
    fail(wrong);
  }
}

/** Whether the group `name` is on in this run; throws for a name no group has. */
function groupOn(name) {
  if (!GROUP_NAMES.includes(name)) {
    throw new Error(`no capture group is called "${name}" (tools/groups.mjs)`);
  }
  return PLAN.on.has(name);
}

/**
 * Runs `step` where the group `name` is on in this run, under the group's gate (`gates`) and its
 * time counted to the group — a step of another group within it under that one's; where the
 * group is off, runs `otherwise` instead, nothing by default. Returns what ran.
 */
async function inGroup(name, step, otherwise = () => undefined) {
  if (!groupOn(name)) {
    return otherwise();
  }
  return gates.run(name, async () => {
    timeByGroup.enter(name);
    try {
      return await step();
    } finally {
      timeByGroup.leave();
    }
  });
}

/**
 * Starts `start` where the group `name` is on, under the group's gate (`gates`) — work going on
 * beside the steps, its time counted to none — and returns what it returns; where the group is
 * off, `otherwise`.
 */
function whenOn(name, start, otherwise = null) {
  return groupOn(name) ? gates.run(name, start) : otherwise;
}

/** Notes a check that fails the run; the walkthrough goes on, so every capture is still taken. */
function fail(what) {
  tally.failures.push(what);
}

/**
 * `url` with `?trace=1` added: the world then keeps its frame durations for `sampleFrames` —
 * and under SHOTS_PROFILE with `?profile=1`, what each of its passes costs.
 */
function traced(url) {
  const withFlag = new URL(url);
  withFlag.searchParams.set('trace', '1');
  if (PROFILE) {
    withFlag.searchParams.set('profile', '1');
  }
  return paged(withFlag.href);
}

/**
 * `url` as every page of this run opens it: with `?gl=1` under SHOTS_WEBGL, and the sound
 * systems SHOTS_AUDIO_OFF names switched off.
 */
function paged(url) {
  if (!WEBGL && AUDIO_OFF.length === 0) {
    return url;
  }
  const withFlags = new URL(url);
  if (WEBGL) {
    withFlags.searchParams.set('gl', '1');
  }
  if (AUDIO_OFF.length > 0) {
    withFlags.searchParams.set('audio-off', AUDIO_OFF.join(','));
  }
  return withFlags.href;
}

/** The run's pages by the name they were opened under: the per-page cost is logged by it. */
const named = new Map();

/** Each page's CDP session for its performance metrics, opened once: they count from then on. */
const metricSessions = new WeakMap();

/**
 * A page's renderer as Chrome counts it: CPU seconds, main-thread task seconds, live audio
 * nodes (wired or awaiting collection) and the JS heap in use, MB.
 */
async function pageCost(page) {
  let cdp = metricSessions.get(page);
  if (cdp === undefined) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    metricSessions.set(page, cdp);
  }
  const { metrics } = await cdp.send('Performance.getMetrics');
  const value = (name) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return {
    cpu: value('ProcessTime'),
    main: value('TaskDuration'),
    audio: value('AudioHandlers'),
    heap: value('JSHeapUsedSize') / 1e6,
  };
}

/** Every open page of the run, with its cost so far. */
async function pageCosts() {
  const open = [...named.keys()].filter((page) => !page.isClosed());
  return new Map(await Promise.all(open.map(async (page) => [page, await pageCost(page)])));
}

/**
 * Each page's cores busy between two readings `seconds` apart, and its audio nodes, as text; a
 * page of `frozen` is marked so, without its main thread's task time — its pause counts as one
 * task, as long as the window.
 */
function pageCostText(before, after, seconds, frozen) {
  return [...after]
    .map(([page, now]) => {
      const was = before.get(page) ?? now;
      const cores = ((now.cpu - was.cpu) / seconds).toFixed(2);
      const main = ((now.main - was.main) / seconds).toFixed(2);
      const heap = now.heap.toFixed(0);
      const busy = frozen.has(page) ? `frozen ${cores}` : `${cores} (main ${main})`;
      return `${named.get(page)} ${busy}, ${now.audio} audio nodes, ${heap} MB`;
    })
    .join('; ');
}

/** CPU seconds the browser's processes have used so far, summed by their type (CDP SystemInfo). */
async function processCpu() {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const byType = {};
    for (const { type, cpuTime } of processInfo) {
      byType[type] = (byType[type] ?? 0) + cpuTime;
    }
    return byType;
  } finally {
    await cdp.detach();
  }
}

/** The cores each type of process kept busy between two readings `seconds` apart, as text. */
function busyCores(before, after, seconds) {
  return Object.keys(after)
    .sort()
    .map((type) => {
      const busy = (after[type] - (before[type] ?? 0)) / seconds;
      return `${type.replace(/\.mojom\./, ' ')} ${busy.toFixed(2)}`;
    })
    .join(', ');
}

/** How long a page being frozen gets to come to its next line of script and pause there, ms. */
const FREEZE_WAIT_MS = 1000;

/** Each page's CDP session for freezing it (`freezePage`), opened once. */
const freezeSessions = new WeakMap();

/**
 * Stops the animations of `page` (`cdp`, its session): the compositor plays a page's
 * animations on a thread of its own, past any pause of the main thread, and composes every
 * frame of them in the one GPU process all pages share — the frozen guest's red edge breathing
 * cost the escape's window half its GPU process. A stopped timeline reaches the compositor with
 * the next frame the page draws, so the page draws one more, given FREEZE_WAIT_MS for it.
 */
async function stopAnimations(cdp, page) {
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  const twoFrames = () =>
    new Promise((drawn) => {
      globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(drawn));
    });
  await Promise.race([page.evaluate(twoFrames), sleep(FREEZE_WAIT_MS)]);
}

/**
 * Freezes the page of `other` (`othersOf`): its animations stopped (`stopAnimations`), then its
 * main thread paused in the debugger at its next line of script, so that it draws nothing,
 * takes nothing in and fires no timer until it is thawed — what the server sends meanwhile
 * waits for it, its audio plays on, and the browser answers the server's pings for it (a socket
 * goes only after twenty silent seconds, server heartbeat.ts). Chromium's own freeze, CDP
 * Page.setWebLifecycleState, leaves a page on screen running, and every page of a headless run
 * is on screen. Under SHOTS_CPU_SLOWDOWN its throttle is lifted while it stands frozen:
 * Chromium's throttle holds a thread back by keeping it spinning, which would keep a core busy
 * for a page with nothing to run. Says 'paused', or 'idle' where no script ran within
 * FREEZE_WAIT_MS: then the first that runs pauses.
 */
async function freezePage({ page }) {
  let cdp = freezeSessions.get(page);
  if (cdp === undefined) {
    cdp = await page.context().newCDPSession(page);
    freezeSessions.set(page, cdp);
  }
  await stopAnimations(cdp, page);
  let onPaused = () => {};
  const paused = new Promise((resolve) => {
    onPaused = () => resolve('paused');
    cdp.once('Debugger.paused', onPaused);
  });
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.pause');
  const how = await Promise.race([paused, sleep(FREEZE_WAIT_MS).then(() => 'idle')]);
  cdp.off('Debugger.paused', onPaused);
  await throttleSessions.get(page)?.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return how;
}

/**
 * Thaws the page of `other`: its throttle back on, the debugger switched off — it runs on, or
 * the pause still pending is called off — and its animations playing again.
 */
async function thawPage({ page }) {
  const cdp = freezeSessions.get(page);
  await throttleSessions.get(page)?.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
  await cdp.send('Debugger.disable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  await cdp.send('Animation.disable');
}

/** Every page open in the run's browser but `page`, each with the name it was opened under. */
function othersOf(page) {
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((other) => other !== page && !other.isClosed())
    .map((other) => ({ name: named.get(other) ?? 'page', page: other }));
}

/**
 * One look at a window of a page opened with `traced`, every other page of the run frozen
 * meanwhile (freeze.mjs): what `lookAlone` saw, with the pages frozen and how (`frozen`). Null,
 * the run failed, for a page without a trace or a window without frames.
 */
async function lookAt(page, when, quiet) {
  const others = othersOf(page);
  const frozenPages = new Set(others.map((other) => other.page));
  const { value, frozen } = await withOthersFrozen(
    others,
    { freeze: freezePage, thaw: thawPage },
    () => lookAlone(page, when, quiet, frozenPages),
  );
  return value === null ? null : { ...value, frozen };
}

/**
 * One look at a window of a page opened with `traced`, the pages of `frozen` standing still:
 * resets its frame trace, lets `quiet` fill the window and reads the durations recorded
 * meanwhile, their p50, p95 and count, with how long the window ran (`ms`), what the machine's
 * processes, the pages and the host's sound did meanwhile, and under SHOTS_PROFILE what each
 * pass of the world's picture cost. Null, the run failed, for a page without a trace or a
 * window without frames.
 */
async function lookAlone(page, when, quiet, frozen) {
  // The probes hold the voice as well: the frames are there only while a world is up.
  const found = await page.evaluate(() => {
    const probe = globalThis.__escapelab;
    if (typeof probe?.resetFrames !== 'function') {
      return false;
    }
    probe.resetFrames();
    probe.resetPasses?.();
    probe.resetLightWork?.();
    return true;
  });
  if (!found) {
    console.log(`frames             !! no trace ${when}: the page keeps none under ?trace=1`);
    fail(`no frame trace ${when}`);
    return null;
  }
  const cpuBefore = await processCpu();
  const pagesBefore = await pageCosts();
  const spentBefore = await page.evaluate(() => globalThis.__escapelab?.audio?.spent ?? null);
  const quietSince = Date.now();
  await quiet();
  const ms = Date.now() - quietSince;
  const cores = busyCores(cpuBefore, await processCpu(), ms / 1000);
  const perPage = pageCostText(pagesBefore, await pageCosts(), ms / 1000, frozen);
  const frames = await page.evaluate(() => globalThis.__escapelab?.frames ?? []);
  const nodes = await page.evaluate(() => globalThis.__escapelab?.audio?.nodes ?? null);
  const spentAfter = await page.evaluate(() => globalThis.__escapelab?.audio?.spent ?? null);
  const passes = PROFILE
    ? await page.evaluate(() => globalThis.__escapelab?.passes ?? null)
    : null;
  const light = await page.evaluate(() => globalThis.__escapelab?.lightWork ?? null);
  if (frames.length === 0) {
    console.log(`frames             !! no frames recorded ${when}`);
    fail(`no frames recorded ${when}`);
    return null;
  }
  return {
    p50: percentile(frames, 50),
    p95: percentile(frames, 95),
    count: frames.length,
    ms,
    cores,
    perPage,
    sound: soundSources(nodes),
    js: soundJs(spentBefore, spentAfter, ms / 1000),
    passes,
    light,
  };
}

/** Which pages a look froze while it measured the page named `measured`, for the log. */
function frozenText(frozen, measured) {
  if (frozen.length === 0) {
    return `none: the ${measured}'s page is the only one open`;
  }
  const pages = frozen.map(({ name, how }) => (how === 'paused' ? name : `${name} (${how})`));
  return `${pages.join(', ')} while the ${measured}'s frames ran`;
}

/**
 * The run's quiet pacing window — the host pacing after the game screenshots — once it is
 * measured and within the budget: its p95, ms, and the machine's 1-minute load as it ran
 * (framegate.mjs `paceOf`); null before. Every gated window after it may reach twice this p95
 * where that is more than the budget.
 */
let runPace = null;

/** The machine's 1-minute load average as the run began: the summary names it. */
const LOAD_AT_START = loadavg()[0];

/**
 * Samples a window of a page opened with `traced` (`lookAt`), every other page frozen while
 * each look runs, and logs p50 and p95 of its frame durations and which pages stood frozen.
 * Nothing in `quiet` may screenshot, resize or click: those stalls are the harness's, not the
 * game's. The window may reach the budget at p95, or twice the run's pace (`runPace`) where
 * that is more (framegate.mjs `allowanceOf`); the run's pacing window (`setsPace`) sets that
 * pace for the windows after it. A p95 over the allowance has the window looked at once more a
 * second later, the other pages thawed in between, `again` filling it for as long as the first
 * look ran — the same scene, `quiet` itself unless that would not stay the same — and fails the
 * run only where both looks are over; the line logs both, with the allowance and why and the
 * machine's 1-minute load as the window began. A window for information only (`gating` false)
 * is looked at once and logged alone, its load too. A page without a
 * trace or a window without frames fails the run. The machine's, the pages' and the sound's
 * lines are the first look's. Returns that first look — its p50, p95 and count, and the load —
 * or null where there was none.
 */
async function sampleFrames(
  page,
  when,
  quiet,
  { gating = true, again = quiet, setsPace = false } = {},
) {
  const load = loadavg()[0];
  const first = await lookAt(page, when, quiet);
  if (first === null) {
    return null;
  }
  const allowed = allowanceOf(FRAME_P95_MS, runPace);
  const gate = gating
    ? await gateWindow(
        first,
        allowed.ms,
        () => lookAt(page, when, () => again(first.ms)),
        () => sleep(AGAIN_AFTER_MS),
      )
    : { again: null, over: false, verdict: 'for information, gating nothing' };
  const p95s = gating
    ? p95Text(first, gate.again, allowed, load)
    : `p95 ${first.p95.toFixed(1)} ms at ${loadText(load)}`;
  const counts = [first, gate.again].flatMap((look) => (look === null ? [] : [look.count]));
  console.log(
    `frames             p50 ${first.p50.toFixed(1)} ms · ${p95s} (${counts.join(', ')}) ` +
      `${when}: ${gate.verdict}`,
  );
  if (setsPace && runPace === null) {
    runPace = paceOf(first, gate, load);
    console.log(`pace               ${paceText(runPace)}`);
  }
  console.log(`frozen             ${frozenText(first.frozen, named.get(page))}`);
  console.log(`cpu                cores busy: ${first.cores}; sound: ${first.sound}`);
  console.log(`pages              ${first.perPage}`);
  console.log(`sound js           ms a second on the host's main thread: ${first.js}`);
  console.log(`light              ${lightWorkText(first.light)} ${when}`);
  if (PROFILE) {
    logPasses(first.passes, when);
  }
  // A second look that found no frames has failed the run itself (`lookAt`).
  if (gate.over && gate.again !== null) {
    fail(`frame ${p95s} ${when}, over the allowance both times`);
  }
  return { ...first, load };
}

/**
 * A frame window, perf's (`sampleFrames`): where the run leaves perf out, `quiet` fills the
 * window's time all the same — a walk or a pace the steps after it may stand on — and nothing is
 * measured. Returns the first look, or null.
 */
function frameWindow(page, when, quiet, options = {}) {
  const unmeasured = async () => {
    await quiet();
    return null;
  };
  return inGroup('perf', () => sampleFrames(page, when, quiet, options), unmeasured);
}

/** The run's pace as the log names it, and what it lets the windows after it reach. */
function paceText(measured) {
  if (measured === null) {
    return `none: the pacing window failed, so every window after it keeps ${FRAME_P95_MS} ms`;
  }
  const { text } = allowanceOf(FRAME_P95_MS, measured);
  const pace = `${measured.p95.toFixed(1)} ms p95 at ${loadText(measured.load)}`;
  return `${pace}; every window after it ${text}`;
}

/**
 * Under SHOTS_PROFILE, what each pass of the world's picture cost a frame over a window
 * (`window.__escapelab.passes`, read by `lookAt`), p50/p95 in ms; a page without the probe
 * (`passes` null) fails.
 */
function logPasses(passes, when) {
  if (passes === null) {
    const why = `no pass profile ${when}: the page keeps none under ?profile=1`;
    console.log(`passes             !! ${why}`);
    fail(`no pass profile ${when}`);
    return;
  }
  const parts = Object.entries(passes).map(
    ([name, { p50, p95 }]) => `${name} ${p50.toFixed(2)}/${p95.toFixed(2)}`,
  );
  console.log(`passes             ms a frame, p50/p95, ${when}: ${parts.join(' · ')}`);
}

/** What the host's audio thread renders, from the probe's census (`audio.nodes`), as text. */
function soundSources(nodes) {
  if (nodes?.playing === undefined) {
    return 'no audio probe';
  }
  const { playing, total, wired, beds } = nodes;
  return (
    `playing ${playing.oscillator} oscillators, ${playing.buffer} buffer sources; ` +
    `${total} nodes wired (${countsOf(wired)}); ${beds} beds`
  );
}

/** The main thread's ms a second each sound system took between two readings of `audio.spent`. */
function soundJs(before, after, seconds) {
  if (after === null) {
    return 'none';
  }
  return Object.keys(after)
    .sort()
    .map((name) => `${name} ${((after[name] - (before?.[name] ?? 0)) / seconds).toFixed(2)}`)
    .join(', ');
}

/**
 * The run's last lines: the seconds each group played took (`groups`), then the summary — the
 * captures taken, skipped and failed, the groups played, the machine's 1-minute load as the run
 * began and as it ends, and what failed (`summaryText`).
 */
function summarize() {
  const load = { start: LOAD_AT_START, end: loadavg()[0] };
  console.log(`groups             ${spentText(timeByGroup.spent(), PLAN.on)}`);
  console.log(`summary            ${summaryText(tally, PLAN.on, load)}`);
}

/**
 * Reports how far the main area overflows its window. A screen that scrolls
 * is a layout bug here, so this is printed next to every capture.
 */
async function overflow(page, label) {
  const { scroll, client, parts } = await page.evaluate(() => {
    const el = document.querySelector('.content');
    // An SVG icon's className is an SVGAnimatedString, so read the attribute.
    const name = (n) =>
      `${n.tagName.toLowerCase()}.${(n.getAttribute('class') ?? '').split(' ')[0] || '-'}`;
    const measure = (node, depth) =>
      depth === 0
        ? []
        : Array.from(node.children).flatMap((c) => [
            `${'  '.repeat(3 - depth)}${name(c)} ${Math.round(c.getBoundingClientRect().height)}`,
            ...measure(c, depth - 1),
          ]);
    return {
      scroll: el.scrollHeight,
      client: el.clientHeight,
      parts: measure(el.firstElementChild ?? el, 2),
    };
  });
  const over = scroll - client;
  console.log(`${over > 1 ? '!! scrolls' : 'ok  fits  '} ${label}: ${scroll}/${client} (+${over})`);
  if (over > 1) {
    console.log(parts.join('\n'));
  }
}

/** How far a modal's panel runs out sideways, in px; 0 when it fits. */
async function sideways(page, selector) {
  return page.evaluate((sel) => {
    const panel = document.querySelector(sel);
    return panel === null ? 0 : panel.scrollWidth - panel.clientWidth;
  }, selector);
}

/**
 * The Bestenliste off the menu, captured as `shot` once it is loaded:
 * measured like the menu — at 1280×720 too where the window is a
 * laptop's, sideways on a phone — and left the way a player goes back.
 */
async function captureHistory(page, shot) {
  const name = shot.replace(/\.png$/, '');
  await page.locator('.menu-item', { hasText: 'Bestenliste' }).click();
  const loaded = page.locator('.history-board, .history [role="alert"]').first();
  await loaded.waitFor({ timeout: 10_000 });
  await sleep(300);
  await capture(page, shot);
  const { width, height } = page.viewportSize();
  await overflow(page, `${name} @ ${width}x${height}`);
  if (width >= 1280) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await sleep(400);
    await overflow(page, `${name} @ 1280x720`);
    await page.setViewportSize({ width, height });
    await sleep(300);
  } else {
    const over = await sideways(page, '.content');
    console.log(shot.padEnd(19) + (over > 0 ? `!! +${over}px sideways` : 'fits sideways'));
  }
  await clickText(page, 'Zurück');
  await page.locator('.menu-item').first().waitFor({ timeout: 10_000 });
}

/** Click a button whose visible text contains `text`. */
async function clickText(page, text) {
  const button = page.locator('button', { hasText: text }).first();
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  await button.click();
}

/**
 * The menu (client screens/Join.tsx): opens the panel behind the item `label` — „Einsatz
 * starten", „Beitreten", „Offene Runden" — and waits for it.
 */
async function openMenuPanel(page, label) {
  await page.locator('.menu-item', { hasText: label }).click();
  const panel = page.locator('.menu-panel');
  await panel.waitFor({ timeout: 10_000 });
  // It slides in: what follows reads it where it comes to rest.
  await panel.evaluate((el) =>
    Promise.all(el.getAnimations().map((slide) => slide.finished.catch(() => undefined))),
  );
}

/** Steps back out of the menu's panel with Esc, as a player does. */
async function closeMenuPanel(page) {
  await page.keyboard.press('Escape');
  await page.locator('.menu-panel').waitFor({ state: 'detached', timeout: 5000 });
}

/** Opens a round of the mission whose card reads `title`: its card picked, „Runde eröffnen". */
async function openRound(page, title) {
  await openMenuPanel(page, 'Einsatz starten');
  await page.locator('.mission', { hasText: title }).first().click();
  await page.locator('.menu-panel button', { hasText: 'Runde eröffnen' }).click();
}

/** Joins room `code` by the menu's „Beitreten" — or watches it, `watch`. */
async function byCode(page, code, watch = false) {
  await openMenuPanel(page, 'Beitreten');
  await page.getByLabel('Raumcode').fill(code);
  const way = watch ? 'Zuschauen' : 'Beitreten';
  await page.locator('.join-with-code button', { hasText: way }).click();
}

/**
 * Listens in on one player's socket: the newest view the server sent it,
 * where its avatar last reported itself and where the drones awake fly, and
 * when it heard that. The walks below steer by these, so they depend neither
 * on the map's layout nor on how fast the page renders. On the audience's
 * socket it keeps the spectator view, which places every source before the
 * crew has come across it. It notes when each view of a run on came, for the
 * views line (`reportViews`).
 */
function eavesdrop(page) {
  // `sent`: the quick-chat lines and pings the page sent, in order; `heard`: the quick-chat
  // lines it was told of, as said.
  const seen = { view: null, pos: null, crew: {}, drones: {}, dronesAt: null, sent: [] };
  seen.viewsAt = [];
  seen.heard = [];
  page.on('websocket', (socket) => {
    if (!socket.url().endsWith('/ws')) {
      return;
    }
    socket.on('framereceived', ({ payload }) => {
      const msg = JSON.parse(String(payload));
      if (msg.kind === 'chat') {
        seen.heard.push({ playerId: msg.playerId, text: msg.text });
      }
      if (msg.kind === 'view' || msg.kind === 'spectator-view') {
        seen.view = msg.view;
        if (msg.view.phase === 'playing') {
          seen.viewsAt.push(Date.now());
        }
      }
      if (msg.kind === 'positions') {
        seen.crew = msg.players;
        seen.drones = msg.drones;
        seen.dronesAt = Date.now();
      }
    });
    socket.on('framesent', ({ payload }) => {
      const msg = JSON.parse(String(payload));
      if (msg.kind === 'pos') {
        seen.pos = { x: msg.x, y: msg.y };
      }
      if (msg.kind === 'chat' || msg.kind === 'ping') {
        seen.sent.push(msg);
      }
    });
  });
  return seen;
}

/** Where the avatar is, in tiles: its last report, or its spawn before it ever moved. */
function whereIs(seen) {
  const spawn = seen.view?.map?.yourSpawn;
  return seen.pos ?? (spawn === undefined ? null : { x: spawn.x + 0.5, y: spawn.y + 0.5 });
}

/** The tiles the map's furniture stands on, by key: solid for every step, as walls are. */
function furniture(map) {
  return new Set((map.decor ?? []).map((piece) => `${piece.x},${piece.y}`));
}

/**
 * Shortest walk over floor and open doors, round the furniture — and round
 * the tiles of `avoid` (keys), but onto `to` — as tiles from `from` to `to`;
 * null if none.
 */
function route(map, from, to, avoid = new Set()) {
  const key = (x, y) => `${x},${y}`;
  const closed = new Set(map.doors.filter((d) => !d.open).map((d) => key(d.x, d.y)));
  const solid = furniture(map);
  const walkable = (x, y) =>
    map.tiles[y]?.[x] === '.' &&
    !closed.has(key(x, y)) &&
    !solid.has(key(x, y)) &&
    (!avoid.has(key(x, y)) || (x === to.x && y === to.y));
  const cameFrom = new Map([[key(from.x, from.y), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (at.x === to.x && at.y === to.y) {
      const path = [];
      for (let step = at; step !== null; step = cameFrom.get(key(step.x, step.y))) {
        path.unshift(step);
      }
      return path;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: at.x + dx, y: at.y + dy };
      if (walkable(next.x, next.y) && !cameFrom.has(key(next.x, next.y))) {
        cameFrom.set(key(next.x, next.y), at);
        queue.push(next);
      }
    }
  }
  return null;
}

/** The tile the avatar stands on. */
function tileOf(seen) {
  const at = whereIs(seen);
  return at === null ? null : { x: Math.floor(at.x), y: Math.floor(at.y) };
}

/**
 * Each floor tile's room on `map` ({ tiles, labels, doors }), by key: the floor no door cuts off,
 * shared out to the label nearest by walking — the first of two as near — as the clients dress
 * the rooms (client world/dress.ts) and core's tests count them.
 */
function roomsOf(map) {
  const doors = new Set(map.doors.map((door) => `${door.x},${door.y}`));
  const rooms = new Map();
  const queue = [];
  const claim = (x, y, room) => {
    const key = `${x},${y}`;
    if (map.tiles[y]?.[x] === '.' && !doors.has(key) && !rooms.has(key)) {
      rooms.set(key, room);
      queue.push({ x, y, room });
    }
  };
  map.labels.forEach((label) => claim(label.x, label.y, label.text));
  for (let i = 0; i < queue.length; i++) {
    const { x, y, room } = queue[i];
    for (const [dx, dy] of NEIGHBOURS) {
      claim(x + dx, y + dy, room);
    }
  }
  return rooms;
}

/** A tile's four neighbours, as steps: south, north, east, west. */
const NEIGHBOURS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/**
 * How long each page's avatar has walked in the run, ms with its keys down,
 * and when the run came up: the walking share the log ends on.
 */
const walking = { since: null, ms: new Map() };

/** The walking share in the log: each player's walk against the time since the run came up. */
function reportWalking() {
  if (walking.since === null) {
    return;
  }
  const total = Date.now() - walking.since;
  const walks = [...walking.ms].map(
    ([page, ms]) => `${named.get(page)} ${seconds(ms)} (${Math.round((ms / total) * 100)} %)`,
  );
  console.log(`walking            ${walks.join(', ')} of the ${seconds(total)} since the start`);
}

/**
 * Steers the avatar onto a tile centre with short key presses, checking each
 * result. An emergency that locks the world meanwhile is weathered first.
 */
async function stepTo(page, seen, tx, ty) {
  for (let i = 0; i < 30; i++) {
    if (relayCrew.length > 0 && emergencyOn(seen)) {
      await weather();
    }
    const at = whereIs(seen);
    const dx = tx - at.x;
    const dy = ty - at.y;
    if (Math.abs(dx) < STEP_TOLERANCE && Math.abs(dy) < STEP_TOLERANCE) {
      return true;
    }
    const keys = [];
    if (Math.abs(dx) >= STEP_TOLERANCE) keys.push(dx > 0 ? 'd' : 'a');
    if (Math.abs(dy) >= STEP_TOLERANCE) keys.push(dy > 0 ? 's' : 'w');
    // Never more than a tile's worth at once, so a slow frame cannot carry it far off.
    const ms = Math.min(240, (Math.hypot(dx, dy) / SPEED) * 1000);
    for (const key of keys) await page.keyboard.down(key);
    await sleep(ms);
    for (const key of keys) await page.keyboard.up(key);
    walking.ms.set(page, (walking.ms.get(page) ?? 0) + ms);
    await sleep(140); // the avatar reports itself every 80 ms
  }
  return false;
}

/**
 * Walks `player` to and fro inside the tile it stands on for `ms`, then back
 * to the tile's centre. The lamp moves, so every moving frame works its light
 * out anew, as in play, where a lamp standing still reuses its last sight.
 * A fifth of a tile each way presses no plate on a tile next door, and stays
 * inside the radius that keeps the player present wherever it already was.
 */
async function pace(player, ms) {
  const home = tileOf(player.seen);
  if (home === null) {
    await sleep(ms);
    return;
  }
  const [x, y] = [home.x + 0.5, home.y + 0.5];
  const end = Date.now() + ms;
  for (let leg = 0; Date.now() < end; leg++) {
    await stepTo(player.page, player.seen, x + (leg % 2 === 0 ? 0.2 : -0.2), y);
  }
  await stepTo(player.page, player.seen, x, y);
}

/**
 * How long a step waits for a change the server made to reach a page, in
 * ms: a door opened after a solve, a plate or a key, a wire cut at the other
 * console — a moment later, on a slow machine a long one.
 */
const CATCH_UP_MS = 10_000;

/** The doors as `seen`'s page shows them, for a walk that found no way. */
function doorsSaid(seen) {
  const doors = (seen.view?.map?.doors ?? []).map(
    (d) => `${d.id} ${d.x},${d.y} ${d.open ? 'open' : 'shut'}`,
  );
  const whose = seen.view?.you?.name ?? 'the';
  return `doors as ${whose}'s page sees them: ${doors.join(', ') || 'none'}`;
}

/**
 * The way from where `seen`'s avatar stands to `target` (`route`, round
 * `avoid` where it can), once the page's map shows one: where none leads
 * there yet, it looks again every 100 ms for up to CATCH_UP_MS — a door
 * opened on the server may not have reached the page — and logs how long it
 * waited for the door. Null where no way comes.
 */
async function wayThere(seen, target, avoid = new Set()) {
  const since = Date.now();
  for (let looks = 0; ; looks++) {
    const from = tileOf(seen);
    const map = seen.view?.map;
    const path =
      from === null || map == null
        ? null
        : (route(map, from, target, avoid) ?? (avoid.size > 0 ? route(map, from, target) : null));
    const waited = Date.now() - since;
    if (path !== null && looks > 0) {
      console.log(
        `door               ${seen.view?.you?.name ?? 'the walker'} waited ${waited} ms for ` +
          `the door on the way to ${target.x},${target.y}`,
      );
    }
    if (path !== null || waited >= CATCH_UP_MS) {
      return path;
    }
    await sleep(100);
  }
}

/**
 * Waits until every page of `crew` shows the station the furthest of them shows (presence.mjs
 * `lagging`), for up to CATCH_UP_MS: a solve reaches the pages one after the other, on a slow
 * runner a while apart, and a step that plans its walks from a page still showing the station
 * before walks there — on CI (f8a38a1) Ben went back to the Notstrom-Kasten's console A
 * instead of the Signalkette's. Logs how long a page lagged; throws naming it where it never
 * caught up.
 */
async function viewsCaughtUp(crew) {
  const behind = () => lagging(crew.map((player) => player.seen.view)).map((i) => crew[i]);
  const late = behind().map((player) => player.name);
  if (late.length === 0) {
    return;
  }
  const since = Date.now();
  if (!(await until(() => behind().length === 0, CATCH_UP_MS))) {
    const at = crew.map((player) => `${player.name} ${player.seen.view?.currentPuzzleIndex}`);
    throw new Error(
      `${late.join(' and ')}'s view still lags the solve after ${seconds(CATCH_UP_MS)} ` +
        `(station index ${at.join(', ')})`,
    );
  }
  console.log(
    `catch-up           ${late.join(' and ')}'s view caught up with the solve ` +
      `${Date.now() - since} ms after the step`,
  );
}

/**
 * Walks the avatar to the tile before `target` on the way there, or leaves it
 * where it is when it already stands next to it — once a way leads there on
 * the page (`wayThere`). False when none does, with the doors as the page
 * shows them in the log, or when the avatar gets stuck.
 */
async function walkNear(page, seen, target) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const path = await wayThere(seen, target);
    if (path === null) {
      const from = tileOf(seen);
      console.log(
        `door               no way from ${from?.x},${from?.y} to ${target.x},${target.y} ` +
          `after ${seconds(CATCH_UP_MS)} — ${doorsSaid(seen)}`,
      );
      return false;
    }
    let arrived = true;
    for (const tile of path.slice(1, -1)) {
      if (!(await stepTo(page, seen, tile.x + 0.5, tile.y + 0.5))) {
        arrived = false;
        break;
      }
    }
    if (arrived) {
      return true;
    }
  }
  return false;
}

/** Polls `check` until it holds or `ms` have passed; whether it held in the end. */
async function until(check, ms) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) {
    await sleep(100);
  }
  return check();
}

/**
 * E where `player` stands until `shows` holds (presence.mjs `pressUntilShown`): once the page's
 * view counts the player at `target` — the server writes that a stream tick and a round trip
 * after the avatar stops, a slow runner later — or 6 s have passed, up to 6 presses over 6 s,
 * an emergency on meanwhile weathered before each. A count that took a second or more, or
 * never came, gets a line in the log; where nothing comes up, the line says where the server
 * has the player and what it counts them at (`stateSaid`). Whether `shows` holds.
 *
 * @param {{ what: string, now: () => Promise<boolean>, within: (ms: number) => Promise<void> }}
 *   shows what E brings up as the log names it; whether it is up now; a wait of at most `ms`
 *   for it
 */
async function pressAt(player, target, shows) {
  const { page, seen, name } = player;
  const outcome = await pressUntilShown({
    counted: () => presentAt(seen.view, target),
    shown: shows.now,
    press: async () => {
      await weather();
      await page.keyboard.press('e');
    },
    waitShown: shows.within,
    sleep,
    now: Date.now,
  });
  const said = pressSaid(outcome, shows.what);
  if (said !== null) {
    const server = seen.crew?.[seen.view?.you?.id];
    const state = { name, view: seen.view, server, sent: seen.pos, target, now: Date.now() };
    const where = outcome.shown ? '' : ` — ${stateSaid(state)}`;
    console.log(`presence           ${name} at ${targetSaid(target)}: ${said}${where}`);
  }
  return outcome.shown;
}

/** What E brings up at each kind of target, as the log names it. */
const BROUGHT_UP = { station: 'the panel', source: 'the pages', note: 'the slip' };

/** Presses E at `target` until `locator` shows (`pressAt`); whether it does. */
async function interactUntil(player, locator, target) {
  return pressAt(player, target, {
    what: BROUGHT_UP[target.of],
    now: () => locator.isVisible(),
    within: (ms) => locator.waitFor({ state: 'visible', timeout: ms }).catch(() => undefined),
  });
}

/** Presses E at `target` until `done` holds on the views (`pressAt`); whether it does. */
async function pressUntil(player, target, what, done) {
  return pressAt(player, target, {
    what,
    now: async () => done(),
    within: (ms) => until(done, ms),
  });
}

/** How many presses E gets, for the errors of a step whose E opened nothing. */
const TRIES = `${PRESSES.tries} presses`;

/** Steps from where a player stands to `target` over floor and open doors; Infinity if none. */
function stepsTo(seen, target) {
  const from = tileOf(seen);
  const path = from === null ? null : route(seen.view.map, from, target);
  return path === null ? Infinity : path.length;
}

/**
 * Nobody has a role: as in the smoke script, whoever the draw put nearer the
 * armed station works it, and the other one reads.
 */
function operatorFirst(players) {
  const station = players[0].seen.view.map.stations.find((s) => s.status === 'armed');
  return station === undefined
    ? players
    : [...players].sort((a, b) => stepsTo(a.seen, station) - stepsTo(b.seen, station));
}

/**
 * The open manual object the crew has come across that a player can walk to soonest, one
 * covering the armed station first.
 */
function nearestManual(seen) {
  const map = seen.view.map;
  const from = tileOf(seen);
  const armed = map.stations.find((s) => s.status === 'armed')?.puzzleId;
  const options = map.manuals
    .filter((manual) => manual.known && manual.opened)
    .map((manual) => ({ manual, path: from === null ? null : route(map, from, manual) }))
    .filter((option) => option.path !== null)
    .sort(
      (a, b) =>
        Number(b.manual.puzzleIds.includes(armed)) - Number(a.manual.puzzleIds.includes(armed)) ||
        a.path.length - b.path.length,
    );
  return options[0]?.manual ?? null;
}

/** Text of the first match, trimmed; null when nothing matches. */
async function textOf(locator) {
  return (await locator.count()) === 0 ? null : (await locator.first().innerText()).trim();
}

/** Book pages whose text runs past their foot: the pagination estimate fell short there. */
async function pagesRunningOver(page) {
  return page.evaluate(
    () =>
      [...document.querySelectorAll('.reading-modal .page-text')].filter(
        (text) => text.scrollHeight - text.clientHeight > 1,
      ).length,
  );
}

/**
 * reading-page2.png: one page turned — by a swipe across the pages, falling
 * back to the arrow key if the swipe did nothing — forwards unless the
 * source opened at its end. A wall chart has nothing to turn.
 */
async function capturePageTurn(page, overlay, who) {
  const where = overlay.locator('.book-where, .terminal-status');
  const before = await textOf(where);
  if (before === null) {
    skip('reading-page2.png', `${who} reads a wall chart, it has no pages`);
    return;
  }
  const forwards = !(await overlay.locator('.turn-next').isDisabled());
  if (!forwards && (await overlay.locator('.turn-back').isDisabled())) {
    skip('reading-page2.png', `"${before}" is the whole source, no page to turn either way`);
    return;
  }
  const box = await overlay.locator('.book-pages, .terminal-body').first().boundingBox();
  if (box !== null) {
    const y = box.y + box.height / 2;
    const [from, to] = forwards ? [0.75, 0.2] : [0.25, 0.8];
    await page.mouse.move(box.x + box.width * from, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
    await page.mouse.up();
  }
  await sleep(450);
  let after = await textOf(where);
  let how = 'swiped';
  if (after === before) {
    await page.keyboard.press(forwards ? 'ArrowRight' : 'ArrowLeft');
    await sleep(450);
    after = await textOf(where);
    how = '!! the swipe did nothing, turned by key';
  }
  await capture(page, 'reading-page2.png');
  console.log(
    `reading-page2.png  ${who}: "${before}" → "${after}" ` +
      `(${after === before ? '!! did not turn' : how}), ` +
      `${await pagesRunningOver(page)} page(s) run over`,
  );
}

/**
 * reading.png: a player walks to a manual object, presses E and reads; then
 * turns a page. False when no manual object is in reach for this player.
 */
async function captureReading(page, seen, who) {
  const manual = nearestManual(seen);
  if (manual === null || !(await walkNear(page, seen, manual))) {
    return false;
  }
  const overlay = page.locator('.reading-modal');
  if (!(await interactUntil({ page, seen, name: who }, overlay, sourceTarget(manual)))) {
    throw new Error(`${who} stands at "${manual.id}", but no .reading-modal opened after ${TRIES}`);
  }
  await sleep(400); // past the page's fade-in
  await capture(page, 'reading.png');
  const shows = await textOf(overlay.locator('.book-where, .terminal-status'));
  const over = await sideways(page, '.reading-modal .panel');
  console.log(
    `reading.png        ${who}: "${manual.label}" (${manual.kind}), ${shows ?? 'one sheet'}, ` +
      `${await pagesRunningOver(page)} page(s) run over, ` +
      `panel ${over > 0 ? `!! +${over}px sideways` : 'fits sideways'}`,
  );
  await capturePageTurn(page, overlay, who);
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'hidden', timeout: 3000 });
  return true;
}

/**
 * In the page, before a sync station's presses: from now on it notes on its own clock when its
 * strip first shows station `index` done (`led-done`) and when its own press went down
 * (`window.__stripWatch`, pageclock.mjs `StripSeen`) — however late the walkthrough looks, and
 * whatever takes the strip's place by then: on a phone held sideways, the radio's banner takes
 * it over in the row a moment after a solve (client screens/Game.tsx `StageTop`). The watch
 * ends once the strip shows it done, its listeners after 20 s.
 */
function watchStrip(index) {
  const t0 = globalThis.performance.now();
  const seen = { done: null, pressed: null };
  globalThis.__stripWatch = seen;
  const press = (event) => {
    seen.pressed ??= event.timeStamp - t0;
  };
  const look = () => {
    const led = document.querySelector('.led-strip')?.children[index];
    if (seen.done === null && led?.classList.contains('led-done') === true) {
      seen.done = globalThis.performance.now() - t0;
      watch.disconnect();
    }
  };
  const watch = new globalThis.MutationObserver(look);
  watch.observe(document.body, { subtree: true, childList: true, attributeFilter: ['class'] });
  document.addEventListener('pointerdown', press, true);
  globalThis.setTimeout(() => {
    watch.disconnect();
    document.removeEventListener('pointerdown', press, true);
  }, 20_000);
  look();
}

/** What `page`'s strip watch noted (watchStrip) once it saw the station done, or after `ms`. */
async function stripSeen(page, ms) {
  await pageHolds(page, () => globalThis.__stripWatch?.done != null, ms);
  return page.evaluate(() => globalThis.__stripWatch ?? null);
}

/**
 * A sync station takes every press within its window: both players click
 * its button at the same moment, and the station has to solve — the run
 * moves on past it, and the LED strip moves on for both, as each page noted
 * it on its own clock (watchStrip); the rooms it lights, if any, come up.
 * Throws when it does not.
 */
async function pressTogether(players, station) {
  const [first] = players;
  const litBefore = first.seen.view.map.litRooms.length;
  const index = first.seen.view.currentPuzzleIndex;
  await Promise.all(players.map(({ page }) => page.evaluate(watchStrip, index)));
  await Promise.all(players.map(({ page }) => page.locator('.station-modal .big-button').click()));
  // The line that comes with the solve speaks a second after it: listen from the presses on.
  const listening = whenOn('audio', () => hearRadio(first, RADIO_LISTEN_MS));
  if (station.look !== 'lever') {
    await inGroup('devices', () => captureSolved(first, station));
  }
  const solved = await until(() => first.seen.view.currentPuzzleIndex > index, 5000);
  const seen = await Promise.all(players.map(({ page }) => stripSeen(page, 5000)));
  const strips = stripVerdict(players.map(({ name }, i) => ({ name, seen: seen[i] })));
  if (!solved || strips.stuck.length > 0) {
    const why = [
      ...(solved ? [] : ['the run did not move on']),
      ...(strips.stuck.length === 0 ? [] : [`the LED strip stood still (${strips.text})`]),
    ];
    // The radio still listens on: once this throw has closed the browser its page is gone, and
    // that error, left unheard, would end the process before the summary could name this one.
    listening?.catch((error) => console.log(`radio voice        stopped: ${firstLine(error)}`));
    throw new Error(`both pressed "${station.title}", but it did not solve: ${why.join(', ')}`);
  }
  console.log(
    `sync               ${players.map(({ name }) => name).join(' and ')} pressed ` +
      `"${station.title}" together: solved, ` +
      `${first.seen.view.map.litRooms.join(', ') || 'no room'} lit; the strip showed it done, ` +
      `on each page's clock: ${strips.text}`,
  );
  return { listening, lit: first.seen.view.map.litRooms.slice(litBefore) };
}

/** How long after a solve a device closes itself, as puzzles/Device.tsx says (SOLVED_CLOSE_MS). */
const SOLVED_CLOSE_MS = 500;

/**
 * device-solved.png as the run takes it: whether a shot landed while the
 * device still showed solved, and when those that landed after its close did,
 * ms after it showed solved. The first sync station the run solves is shot; a
 * late shot is taken again at the next one, and one late there too is skipped.
 */
const solvedShot = { taken: false, late: [] };

/** Whether device-solved.png is still to be shot: none in time yet, no second chance spent. */
function shootingSolved() {
  return !solvedShot.taken && solvedShot.late.length < 2;
}

/**
 * Counts the shot of a solved device, `shot` ms after it showed solved (null
 * where none was taken): in time before its close; after it, late — and the
 * second late one is skipped at once.
 */
function noteShot(shot) {
  if (shot === null) {
    return;
  }
  if (shot < SOLVED_CLOSE_MS) {
    solvedShot.taken = true;
  } else {
    solvedShot.late.push(shot);
    if (solvedShot.late.length === 2) {
      skipLateShot();
    }
  }
}

/** Logs device-solved.png as skipped: its shots landed after the device's close, at these times. */
function skipLateShot() {
  const times = solvedShot.late.map((ms) => `${ms} ms`).join(', ');
  skip('device-solved.png', `the solved-device shot landed late under load (${times})`);
}

/**
 * What a solved device shows at its shot: the status strip's LEDs gone green
 * so far, and any overlay lying over the device — nothing may cover it, its
 * own sweep is the solve's whole show.
 */
function solvedLook(page) {
  return page.evaluate(() => {
    const view = document.defaultView;
    const device = document.querySelector('.station-modal .device--solved');
    const strip = [...document.querySelectorAll('.station-modal .device-strip-led')];
    const green = (led) => {
      const [r, g] = (view.getComputedStyle(led).backgroundColor.match(/\d+/g) ?? []).map(Number);
      return g > 150 && g > r;
    };
    const box = device?.getBoundingClientRect();
    const over = (el) => {
      const r = el.getBoundingClientRect();
      const meets = box !== undefined && r.left < box.right && r.right > box.left;
      return meets && r.top < box.bottom && r.bottom > box.top;
    };
    const covers = [...document.querySelectorAll('.overlay')]
      .filter((el) => over(el) && Number(view.getComputedStyle(el).opacity) > 0.05)
      .map((el) => el.getAttribute('class'));
    return { lit: strip.filter(green).length, all: strip.length, covers };
  });
}

/**
 * A sync station right after the crew's presses: it has to show solved — its
 * status strip sweeping green along the bezel's foot, its plate dimmed — with
 * nothing over it, and close itself SOLVED_CLOSE_MS later. The first one the
 * run solves is shot as it sweeps (device-solved.png), the next one again
 * where that shot landed after the close (noteShot). Fails where it never
 * shows solved, is gone before it is looked at, lies covered, or does not
 * close itself.
 */
async function captureSolved(player, station) {
  const solved = player.page.locator('.station-modal .device--solved');
  const since = Date.now();
  if (!(await attached(solved, 3000))) {
    console.log(`device-solved      !! "${station.title}" never showed solved for ${player.name}`);
    fail(`device-solved: "${station.title}" never showed solved`);
    return;
  }
  const seen = Date.now();
  await sleep(120); // the sweep under way along the strip
  const look = await solvedLook(player.page);
  const looked = Date.now() - seen;
  const shooting = shootingSolved();
  if (shooting) {
    await capture(player.page, 'device-solved.png');
  }
  const shot = shooting ? Date.now() - seen : null;
  const gone = await solved.waitFor({ state: 'detached', timeout: SOLVED_CLOSE_MS + 1500 }).then(
    () => Date.now() - seen,
    () => null,
  );
  noteShot(shot);
  const timing = { since: seen - since, looked, shot, gone };
  reportSolved(`${player.name}: "${station.title}"`, look, timing);
}

/**
 * A solved sync station in the log — when it showed solved after the presses,
 * when it was looked at and shot, what lay over it, when it closed itself —
 * and in the failures where it was gone before it was looked at, covered, or
 * never closed itself. A shot after its close is no failure (noteShot).
 */
function reportSolved(what, look, { since, looked, shot, gone }) {
  const late = shot !== null && shot >= SOLVED_CLOSE_MS;
  const lateSaid = late ? ' (late: after its close)' : '';
  const shotSaid = shot === null ? '' : `, shot ${shot} ms${lateSaid}`;
  const covered = look.covers.length > 0;
  const strip = `${look.lit} of ${look.all} strip LEDs green`;
  console.log(
    `${shot === null ? 'device-solved     ' : 'device-solved.png '} ${what} solved ${since} ms ` +
      `after the presses, looked at ${looked} ms into it${shotSaid} — ${strip}, ` +
      `${covered ? `!! under ${look.covers.join(', ')}` : 'nothing over it'}; ` +
      (gone === null ? '!! it stayed open' : `it closed itself after ${gone} ms`),
  );
  const why = [
    ...(look.all === 0 ? ['was gone before it was looked at'] : []),
    ...(covered ? ['lay covered'] : []),
    ...(gone === null ? ['stayed open'] : []),
  ];
  if (why.length > 0) {
    fail(`device-solved: ${what} ${why.join(', ')}`);
  }
}

/**
 * station-both.png: while the operator keeps the station open, the reader
 * walks up as well and presses E — the panel has to show for both of them.
 * At a sync station both then press it together — at a main switch with a
 * window after the operator's lone pull, its ring and both pages' count
 * (captureLeverRing). Then the reader leaves it and walks back to where it
 * stood.
 */
async function captureBothAtStation(reader, operator, station, sync) {
  const back = tileOf(reader.seen);
  if (!(await walkNear(reader.page, reader.seen, station))) {
    if (sync) {
      throw new Error(`${reader.name} has no way to the sync station "${station.title}"`);
    }
    const why = `${reader.name} has no way to "${station.puzzleId}"`;
    await inGroup('devices', () => skip('station-both.png', why));
    return;
  }
  const readerSees = await interactUntil(
    reader,
    reader.page.locator('.station-modal'),
    consoleTarget(station),
  );
  const operatorSees = await operator.page.locator('.station-modal').isVisible();
  await sleep(400); // past the panel's fade-in
  const missing = [
    ...(readerSees ? [] : [reader.name]),
    ...(operatorSees ? [] : [operator.name]),
  ];
  await inGroup('devices', () => shootBothAtStation(reader, operator, station, missing));
  if (sync) {
    await pressBoth(reader, operator, station, missing);
  }
  // Whatever E opened instead of the panel locks the avatar too.
  await reader.page.keyboard.press('Escape');
  await sleep(300);
  const returned = back !== null && (await walkNear(reader.page, reader.seen, back));
  console.log(
    `station-both       ${reader.name}: ` +
      (returned ? `back near ${back.x},${back.y}` : '!! could not walk back'),
  );
}

/** station-both.png on the reader's page, and whether the panel showed for both (`missing`). */
async function shootBothAtStation(reader, operator, station, missing) {
  await capture(reader.page, 'station-both.png');
  console.log(
    `station-both.png   ${reader.name} joins ${operator.name} at "${station.title}": ` +
      (missing.length === 0
        ? 'panel up for both'
        : `!! no .station-modal for ${missing.join(' and ')}`),
  );
}

/**
 * Both press the sync station `station` together — at a main switch with a window after the
 * operator's lone pull, its ring and both pages' count (captureLeverRing) — and the room it lights
 * comes up alive, its line spoken. Throws where one of them (`missing`) has no panel to press.
 */
async function pressBoth(reader, operator, station, missing) {
  if (missing.length > 0) {
    const who = missing.join(' and ');
    throw new Error(`"${station.title}" wants both presses, but ${who} has no panel`);
  }
  if (station.look === 'lever') {
    await inGroup('devices', () => captureLeverRing(operator, [operator, reader]));
  }
  const solved = await pressTogether([operator, reader], station);
  await inGroup('audio', () => soundAfterTheSync([operator, reader], station, solved));
}

/**
 * After a sync station `players` pressed (`solved`, from pressTogether): the bed of the room it
 * lit alive, its line spoken by its recording, and what each page keeps decoded.
 */
async function soundAfterTheSync(players, station, solved) {
  const [operator] = players;
  await bedAlive(operator, solved.lit, `after "${station.title}"`);
  await checkRadioVoice(operator, solved.listening, `"${station.title}"`);
  await audioKept(players, 'at the first station');
}

/**
 * One step from where `player` stands into its room — north, east, south or
 * west, the first that is floor — as a player does first, which brings more
 * of the room into sight. The player stays there.
 */
async function stepIntoRoom(player) {
  const home = tileOf(player.seen);
  const map = player.seen.view.map;
  const solid = furniture(map);
  const step = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ].find(
    ([dx, dy]) =>
      home !== null &&
      map.tiles[home.y + dy]?.[home.x + dx] === '.' &&
      !solid.has(`${home.x + dx},${home.y + dy}`),
  );
  if (home === null || step === undefined) {
    return;
  }
  await stepTo(player.page, player.seen, home.x + step[0] + 0.5, home.y + step[1] + 0.5);
}

/**
 * The floor of the room round `from`, as tiles: every floor tile reachable
 * without crossing a door, open or not — the room the power lights whole.
 */
function roomFloorOf(map, from) {
  const key = (x, y) => `${x},${y}`;
  const doors = new Set(map.doors.map((d) => key(d.x, d.y)));
  const inside = (x, y) => map.tiles[y]?.[x] === '.' && !doors.has(key(x, y));
  if (!inside(from.x, from.y)) {
    return [];
  }
  const seen = new Set([key(from.x, from.y)]);
  const room = [{ x: from.x, y: from.y }];
  for (let i = 0; i < room.length; i++) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: room[i].x + dx, y: room[i].y + dy };
      if (inside(next.x, next.y) && !seen.has(key(next.x, next.y))) {
        seen.add(key(next.x, next.y));
        room.push(next);
      }
    }
  }
  return room;
}

/**
 * How bright the floor of a room comes out on a traced page's world canvas: the
 * mean luma, 0 to 255, of a few pixels at the middle of each of its tiles on
 * the canvas — mapped by the camera the page reports — and how many tiles
 * that was; a mean of null where none of them is on the canvas.
 */
async function roomBrightness(page, tiles) {
  return page.evaluate((spots) => {
    const camera = globalThis.__escapelab?.camera;
    const canvas = document.querySelector('.world-canvas');
    const g = canvas?.getContext('2d');
    if (camera === undefined || g == null) {
      return { mean: null, tiles: 0 };
    }
    const { width: w, height: h } = canvas;
    let sum = 0;
    let pixels = 0;
    let counted = 0;
    for (const { x, y } of spots) {
      const px = Math.round(w / 2 + (x + 0.5 - camera.x) * camera.scale);
      const py = Math.round(h / 2 + (y + 0.5 - camera.y) * camera.scale);
      if (px < 3 || py < 3 || px > w - 4 || py > h - 4) {
        continue;
      }
      counted += 1;
      const data = g.getImageData(px - 2, py - 2, 5, 5).data;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        pixels += 1;
      }
    }
    return { mean: pixels === 0 ? null : sum / pixels, tiles: counted };
  }, tiles);
}

/** The floor of a lit room comes out at least this bright with the power on, mean luma 0–255. */
const ROOM_LIT_LUMA = 45;
/** A room left in the dark comes out at most this bright. */
const ROOM_DARK_LUMA = 20;

/**
 * With the power on the host's own room is lit whole and warm, and the
 * Serverraum and the Labor — rooms of its map it is not in — stay dark: each
 * by the brightness of its floor on the host's canvas. Fails where one is
 * not; a room of these the map lacks, or the canvas does not show, is left
 * out of the check with a word.
 */
async function checkPowerRooms(host) {
  const map = host.seen.view.map;
  const own = roomFloorOf(map, tileOf(host.seen));
  const named = (text) => map.labels.find((label) => label.text === text);
  // The furniture's tiles show its sprites, not the floor: only bare floor is measured.
  const solid = furniture(map);
  const bare = (floor) => floor.filter((tile) => !solid.has(`${tile.x},${tile.y}`));
  const rooms = [
    { name: 'own room', floor: bare(own), lit: true },
    ...['SERVERRAUM', 'LABOR'].map((text) => {
      const label = named(text);
      const floor = label === undefined ? [] : bare(roomFloorOf(map, label));
      return { name: text, floor, lit: false };
    }),
  ];
  const said = [];
  for (const room of rooms) {
    const { mean, tiles } = await roomBrightness(host.page, room.floor);
    if (mean === null) {
      said.push(`${room.name} not on the canvas`);
      continue;
    }
    const ok = room.lit ? mean >= ROOM_LIT_LUMA : mean <= ROOM_DARK_LUMA;
    const luma = mean.toFixed(0);
    said.push(`${room.name} ${room.lit ? 'lit' : 'dark'} ${ok ? '' : '!! '}${luma} (${tiles} tiles)`);
    if (!ok) {
      const should = room.lit ? `be lit (≥ ${ROOM_LIT_LUMA})` : `be dark (≤ ${ROOM_DARK_LUMA})`;
      fail(`cold-open.png: the ${room.name} comes out at luma ${luma} with the power on — should ${should}`);
    }
  }
  return said.join(', ');
}

/**
 * cold-open.png: a mission with an intro opens with the power on, and a
 * player who has skipped its opening walks the lit lab — NORMALBETRIEB where
 * the clock will be, the room the player stands in lit whole and warm, the
 * rest of the lab dark. The host's window grows to COLD_OPEN; the host steps
 * into its room, and the host's frames meanwhile are the sample of the lit
 * scene, while the guest still watches the opening. Fails unless the shot
 * shows the host's own room lit and the Serverraum and the Labor dark
 * (`checkPowerRooms`); throws when NORMALBETRIEB never shows or the lights
 * are out before the shot.
 */
async function captureColdOpen(host) {
  if (!(await attached(host.page.locator('.stage-clock .power-status'), 5000))) {
    throw new Error('the run opened with the power on, but no NORMALBETRIEB shows');
  }
  await host.page.setViewportSize(COLD_OPEN);
  await sleep(250);
  // A second look paces where the step ended: one more step could leave the host's room.
  await frameWindow(host.page, 'in the lit lab, the power still on', () => stepIntoRoom(host), {
    again: (ms) => pace(host, ms),
  });
  if (host.seen.view.lights.out) {
    throw new Error('the lights went out before cold-open.png');
  }
  await capture(host.page, 'cold-open.png');
  const status = await textOf(host.page.locator('.stage-clock .power-status'));
  const room = await textOf(host.page.locator('.stage-goal--power .stage-sub'));
  const rooms = await checkPowerRooms(host);
  const found =
    host.seen.view.map.manuals.filter((m) => m.found).map((m) => m.kind).join(', ') || 'none';
  console.log(
    `cold-open.png      ${host.name} @ ${COLD_OPEN.width}x${COLD_OPEN.height}: "${status}", ` +
      `"${room}"; ${rooms}; sources found: ${found}`,
  );
  const lit = 'in the lit lab, the power still on';
  await keySceneAtTwo(host, lit, () => pace(host, SAMPLE_MS), 'cold-open-dpr2.png');
  await host.page.setViewportSize(SIZES[0]);
}

/** The run's opening as a traced page has it (client world/intro/useIntro.ts); null for none. */
function introOf(page) {
  return page.evaluate(() => globalThis.__escapelab?.intro ?? null);
}

/** Where a traced page's camera looks, tiles; null without one. */
function cameraOf(page) {
  return page.evaluate(() => {
    const camera = globalThis.__escapelab?.camera;
    return camera === undefined ? null : { x: camera.x, y: camera.y };
  });
}

/** The black bars of the opening's shot standing in `page`'s picture. */
function barsIn(page) {
  return page.locator('.intro-bar:not(.intro-bar--out)').count();
}

/**
 * How much of the HUD a traced page shows: the most of the objective bar, the crew's strip and
 * the control cluster by their opacity (`page`), and of what the canvas draws of it, the
 * minimap and the marks (`canvas`, the opening's probe; null without an opening).
 */
function hudOf(page) {
  return page.evaluate(() => {
    const shown = ['.stage-top', '.hud', '.world-controls'].flatMap((selector) => {
      const element = document.querySelector(selector);
      return element === null ? [] : [Number(globalThis.getComputedStyle(element).opacity)];
    });
    const intro = globalThis.__escapelab?.intro;
    return { page: Math.max(0, ...shown), canvas: intro?.phase == null ? null : intro.hud };
  });
}

/** Whether `hud` (from hudOf) shows nothing of the HUD. */
const hudOut = (hud) => hud.page < 0.01 && (hud.canvas ?? 0) === 0;

/** How long after the title has gone hudReturn looks for the clock's flash, ms. */
const FLASH_LOOK_MS = 1200;

/**
 * Waits in a traced page for what the opening holds over its world to go — the title, or for
 * `card`, a mission's name card — then for the HUD to come back whole: how much of the objective
 * bar showed as it went (`atGone`), how long it took to come back (`ms`), whether the clock's
 * digits flashed as it came (looked for up to FLASH_LOOK_MS on) and whether a radio line stood
 * on the bar while the HUD was out. Null where it never came back within `limit` ms.
 */
function hudReturn(page, card = false, limit = 8000) {
  return page.evaluate(
    ([nameCard, most, look]) =>
      new Promise((resolve) => {
        const start = globalThis.performance.now();
        const top = () => {
          const bar = document.querySelector('.stage-top');
          return bar === null ? 0 : Number(globalThis.getComputedStyle(bar).opacity);
        };
        const seen = { gone: null, atGone: null, whole: null, flashed: false, banner: false };
        const step = () => {
          const now = globalThis.performance.now();
          const over = nameCard
            ? document.querySelector('.intro-card') === null
            : (globalThis.__escapelab?.intro?.title ?? 0) === 0;
          if (seen.gone === null && over) {
            seen.gone = now;
            seen.atGone = top();
          }
          seen.banner ||= top() < 0.01 && document.querySelector('.radio-banner') !== null;
          if (seen.gone !== null) {
            seen.flashed ||= document.querySelector('.countdown--start') !== null;
            seen.whole ??= top() >= 0.99 ? now : null;
            if (seen.whole !== null && (seen.flashed || nameCard || now - seen.gone > look)) {
              const { atGone, flashed, banner } = seen;
              resolve({ atGone, ms: Math.round(seen.whole - seen.gone), flashed, banner });
              return;
            }
          }
          if (now - start > most) {
            resolve(null);
            return;
          }
          globalThis.requestAnimationFrame(step);
        };
        step();
      }),
    [card, limit, FLASH_LOOK_MS],
  );
}

/**
 * intro-card.png: a run opens on the location card, on black — the plant, and for a mission
 * with an intro its wing and the shift with its time; a mission without one names itself
 * there. The card stands 1.5 s (2.5 s without an intro): waited for from before the run starts
 * and shot as soon as it is up whole, the HUD out under it; a mission's name card lets the HUD
 * come back as it goes. Fails where none comes up, or the HUD shows under it or stays away.
 */
async function captureIntroCard(player) {
  const up = await player.page
    .waitForFunction(
      () => {
        const card = document.querySelector('.intro-card');
        return card !== null && Number(globalThis.getComputedStyle(card).opacity) > 0.9;
      },
      null,
      { timeout: START_MS + 2500 },
    )
    .then(
      () => true,
      () => false,
    );
  if (!up) {
    console.log('intro-card.png     !! no location card came up as the run started');
    fail('intro-card.png: no location card as the run started');
    return;
  }
  await capture(player.page, 'intro-card.png');
  const hud = await hudOf(player.page);
  const lines = await player.page.locator('.intro-card p, .intro-card h1').allInnerTexts();
  const named = (await player.page.locator('.intro-card .intro-name').count()) > 0;
  const back = named ? await hudReturn(player.page, true) : undefined;
  const after =
    back === undefined
      ? ''
      : back === null
        ? '; !! the HUD never came back after it'
        : `; the HUD back over ${back.ms} ms once the card had gone`;
  console.log(
    `intro-card.png     ${player.name}: ${lines.join(' / ')}; ` +
      `${hudOut(hud) ? 'the HUD out' : `!! the HUD showing (${hud.page}, ${hud.canvas})`}${after}`,
  );
  if (!hudOut(hud) || back === null) {
    fail(`intro-card.png: the HUD at ${hud.page} under the card, back ${back?.ms ?? 'never'}`);
  }
}

/**
 * intro-pan.png: the opening's shot once the lab has faded in, its power on, and the
 * loudspeakers' first line stands subtitled in the lower bar between the two black bars, the
 * skip beside it, nobody of the crew skipped yet. The camera runs from the reactor end towards
 * the spawn meanwhile; the host's frames over the shot are sampled for information, gating
 * nothing. Fails where the bars, the subtitle, the skip or the camera's run are missing.
 */
async function captureIntroShot(player) {
  const subtitle = player.page.locator('.intro-subtitle');
  const said = await attached(subtitle, 8000);
  await capture(player.page, 'intro-pan.png');
  const line = said ? await textOf(subtitle) : null;
  const hint = await textOf(player.page.locator('.intro-skip'));
  const bars = await barsIn(player.page);
  const from = await cameraOf(player.page);
  await frameWindow(player.page, 'over the opening’s shot', () => sleep(SAMPLE_MS), {
    gating: false,
  });
  const to = await cameraOf(player.page);
  const intro = await introOf(player.page);
  const ran = from === null || to === null ? 0 : Math.hypot(to.x - from.x, to.y - from.y);
  console.log(
    `intro-pan.png      ${player.name}: ${bars} bars, „${line ?? '!! no subtitle'}", ` +
      `„${hint ?? '!! no skip'}"; the camera ran ${ran.toFixed(2)} tiles in ` +
      `${SAMPLE_MS / 1000} s; ${intro?.pa?.played ?? 0} line(s) over the loudspeakers so far, ` +
      `music ${intro?.cue?.playing ? 'playing' : 'none'}`,
  );
  const fine = bars === 2 && line !== null && hint === 'Überspringen · Leertaste (0/2)';
  if (!fine || intro?.phase !== 'shot' || !(ran > 0.05)) {
    fail(`intro-pan.png: ${bars} bars, subtitle ${line !== null}, „${hint}", ran ${ran} tiles`);
  }
}

/**
 * intro-skip.png: the host skips the opening with Space — the bars leave its picture, the lit
 * lab is its to walk — and the guest's lower bar counts it, „(1/2)". Fails where the count
 * does not come or the host's opening is not cut.
 */
async function captureIntroSkip(host, guest) {
  await host.page.keyboard.press('Space');
  const counted = await attached(guest.page.locator('.intro-skip', { hasText: '(1/2)' }), 5000);
  await capture(guest.page, 'intro-skip.png');
  const hint = await textOf(guest.page.locator('.intro-skip'));
  await sleep(500); // the host's bars leave over 0.4 s
  const intro = await introOf(host.page);
  const bars = await barsIn(host.page);
  console.log(
    `intro-skip.png     ${host.name} skipped with Space (${intro?.phase}, ${bars} bars left), ` +
      `${guest.name}'s lower bar: „${hint ?? '!! nothing'}"; the lights ` +
      (host.seen.view.lights.out ? '!! went out' : 'still on'),
  );
  if (!counted || intro?.skipped !== true || bars !== 0 || host.seen.view.lights.out) {
    fail(`intro-skip.png: counted ${counted}, ${host.name} ${intro?.phase} with ${bars} bars`);
  }
}

/** Whether `box`, a locator's bounding box, lies whole inside a window `size` big. */
function insideWindow(box, size) {
  return (
    box !== null &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= size.width + 0.5 &&
    box.y + box.height <= size.height + 0.5
  );
}

/**
 * intro-phone-932.png: the opening's shot on the guest's phone, turned sideways as a large phone
 * is (SIZES[4]) while the shot still plays there — the host has skipped, the guest not: its two
 * bars, the skip line and a subtitle on now whole inside the window, nothing of the HUD. The run
 * fails where it is not so. The phone goes back to how it was held.
 */
async function captureOpeningLarge(player) {
  const { page, name } = player;
  const held = page.viewportSize();
  const size = SIZES[4];
  await page.setViewportSize({ width: size.width, height: size.height });
  await sleep(500);
  const bars = await barsIn(page);
  const skip = insideWindow(await page.locator('.intro-skip').boundingBox(), size);
  const subtitle = page.locator('.intro-subtitle');
  const said = (await subtitle.count()) === 0 || insideWindow(await subtitle.boundingBox(), size);
  const hud = await hudOf(page);
  await capture(page, `intro-${size.name}.png`);
  await page.setViewportSize(held);
  await sleep(300);
  const checks = [
    [bars !== 2, `${bars} bars`],
    [!skip, 'the skip line cut off'],
    [!said, 'the subtitle cut off'],
    [!hudOut(hud), `the HUD showing (${hud.page})`],
  ];
  const wrong = checks.filter(([bad]) => bad).map(([, what]) => what);
  const verdict = wrong.length === 0 ? 'the skip line and any subtitle in view, the HUD out' : '';
  console.log(
    `intro-${size.name}.png ${name} @ ${size.width}x${size.height}: ${bars} bars; ` +
      (wrong.length === 0 ? verdict : `!! ${wrong.join(', ')}`),
  );
  if (wrong.length > 0) {
    fail(`intro-${size.name}.png: ${wrong.join(', ')}`);
  }
}

/**
 * Shoots `player`'s title as `name` once it has landed: what it said, the bars beside it and
 * how much of the HUD showed under it.
 */
async function titleShot(player, name) {
  const title = player.page.locator('.intro-title');
  const up = await attached(title, 6000);
  if (up) {
    await sleep(250); // past its landing
    await capture(player.page, name);
  }
  const hud = await hudOf(player.page);
  return { up, text: up ? await textOf(title) : null, bars: await barsIn(player.page), hud };
}

/** The log's words for the HUD under a title shot (titleShot). */
const hudUnder = (shot) =>
  hudOut(shot.hud) ? 'the HUD out' : `!! the HUD showing (${shot.hud.page}, ${shot.hud.canvas})`;

/**
 * intro-title.png, intro-title-phone.png: the guest presses the opening away too, and with the
 * whole crew done the lights go out at once — on the guest's phone the shot cuts to its spawn
 * and the mission's title lands on the dark frame between the bars; on the host's window, the
 * host having skipped, it lands at the bang after the lights' flicker. Neither shows anything of
 * the HUD under its title; on the host's window it comes back once the title has gone, over
 * 0.3 s, the clock's digits flashing as it comes and mission control waiting for it. Fails where
 * a title does not come, the HUD shows under one or stays away, the guest's beat stands without
 * its bars, or the lights waited for the intro's end.
 */
async function captureIntroTitle(host, guest) {
  const pressed = Date.now();
  // A press, not a touch: the phone's first touch in a run takes its page fullscreen, as on a
  // phone, and the walkthrough resizes that window later on.
  await guest.page.locator('.intro').click();
  const [phone, desk] = await Promise.all([
    titleShot(guest, 'intro-title-phone.png'),
    titleShot(host, 'intro-title.png'),
  ]);
  const back = await hudReturn(host.page);
  const { lights, startedAt, intro } = host.seen.view;
  const outIn = lights.outAt === null ? null : lights.outAt - startedAt;
  const early = outIn !== null && lights.outAt >= pressed - 50 && outIn < intro.lightsSec * 1000;
  console.log(
    `intro-title.png    ${host.name}: „${desk.text ?? '!! no title'}" at the bang, ` +
      `${hudUnder(desk)}; intro-title-phone.png ${guest.name}: „${phone.text ?? '!! no title'}" ` +
      `between ${phone.bars} bars, ${hudUnder(phone)}; the lights went out ` +
      `${outIn === null ? '!! never' : seconds(outIn)} into the run as ${guest.name} pressed, ` +
      `the intro's own end at ${intro.lightsSec} s`,
  );
  const returned =
    back === null
      ? '!! never came back'
      : `came back over ${back.ms} ms once the title had gone (${back.atGone} of it then), ` +
        `${back.flashed ? 'the clock flashing' : '!! no flash on the clock'}, ` +
        `${back.banner ? '!! a radio line up while it was out' : 'mission control waiting for it'}`;
  console.log(`hud                ${host.name}'s HUD ${returned}`);
  // The fade may have begun in the frame the title went in: all but out then, not yet back.
  const hudFine = back !== null && back.atGone < 0.25 && back.flashed && !back.banner;
  if (!desk.up || !phone.up || phone.bars !== 2 || !early) {
    const said = `${host.name} ${desk.up}, ${guest.name} ${phone.up} with ${phone.bars} bars`;
    fail(`intro titles: ${said}`);
  }
  if (!hudOut(desk.hud) || !hudOut(phone.hud) || !hudFine) {
    fail(`intro titles: the HUD ${hudUnder(desk)} / ${hudUnder(phone)}, then ${returned}`);
  }
}

/** The light probe of a traced page (client world/gl/path.ts), or null where it has none. */
function lightOf(page) {
  return page.evaluate(() => {
    const light = globalThis.__escapelab?.light;
    return light === undefined
      ? null
      : { path: light.path, renderer: light.renderer, reason: light.reason };
  });
}

/** Resolves after `count` more animation frames of `page`: the world has drawn as many. */
function framesOf(page, count) {
  return page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let left = n;
        const next = () => (--left <= 0 ? resolve() : globalThis.requestAnimationFrame(next));
        globalThis.requestAnimationFrame(next);
      }),
    count,
  );
}

/** Takes the light of `page` the way `path` says ('gl', 'canvas'), or back (null); waits it out. */
async function lightThrough(page, path) {
  await page.evaluate((way) => globalThis.__escapelab?.light?.use(way), path);
  await framesOf(page, 3);
}

/** The mean luma of `page`'s world canvas as its light probe reads it, 0–255; null without one. */
function canvasLuma(page) {
  return page.evaluate(() => globalThis.__escapelab?.light?.luma() ?? null);
}

/**
 * Logs which way the world's light takes on `player`'s page and why. Fails
 * the run where SHOTS_WEBGL asked for the light layer and it does not draw,
 * or where SHOTS_SOFTWARE_GL renders in software and it does.
 */
async function checkLight({ name, page }) {
  const light = await lightOf(page);
  const said = light === null ? '!! no light probe' : `${light.path} (${light.reason})`;
  console.log(`light              ${name}: ${said}, renderer ${light?.renderer ?? 'none'}`);
  if (WEBGL && light?.path !== 'gl') {
    const way = light?.path ?? 'no way';
    fail(`SHOTS_WEBGL asked for the light layer, but ${name}'s light takes ${way}`);
  } else if (SOFTWARE_GL && !WEBGL && light?.path !== 'canvas') {
    fail(`a software renderer keeps the Canvas pass, but ${name}'s light takes ${light?.path}`);
  }
}

/**
 * Under SHOTS_WEBGL, the moment about to be shot both ways on `page`: its
 * world's mean luma on the light layer and on the Canvas pass, which may lie
 * at most LUMA_TOLERANCE apart; `shot` taken on the layer, then the light
 * left on the Canvas pass for the shot the caller takes. Returns what takes
 * the light back to the layer. Without SHOTS_WEBGL, nothing.
 */
async function lightPair(page, shot) {
  if (!WEBGL) {
    return async () => undefined;
  }
  const light = await lightOf(page);
  if (light?.path !== 'gl') {
    console.log(`${shot.padEnd(18)} !! the light takes ${light?.path ?? 'no way'}, not the layer`);
    fail(`${shot}: the light probe reports ${light?.path ?? 'nothing'}, not gl`);
    return async () => undefined;
  }
  const onLayer = await canvasLuma(page);
  await lightThrough(page, 'canvas');
  const onCanvas = await canvasLuma(page);
  await lightThrough(page, null);
  await capture(page, shot);
  await lightThrough(page, 'canvas');
  if (onLayer === null || onCanvas === null) {
    console.log(`${shot.padEnd(18)} !! the world's canvas gave no luma to compare`);
    fail(`${shot}: no luma off the world's canvas`);
    return () => lightThrough(page, null);
  }
  const gap = onCanvas > 0 ? Math.abs(onLayer - onCanvas) / onCanvas : Infinity;
  const match = gap <= LUMA_TOLERANCE;
  console.log(
    `${shot.padEnd(18)} on the light layer (${light.renderer}): mean luma ${onLayer.toFixed(1)}, ` +
      `the Canvas pass ${onCanvas.toFixed(1)} — ${(gap * 100).toFixed(1)} % apart` +
      (match ? '' : ` !! more than ${LUMA_TOLERANCE * 100} %`),
  );
  if (!match) {
    fail(`${shot}: mean luma ${onLayer.toFixed(1)} on the layer, ${onCanvas.toFixed(1)} on Canvas`);
  }
  return () => lightThrough(page, null);
}

// --- sound (client world/ambience.ts, music.ts, radioVoice.ts, spatial.ts) ---

/** What a traced page's world sounds like, as its audio probe reads it; null without one. */
function soundOf(page) {
  return page.evaluate(() => {
    const audio = globalThis.__escapelab?.audio;
    if (audio === undefined) {
      return null;
    }
    const { room, kind, beds, power, music, voice, spatial } = audio;
    return { room, kind, beds, power, music, voice, spatial };
  });
}

/** Counts by name as text: "gain 12, filter 4". */
function countsOf(record) {
  return Object.entries(record ?? {}).map(([name, count]) => `${name} ${count}`).join(', ');
}

/** Levels by name as text: "archive 1.00, corridor 0.25". */
function levelsOf(record) {
  const named = Object.entries(record ?? {}).map(([name, level]) => `${name} ${level.toFixed(2)}`);
  return named.join(', ') || 'none';
}

/**
 * The bed of the room `player` stands in has collapsed to its dead variant
 * (`when`: after the blackout, or with the lights out from the start): its
 * powered layer — fans, hums, whines — is down. Fails otherwise.
 */
async function bedDead(player, when) {
  const sound = await soundOf(player.page);
  const kind = sound?.kind ?? null;
  const power = kind === null ? null : (sound.power[kind] ?? null);
  const dead = power !== null && power <= 0.05;
  const state = `${dead ? 'dead' : '!! not dead'} (power ${power?.toFixed(2) ?? 'none'})`;
  console.log(
    `sound              ${player.name} in ${sound?.room ?? '!! no room'} ${when}: the ` +
      `${kind ?? '?'} bed ${state}; beds ${levelsOf(sound?.beds)}`,
  );
  if (!dead) {
    fail(`sound ${when}: the bed of ${player.name}'s room is not dead (${kind}: ${power})`);
  }
}

/**
 * Once a station has lit rooms (`lit`), the bed of the one `player` stands
 * in is alive again, warmed up with the lights: waits up to 3 s for it. Fails
 * otherwise.
 */
async function bedAlive(player, lit, when) {
  let sound = null;
  const alive = () => {
    const kind = sound?.kind ?? null;
    return kind !== null && lit.includes(sound.room) && (sound.power[kind] ?? 0) >= 0.95;
  };
  for (const end = Date.now() + 3000; ; await sleep(100)) {
    sound = await soundOf(player.page);
    if (alive() || Date.now() >= end) {
      break;
    }
  }
  const kind = sound?.kind ?? '?';
  console.log(
    `sound              ${player.name} in ${sound?.room ?? '!! no room'} ${when}: the ${kind} ` +
      `bed ${alive() ? 'alive' : '!! not alive'} (power ${levelsOf(sound?.power)})`,
  );
  if (!alive()) {
    fail(`sound ${when}: the bed of ${player.name}'s lit room is not alive`);
  }
}

/**
 * How long the walkthrough listens for a line on the radio, ms: the longest line speaks some
 * ten seconds, and a line that comes with a solve begins a second after it.
 */
const RADIO_LISTEN_MS = 20_000;

/** The least a spoken word takes, ms: a line of twenty words speaks four seconds at least. */
const MS_PER_WORD = 200;

/** A line's words, as the radio-line test counts them (core test/radioLines.test.ts). */
const wordsOf = (line) => line.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/**
 * Listens to `player`'s radio for up to `ms` from now: the first line that
 * speaks, by its recording's id, from when to when it was heard speaking
 * (polled every 100 ms), and whether the Leitstelle opened the channel for
 * it. Null where none spoke.
 */
async function hearRadio(player, ms) {
  const end = Date.now() + ms;
  let heard = null;
  while (Date.now() < end) {
    const voice = (await soundOf(player.page))?.voice;
    if (voice?.playing === true && (heard === null || voice.lastId === heard.id)) {
      heard ??= { id: voice.lastId, from: Date.now(), to: Date.now(), opened: voice.opened };
      heard.to = Date.now();
    } else if (heard !== null) {
      break;
    }
    await sleep(100);
  }
  return heard;
}

/**
 * The line that came over the radio (`listening`, from hearRadio): a
 * recording from the manifest the server hands out has to have spoken it —
 * what the banner says, the view's last radio line, or `expected` where given
 * — for MS_PER_WORD a word at least, a second at the least; the line that
 * opens a run after the Leitstelle's opening squelch, and no other line.
 * Fails otherwise.
 */
async function checkRadioVoice(player, listening, after, expected = null) {
  const heard = await listening;
  // A page without the recordings answers with something else: no manifest, and the check fails.
  const manifest = await player.page.evaluate(() =>
    globalThis
      .fetch('/voice/manifest.json')
      .then((res) => res.json())
      .catch(() => ({})),
  );
  const events = player.seen.view.events;
  const line =
    expected ?? [...events].reverse().find((event) => event.kind === 'radio')?.label ?? null;
  const entry = heard === null ? undefined : manifest[heard.id];
  const spoke = heard === null ? 0 : heard.to - heard.from;
  const words = line === null ? 0 : wordsOf(line);
  const opens = entry?.opens === true;
  const keyedRight = heard !== null && heard.opened === opens;
  const keyed = opens ? ', opened by the Leitstelle' : '';
  const said = heard === null
    ? '!! no line spoke'
    : `${heard.id} „${entry?.text ?? '!! not in the manifest'}" speaking ${seconds(spoke)} ` +
      `of its ${seconds(entry?.ms ?? 0)}, ${words} words${keyed}` +
      `${keyedRight ? '' : ` !! ${heard.opened ? 'opened' : 'not opened'}`}`;
  console.log(`radio voice        ${player.name} after ${after}: ${said}; the banner: „${line}"`);
  const plausible = spoke >= Math.max(1000, words * MS_PER_WORD);
  if (entry === undefined || entry.text !== line || !plausible || !keyedRight) {
    fail(`radio voice after ${after}: ${heard?.id ?? 'nothing'} spoke ${spoke} ms for „${line}"`);
  }
}

/** The run's first line on the radio, as `player`'s view has it; null before it came. */
const startLineOf = (player) =>
  player.seen.view.events.find((event) => event.kind === 'radio')?.label ?? null;

/** How many times the partner's side was told apart, of the checks that could. */
const sides = { checked: 0 };

/**
 * Where `player` hears `partner`: the probe's pan has to point to the side
 * the partner stands on, wherever they stand half a tile or more apart
 * sideways (`where`: the moment). Fails on the wrong side.
 */
async function partnerSide(player, partner, where) {
  await sleep(300); // a placing round or two after the last step
  const at = whereIs(player.seen);
  const them = whereIs(partner.seen);
  const pan = (await soundOf(player.page))?.spatial?.partnerPan ?? null;
  const dx = them.x - at.x;
  if (Math.abs(dx) < 0.5) {
    console.log(`partner            ${where}: ${partner.name} stands in line with ${player.name}`);
    return;
  }
  sides.checked += 1;
  const right = pan !== null && Math.sign(pan) === Math.sign(dx);
  const side = dx > 0 ? 'right' : 'left';
  const heard = `${pan?.toFixed(2) ?? '!! none'}${right ? '' : ' !! wrong side'}`;
  console.log(
    `partner            ${where}: ${partner.name} ${Math.abs(dx).toFixed(1)} tiles to the ` +
      `${side} of ${player.name}, heard at pan ${heard}`,
  );
  if (!right) {
    fail(`partner ${where}: ${partner.name} stands ${side}, but pans ${pan}`);
  }
}

/**
 * The partner across the room from `player`: `partner` walks to bare floor
 * — no plate, station or furniture — three to five tiles to its side in its
 * row, is heard there on that side (partnerSide), and walks back. Throws
 * where the walk breaks off.
 */
async function partnerAcross(player, partner, where) {
  const map = player.seen.view.map;
  const at = tileOf(player.seen);
  const back = tileOf(partner.seen);
  const taken = new Set([
    ...map.plates.map((p) => `${p.x},${p.y}`),
    ...map.stations.map((s) => `${s.x},${s.y}`),
    ...furniture(map),
  ]);
  const away = (tile) => Math.abs(tile.x - at.x);
  const spot = roomFloorOf(map, at)
    .filter((tile) => tile.y === at.y && away(tile) >= 3 && away(tile) <= 5)
    .filter((tile) => !taken.has(`${tile.x},${tile.y}`))
    .sort((a, b) => away(a) - away(b))
    .find((tile) => stepsTo(partner.seen, tile) !== Infinity);
  if (spot === undefined) {
    skip('partner', `no bare floor three to five tiles beside ${player.name} in its row`);
    return;
  }
  if (!(await standOn(partner, spot))) {
    throw new Error(`${partner.name} found no way to ${spot.x},${spot.y} ${where}`);
  }
  await partnerSide(player, partner, where);
  if (back !== null && !(await standOn(partner, back))) {
    throw new Error(`${partner.name} found no way back to ${back.x},${back.y}`);
  }
}

/**
 * The radio's chain rendered once offline in the page, white noise in: its
 * band-pass has to show in the spectrum — the power above 4 kHz at least 10 dB
 * under the power from 300 Hz to 3.4 kHz, and 15 dB further down against it
 * than in the noise that went in. Fails otherwise.
 */
async function checkRadioBand(page) {
  const render = await page.evaluate(() => globalThis.__escapelab?.audio?.renderRadio() ?? null);
  if (render === null) {
    fail('radio band: the page has no audio probe to render the chain with');
    return;
  }
  const bands = [
    [300, 3400],
    [4000, render.rate / 2],
  ];
  const [inBand, inAbove] = bandPowers(render.input, render.rate, bands);
  const [outBand, outAbove] = bandPowers(render.output, render.rate, bands);
  const before = decibels(inAbove, inBand);
  const after = decibels(outAbove, outBand);
  const passes = after <= -10 && before - after >= 15;
  console.log(
    `radio band         above 4 kHz against 300–3400 Hz: ${before.toFixed(1)} dB in the noise, ` +
      `${after.toFixed(1)} dB out of the chain${passes ? '' : ' !! no band-pass'}`,
  );
  if (!passes) {
    fail(`radio band: ${after.toFixed(1)} dB above 4 kHz out, ${before.toFixed(1)} dB in`);
  }
}

/** How much of a recorded line the page hands back from its offline render, s. */
const LINE_RENDER_S = 3;

/**
 * One recorded line rendered through the radio's chain offline in the page — the opening line
 * of `missionId`, as the manifest marks it, its first LINE_RENDER_S: its spectrum has to show
 * the band-pass too — above 4 kHz and below 300 Hz each at least 10 dB further down against
 * the band from 300 Hz to 3.4 kHz than in the recording. Fails otherwise.
 */
async function checkRadioLine(page, missionId) {
  const render = await page.evaluate(
    async ([mission, seconds]) => {
      const manifest = await globalThis.fetch('/voice/manifest.json').then((res) => res.json());
      const id = Object.keys(manifest).find(
        (key) => manifest[key].opens === true && manifest[key].missions.includes(mission),
      );
      const audio = globalThis.__escapelab?.audio;
      if (id === undefined || audio === undefined) {
        return null;
      }
      const { rate, input, output } = await audio.renderRadio(id);
      const length = Math.min(input.length, rate * seconds);
      return { id, rate, input: input.slice(0, length), output: output.slice(0, length) };
    },
    [missionId, LINE_RENDER_S],
  );
  if (render === null) {
    fail(`radio line: no opening line of ${missionId} in the manifest, or no audio probe`);
    return;
  }
  const bands = [
    [20, 300],
    [300, 3400],
    [4000, render.rate / 2],
  ];
  const [inLow, inBand, inHigh] = bandPowers(render.input, render.rate, bands);
  const [outLow, outBand, outHigh] = bandPowers(render.output, render.rate, bands);
  const high = [decibels(inHigh, inBand), decibels(outHigh, outBand)];
  const low = [decibels(inLow, inBand), decibels(outLow, outBand)];
  const passes = high[0] - high[1] >= 10 && low[0] - low[1] >= 10;
  console.log(
    `radio line         ${render.id} through the chain, against 300–3400 Hz: above 4 kHz ` +
      `${high[0].toFixed(1)} dB in the recording, ${high[1].toFixed(1)} dB out; below 300 Hz ` +
      `${low[0].toFixed(1)} dB in, ${low[1].toFixed(1)} dB out${passes ? '' : ' !! no band-pass'}`,
  );
  if (!passes) {
    fail(`radio line: ${high[1].toFixed(1)} dB above 4 kHz, ${low[1].toFixed(1)} dB below 300 Hz`);
  }
}

/** What a page may keep decoded at most, bytes (client world/audioMemory.ts DECODED_BUDGET). */
const DECODED_BUDGET = 30 * 1024 * 1024;
/** Where the PCM kept has been logged already: the first station is logged once a run. */
const keptLogged = new Set();

/** What a page's sound keeps and holds now, as its audio probe reads it; null without one. */
function keptOf(page) {
  return page.evaluate(() => {
    const audio = globalThis.__escapelab?.audio;
    if (audio === undefined || typeof audio.decodedBytes !== 'number') {
      return null;
    }
    const { decodedBytes, decoded, budget, nodes, music, reverb, limiterDb } = audio;
    const playing = nodes?.playing?.buffer ?? null;
    return { decodedBytes, decoded, budget, playing, music, room: reverb?.room ?? null, limiterDb };
  });
}

/** Bytes as megabytes, one place. */
const megabytes = (bytes) => (bytes / 1024 / 1024).toFixed(1);

/**
 * The PCM each of `players`' pages keeps decoded and the sources it holds (keptOf), logged at
 * `when` — the first station once a run: a page over 30 MB, a budget over its caps or a page
 * without the probe fails the run.
 */
async function audioKept(players, when) {
  if (keptLogged.has(when) && when === 'at the first station') {
    return;
  }
  keptLogged.add(when);
  for (const player of players) {
    const kept = await keptOf(player.page);
    if (kept === null) {
      console.log(`audio              ${player.name} ${when}: !! no audio probe`);
      fail(`audio ${when}: ${player.name}'s page has no audio probe`);
      continue;
    }
    const over = kept.decodedBytes > DECODED_BUDGET;
    const by = Object.entries(kept.decoded).map(([who, bytes]) => `${who} ${megabytes(bytes)}`);
    const { voice, loop, caps } = kept.budget;
    const within = voice <= caps.voice && loop <= caps.loop;
    const music = kept.music;
    console.log(
      `audio              ${player.name} ${when}: decoded ${megabytes(kept.decodedBytes)} MB ` +
        `(${by.join(', ')})${over ? ' !! over 30 MB' : ''}; sources ${voice} of ${caps.voice} ` +
        `voices, ${loop} of ${caps.loop} loops${within ? '' : ' !! over the budget'}, ` +
        `${kept.playing ?? '?'} buffers playing, ${music.streams} streams (latest in ` +
        `${music.lateMs} ms late, ${music.lagMs} ms off now); reverb ${kept.room ?? 'none'}; ` +
        `limiter ${kept.limiterDb.toFixed(1)} dB`,
    );
    if (over) {
      fail(`audio ${when}: ${player.name} keeps ${megabytes(kept.decodedBytes)} MB decoded`);
    }
    if (!within) {
      fail(`audio ${when}: ${player.name} holds ${voice} voices, ${loop} loops`);
    }
  }
}

/**
 * In the escape the music's pressure is 0.8 or more, a pressure stem up (the
 * tense or the critical) and the calm stem gone under the siren: waits up to
 * 6 s for the crossfade — a change waits for the stems' next bar (client
 * music.ts, under 3 s at 90 bpm), then crosses over 2 s. Fails otherwise.
 */
async function escapeMusic(player) {
  let music = null;
  const pressed = () =>
    music !== null && music.level >= 0.8 && music.pressure >= 0.8 && music.calm <= 0.05;
  for (const end = Date.now() + 6000; ; await sleep(100)) {
    music = (await soundOf(player.page))?.music ?? null;
    if (pressed() || Date.now() >= end) {
      break;
    }
  }
  const level = music?.level.toFixed(2) ?? '!! none';
  console.log(
    `music              ${player.name} in the escape: pressure ${level}, layers calm ` +
      `${music?.calm.toFixed(2)}, pressure ${music?.pressure.toFixed(2)}, last ` +
      `${music?.last.toFixed(2)}${pressed() ? '' : ' !! not under pressure'}`,
  );
  if (!pressed()) {
    fail(`music in the escape: pressure ${music?.level}, layers ${JSON.stringify(music)}`);
  }
}

/**
 * The lights out on the host's page once the whole crew has skipped the opening: its clock
 * counting, and its HUD coming back whole over the dark, waited for up to 8 s each. The clock's
 * locator, and whether the HUD came back; throws where no clock ever counts.
 */
async function lightsOut(host) {
  const clock = host.page.locator('.stage-clock .countdown');
  if (!(await attached(clock, 8000))) {
    throw new Error('the lights went out, but no clock ever counted');
  }
  const shown = await host.page
    .waitForFunction(
      () => {
        const bar = document.querySelector('.stage-top');
        return bar !== null && Number(globalThis.getComputedStyle(bar).opacity) >= 0.99;
      },
      null,
      { timeout: 8000 },
    )
    .then(
      () => true,
      () => false,
    );
  return { clock, shown };
}

/**
 * blackout.png: two seconds after the clock has come into sight on the
 * host's page — it counts from the click, under the HUD the opening keeps
 * out until its title has gone — the flashlight on, the emergency lamps red
 * in the dark. Fails where the HUD never comes back.
 */
async function captureBlackout(host) {
  const { clock, shown } = await lightsOut(host);
  if (!shown) {
    fail('blackout.png: the HUD never came back over the dark lab');
  }
  await sleep(2000);
  const back = await lightPair(host.page, 'light-gl.png');
  await capture(host.page, 'blackout.png');
  await back();
  const { lights, startedAt, map } = host.seen.view;
  console.log(
    `blackout.png       ${host.name}: the lights went out ` +
      `${seconds(lights.outAt - startedAt)} into the run, clock "${await textOf(clock)}", ` +
      `${map.lamps.length} emergency lamp(s) on the map`,
  );
}

/**
 * Lets `walker` through a plate door to `target`: `holder` stands on the
 * nearest plate it reaches that opens the way. False when none does.
 */
async function letThrough(walker, holder, target) {
  const plates = holder.seen.view.map.plates
    .filter((plate) => !plate.freezesDrone && stepsTo(holder.seen, plate) !== Infinity)
    .sort((one, other) => stepsTo(holder.seen, one) - stepsTo(holder.seen, other));
  for (const plate of plates) {
    await holdPlate(holder, plate);
    if ((await wayThere(walker.seen, target)) !== null) {
      console.log(
        `plate              ${holder.name} holds "${plate.label}" at ${plate.x},${plate.y}, ` +
          `${walker.name} walks out`,
      );
      return walkNear(walker.page, walker.seen, target);
    }
  }
  return false;
}

/**
 * Tiles beside `station` for `count` players to stand on, one each: floor
 * within reach of it, neither a plate, another station nor furniture,
 * nearest first.
 */
function spotsBy(station, map, count) {
  const taken = new Set([
    ...map.plates.map((p) => `${p.x},${p.y}`),
    ...map.stations.map((s) => `${s.x},${s.y}`),
    ...furniture(map),
  ]);
  const spots = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const spot = { x: station.x + dx, y: station.y + dy };
      if (map.tiles[spot.y]?.[spot.x] === '.' && !taken.has(`${spot.x},${spot.y}`)) {
        spots.push(spot);
      }
    }
  }
  const away = (spot) => Math.hypot(spot.x - station.x, spot.y - station.y);
  return spots.sort((a, b) => away(a) - away(b) || a.x - b.x).slice(0, count);
}

/**
 * Brings the whole crew to `station`: whoever cannot reach it is let through
 * a plate door by somebody who can, then each stands on a spot of its own
 * beside it, so that whoever held a plate steps off it and its door shuts,
 * as the steps after expect. Throws where somebody cannot get there.
 */
async function gatherAt(station, players) {
  const free = players.filter((player) => stepsTo(player.seen, station) !== Infinity);
  if (free.length === 0) {
    throw new Error(`nobody reaches the station at ${station.x},${station.y}`);
  }
  for (const walker of players.filter((player) => !free.includes(player))) {
    if (!(await letThrough(walker, free[0], station))) {
      throw new Error(`${walker.name} found no way to the station at ${station.x},${station.y}`);
    }
  }
  const spots = spotsBy(station, players[0].seen.view.map, players.length);
  for (const [i, player] of players.entries()) {
    const spot = spots[i] ?? station;
    const there =
      (await walkNear(player.page, player.seen, spot)) &&
      (await stepTo(player.page, player.seen, spot.x + 0.5, spot.y + 0.5));
    if (!there) {
      throw new Error(`${player.name} got stuck on the way to ${spot.x},${spot.y} by the station`);
    }
  }
}

/**
 * lever.png, lit-flur.png: the whole crew at the main switch the first
 * station is (gatherAt). On the way each page finds the switch — within two
 * tiles or in its lamp's cone, or the run fails (`reportLeverFound`). E
 * opens its panel on both pages, a lever lit for each of them; both throw
 * theirs together, the panel closes itself and the room the station lights
 * comes up warm. Logs how long the lever took from the lights going out.
 */
async function throwLever(players) {
  const [first] = players;
  const lever = first.seen.view.map.stations.find((s) => s.status === 'armed');
  if (lever === undefined || lever.look !== 'lever') {
    await inGroup('devices', () => skip('lever.png', 'the first station is no main switch'));
    return;
  }
  const watches = players.map((player) => watchFinding(player, lever));
  try {
    await gatherAt(lever, players);
  } finally {
    watches.forEach((watch) => watch.stop());
  }
  await reportLeverFound(players, lever, watches);
  await inGroup('graphics', () => atTheLever(first));
  for (const player of players) {
    const modal = player.page.locator('.station-modal');
    if (!(await interactUntil(player, modal, consoleTarget(lever)))) {
      throw new Error(`${player.name} stands at the lever, but no .station-modal after ${TRIES}`);
    }
  }
  await sleep(500); // past the panel's fade-in
  await inGroup('devices', () => leverPanels(players));
  const solved = await pressTogether(players, lever);
  await captureLitFlur(first, lever);
  await inGroup('audio', () => soundAfterTheLever(players, solved));
}

/**
 * The host at the main switch in the dark, its panel not yet open: the beacon over it turning
 * (beacon-sweep-a.png, beacon-sweep-b.png), the blackout's grade, the beam's core and the host
 * posed at the console (pose-console.png).
 */
async function atTheLever(first) {
  await captureBeaconSweep(first);
  await captureGradeBlackout(first);
  await captureBeamCore(first);
  await capturePose(first, first, 'console', 'pose-console.png');
}

/**
 * The main switch's panel open on both pages: each phone's held sideways (device-phone-*.png),
 * the host's levers (lever.png), and its lone pull with the count on both pages (lever-ring.png).
 */
async function leverPanels(players) {
  const [first] = players;
  for (const player of players) {
    await captureDevicePhone(player, stationSlug(player));
  }
  await captureLeverPanel(first, players.length);
  await captureLeverRing(first, players);
}

/**
 * After the lever (`solved`, from pressTogether): the lit corridor's bed alive, the lever's line
 * spoken, what each page keeps decoded, and the partner heard from across the corridor.
 */
async function soundAfterTheLever(players, solved) {
  const [first, partner] = players;
  await bedAlive(first, solved.lit, 'after the lever');
  await checkRadioVoice(first, solved.listening, 'the lever');
  await audioKept(players, 'at the first station');
  await partnerAcross(first, partner, 'across the corridor');
}

/** The beacon burning nearest the page's avatar, as its graphics probe has it; null for none. */
async function nearestBeacon(page) {
  const probe = await graphicsOf(page);
  const self = await page.evaluate(() => globalThis.__escapelab?.self ?? null);
  if (probe === null || self === null || probe.beacons.length === 0) {
    return null;
  }
  const away = (b) => Math.hypot(b.x - self.x, b.y - self.y);
  return [...probe.beacons].sort((a, b) => away(a) - away(b))[0];
}

/**
 * beacon-sweep-a.png, beacon-sweep-b.png: the emergency lamps turned beacons once the lights
 * failed (client world/beacon.ts) — the crew at the main switch, the lamp over it turning its two
 * lobes of red: two shots of the host's window a second apart. Between them the first lobe of
 * the beacon nearest the host has to have turned as far as the page's probe says its clock turned
 * it, a tenth of a turn at least, and the picture round that lamp, as far as its lobes reach, has
 * to have changed — or the run fails (tools/sweep.mjs). Skipped where no lamp burns in view.
 */
async function captureBeaconSweep(player) {
  const { page } = player;
  const before = await nearestBeacon(page);
  const spot = before === null ? null : await onPage(page, before.x, before.y);
  if (before === null || spot === null) {
    skip('beacon-sweep-a.png', 'no emergency lamp burns as a beacon in this window');
    return;
  }
  const first = await page.screenshot();
  await sleep(1000);
  const second = await page.screenshot();
  const after = await nearestBeacon(page);
  writeFileSync(join(OUT, 'beacon-sweep-a.png'), first);
  writeFileSync(join(OUT, 'beacon-sweep-b.png'), second);
  taken('beacon-sweep-a.png');
  taken('beacon-sweep-b.png');
  const half = before.reach * spot.tile;
  const box = { x: spot.x - half, y: spot.y - half, width: 2 * half, height: 2 * half };
  const dpr = await page.evaluate(() => globalThis.devicePixelRatio);
  const share = changedShare(decodePng(first), decodePng(second), box, dpr);
  const sweep = after === null ? null : sweepOf(before, after, before.turnMs);
  const fine = sweep !== null && sweepVerdict(sweep, share);
  const clock = sweep === null ? '' : ` (its clock ${degrees(sweep.expected)}°)`;
  const turned = sweep === null ? '!! gone' : `${degrees(sweep.turned)}°${clock}`;
  const where = `${before.x.toFixed(2)},${before.y.toFixed(2)}`;
  console.log(
    `beacon-sweep       ${player.name}: the lamp at ${where} turned ${turned} between the ` +
      `shots, ${(share * 100).toFixed(1)} % of the picture round it changed${fine ? '' : ' !!'}`,
  );
  if (!fine) {
    fail(`beacon-sweep: turned ${turned}, ${(share * 100).toFixed(1)} % changed`);
  }
}

/**
 * grade-blackout.png: the lab's colours in the blackout (client world/grade.ts) — the crew at the
 * main switch in the dark, the host's window whole: the darkness and what the lamps show turned
 * a cool blue-grey, the emergency lamps' red added over it as it was. The page's probe has to
 * name the blackout's grade, laid on (a twentieth at least) in a colour bluer than red or green,
 * or the run fails.
 */
async function captureGradeBlackout(player) {
  const { page } = player;
  const probe = await graphicsWhen(page, (p) => p.grade?.phase === 'blackout', 3000);
  await capture(page, 'grade-blackout.png');
  const grade = probe?.grade ?? null;
  const [r, g, b] = grade?.rgb ?? [];
  const fine = grade !== null && grade.alpha >= 0.05 && b > r && b > g;
  const wash =
    grade === null ? '!! no blackout grade' : `rgb(${grade.rgb.join(', ')}) at ${grade.alpha}`;
  console.log(
    `grade-blackout.png ${player.name}: the blackout's grade, ${wash} over the world` +
      (fine ? '' : ' !!'),
  );
  if (!fine) {
    fail(`grade-blackout.png: ${wash}`);
  }
}

/** The four ways a player can face, by the key that turns it there, and the step they take. */
const FACINGS = [
  { key: 'd', dx: 1, dy: 0 },
  { key: 'a', dx: -1, dy: 0 },
  { key: 's', dx: 0, dy: 1 },
  { key: 'w', dx: 0, dy: -1 },
];

/** How many tiles of bare floor run from `at` along (dx, dy) on `map`, up to `most`. */
function freeRun(map, at, { dx, dy }, most) {
  const solid = furniture(map);
  for (let n = 1; n <= most; n++) {
    const x = at.x + dx * n;
    const y = at.y + dy * n;
    if (map.tiles[y]?.charAt(x) !== '.' || solid.has(`${x},${y}`)) {
      return n - 1;
    }
  }
  return most;
}

/** How the world lies on `page`: tiles to CSS px, a tile's CSS px and the page's density. */
async function worldOnPage(page) {
  const view = await page.evaluate(() => {
    const camera = globalThis.__escapelab?.camera;
    const canvas = document.querySelector('.world-canvas');
    if (camera === undefined || canvas === null) {
      return null;
    }
    const r = canvas.getBoundingClientRect();
    const dpr = canvas.width / r.width;
    return { camera, left: r.left, top: r.top, width: r.width, height: r.height, dpr };
  });
  if (view === null) {
    return null;
  }
  const { camera, left, top, width, height, dpr } = view;
  const toPage = (x, y) => ({
    x: left + width / 2 + ((x - camera.x) * camera.scale) / dpr,
    y: top + height / 2 + ((y - camera.y) * camera.scale) / dpr,
  });
  return { toPage, tile: camera.scale / dpr, dpr };
}

/**
 * beam-core.png: the host's flashlight in the dark (client world/beam.ts) — a beam with a soft
 * edge and a brighter core, the glint at its lens. The host turns to the longest run of bare
 * floor from where it stands with a tap of the key; the window is shot, and its light read on the
 * beam's axis and on both flanks at the same distances past the glow (beamcheck.mjs): the core
 * has to read brighter than either flank, or the run fails. The host steps back onto its tile.
 */
async function captureBeamCore(player) {
  const { page, seen } = player;
  const map = seen.view.map;
  const at = tileOf(seen);
  const way = [...FACINGS].sort((a, b) => freeRun(map, at, b, 6) - freeRun(map, at, a, 6))[0];
  if (freeRun(map, at, way, 6) < 5) {
    skip('beam-core.png', `no five tiles of bare floor in a line from ${at.x},${at.y}`);
    return;
  }
  await page.keyboard.down(way.key);
  await sleep(50);
  await page.keyboard.up(way.key);
  await sleep(600); // the lamp at rest in the hands, the frame drawn
  const probe = await graphicsOf(page);
  const view = await worldOnPage(page);
  const shot = await page.screenshot();
  writeFileSync(join(OUT, 'beam-core.png'), shot);
  taken('beam-core.png');
  const beam = probe?.beam ?? null;
  if (beam === null || view === null) {
    console.log(`beam-core.png      ${player.name}: !! no beam on the probe`);
    fail('beam-core.png: no beam on the probe');
  } else {
    const light = beamLight(decodePng(shot), beamPatches(beam, view.toPage, view.tile), view.dpr);
    const fine = beamVerdict(light);
    const read = [light.left, light.core, light.right].map((l) => l.toFixed(1)).join(' | ');
    const streak = beam.streak === null ? 'no streak' : `a streak ${beam.streak.toFixed(2)} tiles`;
    console.log(
      `beam-core.png      ${player.name}: facing ${degrees(beam.facing)}°, light across the ` +
        `beam (left | core | right) ${read}, ${streak}${fine ? '' : ' !!'}`,
    );
    if (!fine) {
      fail(`beam-core.png: the core no brighter than its flanks (${read})`);
    }
  }
  await standOn(player, at);
}

/**
 * pose-console.png, pose-reading.png: a figure busy where it stands (client world/figure.ts) —
 * `who` as the window of `watcher` shows them, two tiles round: both hands up on the panel at a
 * console, or holding the sheet, the head bowed over it, at an open source. The watcher's probe
 * has to pose them so within two seconds — busy with `task`, a reader's hands holding the sheet
 * — or the run fails.
 */
async function capturePose(watcher, who, task, name) {
  const id = who.seen.view.you.id;
  const busy = (p) => p.crew.some((c) => c.id === id && c.task === task);
  const probe = await graphicsWhen(watcher.page, busy, 2000);
  const at = whereIs(who.seen);
  if (at === null || !(await shootAround(watcher.page, name, at, 2))) {
    fail(`${name}: ${who.name} stands nowhere ${watcher.name}'s window shows`);
    return;
  }
  const figure = probe?.crew.find((c) => c.id === id);
  const fine = figure?.task === task && (task !== 'reading' || figure.holding);
  const hands = figure?.holding ? 'holding' : 'free';
  console.log(
    `${name.padEnd(18)} ${watcher.name} sees ${who.name} busy: ` +
      `${figure?.task ?? '!! nothing'}, hands ${hands}${fine ? '' : ' !!'}`,
  );
  if (!fine) {
    fail(`${name}: ${who.name} posed ${figure?.task ?? 'idle'}, hands ${hands}`);
  }
}

/** `radians` in whole degrees. */
function degrees(radians) {
  return Math.round((radians * 180) / Math.PI);
}

/**
 * lever.png: the main switch's panel, the lamp over every lever burning with
 * the whole crew at the station, the names under the levers — this player's
 * own under the lever in front of them.
 */
async function captureLeverPanel(player, crew) {
  const here = await player.page.locator('.station-modal .lever-unit--here').count();
  const plate = await textOf(player.page.locator('.station-modal .lever-plate'));
  const names = await player.page.locator('.station-modal .lever-name').allInnerTexts();
  await capture(player.page, 'lever.png');
  console.log(
    `lever.png          ${player.name}: "${plate}", ${here} of ${crew} lamps lit, ` +
      `names ${names.join(', ') || '!! none'}`,
  );
  if (here !== crew || names[0] !== player.name) {
    fail(`lever.png: ${here} of ${crew} lamps lit, names ${names.join(', ')}`);
  }
}

/**
 * lever-ring.png: the host throws its lever alone, and the shot catches the
 * ring round its grip draining while the press counts — and then both pages'
 * count beside the levers (captureLeverCountdown); then its window shuts: the
 * lever has to spring back up, the device say so and the count be gone from
 * every page at the switch. A main switch without a window has nothing to
 * drain — every press counts whenever it comes — and is skipped.
 */
async function captureLeverRing(player, players) {
  if (player.seen.view.puzzle?.windowMs == null) {
    skip('lever-ring.png', 'this main switch has no window: a press never runs out');
    return;
  }
  const modal = player.page.locator('.station-modal');
  await modal.locator('button.lever-grip').click();
  if (!(await until(() => player.seen.view.puzzle?.press?.expiresAt != null, 3000))) {
    fail(`lever-ring.png: ${player.name} threw the lever, but the view gives no press running out`);
    return;
  }
  const { at, expiresAt } = player.seen.view.puzzle.press;
  await sleep(Math.max(0, at + 600 - Date.now())); // the ring under a fifth drained
  const ring = await modal.locator('.lever-ring').count();
  await capture(player.page, 'lever-ring.png');
  await captureLeverCountdown(player, players, at);
  await checkPullTag(player, players);
  await sleep(Math.max(0, expiresAt + 400 - Date.now()));
  const down = await modal.locator('.lever-unit').first().getAttribute('class');
  const says = await textOf(modal.locator('.warn'));
  const sprang = !(down ?? '').includes('lever-unit--down');
  const counting = await Promise.all(players.map(({ page }) => countOn(page)));
  const still = players.filter((_, i) => counting[i] !== null).map(({ name }) => name);
  console.log(
    `lever-ring.png     ${player.name} alone: ring ${ring > 0 ? 'draining' : '!! missing'} over ` +
      `${seconds(expiresAt - at)}; then ${sprang ? 'sprang back' : '!! stayed down'}, ` +
      `"${says ?? '!! no word of it'}", ` +
      `count ${still.length === 0 ? 'gone' : `!! still on ${still.join(' and ')}'s page`}`,
  );
  if (ring === 0 || !sprang || says?.includes('Zug verfallen') !== true || still.length > 0) {
    fail(`lever-ring.png: ring ${ring}, sprang back ${sprang}, says "${says}", count on ${still}`);
  }
}

/** How far into a lone pull the count is shot, ms: past its first second, short of the next. */
const COUNT_SHOT_MS = 1300;

/**
 * What the count beside the open station's control reads on `page`: whose press opened the
 * window, and the digit (client puzzles/SyncCount.tsx); null where it shows none.
 */
function countOn(page) {
  return page.evaluate(() => {
    const count = document.querySelector('.station-modal .sync-count');
    return count === null
      ? null
      : {
          line: count.querySelector('.sync-count-by')?.textContent ?? '',
          digit: Number(count.querySelector('.sync-count-digit')?.textContent ?? Number.NaN),
        };
  });
}

/**
 * lever-countdown.png, lever-countdown-partner.png: COUNT_SHOT_MS into the host's lone pull at
 * `at`, the main switch on both pages, the count beside the levers from the server's clock. The
 * run fails where either page shows no digit, where the two are more than one apart, or where
 * the partner's page does not name who pulled.
 */
async function captureLeverCountdown(host, players, at) {
  const partner = players.find((player) => player !== host);
  if (partner === undefined) {
    skip('lever-countdown.png', 'nobody else at the main switch to count along');
    return;
  }
  await sleep(Math.max(0, at + COUNT_SHOT_MS - Date.now()));
  const [mine, theirs] = await Promise.all([countOn(host.page), countOn(partner.page)]);
  await Promise.all([
    capture(host.page, 'lever-countdown.png'),
    capture(partner.page, 'lever-countdown-partner.png'),
  ]);
  const said = (count) => (count === null ? '!! no count' : `"${count.line} ${count.digit}"`);
  console.log(
    `lever-countdown    ${seconds(COUNT_SHOT_MS)} into ${host.name}'s pull: ` +
      `${host.name} ${said(mine)}, ${partner.name} ${said(theirs)}`,
  );
  const apart = mine === null || theirs === null ? Number.NaN : Math.abs(mine.digit - theirs.digit);
  if (!(apart <= 1) || theirs?.line.startsWith(host.name) !== true) {
    fail(`lever-countdown: ${host.name} ${said(mine)}, ${partner.name} ${said(theirs)}`);
  }
}

/** The tags under `name` in the crew strip on `page`, in words; null where it has no `name`. */
function crewTagsOn(page, name) {
  return page.evaluate((who) => {
    const entries = [...document.querySelectorAll('.hud-crew li')];
    const entry = entries.find((li) => li.querySelector('.hud-name')?.textContent === who);
    return entry === undefined
      ? null
      : [...entry.querySelectorAll('.presence-tag')].map((tag) => tag.textContent ?? '');
  }, name);
}

/**
 * While the host's lone pull waits, the partner's crew strip tags the host „zieht" in place of
 * „am Pult" (client screens/Crew.tsx) — the strip that calls a partner not yet at the main
 * switch to it — or the run fails.
 */
async function checkPullTag(host, players) {
  const partner = players.find((player) => player !== host);
  if (partner === undefined) {
    return;
  }
  const tags = await crewTagsOn(partner.page, host.name);
  const said = tags === null ? '!! no entry' : `[${tags.join(', ') || 'none'}]`;
  console.log(`pull tag           ${partner.name}'s strip has ${host.name} ${said}`);
  if (tags?.includes('zieht') !== true || tags.includes('am Pult')) {
    fail(`pull tag: ${partner.name}'s crew strip has ${host.name} ${said}, not „zieht"`);
  }
}

// ── discovery: finding things is an act (client world/labelFade.ts, world/finds.ts) ──
//
// A thing shows its name only once the player has found it — within 2 tiles in sight, or 600 ms
// in their lamp's cone within 3 tiles (core discovery.ts) — and a find that matters gets its
// caption once, its chime at most once in 1.5 s. The lever's line: how far off each page found
// the main switch, and that its caption came, with the chime or without. Then Ben walks into the
// Archiv the lever lit, and at each stop the rule says which names must show and which may:
// discover-enter.png  two steps in from the Archiv's opening, standing: the names under its
//   things in Ben's window — none for certain (nothing within 2 tiles), at most what came within
//   3 of his lamp on the way, should it rest there — or the run fails
// discover-later.png  by the shelves at the sign: the sign, 1 tile off, and nothing else — the
//   book and the fuse lie 5.4 and 7.2 tiles off — or the run fails
// The audio line: the discovery chimes each page sounded since the start, besides the captions
// that came without one, and Ben's chimes in the Archiv — at most three there, or the run fails.

/** How far a lamp's cone finds things, tiles (core discovery.ts LAMP_REACH). */
const LAMP_REACH = 3;
/** Within this many tiles a thing in sight is found outright (core discovery.ts FIND_REACH). */
const FIND_REACH = 2;
/**
 * Blackout's Archiv for Ben's walk, read from its mission (`archivOf`): its floor's bounds, its
 * opening, two steps in from it, and the shelves by the sign.
 */
const ARCHIV = archivOf(BLACKOUT.map);

/**
 * The Archiv of `map`, by the floor its label claims (`roomsOf`): the bounds of that floor; its
 * opening to the Flur, the first floor tile beside it in reading order that is not its own; the
 * two tiles straight in from there; and the tile beside the Laborkennung, east of it where that
 * is free, among the shelves. Null on a map without one.
 */
function archivOf(map) {
  const floor = [...roomsOf(map)]
    .filter(([, room]) => room === 'ARCHIV')
    .map(([key]) => key.split(',').map(Number));
  const sign = map.edgeworkSign;
  if (floor.length === 0 || sign === undefined) {
    return null;
  }
  const xs = floor.map(([x]) => x);
  const ys = floor.map(([, y]) => y);
  const inside = new Set(floor.map(([x, y]) => `${x},${y}`));
  const open = (x, y) => map.tiles[y]?.[x] === '.' && !inside.has(`${x},${y}`);
  const [door, [dx, dy]] = floor
    .flatMap(([x, y]) => NEIGHBOURS.map(([sx, sy]) => [{ x: x + sx, y: y + sy }, [-sx, -sy]]))
    .filter(([tile]) => open(tile.x, tile.y))
    .sort(([a], [b]) => a.y - b.y || a.x - b.x)[0];
  const solid = furniture(map);
  const free = ({ x, y }) => inside.has(`${x},${y}`) && !solid.has(`${x},${y}`);
  const shelves = NEIGHBOURS.map(([sx, sy]) => ({ x: sign.x + sx, y: sign.y + sy }))
    .sort((a, b) => b.x - a.x)
    .find(free);
  return {
    floor: {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    },
    door,
    inside: [1, 2].map((n) => ({ x: door.x + n * dx, y: door.y + n * dy })),
    shelves,
  };
}
/** A name comes up over 300 ms (client labels.ts): a shot waits this long after a step, ms. */
const NAMES_UP_MS = 600;

/**
 * Watches `player`'s view while it walks for the moment it has found `spot` — a station's
 * console — and where it stood then; `stop` ends the watch and says what it saw.
 */
function watchFinding(player, spot) {
  const seen = { at: null, from: null };
  const timer = setInterval(() => {
    const stations = player.seen.view?.map?.stations ?? [];
    const station = stations.find((s) => s.x === spot.x && s.y === spot.y);
    if (seen.at === null && station?.found === true) {
      seen.at = Date.now();
      seen.from = whereIs(player.seen);
    }
  }, 40);
  return {
    stop: () => {
      clearInterval(timer);
      return seen;
    },
    seen,
  };
}

/**
 * The finds that matter `page` took this run, each with whether its chime sounded, as its audio
 * probe lists them; null without the probe.
 */
function findsOn(page) {
  return page.evaluate(() => globalThis.__escapelab?.audio?.finds ?? null);
}

/** What a discovery found, in a word: „console notlicht", „source spind". */
const findSaid = ({ find }) =>
  find.of === 'sign' ? 'sign' : `${find.of} ${find.id ?? find.puzzleId ?? find.index}`;

/** How far `from` lies from the middle of the station spot `lever`, tiles; null for never. */
const offLever = (from, lever) =>
  from === null ? null : Math.hypot(from.x - lever.x - 0.5, from.y - lever.y - 0.5);

/** How a page found the lever from `away` tiles off, in words. */
function foundHow(away) {
  if (away === null) {
    return '!! never';
  }
  return away <= FIND_REACH ? 'within reach' : 'by the lamp';
}

/** What `page` made of the lever's discovery, in words: its caption, with the chime or without. */
async function leverNews(page, lever) {
  const finds = (await findsOn(page)) ?? [];
  const isLever = ({ find }) => find.of === 'console' && find.puzzleId === lever.puzzleId;
  const news = finds.find(isLever);
  if (news === undefined) {
    return '!! no caption';
  }
  return news.sounded ? 'caption and chime' : 'caption, chime let go';
}

/**
 * The lever's line: each page found the main switch within FIND_REACH or by its lamp's cone
 * within LAMP_REACH — from where it stood when its view first said so — and „Hauptschalter
 * entdeckt" came, or the run fails; and whether the chime came with it.
 */
async function reportLeverFound(players, lever, watches) {
  const said = [];
  for (const [i, player] of players.entries()) {
    const away = offLever(watches[i].seen.from, lever);
    const news = await leverNews(player.page, lever);
    said.push(`${player.name} ${away?.toFixed(1) ?? '?'} tiles off ${foundHow(away)}, ${news}`);
    if (away === null || away > LAMP_REACH + 0.5 || news.startsWith('!!')) {
      fail(`the lever: ${player.name} found the main switch ${away ?? 'never'} tiles off, ${news}`);
    }
  }
  console.log(`lever found        ${said.join('; ')}`);
}

/** Whether the point (x, y), in tiles, lies on the Archiv's floor. */
function inArchiv(x, y) {
  const { left, top, right, bottom } = ARCHIV.floor;
  return x >= left && x < right + 1 && y >= top && y < bottom + 1;
}

/** The names on `page`'s canvas under the Archiv's things, and how far each lies from `at`. */
async function archivNames(page, at) {
  const names = await page.evaluate(() => globalThis.__escapelab?.labels ?? null);
  if (names === null) {
    throw new Error('discover-*.png: the traced page lists no names (`__escapelab.labels`)');
  }
  return names
    .filter((name) => name.onScreen && inArchiv(name.x, name.y))
    .map((name) => ({ ...name, away: Math.hypot(name.x - at.x, name.y - at.y) }));
}

/** „SICHERUNG 3.6" — a name and how far it lies from the player, for the log. */
const namesSaid = (names) =>
  names.map((name) => `${name.text} ${name.away.toFixed(1)}`).join(', ') || 'none';

/**
 * discover-enter.png, discover-later.png and the audio line: Ben walks from where the lever
 * was thrown into the Archiv the lever lit, two steps in, and stands — Ben's window at laptop
 * size — then on to the shelves by the sign, and back after. Skipped on a map without
 * Blackout's Archiv.
 */
async function captureDiscovery(walker, other) {
  const map = walker.seen.view.map;
  const archiv = map.labels.some((label) => label.text === 'ARCHIV');
  if (!archiv || ARCHIV === null || map.tiles[ARCHIV.door.y]?.[ARCHIV.door.x] !== '.') {
    skip('discover-*.png', 'this map has no Archiv to walk into');
    return;
  }
  const home = tileOf(walker.seen);
  await standOrFail(walker, ARCHIV.door, "to the Archiv's door");
  const atDoor = ((await findsOn(walker.page)) ?? []).length;
  const inside = ARCHIV.inside.at(-1);
  const by = { x: ARCHIV.shelves.x + 0.5, y: ARCHIV.shelves.y + 0.5 };
  const walk = walkedFrom(walker);
  let enter;
  let later;
  try {
    await stepIntoArchiv(walker);
    await walker.page.setViewportSize(SIZES[0]);
    await sleep(NAMES_UP_MS);
    enter = await namesAtStop(walker, { x: inside.x + 0.5, y: inside.y + 0.5 }, walk);
    await capture(walker.page, 'discover-enter.png');
    await standOrFail(walker, ARCHIV.shelves, "to the Archiv's shelves by the sign");
    await sleep(NAMES_UP_MS);
    later = await namesAtStop(walker, by, walk);
    await capture(walker.page, 'discover-later.png');
  } finally {
    walk.stop();
  }
  const finds = ((await findsOn(walker.page)) ?? []).slice(atDoor);
  await walker.page.setViewportSize(SIZES[2]);
  reportNames(walker, 'discover-enter.png', 'two steps into the Archiv', enter);
  reportNames(walker, 'discover-later.png', 'by the shelves', later);
  await inGroup('audio', () => reportChimes([walker, other], walker, finds));
  if (home !== null) {
    await standOrFail(walker, home, `back to ${home.x},${home.y} from the Archiv`);
  }
}

/** `walker` stands on `tile`, or the walkthrough fails: it found no way `where`. */
async function standOrFail(walker, tile, where) {
  if (!(await standOn(walker, tile))) {
    throw new Error(`${walker.name} found no way ${where}`);
  }
}

/**
 * `walker` walks from the Archiv's door two steps in. Names counted from anywhere but where the
 * shots say would prove nothing: a stall fails.
 */
async function stepIntoArchiv(walker) {
  for (const step of ARCHIV.inside) {
    if (!(await stepTo(walker.page, walker.seen, step.x + 0.5, step.y + 0.5))) {
      throw new Error(`${walker.name} stalled going into the Archiv, short of ${step.x},${step.y}`);
    }
  }
}

/**
 * What the rule lets `walker` have found from here on, kept as it walks: where the Archiv's named
 * things it has found already hang (`foundKeys`), and each point it stands on, taken every 40 ms
 * until `stop` — a thing its lamp came within LAMP_REACH of on the way may be found.
 */
function walkedFrom(walker) {
  const before = foundKeys(walker.seen.view.map);
  const points = [];
  const timer = setInterval(() => {
    const at = whereIs(walker.seen);
    if (at !== null) {
      points.push(at);
    }
  }, 40);
  return { before, points, stop: () => clearInterval(timer) };
}

/**
 * The Archiv's things that carry a name on `map` — its sources, the parts lying loose, the sign —
 * each at the point its name hangs from, as render/labels.ts places it, found or not: one not
 * found yet lies on the map, in sight, without its name (`what` is then its id).
 */
function archivNameables(map) {
  const loose = (item) => item.carriedBy == null && item.delivered !== true;
  const thing = (what, x, y, found) => ({ what, x, y, found: found === true });
  const sign = map.edgeworkSign;
  return [
    ...map.manuals.map((m) => thing(m.label ?? m.id, m.x + 0.5, m.y + 0.5, m.found)),
    ...map.items.filter(loose).map((i) => thing(i.label ?? i.id, i.x, i.y, i.found)),
    ...(sign == null ? [] : [thing('LABORKENNUNG', sign.x + 0.5, sign.y + 0.5, sign.found)]),
  ].filter((it) => inArchiv(it.x, it.y));
}

/** Where a name hangs, as a key: the point of its thing, in tiles. */
const hangKey = ({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`;

/** Where the Archiv's named things `map`'s player has found hang, by `hangKey`. */
function foundKeys(map) {
  return new Set(archivNameables(map).filter((thing) => thing.found).map(hangKey));
}

/**
 * The names `walker`'s window shows under the Archiv's things at a stop (`at`, its tile's middle),
 * and what the rule says of them (core discovery.ts) after the walk `walk` (`walkedFrom`): for
 * certain, what it had found before and what lies within FIND_REACH of where it stands — nothing
 * on the Archiv's floor stands between two of its points; at most, besides, what came within
 * LAMP_REACH of it on the way, which its lamp finds once it has rested there for 600 ms.
 */
async function namesAtStop(walker, at, walk) {
  const shown = await archivNames(walker.page, at);
  const here = whereIs(walker.seen) ?? at;
  const off = (thing, from) => Math.hypot(thing.x - from.x, thing.y - from.y);
  const things = archivNameables(walker.seen.view.map).map((thing) => ({
    ...thing,
    had: walk.before.has(hangKey(thing)),
    away: off(thing, here),
    nearest: Math.min(...[here, ...walk.points].map((from) => off(thing, from))),
  }));
  const certain = things.filter((thing) => thing.had || thing.away <= FIND_REACH);
  const may = things.filter((thing) => thing.had || thing.nearest <= LAMP_REACH);
  return { shown, certain, may };
}

/** „LABORKENNUNG 2.2" — what the rule names, and how near the walker came to it, for the log. */
const ruleSaid = (things) =>
  things.map((thing) => `${thing.what} ${thing.nearest.toFixed(1)}`).join(', ') || 'none';

/**
 * A stop's names line: the names under the Archiv's things in the walker's window, and the
 * rule's count — every certain one shown, none shown that the rule does not allow — or the run
 * fails.
 */
function reportNames(walker, shot, where, { shown, certain, may }) {
  const hangs = (name, thing) => Math.hypot(name.x - thing.x, name.y - thing.y) < 0.01;
  const missing = certain.filter((thing) => !shown.some((name) => hangs(name, thing)));
  const extra = shown.filter((name) => !may.some((thing) => hangs(name, thing)));
  const wrong = [
    ...missing.map((thing) => `${thing.what} not named`),
    ...extra.map((name) => `${name.text} named`),
  ];
  const said = wrong.length > 0 ? ` !! ${wrong.join(', ')}` : '';
  console.log(
    `${shot.padEnd(18)} ${walker.name} ${where}: ${shown.length} name(s) under its things ` +
      `(${namesSaid(shown)}); the rule: ${certain.length} for certain (${ruleSaid(certain)}), ` +
      `at most ${may.length} (${ruleSaid(may)})${said}`,
  );
  if (wrong.length > 0) {
    fail(`${shot}: ${wrong.join(', ')} ${where}`);
  }
}

/**
 * The audio line: the discovery chimes each page sounded since the run began — besides the
 * captions that came without one — and `walker`'s in the Archiv (`inArchiv`, the finds it took
 * there), at most three or the run fails.
 */
async function reportChimes(players, walker, inArchiv) {
  const pages = [];
  for (const player of players) {
    pages.push(`${player.name} ${chimesSaid((await findsOn(player.page)) ?? [])}`);
  }
  const archivChimes = inArchiv.filter((one) => one.sounded);
  const since = Date.now() - (walker.seen.view.lights.outAt ?? Date.now());
  console.log(
    `audio              discovery chimes ${seconds(since)} after the blackout: ` +
      `${pages.join(', ')}; ${walker.name} in the Archiv ${archivChimes.length} ` +
      `(${archivChimes.map(findSaid).join(', ') || 'none'})` +
      `${archivChimes.length > 3 ? ' !! more than three' : ''}`,
  );
  if (archivChimes.length > 3) {
    fail(`audio: ${archivChimes.length} discovery chimes in the Archiv`);
  }
}

/** „2 (Spind, Sicherung; 1 caption(s) without)": a page's finds that chimed, and the rest. */
function chimesSaid(finds) {
  const sounded = finds.filter((one) => one.sounded);
  const silent = finds.length - sounded.length;
  return (
    `${sounded.length} (${sounded.map(findSaid).join(', ') || 'none'}` +
    `${silent > 0 ? `; ${silent} caption(s) without` : ''})`
  );
}

/** lit-flur.png: the panel closed itself, the room the lever lit is up. */
async function captureLitFlur(player, lever) {
  const closed = await player.page
    .locator('.station-modal')
    .waitFor({ state: 'hidden', timeout: 3000 })
    .then(
      () => true,
      () => false,
    );
  await sleep(1200); // past the lights coming up
  const back = await lightPair(player.page, 'light-gl-flur.png');
  await capture(player.page, 'lit-flur.png');
  await back();
  const { events, lights, map } = player.seen.view;
  const solved = events.find((e) => e.kind === 'puzzle' && e.label.startsWith(lever.title));
  const took = solved === undefined ? '!! no solve logged' : seconds(solved.at - lights.outAt);
  console.log(
    `lit-flur.png       ${player.name}: ${map.litRooms.join(', ')} lit, the panel ` +
      `${closed ? 'closed itself' : '!! stayed open'}; the lever took ${took} from the blackout`,
  );
  if (!closed) {
    fail('the lever\'s panel did not close itself after the levers dropped');
  }
}

/**
 * The fuse lying loose for figure-carry.png, or any part lying loose where there is none: one
 * glimpsed in sight, found by nobody yet, lies loose as well.
 */
function looseItem(map) {
  const loose = map.items.filter(
    (item) => !item.known || (item.carriedBy === null && !item.delivered),
  );
  return loose.find((item) => item.kind === 'fuse') ?? loose[0];
}

/** A part as the log names it: by its label, or by its id where nobody has found it yet. */
const partName = (item) => item.label ?? item.id;

/** The missions as the server hands them out (`/missions/<id>`), by id, each fetched once. */
const definitions = new Map();

/**
 * The mission `view` plays as the server defines it: where its parts lie and where its sources
 * may lie — what a player has to go and look at, since nothing is found from across the room
 * (core discovery.ts).
 */
async function definitionOf(view) {
  const id = view.missionId;
  if (!definitions.has(id)) {
    const res = await globalThis.fetch(`${BASE}/missions/${encodeURIComponent(id)}`);
    if (!res.ok) {
      throw new Error(`GET /missions/${id} answered ${res.status}: no definition to look in`);
    }
    definitions.set(id, await res.json());
  }
  return definitions.get(id);
}

/**
 * The part `player` goes to carry for figure-carry.png: the one its view shows lying loose
 * (`looseItem`) — in sight, or found by the crew — or else one the mission lays out that the crew
 * has not come across, at its tile's middle, a fuse first: walking up to it is what finds it.
 * Undefined where the mission lays out none.
 */
async function partToCarry(player) {
  const { map } = player.seen.view;
  const shown = looseItem(map);
  if (shown !== undefined) {
    return shown;
  }
  const known = new Set(map.items.filter((item) => item.known).map((item) => item.id));
  const laid = ((await definitionOf(player.seen.view)).map.items ?? [])
    .filter((item) => !known.has(item.id))
    .map((item) => ({ id: item.id, label: item.label, x: item.x + 0.5, y: item.y + 0.5 }));
  return laid.find((item) => /sicherung/i.test(item.label)) ?? laid[0];
}

/**
 * How far off the middle of a part lying loose a player stands to see it bob, tiles: 0.3 inside
 * the client's 0.9 of reach, and far enough that the figure's boots stay off the part's own
 * pixels. Measured on N-phone, the bob's cost against unmoved: 0.25 at 0.7 tiles, 0.6 at 0.45,
 * where the boots stand over the fuse's end, and about 0.9 at 0.3.
 */
const BESIDE = 0.6;

/**
 * Where a player can stand beside `item` and reach it, rather than on it, where the figure
 * would hide it: BESIDE off its middle over the first floor tile next to it to the north, west,
 * east or south that no wall, shut door, furniture or plate takes; null where there is none.
 */
function besideItem(map, item) {
  const x = Math.floor(item.x);
  const y = Math.floor(item.y);
  const taken = new Set([
    ...furniture(map),
    ...shutOn(map),
    ...map.plates.map((plate) => `${plate.x},${plate.y}`),
  ]);
  const ways = [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ];
  const free = ([dx, dy]) =>
    map.tiles[y + dy]?.[x + dx] === '.' && !taken.has(`${x + dx},${y + dy}`);
  const way = ways.find(free);
  if (way === undefined) {
    return null;
  }
  const [dx, dy] = way;
  return { tile: { x: x + dx, y: y + dy }, x: item.x + BESIDE * dx, y: item.y + BESIDE * dy };
}

/**
 * How far the part the E prompt names on `page` rises now, in tiles, the grey of the canvas round
 * `item` — 0.4 tiles each way of its middle, from 0.32 above it to 0.3 below, short of its label —
 * and which of those pixels are the part's own: its silhouette from the glow's probe, where the
 * frame drew it risen. All off the same frame, on the camera's whole-pixel grid as the frame drew
 * it (client render/grid.ts `snapCamera`), so that a camera still easing moves the crop with it.
 */
function bobRead(page, item) {
  return page.evaluate(({ x, y }) => {
    const glow = globalThis.__escapelab?.highlight;
    const camera = globalThis.__escapelab?.camera;
    const canvas = document.querySelector('.world-canvas');
    if (glow == null || camera === undefined || canvas === null) {
      return null;
    }
    const s = camera.scale;
    // The lab's origin on the canvas, on whole pixels as the frame drew it.
    const ox = Math.round(canvas.width / 2 - camera.x * s);
    const oy = Math.round(canvas.height / 2 - camera.y * s);
    const left = Math.round(ox + (x - 0.4) * s);
    const top = Math.round(oy + (y - 0.32) * s);
    const width = Math.round(0.8 * s);
    const height = Math.round(0.62 * s);
    const { data } = canvas.getContext('2d').getImageData(left, top, width, height);
    const shape = glow.pixels();
    /** Whether the crop's pixel `i` lies on the part's silhouette, the part risen by its lift. */
    const own = (i) => {
      const tx = (left + (i % width) + 0.5 - ox) / s - glow.x;
      const ty = (top + Math.floor(i / width) + 0.5 - oy) / s - glow.y + glow.lift;
      const col = Math.floor(tx * shape.level) - shape.left;
      const row = Math.floor(ty * shape.level) - shape.top;
      const inside = col >= 0 && row >= 0 && col < shape.width && row < shape.height;
      return inside && shape.silhouette[row * shape.width + col] >= 128 ? 1 : 0;
    };
    const grey = [];
    const mask = [];
    for (let i = 0; i < width * height; i++) {
      grey.push(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
      mask.push(own(i));
    }
    return { lift: glow.lift, scale: s, width, height, grey, mask };
  }, item);
}

/**
 * The first read of the part bobbing on `page` as it stands highest or lowest — on the side of
 * its middle `side` names (1 up, -1 down, 0 either) — within `ms`, more than a bob by default.
 */
async function atBobPeak(page, item, side = 0, ms = 2500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const read = await bobRead(page, item);
    if (read !== null && Math.abs(read.lift) >= 0.9 * ART_PX && read.lift * side >= 0) {
      return read;
    }
    await sleep(20);
  }
  return null;
}

/**
 * Two reads of the part bobbing on `page` at opposite peaks, within `ms` each, fuse-bob-1.png
 * and fuse-bob-2.png shot right after them — counted once a run (`counted`), shot anew on a
 * second pair — and whether they show it bob (glowcheck.mjs `bobVerdict`).
 */
async function bobPair(page, item, ms, counted) {
  const shoot = (name) =>
    counted ? capture(page, name) : page.screenshot({ path: join(OUT, name) });
  const first = await atBobPeak(page, item, 0, ms);
  await shoot('fuse-bob-1.png');
  const second = first === null ? null : await atBobPeak(page, item, -Math.sign(first.lift), ms);
  await shoot('fuse-bob-2.png');
  return { first, second, verdict: bobVerdict(first, second) };
}

/**
 * fuse-bob-1.png and fuse-bob-2.png: before figure-carry.png the host steps up beside the
 * part lying loose (`besideItem`), BESIDE off its middle, until the E prompt names it — its glow
 * on (`glowNaming`): it bobs a pixel of the art up and down over two seconds, its glow with it
 * (client world/render/highlight.ts). The first shot is taken as it stands highest or lowest,
 * the second as it next stands the other way, read for it rather than timed, so that a slow page
 * cannot land it on the middle; the part's own pixels have to move as its lifts say (`bobPair`).
 * Where the first pair shows no bob the host steps back onto its spot, the glow on again, and a
 * second pair is taken within the next 4 s; only where that shows none either does the run fail
 * (`reportBob`). Skipped where there is no floor beside it to stand on.
 */
async function captureBob(player, item) {
  const { page, seen, name } = player;
  const beside = besideItem(seen.view.map, item);
  const there =
    beside !== null &&
    (await standOn(player, beside.tile)) &&
    (await stepTo(page, seen, beside.x, beside.y));
  if (!there) {
    skip('fuse-bob-*.png', `no floor to stand on beside "${partName(item)}"`);
    return;
  }
  const subject = { of: 'item', id: item.id };
  if ((await glowNaming(page, subject, 3000)) === null) {
    const where = `${name} stands beside "${partName(item)}"`;
    console.log(`fuse-bob-*.png     !! ${where}, but nothing glows`);
    fail(`fuse-bob: the E prompt beside "${partName(item)}" names nothing that glows`);
    return;
  }
  await sleep(400); // the camera settles once the walk is over
  const at = whereIs(seen);
  const who = `${name} ${Math.hypot(at.x - item.x, at.y - item.y).toFixed(2)} tiles off`;
  const pair = await bobPair(page, item, 2500, true);
  if (pair.verdict.fine) {
    reportBob(who, item, pair, null);
    return;
  }
  // Once more, back on its spot: the second pair within the next 4 s.
  await stepTo(page, seen, beside.x, beside.y);
  const glowing = (await glowNaming(page, subject, 1000)) !== null;
  const none = { first: null, second: null, verdict: bobVerdict(null, null) };
  reportBob(who, item, pair, glowing ? await bobPair(page, item, 2000, false) : none);
}

/** A read of the part at a peak as the log gives it: which way it stood, by how much of the art. */
const peakSaid = (read) =>
  read === null
    ? '!! not rising or sinking'
    : `${read.lift >= 0 ? 'up' : 'down'} ${(Math.abs(read.lift) / ART_PX).toFixed(2)} px`;

/** A number for the log to a tenth; „?" where there is none. */
const tenth = (value) => (value === null ? '?' : value.toFixed(1));

/** A pair of reads (`bobPair`) as the log gives it: the peaks, and how the part's pixels moved. */
function pairSaid({ first, second, verdict }) {
  const { shift } = verdict;
  const moved = shift === null ? '?' : `${Math.abs(shift)} px ${shift >= 0 ? 'down' : 'up'}`;
  return (
    `${peakSaid(first)}, then ${peakSaid(second)} of the art; its ${verdict.pixels} own ` +
    `pixels (spread ${tenth(verdict.spread)}) moved ${moved} (${tenth(verdict.expected)} ` +
    `expected), off by ${tenth(verdict.cost)} against ${tenth(verdict.still)} unmoved` +
    (verdict.fine ? '' : ' !! no bob')
  );
}

/**
 * The bob check's line in the log: the part has to show its bob on the first pair of reads, or
 * on the second, taken once more, or the run fails (glowcheck.mjs `bobVerdict`).
 */
function reportBob(who, item, pair, again) {
  const second = again === null ? '' : `; once more: ${pairSaid(again)}`;
  console.log(`fuse-bob-*.png     ${who} "${partName(item)}": ${pairSaid(pair)}${second}`);
  if (!pair.verdict.fine && !again?.verdict.fine) {
    fail(`fuse-bob: "${partName(item)}" did not bob a pixel between the two shots`);
  }
}

/**
 * figure-carry.png: after the lever the host walks to the fuse lying in the
 * Archiv — any part lying loose, where a map has no fuse — stands beside it
 * as it bobs (captureBob), picks it up with E and is shot at 1440×1000
 * holding it before the chest. Then it puts it down with Q and walks back to
 * where it stood, so that the walkthrough goes on with free hands. Skipped
 * where nothing lies loose or no way leads to it; fails where E picks nothing
 * up or Q puts nothing down.
 */
async function captureCarry(player) {
  const item = await partToCarry(player);
  if (item === undefined) {
    skip('figure-carry.png', 'nothing lies loose to carry on this map');
    skip('fuse-bob-*.png', 'nothing lies loose to bob on this map');
    return;
  }
  const home = tileOf(player.seen);
  const spot = { x: Math.floor(item.x), y: Math.floor(item.y) };
  await captureBob(player, item);
  if (home === null || !(await standOn(player, spot))) {
    skip('figure-carry.png', `no open way to "${partName(item)}" at ${spot.x},${spot.y}`);
    return;
  }
  const you = player.seen.view.you.id;
  const held = () =>
    player.seen.view.map.items.some((one) => one.id === item.id && one.carriedBy === you);
  for (let i = 0; i < 3 && !held(); i++) {
    await player.page.keyboard.press('e');
    await until(held, 1500);
  }
  if (!held()) {
    fail(`figure-carry.png: ${player.name} stood on "${partName(item)}", but E picked nothing up`);
    return;
  }
  await player.page.setViewportSize(COLD_OPEN);
  await sleep(600);
  await capture(player.page, 'figure-carry.png');
  await player.page.keyboard.press('q');
  const down = await until(() => !held(), 3000);
  console.log(
    `figure-carry.png   ${player.name} @ ${COLD_OPEN.width}x${COLD_OPEN.height} holds ` +
      `"${partName(item)}", picked up at ${spot.x},${spot.y}; ` +
      (down ? 'put down again with Q' : '!! Q put nothing down'),
  );
  if (!down) {
    fail(`figure-carry.png: ${player.name} pressed Q, but still carries "${partName(item)}"`);
  }
  await player.page.setViewportSize(SIZES[0]);
  await sleep(300);
  if (!(await standOn(player, home))) {
    const from = `from "${partName(item)}"`;
    throw new Error(`${player.name} found no way back to ${home.x},${home.y} ${from}`);
  }
}

/**
 * The floor tile a note of the last shift is read from: its own on the floor;
 * on a wall, the floor its face looks into — south first, then north, east
 * and west (core's noteSpot); null where there is none.
 */
function readFrom(map, note) {
  const floor = (x, y) => map.tiles[y]?.[x] === '.';
  if (floor(note.x, note.y)) {
    return { x: note.x, y: note.y };
  }
  const face = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ].find(([dx, dy]) => floor(note.x + dx, note.y + dy));
  return face === undefined ? null : { x: note.x + face[0], y: note.y + face[1] };
}

/**
 * note.png: `player` walks up to the nearest note of the last shift its view
 * places — one the crew has found, or one in the player's sight — and finds
 * it as it comes up, then presses E: its slip has to come up with the words
 * the view gives whoever stands there, and the run report has to log it
 * read, for nothing: no time, no alarm. Then the slip goes and the player
 * walks back. Skipped where the view places no note the player can walk to.
 */
async function captureNote(player) {
  const map = player.seen.view.map;
  const home = tileOf(player.seen);
  const [found] = map.notes
    .map((note) => ({ note, spot: readFrom(map, note) }))
    .filter(({ spot }) => spot !== null && stepsTo(player.seen, spot) !== Infinity)
    .sort((a, b) => stepsTo(player.seen, a.spot) - stepsTo(player.seen, b.spot));
  if (found === undefined) {
    skip('note.png', `no note of the last shift on ${player.name}'s map within walking reach`);
    return;
  }
  const { note, spot } = found;
  const at = await standOn(player, spot);
  const { deadlineAt, alarms } = player.seen.view;
  const slip = player.page.locator('.note-modal');
  if (!at || !(await interactUntil(player, slip, noteTarget(note.index, spot)))) {
    throw new Error(`${player.name} stands at the note at ${note.x},${note.y}, but no .note-modal`);
  }
  await sleep(400); // past its fade-in
  await capture(player.page, 'note.png');
  const shown = await textOf(slip.locator('.pinned-note-text'));
  const logged = await until(() => player.seen.view.events.some((e) => e.kind === 'note'), 3000);
  const free =
    player.seen.view.deadlineAt === deadlineAt && player.seen.view.alarms.count === alarms.count;
  const right = shown !== null && shown === player.seen.view.noteHere?.text;
  console.log(
    `note.png           ${player.name} at the note on ${note.x},${note.y}: ` +
      `${right ? `„${shown}"` : `!! the slip says „${shown}"`}; ` +
      `${logged ? 'the run report says „Notiz gelesen"' : '!! not in the run report'}, ` +
      `${free ? 'for nothing' : '!! it cost time or an alarm'}`,
  );
  if (!right || !logged || !free) {
    fail(`note.png: slip „${shown}", logged ${logged}, free ${free}`);
  }
  await player.page.keyboard.press('Escape');
  await slip.waitFor({ state: 'hidden', timeout: 3000 });
  if (home !== null && !(await standOn(player, home))) {
    throw new Error(`${player.name} found no way back to ${home.x},${home.y} from the note`);
  }
}

/**
 * sign.png for a player spawned within sight of the Laborkennung: its note
 * is up at once. Returns that player, if any.
 */
async function signAtSpawn(players) {
  const atSign = players.find((p) => p.seen.view.presence.signSeen);
  if (atSign !== undefined) {
    await inGroup('reading', () => captureSign(atSign.page, atSign.name));
  }
  return atSign;
}

/**
 * A mission's intro, the power on, then the lights failing, as the intro group takes it: the
 * opening's shot (intro-pan.png), the host's skip counted on the guest's phone (intro-skip.png),
 * the opening on a large phone (intro-phone-932.png), sign.png for a player spawned at the
 * Laborkennung (signAtSpawn), the host in the lit lab (cold-open.png), the guest's skip and with
 * it the blackout's beat on both (intro-title.png, intro-title-phone.png) — both pages skip, so
 * that the pinned plan keeps its timing — and blackout.png. Returns the player at the sign, if
 * any.
 */
async function introShots(host, guest) {
  await captureIntroShot(host);
  await captureIntroSkip(host, guest);
  await captureOpeningLarge(guest);
  const atSign = await signAtSpawn([host, guest]);
  await captureColdOpen(host);
  await captureIntroTitle(host, guest);
  await captureBlackout(host);
  return atSign;
}

/**
 * The opening where the run leaves intro out: the host skips it once its first line and the skip
 * are up, sign.png comes for a player spawned at the Laborkennung (signAtSpawn), the guest skips
 * it too, and the lights go out over both (`lightsOut`), as after intro-title.png. Returns the
 * player at the sign, if any.
 */
async function skipTheOpening(host, guest) {
  await attached(host.page.locator('.intro-subtitle'), 8000);
  await attached(host.page.locator('.intro-skip'), 3000);
  await host.page.keyboard.press('Space');
  const atSign = await signAtSpawn([host, guest]);
  // A press, not a touch, as in captureIntroTitle: a touch would take the phone fullscreen.
  await guest.page.locator('.intro').click();
  await lightsOut(host);
  return atSign;
}

/**
 * Blackout past its opening: the motes in the host's lamp (dust.png); the host's room dead, the
 * partner heard on its side and the Leitstelle's first line on the guest's radio — listened for
 * since the opening began (`listening`), on the guest's page so that the host's frame samples
 * are left alone; the lever the first station is (lever.png, lit-flur.png); and the guest's walk
 * into the Archiv (discover-*.png).
 */
async function afterTheLights(host, guest, listening) {
  await inGroup('graphics', () => captureDust(host));
  await inGroup('audio', () => soundOfTheBlackout(host, guest, listening));
  await throwLever([host, guest]);
  await captureDiscovery(guest, host);
}

/** After the blackout: the host's room dead, the partner heard on its side, the first line. */
async function soundOfTheBlackout(host, guest, listening) {
  await bedDead(host, 'after the blackout');
  await partnerSide(host, guest, 'after the blackout');
  await checkRadioVoice(guest, listening, 'the blackout', startLineOf(guest));
}

/** The furniture standing tall, which a figure behind shows only above (client world/depth.ts). */
const TALL_DECOR = new Set(['shelf', 'rack']);

/**
 * The tall piece of furniture with free floor behind it that `player` reaches in the fewest
 * steps, and that floor; null where there is none.
 */
function shelfToHideBehind(player) {
  const { map } = player.seen.view;
  const solid = furniture(map);
  const taken = new Set([...map.stations, ...map.plates].map((t) => `${t.x},${t.y}`));
  const free = (x, y) =>
    map.tiles[y]?.[x] === '.' && !solid.has(`${x},${y}`) && !taken.has(`${x},${y}`);
  const options = map.decor
    .filter((piece) => TALL_DECOR.has(piece.kind) && free(piece.x, piece.y - 1))
    .map((piece) => ({ piece, behind: { x: piece.x, y: piece.y - 1 } }))
    .map((option) => ({ ...option, steps: stepsTo(player.seen, option.behind) }))
    .filter((option) => option.steps !== Infinity)
    .sort((a, b) => a.steps - b.steps);
  return options[0] ?? null;
}

/**
 * depth-behind-shelf.png: `player` walks into the aisle behind the nearest shelf (or rack) with
 * free floor behind it and stands pressed up to it, and is shot round its figure: the shelf in
 * front is drawn again over its lower part (client world/depth.ts, render/occluders.ts), its
 * name over all of it — the page's graphics probe has to say the shelf hides it, or the run
 * fails. Then it walks back. Skipped where no such shelf is in reach.
 */
async function captureDepth(player) {
  const option = shelfToHideBehind(player);
  const home = tileOf(player.seen);
  if (option === null || home === null || !(await standOn(player, option.behind))) {
    skip('depth-behind-shelf.png', 'no shelf with free floor behind it in reach');
    return;
  }
  const { piece } = option;
  await stepTo(player.page, player.seen, piece.x + 0.5, piece.y - 0.36);
  const you = player.seen.view.you.id;
  const hidden = (probe) =>
    probe.hidden.some(
      (one) => one.id === you && one.by.some((by) => by.x === piece.x && by.y === piece.y),
    );
  const probe = await graphicsWhen(player.page, hidden, 3000);
  const at = whereIs(player.seen);
  await shootAround(player.page, 'depth-behind-shelf.png', at, 2.4);
  console.log(
    `depth-behind-shelf ${player.name} at ${at.x.toFixed(2)},${at.y.toFixed(2)} behind the ` +
      `${piece.kind} at ${piece.x},${piece.y}: ` +
      (probe === null ? '!! drawn over it, not behind it' : 'only the upper part shows'),
  );
  if (probe === null) {
    fail(`depth-behind-shelf.png: the ${piece.kind} at ${piece.x},${piece.y} hid nothing`);
  }
  if (!(await standOn(player, home))) {
    throw new Error(`${player.name} found no way back to ${home.x},${home.y} from the shelf`);
  }
}

/**
 * The run's first moments, once a mission with an intro (`intro`) is past its opening and its
 * lever (afterTheLights): Anna carries what lies loose for a moment (figure-carry.png), hides
 * behind a shelf (depth-behind-shelf.png) and reads the nearest note of the last shift found
 * (note.png); the draw — who works the first station, who reads — and, without an intro,
 * sign.png for a player spawned at the Laborkennung, whose note is up as soon as the briefing is
 * gone, and the Leitstelle's first line, heard on Ben's radio as the briefing ends. Returns both
 * and the player at the sign (`signedEarly` where the opening found one), if any.
 */
async function firstMoments(anna, ben, { intro, signedEarly }) {
  const opening = intro ? null : whenOn('audio', () => hearRadio(ben, 40_000));
  await inGroup('graphics', () => captureCarry(anna));
  await inGroup('graphics', () => captureDepth(anna));
  await inGroup('reading', () => captureNote(anna));
  const [operator, reader] = operatorFirst([anna, ben]);
  console.log(`the draw:          ${operator.name} works the first station, ${reader.name} reads`);
  const atSign = intro ? signedEarly : await signAtSpawn([reader, operator]);
  if (opening !== null) {
    await inGroup('audio', () => checkRadioVoice(ben, opening, 'the briefing', startLineOf(ben)));
  }
  return { operator, reader, atSign };
}

/** Resolves true once `locator` is in the page, false after `ms`. */
function attached(locator, ms) {
  return locator.waitFor({ state: 'attached', timeout: ms }).then(
    () => true,
    () => false,
  );
}

/** The console a player works, as its view names it: „Pult A". */
function seatOf(player) {
  return `Pult ${String(player.seen.view.puzzle?.console ?? '?').toUpperCase()}`;
}

/**
 * One stage of the Signalkette: `presser` clicks the keys of the sequence the
 * sender's view shows, in its order and ~150 ms apart, each press counted
 * before the next and its done-lamp lit on both panels — by the sign on it,
 * or, at consoles with the legend, by the row and shape `pinned` gives each
 * sign. The last press moves the stage on, or solves the station. Throws at
 * the press that fails; returns how many signs went in.
 */
async function pressStage(sender, presser, pinned = null) {
  const { puzzle, currentPuzzleIndex } = sender.seen.view;
  const { stage, sequence } = puzzle;
  const keys = '.station-modal .signal-key';
  const keyFor = (i, token) =>
    pinned === null
      ? `${keys}[data-token="${token}"]`
      : `${keys}[data-row="${pinned[i]?.row}"][data-shape="${pinned[i]?.shape}"]`;
  // `waitFor` wants one element: the first key stands for the twelve.
  if (!(await attached(presser.page.locator(keys).first(), 3000))) {
    throw new Error(`${presser.name} is to press stage ${stage}, but the panel has no ${keys}`);
  }
  const through = () => {
    const view = presser.seen.view;
    return view.currentPuzzleIndex > currentPuzzleIndex || (view.puzzle?.stage ?? 0) > stage;
  };
  const lamp = (page, i) => page.locator('.station-modal .signal-lamp--lit').nth(i);
  for (const [i, sign] of sequence.entries()) {
    await presser.page.locator(keyFor(i, sign)).click({ timeout: 3000 });
    const last = i === sequence.length - 1;
    const counted = await until(
      () => (last ? through() : presser.seen.view.puzzle?.done === i + 1),
      3000,
    );
    if (!counted) {
      const now = presser.seen.view.puzzle;
      throw new Error(
        `${presser.name} pressed "${signSaid(sign)}", sign ${i + 1} of ${sequence.length} in ` +
          `stage ${stage}, but it did not count (done ${now?.done}, last result ` +
          `${now?.lastResult})`,
      );
    }
    // The last press clears the lamps: the next stage starts dark.
    if (!last) {
      const panels = [sender, presser];
      const lit = await Promise.all(panels.map(({ page }) => attached(lamp(page, i), 2000)));
      const dark = panels.filter((_, k) => !lit[k]).map(({ name }) => name);
      if (dark.length > 0) {
        throw new Error(`sign ${i + 1} counted, but its lamp is dark for ${dark.join(' and ')}`);
      }
    }
    await sleep(150);
  }
  return sequence.length;
}

/**
 * console-plate.png: the heads of a station's two devices as their players see them, one over
 * the other — the label plate, the LED and, engraved under them, what each machine does. Each
 * head has to engrave what the view says its console's machine does (`puzzle.plate`), and the
 * two have to differ, or the run fails.
 */
async function capturePlates(seats, title) {
  const heads = [];
  for (const [player, spot] of seats) {
    const head = player.page.locator('.station-modal .device-head');
    const line = head.locator('.device-purpose');
    const shown = (await line.count()) === 0 ? null : (await line.textContent())?.trim();
    const said = player.seen.view.puzzle?.plate ?? null;
    heads.push({ console: spot.console, shown, said, png: await head.screenshot() });
  }
  // One sheet, the two heads one over the other on the bezel's dark.
  const sheet = await browser.newPage({ viewport: { width: 800, height: 400 } });
  const style =
    'body { margin: 0; background: #0b0f13; } ' +
    '.plates { display: inline-flex; flex-direction: column; gap: 12px; padding: 12px; }';
  const img = ({ png }) => `<img src="data:image/png;base64,${png.toString('base64')}">`;
  const plates = `<div class="plates">${heads.map(img).join('')}</div>`;
  await sheet.setContent(`<style>${style}</style>${plates}`);
  await captureElement(sheet.locator('.plates'), 'console-plate.png');
  await sheet.close();
  const said = heads.map((h) => `Pult ${h.console.toUpperCase()} „${h.shown ?? '!! nothing'}"`);
  console.log(`console-plate.png  "${title}": ${said.join(' · ')}`);
  const wrong = heads.filter(({ shown, said: plate }) => shown === null || shown !== plate);
  if (wrong.length > 0 || heads[0]?.shown === heads[1]?.shown) {
    const what = heads.map((h) => `${h.console} shows "${h.shown}", the view says "${h.said}"`);
    fail(`console-plate.png: ${what.join('; ')}`);
  }
}

/**
 * What `player`'s device and voice say of the station's intercom with `partner`: the PARTNER
 * LED's line, and whether the page plays the partner over it in full — its voice naming them
 * on the intercom, their volume at 1 (`window.__escapelab.voice`).
 */
async function partnerOnAir(player, partner) {
  const detail = player.page.locator('.station-modal .device-led--green .device-led-detail');
  const id = partner.seen.view.you.id;
  const voice = await voiceOf(player.page);
  const line = await textOf(detail);
  const gain = voice?.gains?.[id] ?? null;
  const inFull = voice?.intercom?.includes(id) === true && gain === 1;
  return { line, inFull, gain, ok: inFull && /· Funk$/.test(line ?? '') };
}

/**
 * partner-funk.png: the PARTNER LED line of the first seat's device at a station with two
 * consoles, both players at them, while the station's intercom carries the voice between them
 * (client voice/intercom.ts). On each device the line has to name the partner with „· Funk"
 * after where they stand, and each page has to play the partner over the intercom in full, or
 * the run fails; each gets LINK_MS to say so.
 */
async function capturePartnerFunk(seats, title) {
  const said = [];
  for (const [player] of seats) {
    const partner = seats.map(([other]) => other).find((other) => other !== player);
    let seen = await partnerOnAir(player, partner);
    for (const end = Date.now() + LINK_MS; !seen.ok && Date.now() < end; ) {
      await sleep(250);
      seen = await partnerOnAir(player, partner);
    }
    said.push({ player, partner, ...seen });
  }
  const [[first]] = seats;
  await captureElement(first.page.locator('.station-modal .device-leds'), 'partner-funk.png');
  const lines = said.map(
    ({ player, partner, line, inFull, gain }) =>
      `${player.name} „PARTNER ${line ?? '!! no green LED'}", ` +
      (inFull ? `${partner.name} in full over the intercom` : `!! ${partner.name} at ${gain}`),
  );
  console.log(`partner-funk.png   "${title}": ${lines.join('; ')}`);
  const off = said.filter(({ ok }) => !ok).map(({ player }) => player.name);
  if (off.length > 0) {
    fail(`partner-funk.png: ${off.join(' and ')} not on the intercom with the partner`);
  }
}

/**
 * console-a.png, console-b.png: a station with two consoles, whatever its
 * kind — the one after a solved sync station, or a first one the crew got
 * into (`manBothConsoles`). The operator walks to console A, the reader to
 * console B, and E opens each; both panels are captured at laptop size,
 * their heads together (console-plate.png, `capturePlates`), the
 * guest's window going back to its phone size after, and the log names the
 * panel's kind. A Signalkette the crew then works until it solves
 * (`solveSignal`); at a fuse box the meter measures every wire once
 * (`measureEveryWire`); any other kind is left open. Throws with the step
 * that failed.
 */
async function captureConsoles(operator, reader) {
  const armed = operator.seen.view.map.stations.filter((s) => s.status === 'armed');
  const consoleA = armed.find((s) => s.console === 'a');
  const consoleB = armed.find((s) => s.console === 'b');
  if (consoleA === undefined || consoleB === undefined) {
    const why = armed.length === 0 ? 'no station is armed' : `"${armed[0].title}" has one console`;
    await inGroup('devices', () => skip('console-*.png', why));
    return;
  }
  const title = consoleA.title;
  const crew = [operator, reader];
  const seats = [
    [operator, consoleA],
    [reader, consoleB],
  ];
  await walkToConsoles(seats, title);
  // Console A glows for its player before E — in Blackout in the Maschinenraum still dark.
  const glowing = { subject: { of: 'station', x: consoleA.x, y: consoleA.y } };
  const said = `console A of "${title}"`;
  const shot = 'highlight-console.png';
  await inGroup('graphics', () => captureHighlight(operator, { ...glowing, said }, shot));
  const kind = await openConsoles(seats, title);
  await atOpenConsoles(crew, seats, title, kind);
  if (kind === 'signal') {
    await solveSignal(crew, title);
  } else if (kind === 'circuit') {
    await inGroup('devices', () => measureEveryWire(reader, title));
  } else {
    console.log(`consoles           "${title}" is a ${kind} panel: captured, left open`);
  }
}

/** Each player of `seats` walks up to its console of `title`; throws where one finds no way. */
async function walkToConsoles(seats, title) {
  for (const [player, spot] of seats) {
    if (!(await walkNear(player.page, player.seen, spot))) {
      throw new Error(
        `${player.name} found no way to console ${spot.console} of "${title}" ` +
          `at ${spot.x},${spot.y}`,
      );
    }
  }
}

/**
 * E opens each console of `seats` on its player's page; the panels' kind, which both have to
 * show alike. Throws where a panel does not open, or the two are not one station's.
 */
async function openConsoles(seats, title) {
  for (const [player, spot] of seats) {
    const modal = player.page.locator('.station-modal');
    if (!(await interactUntil(player, modal, consoleTarget(spot)))) {
      throw new Error(
        `${player.name} stands at console ${spot.console} of "${title}", ` +
          `but no .station-modal after ${TRIES}`,
      );
    }
  }
  const crew = seats.map(([player]) => player);
  const kindOf = (player) => player.seen.view.puzzle?.kind ?? null;
  await until(() => crew.every((p) => kindOf(p) !== null), 3000);
  const kind = kindOf(crew[0]);
  if (kind === null || kindOf(crew[1]) !== kind) {
    const panels = crew.map((p) => `${p.name} ${kindOf(p)}`).join(', ');
    throw new Error(`both stand at "${title}", but not at one open panel: ${panels}`);
  }
  return kind;
}

/**
 * Both consoles of `title` open: their panels at laptop size and their heads together
 * (shootConsoles), the station's intercom (partner-funk.png), each window back at its own size,
 * the notepad beside each device (device-notepad*.png), and the host's frames idle at its panel
 * (idleAtPanel).
 */
async function atOpenConsoles(crew, seats, title, kind) {
  const sizes = crew.map(({ page }) => page.viewportSize());
  await inGroup('devices', () => shootConsoles(crew, seats, title, kind));
  await inGroup('voice', () => capturePartnerFunk(seats, title));
  for (const [i, { page }] of crew.entries()) {
    if (sizes[i] !== null) {
      await page.setViewportSize(sizes[i]);
    }
  }
  await sleep(300); // past the resize
  await inGroup('reading', () => notingAtDevices(crew));
  await idleAtPanel(crew, title);
}

/**
 * console-a.png, console-b.png: both panels of `title` at laptop size, each logged with whether
 * it fits sideways, then their heads together (console-plate.png, `capturePlates`).
 */
async function shootConsoles(crew, seats, title, kind) {
  await Promise.all(crew.map(({ page }) => page.setViewportSize(SIZES[0])));
  await sleep(500); // the layout settles, the panel past its fade-in
  for (const [player, spot] of seats) {
    await capture(player.page, `console-${spot.console}.png`);
    const over = await sideways(player.page, '.station-modal .panel');
    console.log(
      `console-${spot.console}.png      ${player.name} at ${seatOf(player)}: "${title}", ` +
        `${kind} panel, ${over > 0 ? `!! +${over}px sideways` : 'fits sideways'}`,
    );
  }
  await capturePlates(seats, title);
}

/** device-notepad.png, device-notepad-phone.png: the notepad beside each open device of `crew`. */
async function notingAtDevices(crew) {
  for (const player of crew) {
    const phone = (player.page.viewportSize()?.width ?? 0) <= 560;
    await captureDeviceNoting(player, phone ? 'device-notepad-phone.png' : 'device-notepad.png');
  }
}

/**
 * The world under an open panel is the game's own cost: it keeps the budget too. The traced page
 * of `crew` is sampled idle at the open `title` panel, then looked at density 2 as well
 * (panel-dpr2.png).
 */
async function idleAtPanel(crew, title) {
  const watched = crew.find((player) => player.traced);
  if (watched === undefined) {
    return;
  }
  await sleep(300); // past the resize
  const idle = `idle at the open "${title}" panel`;
  await frameWindow(watched.page, idle, () => sleep(SAMPLE_MS));
  panelSampled = true;
  const quiet = () => sleep(SAMPLE_MS);
  await inGroup('graphics', () => keySceneAtTwo(watched, idle, quiet, 'panel-dpr2.png'));
}

/** The angle the meter's needle stands at on the page right now, transition and all, in °. */
function needleOnPage(page) {
  return page.evaluate(() => {
    const needle = document.querySelector('.station-modal .gauge-needle');
    const turn = needle === null ? 'none' : document.defaultView.getComputedStyle(needle).transform;
    // matrix(cos, sin, −sin, cos, x, y): the angle is atan2(sin, cos).
    const [a = 1, b = 0] = (turn.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    return Math.round((Math.atan2(b, a) * 180 * 10) / Math.PI) / 10;
  });
}

/** The needle's angle for a reading, as CircuitPanel's needleAngle: −90° at 0 V, +90° at 250 V. */
const needleFor = (volts) => -90 + (Math.min(250, Math.max(0, volts)) / 250) * 180;

/** Wire `i`'s reading on the meter's socket as soon as it comes in, every 5 ms; null by `end`. */
async function readingIn(meter, i, end) {
  const reading = () => meter.seen.view.puzzle?.readings?.[i] ?? null;
  while (reading() === null && Date.now() < end) {
    await sleep(5);
  }
  return reading();
}

/** How far into its swing meter-swing.png holds the needle, ms: some 40 % of its way there. */
const SWING_HOLD_MS = 60;
/** How far a reading has to move the needle for meter-swing.png to show it, in °. */
const SWING_DEG = 35;

/**
 * In the page, before a probe key is pressed, until releaseNeedle: the needle's next swing to a
 * new reading — the transition of its turn (client styles/devices.css) — is paused `ms` into it,
 * so that a shot however late finds the needle on its way; `window.__needleHold` (pageclock.mjs
 * `NeedleHold`) notes on the page's clock when the probe went down, when the swing began and how
 * long it runs.
 */
function holdNeedle(ms) {
  const needle = document.querySelector('.station-modal .gauge-needle');
  const t0 = globalThis.performance.now();
  const hold = { pressed: null, swung: null, length: null };
  const held = { turn: null, stop: () => undefined };
  const press = (event) => {
    hold.pressed ??= event.timeStamp - t0;
  };
  // Where the needle was headed as the hold began: a swing there is the last probe's, whose event
  // comes with the page's next frame, late under load; this probe's turns the needle anew.
  const before = needle?.style.transform ?? null;
  const swing = () => {
    const turn = needle.getAnimations().find((a) => a.transitionProperty === 'transform');
    if (hold.swung === null && turn !== undefined && needle.style.transform !== before) {
      // The swing's own start time, on the document's timeline — the clock performance.now()
      // reads — says when it began, however late its event came.
      hold.swung = (turn.startTime ?? globalThis.performance.now()) - t0;
      hold.length = turn.effect.getComputedTiming().duration;
      turn.pause();
      turn.currentTime = ms;
      held.turn = turn;
    }
  };
  held.stop = () => {
    needle?.removeEventListener('transitionrun', swing);
    document.removeEventListener('pointerdown', press, true);
  };
  globalThis.__needleHold = hold;
  globalThis.__needleHeld = held;
  document.addEventListener('pointerdown', press, true);
  needle?.addEventListener('transitionrun', swing);
}

/** In the page: the needle held by holdNeedle swings on, and nothing watches it any more. */
function releaseNeedle() {
  const held = globalThis.__needleHeld;
  held?.stop();
  held?.turn?.play();
  delete globalThis.__needleHeld;
}

/** Whether `check` holds in `page` within `ms`, looked at every 50 ms; throws what is no wait. */
function pageHolds(page, check, ms) {
  return page.waitForFunction(check, null, { timeout: ms, polling: 50 }).then(
    () => true,
    (error) => {
      if (error?.name !== 'TimeoutError') {
        throw error;
      }
      return false;
    },
  );
}

/**
 * meter-swing.png: the wire just probed (`i`, its key pressed at `pressed`, the needle standing
 * at `from`, its next swing held by holdNeedle) comes in, and where its reading swings the needle
 * SWING_DEG or more, the meter is shot with the needle held SWING_HOLD_MS into its swing, and
 * judged by what the page says it showed (pageclock.mjs `swingVerdict`): the needle swung, held
 * still through the shot, on its way to the reading or swinging past it. True once shot; false
 * where the reading moves the needle less, for the next probe to try.
 */
async function captureSwing(meter, i, pressed, from) {
  const volts = await readingIn(meter, i, pressed + 3000);
  const target = volts === null ? from : needleFor(volts);
  if (Math.abs(target - from) < SWING_DEG) {
    return false;
  }
  await pageHolds(meter.page, () => globalThis.__needleHold?.swung != null, 3000);
  const hold = await meter.page.evaluate(() => globalThis.__needleHold ?? null);
  const at = await needleOnPage(meter.page);
  await capture(meter.page, 'meter-swing.png');
  const after = await needleOnPage(meter.page);
  const swing = { from, target, at, after, hold, holdMs: SWING_HOLD_MS };
  const { faults, text } = swingVerdict(swing);
  console.log(`meter-swing.png    ${meter.name} probed wire ${i + 1}: ${volts} V; ${text}`);
  if (faults.length > 0) {
    fail(`meter-swing.png: ${faults.join('; ')}`);
  }
  return true;
}

/**
 * Probe `i` pressed with `press`, the needle's next swing held for it (holdNeedle) and let go
 * however that went: meter-swing.png where its reading swings the needle far enough
 * (captureSwing). Whether it was shot.
 */
async function probeHeld(meter, i, press) {
  const from = await needleOnPage(meter.page);
  await meter.page.evaluate(holdNeedle, SWING_HOLD_MS);
  try {
    const pressed = Date.now();
    await press();
    return await captureSwing(meter, i, pressed, from);
  } finally {
    await meter.page.evaluate(releaseNeedle);
  }
}

/**
 * At a fuse box's meter: every probe key pressed once, its wire's reading
 * in the meter's view before the next key — the first reading that moves
 * the needle shot mid-swing (captureSwing). Nothing is cut. Throws at the
 * key whose reading stays empty.
 */
async function measureEveryWire(meter, title) {
  const count = meter.seen.view.puzzle?.count ?? 0;
  const keys = await meter.page.locator('.station-modal .circuit-probe[data-index]').count();
  if (count === 0 || keys !== count) {
    throw new Error(`"${title}": the meter shows ${keys} probe keys for ${count} wires`);
  }
  let swung = false;
  for (let i = 0; i < count; i++) {
    swung = (await probeWire(meter, title, i, swung)) || swung;
  }
  reportMeasured(meter, count, swung);
}

/** The meter's round in the log: every reading taken, and whether one was shot mid-swing. */
function reportMeasured(meter, count, swung) {
  const readings = meter.seen.view.puzzle?.readings ?? [];
  const volts = readings.map((reading) => `${reading} V`).join(', ');
  console.log(
    `circuit            ${meter.name} at ${seatOf(meter)} measured all ${count} wires: ` +
      `${volts}; nothing cut`,
  );
  if (!swung) {
    skip('meter-swing.png', 'no reading moved the needle far enough to see it swing');
  }
}

/**
 * Presses wire `i`'s probe key at the meter and waits for its reading; until
 * one has been shot mid-swing (`swung`), tries meter-swing.png on this one
 * (probeHeld). Returns whether this one was shot. Throws where the reading
 * stays empty.
 */
async function probeWire(meter, title, i, swung) {
  const key = meter.page.locator(`.station-modal .circuit-probe[data-index="${i}"]`);
  const press = () => key.click({ timeout: 3000 });
  const shot = swung ? await press().then(() => false) : await probeHeld(meter, i, press);
  if (!(await until(() => meter.seen.view.puzzle?.readings?.[i] != null, 3000))) {
    throw new Error(
      `${meter.name} measured wire ${i + 1} of "${title}", but its reading stayed empty`,
    );
  }
  await sleep(150);
  return shot;
}

/** Steps onto a plate's tile and stays there; throws unless the view counts the plate held. */
async function holdPlate(player, plate) {
  const held = () => player.seen.view.map.plates.some((p) => p.id === plate.id && p.pressed);
  const onIt =
    (await walkNear(player.page, player.seen, plate)) &&
    (await stepTo(player.page, player.seen, plate.x + 0.5, plate.y + 0.5));
  if (!onIt || !(await until(held, 3000))) {
    throw new Error(`${player.name} could not get onto the plate at ${plate.x},${plate.y}`);
  }
}

/**
 * How `box` gets to console A: on their own, or through the plate door that
 * `meter` holds — the nearest plate `meter` reaches. Null when neither works.
 */
function entryPlan([box, meter], consoleA, plates) {
  if (stepsTo(box.seen, consoleA) !== Infinity) {
    return { box, meter, plate: null };
  }
  const steps = (plate) => stepsTo(meter.seen, plate);
  const [nearest] = plates
    .filter((plate) => steps(plate) !== Infinity)
    .sort((one, other) => steps(one) - steps(other));
  return nearest === undefined ? null : { box, meter, plate: nearest };
}

/**
 * A first station worked at two consoles, as Blackout's Notstrom-Kasten,
 * whose console A may lie behind a plate door. Whoever reaches console A on
 * their own works it, the host before the guest; otherwise the host does,
 * and the guest holds the nearest plate in reach until the host is through.
 * The plate holder then walks on to console B, and both consoles are
 * captured (`captureConsoles`). Returns who stands at A and who at B; null,
 * with a log line, when the draw lets nobody through.
 */
async function manBothConsoles(players) {
  const map = players[0].seen.view.map;
  const consoleA = map.stations.find((s) => s.status === 'armed' && s.console === 'a');
  if (consoleA === undefined) {
    throw new Error('the armed station has no console A');
  }
  // Camera plates hold drones still, not doors.
  const plates = map.plates.filter((plate) => !plate.freezesDrone);
  const plan = [players, [...players].reverse()]
    .map((pair) => entryPlan(pair, consoleA, plates))
    .find((option) => option !== null);
  if (plan === undefined) {
    const why =
      `nobody reaches console A of "${consoleA.title}", ` +
      'and nobody else a plate to hold the way open';
    await inGroup('devices', () => skip('console-*.png', why));
    return null;
  }
  const { box, meter, plate } = plan;
  if (plate !== null) {
    await holdPlate(meter, plate);
    if (!(await walkNear(box.page, box.seen, consoleA))) {
      throw new Error(
        `${meter.name} holds the plate at ${plate.x},${plate.y}, but ${box.name} found no ` +
          `way through to console A of "${consoleA.title}"`,
      );
    }
    console.log(
      `plate              ${meter.name} holds "${plate.label}" at ${plate.x},${plate.y}, ` +
        `${box.name} walked through to console A`,
    );
  }
  await captureConsoles(box, meter);
  return { box, meter };
}

/**
 * A Signalkette with both consoles open: the receiving side clicks what the
 * sending side's view shows, and the direction swaps after each stage, until
 * it solves. With `pinned` — the stages a pinned seed deals — every stage's
 * sending console and sequence have to be the pinned ones, and the keys
 * pressed are the pinned ones: at consoles with the legend a key is a row and
 * a shape, which only the printed legend ties to a sign. Throws with the step
 * that failed, naming the seed where a stage differs from its pin.
 */
async function solveSignal(crew, title, pinned = null) {
  const roleOf = (player) => player.seen.view.puzzle?.role ?? null;
  const roles = () => crew.map((p) => `${p.name} ${roleOf(p)}`).join(', ');
  await until(() => crew.every((p) => roleOf(p) !== null), 3000);
  const sender = crew.find((p) => roleOf(p) === 'sender');
  const receiver = crew.find((p) => roleOf(p) === 'receiver');
  if (sender === undefined || receiver === undefined) {
    throw new Error(`both stand at "${title}", but the Signalkette has no roles: ${roles()}`);
  }
  const signs = await sender.page.locator('.station-modal .signal-strip .signal-sign').count();
  const keys = await receiver.page.locator('.station-modal .signal-key').count();
  console.log(
    `signal             ${sender.name} at ${seatOf(sender)} sends ${signs} signs, ` +
      `${receiver.name} at ${seatOf(receiver)} has ${keys} keys`,
  );
  const { length, stages } = sender.seen.view.puzzle;
  if (signs !== length || keys !== 12) {
    throw new Error(
      `"${title}": the sending panel shows ${signs} of ${length} signs, ` +
        `the receiving one ${keys} of 12 keys`,
    );
  }

  const index = sender.seen.view.currentPuzzleIndex;
  const solved = () => crew.every((p) => p.seen.view.currentPuzzleIndex > index);
  let [sending, pressing] = [sender, receiver];
  for (let stage = 1; stage <= stages; stage++) {
    const pin = pinned?.[stage - 1] ?? null;
    if (pin !== null) {
      checkStage(sending, pin, stage);
    }
    // The run's one deliberate alarm: where the traced host sends, or at the last stage.
    if (!flinchShot && (sending.traced === true || stage === stages)) {
      await inGroup('graphics', () => captureFlinch(sending, pressing, pin?.keys[0] ?? null));
    }
    await inGroup('devices', () => captureGreyDisplay(sending));
    const count = await pressStage(sending, pressing, pin?.keys ?? null);
    const line =
      `signal             ${sending.name} sends, ${pressing.name} presses: ` +
      `${count}/${count}, stage ${stage} of ${stages}`;
    if (stage === stages) {
      if (!(await until(solved, 5000))) {
        throw new Error(`the last stage of "${title}" is in, but the station did not solve`);
      }
      console.log(`${line}: "${title}" solved`);
      return;
    }
    // The former receiver sends now: its view has the sequence.
    const swapped = await until(
      () =>
        roleOf(pressing) === 'sender' &&
        pressing.seen.view.puzzle?.sequence != null &&
        roleOf(sending) === 'receiver',
      3000,
    );
    if (!swapped) {
      throw new Error(`stage ${stage} of "${title}" is in, but the roles did not swap: ${roles()}`);
    }
    console.log(`${line} through, roles swapped`);
    [sending, pressing] = [pressing, sending];
  }
}

/**
 * A sign as a view and the plan carry it, said for the log: its id in colour („rot-kreis"), or
 * a grey one's form and pattern („kreis/ring").
 */
const signSaid = (sign) => (typeof sign === 'string' ? sign : `${sign.shape}/${sign.pattern}`);

/** Whether signal-grey.png was taken: a run shoots the first display without colour it meets. */
let greyShot = false;

/** Skips signal-grey.png and signal-grey-phone-932.png where no Signalkette of the run is grey. */
function greyLeftOut() {
  if (!greyShot) {
    skip('signal-grey*.png', 'no Signalkette the walkthrough works here loses its colour');
  }
}

/**
 * How wide a grey sign has to be drawn, px: at this size every cell of its bold pattern — dot to
 * dot, stripe to stripe, the ring across — measures 18 px or more (client SignalPanel.tsx BOLD,
 * measured in test/signalGrey.test.tsx).
 */
const GREY_SIGN_PX = 64;

/** Each page's CDP session that lends it a finger for a while (`asLargePhone`), kept open. */
const touchSessions = new WeakMap();

/**
 * Runs `look` with `page` held as a large phone sideways: 932×430 under a finger, through CDP's
 * touch on a session of the page's own — as a context made with `hasTouch` has it, which a
 * window's context cannot be given once it is made. Gives the window its size and its mouse
 * back after, whatever `look` did.
 */
async function asLargePhone(page, look) {
  const held = page.viewportSize();
  let cdp = touchSessions.get(page);
  if (cdp === undefined) {
    cdp = await page.context().newCDPSession(page);
    touchSessions.set(page, cdp);
  }
  await page.setViewportSize({ width: SIZES[4].width, height: SIZES[4].height });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    await sleep(500);
    await look();
  } finally {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    if (held !== null) {
      await page.setViewportSize(held);
    }
    await sleep(300);
  }
}

/**
 * What the open Signalkette's device shows of a display without colour, read in the page: the
 * strip's class, the signs it lights (none fading out), how wide each grey one is drawn, the
 * legends that burn, every paint of a grey sign that is not a grey, the first colour's word in
 * the device's markup and how many of its elements carry a sign's id.
 */
function greyDisplay() {
  const device = document.querySelector('.station-modal .signal');
  if (device === null) {
    return null;
  }
  const lit = [...device.querySelectorAll('.signal-strip .signal-glyph')].filter(
    ({ classList }) =>
      !classList.contains('signal-glyph--dark') && !classList.contains('signal-glyph--fading'),
  );
  const grey = lit.filter(({ classList }) => classList.contains('signal-glyph--grey'));
  const paints = grey.flatMap((glyph) => [
    globalThis.getComputedStyle(glyph).color,
    ...[...glyph.querySelectorAll('*')].flatMap((el) => [
      el.getAttribute('fill'),
      el.getAttribute('stroke'),
    ]),
  ]);
  const channels = (paint) =>
    paint.startsWith('#')
      ? [1, 3, 5].map((at) => parseInt(paint.slice(at, at + 2), 16))
      : (paint.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const hued = paints.filter((paint) => {
    if (paint === null || paint === 'none') {
      return false;
    }
    const [r, g, b] = channels(paint);
    return r !== g || g !== b;
  });
  const legend = (mode) =>
    `${mode.querySelector('.device-engraving')?.textContent} · ` +
    `${mode.querySelector('.signal-legend--lit')?.textContent ?? '–'}`;
  return {
    grey: device.querySelector('.signal-strip')?.classList.contains('signal-strip--grey') ?? false,
    lit: lit.length,
    sizes: grey.map((glyph) => Math.round(glyph.getBoundingClientRect().width)),
    legends: [...device.querySelectorAll('.signal-mode')].map(legend),
    hued: [...new Set(hued)],
    word: /\b(rot|rote[mnrs]?|blau\w*|grün\w*|gruen|gelb\w*)\b/i.exec(device.outerHTML)?.[0] ??
      null,
    tokens: device.querySelectorAll('[data-token]').length,
  };
}

/**
 * What a display without colour must not show (`greyDisplay`) and a phone must not do with it
 * (`deviceReach`, null in a window): each a test of the two, and what the log says of it.
 */
const GREY_WRONGS = [
  [(seen) => !seen.grey, () => 'the strip is not grey'],
  [(seen) => seen.sizes.length === 0, () => 'no grey sign lit'],
  [
    (seen) => seen.lit > seen.sizes.length,
    (seen) => `${seen.lit - seen.sizes.length} sign(s) lit in colour`,
  ],
  [
    (seen) => seen.sizes.some((px) => px < GREY_SIGN_PX),
    () => `a grey sign under ${GREY_SIGN_PX} px`,
  ],
  [(seen) => !seen.legends.includes('ANZEIGE · FARBLOS'), () => 'no ANZEIGE · FARBLOS lit'],
  [(seen) => seen.hued.length > 0, (seen) => `drawn in colour: ${seen.hued.join(', ')}`],
  [(seen) => seen.word !== null, (seen) => `a colour named: „${seen.word}"`],
  [(seen) => seen.tokens > 0, (seen) => `${seen.tokens} key(s) carrying a sign's id`],
  [(_, reach) => (reach?.scroll ?? 0) > 1, (_, reach) => `it scrolls ${reach.scroll}px`],
  [(_, reach) => (reach?.cut.length ?? 0) > 0, (_, reach) => `${reach.cut.join(', ')} cut off`],
];

/** What a look at a display without colour finds wrong, as the log says it. */
function greyWrongs(seen, reach) {
  if (seen === null) {
    return ['no Signalkette open'];
  }
  return GREY_WRONGS.filter(([wrong]) => wrong(seen, reach)).map(([, said]) => said(seen, reach));
}

/**
 * The open display without colour as `greyDisplay` reads it once a grey sign shows: waited for a
 * fleeting strip's cycle at most, and past its flare as it comes on. Read before the shot, so
 * that a shot slow under load cannot land the reading in the strip's dark pause; where no sign
 * was lit by then, waited for and read once more.
 */
async function greyLit(page) {
  const shown = page.locator('.station-modal .signal-glyph--grey:not(.signal-glyph--fading)');
  let seen = null;
  for (let tries = 0; tries < 2 && (seen?.sizes.length ?? 0) === 0; tries++) {
    await shown
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .catch(() => undefined);
    await sleep(400);
    seen = await page.evaluate(greyDisplay);
  }
  return seen;
}

/**
 * One look at the sending console's display without colour, as `shot`: reads the device as a
 * sign shows (`greyLit`; on a phone `deviceReach` as well), shoots, logs it, and fails the run
 * where the display shows anything but grey signs at their size, or where its legend does not
 * burn, or where a phone does not hold the device whole.
 */
async function greyLook({ page, name }, shot, where, phone) {
  const seen = await greyLit(page);
  const reach = phone ? await page.evaluate(deviceReach) : null;
  await capture(page, shot);
  const wrong = greyWrongs(seen, reach);
  const said =
    seen === null
      ? 'no Signalkette open'
      : `${seen.lit} sign(s) lit, grey at ${[...new Set(seen.sizes)].join('/') || '–'} px; ` +
        seen.legends.join(', ');
  const fits = reach === null ? '' : `; ${reach.controls} controls, scrolls ${reach.scroll}px`;
  console.log(
    `${shot.padEnd(18)} ${name} @ ${where}: ${said}${fits}` +
      wrong.map((what) => `\n                   !! ${what}`).join(''),
  );
  if (wrong.length > 0) {
    fail(`${shot}: ${wrong.join('; ')}`);
  }
}

/**
 * signal-grey.png and signal-grey-phone-932.png: the sending console's device as the first stage
 * whose display has lost its colour starts (core puzzles/signal.ts `greyFrom`) — in the window
 * as it stands, the host's 1440×820, and as a large phone held sideways (`asLargePhone`). Each
 * has to show the strip grey, its signs grey at GREY_SIGN_PX, ANZEIGE · FARBLOS lit and nothing
 * of the colour, and the phone the device whole (`greyLook`). Nothing in a stage in colour, or
 * once taken.
 */
async function captureGreyDisplay(sender) {
  if (greyShot || sender.seen.view.puzzle?.grey !== true) {
    return;
  }
  greyShot = true;
  const held = sender.page.viewportSize();
  await greyLook(sender, 'signal-grey.png', `${held?.width}×${held?.height}`, false);
  await asLargePhone(sender.page, () =>
    greyLook(sender, 'signal-grey-phone-932.png', 'a large phone sideways', true),
  );
}

/** A stage of the pinned Signalkette: sent from the pinned console, the pinned sequence. */
function checkStage(sending, pin, stage) {
  const { sends, sequence } = sending.seen.view.puzzle;
  const shown = (sequence ?? []).map(signSaid).join(' ');
  const pinned = pin.sequence.map(signSaid).join(' ');
  if (sends !== pin.sends || shown !== pinned) {
    differs(
      `Signalkette, stage ${stage}`,
      `${shown} from console ${sends}`,
      `${pinned} from console ${pin.sends}`,
    );
  }
}

/**
 * How soon after the alarm comes in figure-flinch.png has to be asked for, ms: within the hop
 * of the crew's flinch (client world/figure.ts HOP_MS), so that the frame the shot takes — the
 * next one, a slow page's a few later — still shows the 400 ms flinch the page starts as the
 * alarm reaches it. Timed from the alarm, not the press: the alarm's way to the server and back
 * is not the shot's, nor is the picture's encoding after its frame.
 */
const FLINCH_SHOT_MS = 200;
/** Whether figure-flinch.png was taken: a run meets one Signalkette at most for it. */
let flinchShot = false;
/** Whether panel-close.png was tried: the first open station a player steps back from takes it. */
let panelCloseShot = false;

/**
 * From now on, `page` records the station's panel on its own clock (`window.__panelFade`, read
 * by panelfade.mjs `fadeOf`): as its DOM changes, when the panel begins to leave
 * (`puzzle-modal--leaving`), inert or not, and when it is gone; and at each animation frame until
 * then, or a second, the panel — there or not, leaving, inert, its opacity, and how far its
 * fade-out (`panel-down`) has run on the fade's own clock. A frame the page draws late is so
 * judged by what it showed, not by when the walkthrough looked.
 */
function recordPanelFade(page) {
  return page.evaluate(() => {
    const t0 = globalThis.performance.now();
    const now = () => globalThis.performance.now() - t0;
    const record = { left: null, gone: null, inertAtLeft: null, frames: [] };
    globalThis.__panelFade = record;
    const modalNow = () => document.querySelector('.station-modal');
    const leavingNow = (modal) => modal?.classList.contains('puzzle-modal--leaving') === true;
    const watch = new globalThis.MutationObserver(() => {
      const modal = modalNow();
      if (record.left === null && leavingNow(modal)) {
        record.left = now();
        record.inertAtLeft = modal.inert;
      }
      if (modal === null) {
        record.gone = now();
        watch.disconnect();
      }
    });
    watch.observe(document.body, { subtree: true, childList: true, attributeFilter: ['class'] });
    // A panel that never goes is the walkthrough's to report (it waits 3 s for it): stop watching.
    globalThis.setTimeout(() => watch.disconnect(), 5000);
    const frameOf = (modal) => {
      const panel = modal.querySelector('.panel');
      const fade = panel?.getAnimations().find((a) => a.animationName === 'panel-down');
      return {
        t: now(),
        present: true,
        leaving: leavingNow(modal),
        inert: modal.inert,
        opacity: panel === null ? 0 : Number(globalThis.getComputedStyle(panel).opacity),
        fade: fade === undefined ? null : Number(fade.currentTime),
      };
    };
    const gone = () => ({ t: now(), present: false, leaving: false, inert: false, opacity: 0 });
    const step = () => {
      const modal = modalNow();
      record.frames.push(modal === null ? { ...gone(), fade: null } : frameOf(modal));
      if (modal !== null && now() < 1000) {
        globalThis.requestAnimationFrame(step);
      }
    };
    globalThis.requestAnimationFrame(step);
  });
}

/** How long the game keeps a device up as it fades out, ms (client WorldModal.tsx). */
const PANEL_FADE_MS = 150;
/**
 * How far into its fade-out panel-close.png holds the panel, ms: past the ease-in's slow start,
 * the panel about half gone and the dim behind it two-thirds lifted.
 */
const PANEL_SHOT_MS = 120;

/**
 * In the page, until releasePanelFade: a device that starts to fade out stands still `ms` into
 * its fade, and the game's timer that lets it go — the one timer of the fade's length, `fade`
 * (client PutDown.tsx `useLeaving`) — is kept back, so that a shot coming late under load still
 * finds the panel there. The world goes on as it does.
 */
function holdPanelFade({ ms, fade }) {
  const style = document.createElement('style');
  style.id = 'shots-panel-hold';
  style.textContent =
    '.station-modal.puzzle-modal--leaving, .station-modal.puzzle-modal--leaving .panel ' +
    `{ animation-delay: -${ms}ms !important; animation-play-state: paused !important; }`;
  document.head.append(style);
  // The browser's own setTimeout throws unless it is called on the window.
  const plain = globalThis.setTimeout;
  const kept = [];
  globalThis.__panelHold = { plain, kept };
  globalThis.setTimeout = (run, delay, ...args) => {
    if (delay !== fade) {
      return plain.call(globalThis, run, delay, ...args);
    }
    kept.push(() => run(...args));
    return plain.call(globalThis, () => undefined, 0);
  };
}

/** In the page: lets the device held by holdPanelFade go — its timer runs now, its fade goes on. */
function releasePanelFade() {
  const hold = globalThis.__panelHold;
  document.getElementById('shots-panel-hold')?.remove();
  if (hold !== undefined) {
    globalThis.setTimeout = hold.plain;
    delete globalThis.__panelHold;
    for (const run of hold.kept) {
      hold.plain.call(globalThis, run, 0);
    }
  }
}

/** A page's record of a panel that never began to leave (recordPanelFade). */
const NO_FADE = { left: null, gone: null, inertAtLeft: null, frames: [] };

/**
 * The device's fade-out as the game plays it: Esc, the page recording the panel on its own clock
 * (recordPanelFade) until it has gone, and the world shot once it has.
 */
async function fadeOutAsPlayed(page, modal) {
  await recordPanelFade(page);
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden', timeout: 3000 });
  await sleep(100);
  const closed = await page.screenshot();
  const record = await page.evaluate(() => globalThis.__panelFade ?? null);
  return { closed, fade: fadeOf(record ?? NO_FADE, PANEL_FADE_MS) };
}

/**
 * The shot of panel-close.png: the station opened anew with E, stepped back from with its
 * fade-out held PANEL_SHOT_MS in (holdPanelFade) — a screenshot asked for at once draws the
 * fade's first frame, the panel still whole — and the hold let go, however the shot went. Null
 * where the station did not open again.
 */
async function heldFadeShot(player, modal) {
  const { page } = player;
  if (!(await interactUntil(player, modal, armedTarget(player.seen.view)))) {
    return null;
  }
  await sleep(400); // past its fade-in
  let shot = null;
  await page.evaluate(holdPanelFade, { ms: PANEL_SHOT_MS, fade: PANEL_FADE_MS });
  try {
    await page.keyboard.press('Escape');
    // A shot without the panel leaving is judged by its luma (capturePanelClose), not thrown.
    const leaving = page.locator('.station-modal.puzzle-modal--leaving');
    await leaving.waitFor({ state: 'attached', timeout: 1000 }).catch(() => undefined);
    shot = await page.screenshot();
  } finally {
    await page.evaluate(releasePanelFade);
  }
  await modal.waitFor({ state: 'hidden', timeout: 3000 });
  return shot;
}

/**
 * panel-close.png: `player` steps back from the open station with Esc, and the device fades out
 * as it came, over 150 ms (client styles/interaction.css, screens/Game.tsx): the page records
 * the panel on its own clock meanwhile (recordPanelFade) — it has to leave inert, its opacity
 * only falling, be gone within 100 to 600 ms of its beginning to leave, and show midway on a
 * frame drawn in the fade's middle (panelfade.mjs `fadeVerdict`). Then the shot (heldFadeShot),
 * which has to lie between the panel open and gone over the panel's box; one that came after
 * the game had let the panel go is taken again, up to three times. Any of these that fails,
 * fails the run; where the page drew no frame in the fade's middle, its midway frames are
 * skipped with when it drew them.
 */
async function capturePanelClose(player, modal) {
  const { page } = player;
  panelCloseShot = true;
  const dpr = await page.evaluate(() => globalThis.devicePixelRatio);
  const box = await modal.locator('.panel').boundingBox();
  const luma = (png) => meanLuma(decodePng(png), box, dpr);
  const open = luma(await page.screenshot());
  const { closed, fade } = await fadeOutAsPlayed(page, modal);
  const gone = luma(closed);
  let held = null;
  for (let attempt = 1; attempt <= 3 && !(held?.between ?? false); attempt++) {
    const shot = await heldFadeShot(player, modal);
    if (shot === null) {
      fail('panel-close.png: the station did not open again for its shot');
      return;
    }
    const mid = luma(shot);
    held = { shot, attempt, lumas: [open, mid, gone], between: midway(open, mid, gone) };
  }
  writeFileSync(join(OUT, 'panel-close.png'), held.shot);
  taken('panel-close.png');
  reportPanelClose(player, fade, held);
}

/**
 * panel-close.png's line in the log, the fade's numbers on the page's clock. The run fails where
 * the fade (panelfade.mjs `fadeVerdict`) or its shot was wrong; where the page drew no frame in
 * the fade's middle, its frames midway are skipped (`panel-close (fade)`), the reason naming
 * when the page drew them.
 */
function reportPanelClose(player, fade, held) {
  const { faults, unjudged } = fadeVerdict(fade, PANEL_FADE_MS);
  const gone =
    fade.ms === null ? '!! never leaving, or never gone' : `gone in ${Math.round(fade.ms)} ms`;
  const lumas = `luma ${held.lumas.map((l) => l.toFixed(0)).join(' → ')}`;
  console.log(
    `panel-close.png    ${player.name}, Esc: ${gone}, ${fade.midway} of ${fade.drawn.length} ` +
      `frames midway (the fade at ${drawnText(fade.drawn)} ms), ` +
      `${fade.falling ? 'falling' : '!! not only falling'}, ` +
      `${fade.inert ? 'inert' : '!! taking input'}, on the page's clock; the shot held ` +
      `${PANEL_SHOT_MS} ms in ${held.between ? 'midway' : '!! not midway'} (${lumas}), ` +
      `try ${held.attempt}`,
  );
  const shot = held.between ? [] : [`the shot held ${PANEL_SHOT_MS} ms in not midway (${lumas})`];
  if (faults.length + shot.length > 0) {
    fail(`panel-close.png: ${[...faults, ...shot].join('; ')}`);
  }
  if (unjudged !== null) {
    skip('panel-close (fade)', unjudged);
  }
}

/**
 * Steps `player` back from the open station `modal` with Esc: the first time, panel-close.png,
 * graphics' — where the run leaves graphics out, as any other time.
 */
async function stepBack(player, modal) {
  const plainly = async () => {
    await player.page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden', timeout: 3000 });
  };
  if (!panelCloseShot && (await modal.isVisible())) {
    await inGroup('graphics', () => capturePanelClose(player, modal), plainly);
    return;
  }
  await plainly();
}

/**
 * A key on `presser`'s panel that is not the first one the stage asks for:
 * by its sign where the keys show signs, else by its row and shape — not
 * `firstKey`, the one the pinned stage presses first. Its selector, and how
 * the log names it.
 */
async function wrongKey(sender, presser, firstKey) {
  if (firstKey !== null) {
    const keys = await presser.page
      .locator('.station-modal .signal-key[data-row]')
      .evaluateAll((all) => all.map((key) => [key.dataset.row, key.dataset.shape]));
    const other = keys.find(
      ([row, shape]) => row !== String(firstKey.row) || shape !== firstKey.shape,
    );
    if (other === undefined) {
      throw new Error(`${presser.name}'s Signalkette panel has no key to get wrong`);
    }
    const [row, shape] = other;
    const selector = `.station-modal .signal-key[data-row="${row}"][data-shape="${shape}"]`;
    return { selector, said: `${shape} in row ${row}` };
  }
  const first = sender.seen.view.puzzle?.sequence?.[0];
  const tokens = await presser.page
    .locator('.station-modal .signal-key[data-token]')
    .evaluateAll((keys) => keys.map((key) => key.getAttribute('data-token')));
  const wrong = tokens.find((token) => token !== first);
  if (wrong === undefined) {
    throw new Error(`${presser.name}'s Signalkette panel has no key but "${first}" to get wrong`);
  }
  return { selector: `.station-modal .signal-key[data-token="${wrong}"]`, said: wrong };
}

/**
 * figure-flinch.png: a deliberate wrong sign at the Signalkette, the one
 * alarm the run spends on it. The sender closes its panel and its window
 * grows to 1440×1000, so that its world shows both figures; the presser
 * clicks a key the sequence does not start with, and the sender's page is
 * shot the moment the alarm comes in, asked for within FLINCH_SHOT_MS of it —
 * the crew mid-flinch, however long the alarm took on its way. Then the
 * window shrinks back and the sender opens its panel again for the stage.
 * Fails where no alarm comes in or the shot is asked for too late; throws
 * where the panel does not open again.
 */
async function captureFlinch(sender, presser, firstKey = null) {
  flinchShot = true;
  const modal = sender.page.locator('.station-modal');
  await stepBack(sender, modal);
  const size = sender.page.viewportSize();
  await sender.page.setViewportSize(COLD_OPEN);
  await sleep(700); // the layout settles, the panel past its fade-out
  const wrong = await wrongKey(sender, presser, firstKey);
  const count = sender.seen.view.alarms.count;
  const pressed = Date.now();
  await presser.page.locator(wrong.selector).click();
  const clicked = Date.now() - pressed;
  while (sender.seen.view.alarms.count === count && Date.now() - pressed < 2000) {
    await sleep(5);
  }
  const came = sender.seen.view.alarms.count > count ? Date.now() - pressed : null;
  const asked = Date.now() - pressed;
  await capture(sender.page, 'figure-flinch.png');
  const done = Date.now() - pressed;
  const after = came === null ? null : asked - came;
  console.log(
    `figure-flinch.png  ${presser.name} pressed "${wrong.said}" (${clicked} ms), the alarm ` +
      (came === null ? '!! never came in' : `in ${came} ms`) +
      `; ${sender.name}'s world @ ${COLD_OPEN.width}x${COLD_OPEN.height} shot ` +
      (after === null ? `${asked} ms after the press` : `${after} ms after the alarm`) +
      `, the picture in by ${done} ms` +
      (after !== null && after > FLINCH_SHOT_MS ? ` — !! later than ${FLINCH_SHOT_MS} ms` : ''),
  );
  if (after === null || after > FLINCH_SHOT_MS) {
    const alarm = came === null ? 'missing' : `in ${came} ms`;
    fail(`figure-flinch.png: the alarm ${alarm}, the shot asked for ${asked} ms after the press`);
  }
  if (size !== null) {
    await sender.page.setViewportSize(size);
  }
  await sleep(300);
  if (!(await interactUntil(sender, modal, armedTarget(sender.seen.view)))) {
    throw new Error(
      `${sender.name} closed the Signalkette for figure-flinch.png, but it did not open again`,
    );
  }
  await sleep(300); // past the panel's fade-in
}

/**
 * The world canvas's size in CSS pixels — the zoom follows its height — with
 * what shares the column with it: the HUD's height and the banners up.
 */
async function layoutOf(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.world-canvas');
    const hud = document.querySelector('.hud');
    return {
      size: canvas === null ? 'no canvas' : `${canvas.clientWidth}x${canvas.clientHeight}`,
      hud: hud === null ? 0 : hud.offsetHeight,
      banners: ['.alarm', '.sabotage', '.banner.error'].filter(
        (selector) => document.querySelector(selector) !== null,
      ),
    };
  });
}

/** Whether two boxes overlap; a missing box overlaps nothing. */
function overlapping(a, b) {
  return (
    a !== null &&
    b !== null &&
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** The head the Laborkennung comes into the notepad under (client noting.ts SIGN). */
const SIGN_CAPTURE = 'Schild · Laborkennung';

/** All the notepad on `page` holds: its writing, then each capture's head and lines. */
function padText(page) {
  return page.evaluate(() => {
    const writing = document.querySelector('.notepad .notepad-text')?.value ?? '';
    const captures = [...document.querySelectorAll('.notepad .notepad-capture')].map(
      (capture) =>
        `${capture.querySelector('.notepad-capture-head')?.textContent ?? ''}\n` +
        `${capture.querySelector('textarea')?.value ?? ''}`,
    );
    return [writing, ...captures].join('\n\n');
  });
}

/** The head of the newest capture on the notepad on `page`; null for none. */
async function newestCapture(page) {
  const heads = page.locator('.notepad .notepad-capture-head');
  return (await heads.count()) === 0 ? null : heads.last().textContent();
}

/**
 * notepad.png: the guest opens the notepad from the HUD, writes a line and
 * takes the Laborkennung over — a capture of its own at the foot of the pad,
 * „Schild · Laborkennung". The pad is kept per room, so a reload has to bring
 * the writing and the captures back.
 */
async function captureNotepad(page, seen) {
  const pad = page.locator('.notepad');
  await page.locator('.hud-notes').click();
  await pad.waitFor({ state: 'visible', timeout: 3000 });
  await pad.locator('.notepad-text').fill('Spalte 4: Ω ☆ ¶ Ѭ');
  const take = pad.locator('.notepad-take');
  const offered = !(await take.isDisabled());
  if (offered) {
    await take.click();
  }
  await sleep(300);
  await capture(page, 'notepad.png');
  const written = await padText(page);
  const taken = offered ? await newestCapture(page) : null;
  const steering = await page.locator('.world-pad').boundingBox();
  const blocks = overlapping(await pad.boundingBox(), steering);
  // The pad offers the Laborkennung only to a player who has read the sign.
  const kennung = offered
    ? `Laborkennung taken over as ${taken === SIGN_CAPTURE ? '' : '!! '}„${taken}"`
    : seen.view.edgework === null
      ? 'no Laborkennung read yet, none to take over'
      : '!! Laborkennung read but not offered';
  console.log(
    `notepad.png        guest: ${kennung}, ` +
      `${blocks ? '!! covers the steering pad' : 'clear of the steering pad'}`,
  );
  if (offered && taken !== SIGN_CAPTURE) {
    fail(`notepad.png: the Laborkennung came in as „${taken}", not „${SIGN_CAPTURE}"`);
  }

  await page.reload();
  await page.locator('.stage').waitFor({ timeout: 10_000 });
  await page.locator('.overlay.pause').waitFor({ state: 'hidden', timeout: 10_000 });
  await page.locator('.hud-notes').click();
  await pad.waitFor({ state: 'visible', timeout: 3000 });
  const kept = (await padText(page)) === written;
  console.log(
    `notepad            guest: ${kept ? 'all of it kept over a reload' : '!! lost on reload'}`,
  );
  await pad.locator('.notepad-close').click();
  await pad.waitFor({ state: 'hidden', timeout: 3000 });
}

/**
 * Brings the notepad up beside what lies over the world (`over`, its frame's selector): by N
 * where there are keys, by the notepad's tab where a finger is. True for the tab.
 */
async function padUp(page, over) {
  const touch = await page.evaluate(() => globalThis.matchMedia('(pointer: coarse)').matches);
  if (touch) {
    await page.locator(`${over} .put-down-tab--notes, ${over} .device-tab--notes`).first().click();
  } else {
    await page.keyboard.press('n');
  }
  await page.locator('.game--noting .notepad').waitFor({ state: 'visible', timeout: 3000 });
  return touch;
}

/** Puts the notepad away again, by its word. */
async function padAway(page) {
  const pad = page.locator('.notepad');
  await pad.locator('.notepad-close').click();
  await pad.waitFor({ state: 'hidden', timeout: 3000 });
}

/**
 * Where the notepad stands beside what lies over the world: a strip down the right edge, the
 * window's height, with the page left of it, or on a phone a drawer along the foot, the
 * window's width, with the page above it. `ok` where it is either, and the log's words for it.
 */
async function notingSide(page) {
  const { pad, over, width, height } = await page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (element === null) {
        return null;
      }
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      pad: box('.notepad'),
      over: box('.puzzle-modal'),
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    };
  });
  if (pad === null || over === null) {
    return { ok: false, said: '!! no pad, or nothing over the world' };
  }
  const place = padPlace(pad, over, width, height);
  const size = `${Math.round(pad.w)}×${Math.round(pad.h)}`;
  if (place === 'strip') {
    return { ok: true, said: `a strip ${size} down the right edge, the page beside it` };
  }
  if (place === 'drawer') {
    return { ok: true, said: `a drawer ${size} along the foot, the page above it` };
  }
  return { ok: false, said: `!! ${size} at ${Math.round(pad.x)},${Math.round(pad.y)}, over the page` };
}

/**
 * How the pad `pad` stands in a window `width` × `height` beside `over`: a strip down the right
 * edge from top to foot, right of it, or a drawer along the foot from side to side, under it;
 * null for neither.
 */
function padPlace(pad, over, width, height) {
  const near = (a, b) => Math.abs(a - b) <= 1;
  const whole = near(pad.x + pad.w, width) && near(pad.y + pad.h, height);
  if (whole && near(pad.y, 0) && pad.x >= over.x + over.w - 1) {
    return 'strip';
  }
  return whole && near(pad.x, 0) && pad.y >= over.y + over.h - 1 ? 'drawer' : null;
}

/**
 * The open source a player takes notes at: a clipboard first, else the nearest — where it
 * lies from the audience's view (`audience`), which places a source before the crew has come
 * across it; null where none is open within the player's reach.
 */
function sourceToNote(seen, audience) {
  const map = seen.view.map;
  const everything = audience.view?.map ?? map;
  const from = tileOf(seen);
  const options = everything.manuals
    .filter((manual) => manual.opened)
    .map((manual) => ({ manual, path: from === null ? null : route(map, from, manual) }))
    .filter((option) => option.path !== null)
    .sort(
      (a, b) =>
        Number(b.manual.kind === 'clipboard') - Number(a.manual.kind === 'clipboard') ||
        a.path.length - b.path.length,
    );
  return options[0]?.manual ?? null;
}

/** A „Notieren" by a printed block — not the one on the last shift's slip, which lies over them. */
const ON_PAGE = '.note-down:not(.note-slip .note-down)';

/**
 * Turns the pages of an open source forwards until a „Notieren" stands on one in view: a
 * source of several stations opens on its cover while none of them is up. Whether one does.
 */
async function turnToNotable(overlay) {
  const notable = overlay.locator(ON_PAGE).first();
  for (let turns = 0; turns < 8 && !(await notable.isVisible()); turns++) {
    const next = overlay.locator('.turn-next');
    if ((await next.count()) === 0 || (await next.isDisabled())) {
      break;
    }
    await next.click();
    await sleep(500); // past the leaf turning over
  }
  return notable.isVisible();
}

/**
 * Puts a source down again as the player has it: by E where there are keys, by its tab under
 * a finger. It has to go, or the run fails; then the pad goes away by its word.
 */
async function putSourceDown(page, overlay, touch, shot, label) {
  if (touch) {
    await overlay.locator('.put-down-tab:not(.put-down-tab--notes)').click();
  } else {
    await page.keyboard.press('e');
  }
  const down = await overlay.waitFor({ state: 'hidden', timeout: 3000 }).then(
    () => true,
    () => false,
  );
  if (!down) {
    console.log(`${`${shot} `.padEnd(19)}!! ${touch ? 'its tab' : 'E'} did not put "${label}" down`);
    fail(`${shot}: ${touch ? 'the tab' : 'E'} did not put the source down`);
    // The first Escape hands the keys back from the pad, the second steps back from the source.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await overlay.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined);
  }
  await padAway(page);
}

/**
 * What the E prompt names on `page` and its glow, as the traced page's last frame drew them
 * (client world/render/highlight.ts): the thing, where it stands, its halo, how far it rose.
 * Null while it names nothing.
 */
function glowOn(page) {
  return page.evaluate(() => {
    const glow = globalThis.__escapelab?.highlight;
    return glow == null
      ? null
      : { subject: glow.subject, x: glow.x, y: glow.y, halo: glow.halo, lift: glow.lift };
  });
}

/** The glow on `page` once its E prompt names `subject`, within `ms`; null where it never does. */
async function glowNaming(page, subject, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const glow = await glowOn(page);
    if (glow !== null && JSON.stringify(glow.subject) === JSON.stringify(subject)) {
      return glow;
    }
    if (Date.now() >= end) {
      return null;
    }
    await sleep(100);
  }
}

/**
 * The glow naming `subject` on `player`'s page within 3 s — or, where none comes, within 4 s
 * more after a step onto the middle of the tile the player stands on: the step sends its place
 * anew, and a count of it the server keeps a moment behind the walk catches up. Null where
 * neither brings it.
 */
async function glowAfterStep(player, subject) {
  const glow = await glowNaming(player.page, subject, 3000);
  const tile = glow === null ? tileOf(player.seen) : null;
  if (tile === null) {
    return glow;
  }
  await stepTo(player.page, player.seen, tile.x + 0.5, tile.y + 0.5);
  return glowNaming(player.page, subject, 4000);
}

/**
 * `shot`: `player` stands in reach of a thing — `subject`, as client world/interact.ts names
 * it, `said` in the log — the E prompt names it (within 3 s, or 4 s more after a step,
 * `glowAfterStep`), and it glows in its own shape. The traced
 * page hands back the halo's bake and the silhouette it was baked from
 * (`window.__escapelab.highlight`): the halo has to come out strong, every pixel of it that
 * glows has to lie within the spread and the blur's reach of the silhouette, and the corners
 * of the box once drawn round the thing's tile have to stay dark — or the run fails.
 */
async function captureHighlight(player, { subject, said }, shot) {
  const { page, name } = player;
  const label = `${shot} `.padEnd(19);
  const glow = await glowAfterStep(player, subject);
  const pixels =
    glow === null
      ? null
      : await page.evaluate(() => globalThis.__escapelab?.highlight?.pixels() ?? null);
  if (glow === null || pixels === null) {
    console.log(`${label}!! ${name} stands at ${said}, but nothing glows`);
    fail(`${shot}: the E prompt at ${said} names nothing that glows`);
    return;
  }
  await capture(page, shot);
  // The halo's spread and three sigma of its blur at its level, and two pixels more.
  const reach = Math.ceil(((HALO_SPREAD + HALO_BLUR * 1.5) * pixels.level) / 64) + 2;
  const seen = haloAgainst(pixels, reach);
  const corners = glowAtCorners(pixels, OLD_BOX);
  const dark = corners.every((alpha) => alpha === null || alpha < GLOWING);
  const shaped = seen.strongest >= 128 && seen.glowing > 0 && seen.stray === 0;
  console.log(
    `${label}${name} at ${said}, halo ${glow.halo.toFixed(2)}: ` +
      `${seen.glowing} px glow at ${pixels.level} px a tile, ` +
      `${seen.stray === 0 ? 'all' : `!! ${seen.stray} not`} within ${reach} px of its ` +
      `${seen.solid} px silhouette, strongest ${seen.strongest}; the old box's corners ` +
      `${dark ? 'dark' : '!! lit'} (${corners.map((alpha) => alpha ?? 'off').join(', ')})`,
  );
  if (!shaped || !dark) {
    fail(`${shot}: the glow round ${said} does not keep to its shape`);
  }
}

/** A label on the map as the notepad names the place: „KLEMMBRETT" is the Klemmbrett. */
function placeNamed(label) {
  return label
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, before, first) => before + first.toUpperCase());
}

/** How many lines a capture holds under its head, at most (client noting.ts CAPTURE_LINES). */
const CAPTURE_LINES = 11;

/**
 * The newest capture on the notepad on `page` as it should stand after „Notieren" at `source`:
 * under a head naming the source and the part („Klemmbrett · Legende"), at most CAPTURE_LINES
 * lines under it. Whether it does, and the log's words for it.
 */
async function noteTakenAt(page, source) {
  const head = await newestCapture(page);
  const body = page.locator('.notepad .notepad-capture textarea').last();
  const lines = head === null ? 0 : (await body.inputValue()).split('\n').length;
  const named = head !== null && head.startsWith(`${placeNamed(source.label)} · `);
  const ok = named && lines <= CAPTURE_LINES;
  return { ok, head, said: `${ok ? '' : '!! '}noted „${head}", ${lines} line(s) under it` };
}

/** The capture reading-notepad.png took, and whose pad holds it; null before. */
let noted = null;

/**
 * The notepad on `page` as it shows now, read off the page: the faces it writes in, the sizes
 * and the contrast of its texts against its paper, whether every table of pencil fits its line,
 * the heads of its captures, and whether the pad lies within the window.
 */
function padLook(page) {
  return page.evaluate(() => {
    const luminance = (color) => {
      const [r, g, b] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((c) => {
        const s = Number(c) / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const style = (el) => globalThis.getComputedStyle(el);
    const pad = document.querySelector('.notepad');
    const paper = luminance(style(pad).backgroundColor);
    const texts = [
      ...pad.querySelectorAll('.notepad-text, .notepad-capture-head, .notepad-capture-text'),
    ];
    const contrast = Math.min(
      ...texts.map((el) => {
        const [light, dark] = [luminance(style(el).color), paper].sort((a, b) => b - a);
        return (light + 0.05) / (dark + 0.05);
      }),
    );
    const tables = [...pad.querySelectorAll('.notepad-capture--table .notepad-capture-text')];
    const box = pad.getBoundingClientRect();
    return {
      hand: style(pad.querySelector('.notepad-text')).fontFamily.split(',')[0].replaceAll('"', ''),
      handLoaded: document.fonts.check('18px Kalam'),
      pencil: tables.map((el) => style(el).fontFamily.split(',')[0])[0] ?? null,
      smallest: Math.min(...texts.map((el) => Number.parseFloat(style(el).fontSize))),
      contrast,
      tablesFit: tables.every((el) => el.scrollWidth <= el.clientWidth),
      heads: [...pad.querySelectorAll('.notepad-capture-head')].map(
        (el) => el.firstChild?.textContent,
      ),
      inWindow:
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= globalThis.innerWidth &&
        box.bottom <= globalThis.innerHeight,
    };
  });
}

/**
 * notepad-captured.png, then notepad-captured-phone.png at the phone's size: the pad of the
 * player who noted the Signalkette's legend at the Klemmbrett (reading-notepad.png) takes the
 * Laborkennung over too, and shows both in the notepad's own look — the writing in the hand
 * shipped with the game (Kalam), the legend in pencil block letters on ruled lines, the
 * Laborkennung on its line —, scrolled down to them. Its texts have to stand at 15 px or more
 * and 4.5:1 against the paper, the legend's columns on their lines without scrolling, the pad
 * within the window, or the run fails. A pad without the legend, or a player who has not read
 * the sign, skips the shots.
 */
async function captureNotepadCaptured() {
  const shots = ['notepad-captured.png', 'notepad-captured-phone.png'];
  if (noted === null || !/ · Legende$/.test(noted.head ?? '')) {
    const why = `no Signalkette legend noted (${noted?.head ?? 'nothing'})`;
    shots.forEach((shot) => skip(shot, why));
    return;
  }
  const { page, name, seen } = noted.player;
  if (seen.view.edgework === null) {
    shots.forEach((shot) => skip(shot, `${name} has not read the Laborkennung`));
    return;
  }
  const pad = page.locator('.notepad');
  await page.locator('.hud-notes').click();
  await pad.waitFor({ state: 'visible', timeout: 3000 });
  await pad.locator('.notepad-take').click();
  const size = page.viewportSize();
  for (const [shot, at] of [[shots[0], size], [shots[1], SIZES[2]]]) {
    await page.setViewportSize({ width: at.width, height: at.height });
    await sleep(300);
    await page.evaluate(async () => {
      await document.fonts.ready;
      const sheet = document.querySelector('.notepad-sheet');
      sheet.scrollTop = sheet.scrollHeight;
    });
    await capture(page, shot);
    const look = await padLook(page);
    const both = look.heads.includes(noted.head) && look.heads.at(-1) === SIGN_CAPTURE;
    const ok =
      both && look.hand === 'Kalam' && look.handLoaded && look.pencil !== null &&
      look.smallest >= 15 && look.contrast >= 4.5 && look.tablesFit && look.inWindow;
    console.log(
      `${`${shot} `.padEnd(19)}${name} @ ${at.width}x${at.height}: ` +
        `${look.heads.map((h) => `„${h}"`).join(', ')}; ` +
        `writing in ${look.hand}${look.handLoaded ? '' : ' (!! not loaded)'}, ` +
        `tables in ${look.pencil}` +
        `${look.tablesFit ? '' : ' (!! cut)'}; smallest ${look.smallest} px, contrast ` +
        `${look.contrast.toFixed(1)}:1` +
        `${look.inWindow ? '' : '; !! the pad runs out of the window'}`,
    );
    if (!ok) {
      fail(`${shot}: the notepad does not show the captures in its own look`);
    }
  }
  await page.setViewportSize(size);
  await padAway(page);
}

/**
 * reading-notepad.png (reading-notepad-phone.png on the guest's phone): a player reads an open
 * source — a clipboard where one is open — brings the notepad up beside it and takes the
 * first rules list or table in view down with „Notieren". The pad has to stand beside the
 * page and hold the capture at its foot under a head naming the source („Klemmbrett ·
 * Legende"), or the run fails. Then the source is put down again (`putSourceDown`). Before E,
 * as the player stands in reach, `glowShot` catches the source glowing in its shape
 * (captureHighlight).
 */
async function captureNoting(player, shot, glowShot, audience) {
  const { page, seen, name } = player;
  const source = sourceToNote(seen, audience);
  if (source === null || !(await walkNear(page, seen, source))) {
    skip(shot, `no open source within ${name}'s reach`);
    skip(glowShot, `no open source within ${name}'s reach`);
    return;
  }
  const subject = { of: 'manual', id: source.id };
  await captureHighlight(player, { subject, said: `"${source.label}" (${source.kind})` }, glowShot);
  const overlay = page.locator('.reading-modal');
  if (!(await interactUntil(player, overlay, sourceTarget(source)))) {
    throw new Error(`${name} stands at "${source.id}", but no .reading-modal after ${TRIES}`);
  }
  await sleep(400); // past the page's fade-in
  const touch = await padUp(page, '.reading-modal');
  const offered = await turnToNotable(overlay);
  if (offered) {
    await overlay.locator(ON_PAGE).first().click();
  }
  await sleep(500); // the pad scrolled down to it, the control says it took it
  await capture(page, shot);
  const taken = await noteTakenAt(page, source);
  const side = await notingSide(page);
  console.log(
    `${`${shot} `.padEnd(19)}${name}: "${source.label}" (${source.kind}), ` +
      (offered ? taken.said : '!! no „Notieren"') +
      `; the pad ${side.said}${touch ? ', up by its tab' : ', up by N'}`,
  );
  if (!offered || !taken.ok || !side.ok) {
    fail(`${shot}: ${offered ? 'the capture or the pad is not as it should be' : 'no „Notieren"'}`);
  }
  noted = { player, head: taken.head };
  await captureSheetSideways(player, touch);
  await putSourceDown(page, overlay, touch, shot, source.label);
}

/**
 * The least body a page sets on a phone, held sideways or upright, at the normal text size: the
 * body's own 14 px (styles/book.css, `--type-body`).
 */
const PHONE_BODY = 14;

/**
 * The open source's sheet as a phone shows it: its pages, whether as a spread, the frame's
 * scroll, the body's size; how far a page's text scrolls inside its sheet, whether a scroll
 * reaches its last line, and how far a line runs past the sheet's edge.
 */
function sheetOnPhone() {
  const modal = document.querySelector('.reading-modal');
  const pages = [...document.querySelectorAll('.reading-modal .book-leaves > .page')];
  const read = pages.flatMap((page) => {
    const text = page.querySelector('.page-text');
    if (text === null) {
      return [];
    }
    const edge = page.getBoundingClientRect().right;
    const lines = [...text.querySelectorAll('*')].map((el) => el.getBoundingClientRect().right);
    const held = text.scrollTop;
    text.scrollTop = text.scrollHeight;
    const last = text.lastElementChild?.getBoundingClientRect().bottom ?? 0;
    const reached = last <= text.getBoundingClientRect().bottom + 1;
    text.scrollTop = held;
    const past = Math.max(0, ...lines.map((right) => right - edge));
    const wide = text.scrollWidth - text.clientWidth;
    return [{ rises: text.scrollHeight - text.clientHeight, past: Math.max(past, wide), reached }];
  });
  const body = document.querySelector('.reading-modal .page-in');
  return {
    pages: pages.length,
    spread: document.querySelector('.reading-modal .book-spread') !== null,
    scroll: modal === null ? 0 : modal.scrollHeight - modal.clientHeight,
    body: body === null ? null : parseFloat(globalThis.getComputedStyle(body).fontSize),
    rises: Math.max(0, ...read.map((r) => r.rises)),
    past: Math.round(Math.max(0, ...read.map((r) => r.past))),
    reached: read.every((r) => r.reached),
  };
}

/** The log's words for a sheet as `sheetOnPhone` read it. */
function sheetSaid(sheet) {
  const body = sheet.body === null ? 'no page' : `its body ${sheet.body.toFixed(1)} px`;
  const end = sheet.reached ? '' : ', !! not to its last line';
  return (
    `${sheet.pages} page(s), ${body}, its text scrolling ${sheet.rises} px inside the sheet` +
    `${end}, ${sheet.past} px past its edge, the frame scrolling ${sheet.scroll} px`
  );
}

/** What is wrong with a sheet as `sheetOnPhone` read it on a phone, held sideways or upright. */
function sheetWrong(sheet) {
  return [
    sheet.spread && 'a book opens two pages on a phone',
    !(sheet.body >= PHONE_BODY) && `its body stands ${sheet.body} px`,
    sheet.scroll > 1 && `the frame scrolls ${sheet.scroll} px`,
    sheet.past > 0 && `a line runs ${sheet.past} px past the sheet's edge`,
    !sheet.reached && "a page's text does not scroll to its last line",
  ].filter(Boolean);
}

/**
 * reading-notepad-landscape.png: the source `player` reads on a phone — `touch`, a touch screen;
 * a window with keys is left alone — the notepad up beside it, with the phone turned sideways:
 * a book on its pages one at a time, never a spread, the body at 14 px at least, its text
 * scrolling inside the sheet to its last line and no line past the sheet's edge, the frame
 * round it not scrolling; and the pad a strip down the right edge, the window's height
 * (`notingSide`). The run fails where any of it is not so. The phone goes back to how it was
 * held.
 */
async function captureSheetSideways(player, touch) {
  if (!touch) {
    return;
  }
  const { page, name } = player;
  const held = page.viewportSize();
  const { width, height } = SIZES[3];
  await page.setViewportSize({ width, height });
  await sleep(600);
  const sheet = await page.evaluate(sheetOnPhone);
  const side = await notingSide(page);
  await capture(page, 'reading-notepad-landscape.png');
  await page.setViewportSize(held);
  await sleep(400);
  console.log(
    `reading-notepad-landscape.png ${name} @ ${width}x${height}: ${sheetSaid(sheet)}; ` +
      `the pad ${side.said}`,
  );
  const wrong = sheetWrong(sheet);
  if (!side.ok) {
    wrong.push('the pad is not a strip beside the page');
  }
  if (wrong.length > 0) {
    fail(`reading-notepad-landscape.png: ${wrong.join(', ')}`);
  }
}

/**
 * device-notepad.png (device-notepad-phone.png on the guest's phone): at an open device the
 * notepad comes up beside it — N, or the tab on the chassis where a finger is — and has to
 * stand beside it, the device left in view; then it goes again.
 */
async function captureDeviceNoting(player, shot) {
  const { page, name } = player;
  const touch = await padUp(page, '.station-modal');
  await sleep(300); // the device's frame settled in the room left to it
  await capture(page, shot);
  const side = await notingSide(page);
  const over = await sideways(page, '.station-modal .panel');
  console.log(
    `${`${shot} `.padEnd(19)}${name}: the pad ${side.said}${touch ? ', up by the tab' : ', up by N'}; ` +
      `the device ${over > 0 ? `!! runs out ${over}px sideways` : 'fits sideways'}`,
  );
  if (!side.ok || over > 0) {
    fail(`${shot}: the notepad does not stand beside the device`);
  }
  await padAway(page);
}

/** How long the walkthrough waits for mission control to speak up at a quiet station, ms. */
const NUDGE_WAIT_MS = 110_000;

/** The lines mission control sent unasked so far, as a page's view has them. */
const nudgesOf = (seen) => (seen.view?.events ?? []).filter((event) => event.kind === 'nudge');

/**
 * nudge.png (nudge-phone.png on the guest's phone): with nothing open over the world, the
 * crew lets the station that is up stand quiet until the Leitstelle names the next place —
 * within its 90 s of quiet. Its line has to show in both banners and be spoken by a recording
 * from the manifest, or the run fails.
 */
async function captureNudge(players) {
  const [first] = players;
  for (const { page } of players) {
    const onTop = page.locator('.station-modal, .reading-modal').first();
    if (await onTop.isVisible()) {
      await page.keyboard.press('Escape');
      await onTop.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined);
    }
  }
  const before = nudgesOf(first.seen).length;
  const armed = first.seen.view.map.stations.find((s) => s.status === 'armed')?.title ?? 'none';
  const from = Date.now();
  if (!(await until(() => nudgesOf(first.seen).length > before, NUDGE_WAIT_MS))) {
    console.log(`nudge.png          !! no word from the Leitstelle at "${armed}" within ${seconds(NUDGE_WAIT_MS)}`);
    fail(`nudge.png: no word from the Leitstelle within ${seconds(NUDGE_WAIT_MS)}`);
    return;
  }
  const line = nudgesOf(first.seen).at(-1).label;
  const listening = hearRadio(first, RADIO_LISTEN_MS);
  const banners = await Promise.all(
    players.map(({ page }) =>
      page
        .locator('.radio-banner', { hasText: line })
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(
          () => true,
          () => false,
        ),
    ),
  );
  await sleep(400); // past the banner's fade-in
  await Promise.all(
    players.map(({ page }, i) => capture(page, i === 0 ? 'nudge.png' : 'nudge-phone.png')),
  );
  const shown = players.map(({ name }, i) => `${name} ${banners[i] ? 'up' : '!! missing'}`);
  console.log(
    `nudge.png          the Leitstelle at "${armed}" after ${seconds(Date.now() - from)} of ` +
      `quiet waited for: „${line}"; banner ${shown.join(', ')}`,
  );
  if (!banners.every(Boolean)) {
    fail('nudge.png: the Leitstelle\'s line is not in every banner');
  }
  await checkRadioVoice(first, listening, `the Leitstelle's nudge at "${armed}"`, line);
}

/**
 * An emergency closes whatever a player has open, and nothing reopens by
 * itself. The walkthrough works no console and mans no valve, so it waits
 * the emergency out and presses E again at the source `target`. Returns how
 * long that took, in ms; throws when `overlay` closed with no emergency on or
 * stays shut after it.
 */
async function reopenAfterEmergency(reader, overlay, target) {
  const { page, seen, name: who } = reader;
  const sabotage = seen.view.map.sabotage;
  if (sabotage === null) {
    throw new Error(`${who}: the book closed while waiting for a note, with no emergency on`);
  }
  const from = Date.now();
  const onTop =
    sabotage.relay === undefined
      ? 'valves'
      : (await page.locator('.relay-modal').isVisible())
        ? 'relay console up'
        : '!! no relay console';
  const over = await until(
    () => seen.view.map.sabotage === null,
    Math.max(0, sabotage.endsAt - Date.now()) + 10_000,
  );
  if (!over || !(await interactUntil(reader, overlay, target))) {
    throw new Error(`${who}: "${sabotage.label}" closed the book, and it did not open again after`);
  }
  console.log(
    `emergency          ${who}: "${sabotage.label}" closed the book (${onTop}), ` +
      'E opened it again after it',
  );
  return Date.now() - from;
}

/**
 * Whether the crew knows of an open source printing the armed station's rules. Where it does
 * not yet, `seen`'s player goes looking where the mission may lay one — each such spot in turn,
 * the shortest walk first — till its view knows one: nobody finds a source from across the room
 * (core discovery.ts).
 */
async function lookForRules(page, seen) {
  const armed = seen.view.map.stations.find((s) => s.status === 'armed')?.puzzleId;
  const known = () =>
    seen.view.map.manuals.some((m) => m.known && m.opened && m.puzzleIds.includes(armed));
  if (armed === undefined || known()) {
    return known();
  }
  const from = tileOf(seen);
  const spots = (await definitionOf(seen.view)).map.manuals
    .filter((manual) => manual.puzzleIds.includes(armed))
    .flatMap((manual) => manual.spots)
    .map((spot) => ({ spot, path: from === null ? null : route(seen.view.map, from, spot) }))
    .filter(({ path }) => path !== null)
    .sort((a, b) => a.path.length - b.path.length);
  for (const { spot } of spots) {
    if ((await walkNear(page, seen, spot)) && (await until(known, 1500))) {
      return true;
    }
  }
  return known();
}

/**
 * hint-*.png: at a source covering the open station, a player asks the last
 * crew for a note in the book's margin — while it is still held back, once it
 * may be asked for, and with the note written in; the other player hears it
 * on the radio meanwhile. Where the crew has come across no such source yet,
 * the player goes looking for one first (`lookForRules`). False when none is
 * in this player's reach.
 */
async function captureNotes(page, seen, who, other) {
  await lookForRules(page, seen);
  const armed = seen.view.map.stations.find((s) => s.status === 'armed')?.puzzleId;
  const source = nearestManual(seen);
  const covers = source !== null && source.puzzleIds.includes(armed);
  if (!covers || !(await walkNear(page, seen, source))) {
    return false;
  }
  const reader = { page, seen, name: who };
  const target = sourceTarget(source);
  const overlay = page.locator('.reading-modal');
  if (!(await interactUntil(reader, overlay, target))) {
    throw new Error(`${who} stands at "${source.id}", but no .reading-modal opened after ${TRIES}`);
  }
  const ask = overlay.locator('.note-ask');
  await ask.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
  if ((await ask.count()) === 0) {
    throw new Error(`${who} reads "${source.id}", but no .note-ask beside the open station`);
  }
  await capture(page, 'hint-waiting.png');
  let label = (await ask.innerText()).trim();
  console.log(`hint-waiting.png   ${who}: "${label}"`);

  // The last shift's notes are held back for 45 s after a station opens.
  let readyBy = Date.now() + 60_000;
  while (!label.startsWith('Notiz der letzten Schicht') && Date.now() < readyBy) {
    await sleep(1000);
    if (!(await overlay.isVisible())) {
      readyBy += await reopenAfterEmergency(reader, overlay, target);
    }
    label = (await ask.innerText()).trim();
  }
  if (!label.startsWith('Notiz der letzten Schicht')) {
    throw new Error(`the ask button still reads "${label}" after 60 s`);
  }
  await capture(page, 'hint-ready.png');
  console.log(`hint-ready.png     ${who}: "${label}"`);

  await ask.click();
  await overlay.locator('.margin-note').first().waitFor({ timeout: 5000 });
  await sleep(600);
  await capture(page, 'hint-revealed.png');
  const notes = await overlay.locator('.margin-note').count();
  const next = (await textOf(ask)) ?? 'none';
  console.log(`hint-revealed.png  ${who}: ${notes} note(s) in the margin, next button "${next}"`);
  await capture(other, 'radio-banner.png');
  const banner = (await other.locator('.radio-banner').count()) > 0 ? 'up' : '!! missing';
  const panel = (await other.locator('.station-modal').count()) > 0;
  console.log(
    `radio-banner.png   the other player: banner ${banner}, ` +
      (panel ? '!! station panel shown away from the station' : 'no station panel away'),
  );
  await noteTheSlip(page, overlay, who);
  return true;
}

/**
 * The last shift's note just written into the slip, taken down with the slip's own
 * „Notieren": the notepad has to come up with it at its foot, under „… · Notizen der letzten
 * Schicht", word for word as the margin holds it, or the run fails. The pad goes away again.
 */
async function noteTheSlip(page, overlay, who) {
  const take = overlay.locator('.note-slip .note-down');
  if ((await take.count()) === 0) {
    console.log(`hint-noted         ${who}: !! no „Notieren" on the slip`);
    fail('hint-noted: the last shift’s slip offers no „Notieren"');
    return;
  }
  await take.click();
  await page.locator('.notepad').waitFor({ state: 'visible', timeout: 3000 });
  const head = await newestCapture(page);
  const written = await page.locator('.notepad .notepad-capture textarea').last().inputValue();
  const margin = await overlay.locator('.margin-note').allInnerTexts();
  const verbatim = written === margin.map((note) => note.trim()).join('\n');
  const named = (head ?? '').endsWith(' · Notizen der letzten Schicht');
  console.log(
    `hint-noted         ${who}: ${named ? '' : '!! '}„${head}", ` +
      `${margin.length} note(s) ${verbatim ? 'word for word' : '!! not as the margin has them'}`,
  );
  if (!named || !verbatim) {
    fail('hint-noted: the slip’s notes did not come into the notepad as written');
  }
  await padAway(page);
}

/**
 * hint-*.png from the first of two players who reaches a source on the open
 * station, `first` before `second`; a log line when neither does.
 */
async function askForNotes(first, second) {
  if (await captureNotes(first.page, first.seen, first.name, second.page)) {
    return;
  }
  console.log(
    `hint-*.png         ${first.name}: no source on the open station in reach — ` +
      `${second.name} asks`,
  );
  if (!(await captureNotes(second.page, second.seen, second.name, first.page))) {
    skip('hint-*.png', 'no source on the open station in reach of either');
  }
}

/** The HUD's Info button: in the crew strip, or in the row a phone held sideways folds it into. */
const INFO_BUTTON = '.hud-info:not(.hud-notes):not(.hud-mic)';
/** The Laborkennung's chip in the HUD: in the crew strip, or in the row. */
const CHIP = '.hud .edgework, .stage-row .edgework';

/**
 * sign.png: a player has just read the Laborkennung — the note up, the chip
 * in the HUD. The note waits for the briefing to end and for the radio lines
 * queued before it, so this may take a while.
 */
async function captureSign(page, who) {
  const note = await page
    .locator('.toast')
    .waitFor({ state: 'visible', timeout: 25_000 })
    .then(
      () => true,
      () => false,
    );
  await sleep(400); // past its fade-in
  await capture(page, 'sign.png');
  const chip = (await page.locator(CHIP).count()) > 0;
  console.log(
    `sign.png           ${who}: note ${note ? 'up' : '!! missing'}, ` +
      `chip in the HUD ${chip ? 'shown' : '!! missing'}`,
  );
}

/**
 * menu-missions.png on a device that has won no run: the tutorial's card — and no other —
 * says „Erster Einsatz? Hier starten" in a line of its own over its title, nothing stuck over
 * it, and no card carries the browser's own tooltip; or the run fails.
 */
async function checkFirstRunCard(page) {
  const card = page.locator('.mission', { hasText: 'Tutorial' });
  const label = await textOf(card.locator('.mission-text > .mission-first'));
  const labels = await page.locator('.mission-first').count();
  const tooltips = await page.locator('.menu-panel [title]').count();
  const said = label === null ? '!! no line on the tutorial' : `„${label}" on the tutorial`;
  console.log(
    `menu-missions.png  a first run: ${said}` +
      (labels === 1 ? '' : `, !! ${labels} lines in all`) +
      (tooltips === 0 ? ', no tooltips' : `, !! ${tooltips} tooltips`),
  );
  if (label === null || labels !== 1 || tooltips !== 0) {
    fail('menu-missions.png: the tutorial’s card does not say „Erster Einsatz?" alone');
  }
}

/** The menu's scene off the page's probe (client world/menu/stage.ts); null without one. */
const sceneOf = (page) =>
  page.evaluate(() => {
    const scene = globalThis.__escapelab?.scene;
    return scene === undefined ? null : { ...scene };
  });

/** How long a mission picked anew takes to come in over the scene before (client drift.ts). */
const SCENE_FADE_MS = 600;

/**
 * The menu's scene once it is baked for the window's `w` × `h` device pixels (any size where
 * none is given) — of mission `missionId` where one is given — and has come in; null, and the
 * run failed, where it never is.
 */
async function sceneBaked(page, { w = null, h = null, missionId = null } = {}) {
  const want = { w, h, missionId };
  const baked = await page
    .waitForFunction(
      (asked) => {
        const scene = globalThis.__escapelab?.scene;
        const bake = scene?.baked;
        const fits = (b) => asked.w === null || (b.w === asked.w && b.h === asked.h);
        const sized = bake != null && fits(bake);
        return sized && (asked.missionId === null || scene.missionId === asked.missionId);
      },
      want,
      { timeout: 15_000 },
    )
    .then(
      () => true,
      () => false,
    );
  await sleep(SCENE_FADE_MS + 200);
  const scene = await sceneOf(page);
  if (!baked) {
    fail(`menu: no scene baked for ${JSON.stringify(want)}: ${JSON.stringify(scene)}`);
  }
  return baked ? scene : null;
}

/** What the log says of the menu's scene. */
function sceneText(scene) {
  if (scene === null || scene.baked === null) {
    return '!! no scene';
  }
  const { baked } = scene;
  return (
    `the scene: ${scene.missionId}'s lab baked for ${baked.w}×${baked.h} ` +
    `(box ${baked.boxW}×${baked.boxH}) in ${Math.round(scene.bakeMs ?? 0)} ms, ` +
    `${scene.paints} frames drawn, the drift at ${scene.progress.toFixed(2)}`
  );
}

/** The text of the control in the focus on `page`. */
const focusedText = (page) =>
  page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');

/**
 * The menu walked by the keys as a player walks it: an arrow down and up the items, Enter
 * opening „Einsatz starten" with the picked mission's card in the focus, Esc back out of it
 * with the focus on the item again — or the run fails.
 */
async function walkMenuKeys(page) {
  await page.locator('.menu-item').first().focus();
  await page.keyboard.press('ArrowDown');
  const down = await focusedText(page);
  await page.keyboard.press('ArrowUp');
  const up = await focusedText(page);
  await page.keyboard.press('Enter');
  await page.locator('.menu-panel').waitFor({ timeout: 5000 });
  const card = await page.evaluate(
    () => document.activeElement?.matches('.menu-panel .mission-selected') === true,
  );
  await closeMenuPanel(page);
  const back = await focusedText(page);
  const walked = down === 'Beitreten' && up === 'Einsatz starten' && card;
  console.log(
    `menu keys          ↓ ${down} · ↑ ${up} · Enter: the picked card ` +
      `${card ? 'in the focus' : '!! not in the focus'} · Esc: back on ${back}`,
  );
  if (!walked || back !== 'Einsatz starten') {
    fail(`menu keys: ↓ ${down}, ↑ ${up}, the card focused ${card}, Esc back on ${back}`);
  }
}

/**
 * The menu's sound off the page's probe (client world/menuSound.ts): its state, what sounds — an
 * element of the piece heard playing, not a pass laid — and what played.
 */
const menuSoundOf = (page) =>
  page.evaluate(
    () => globalThis.__escapelab?.menuSound ?? { state: '!! no probe', theme: false, played: {} },
  );

/** The music's manifest as the page's server serves it (public/music/manifest.json); {} if none. */
const musicListOf = (page) =>
  page.evaluate(() =>
    globalThis.fetch('/music/manifest.json').then(
      (res) => (res.ok ? res.json() : {}),
      () => ({}),
    ),
  );

/** How long a piece listed may take to sound once wanted, ms: its file, a bar, its crossing. */
const SOUND_WITHIN_MS = 8000;

/** The menu's probe on `page` once `heard` holds of it, or as it stands after SOUND_WITHIN_MS. */
async function menuSoundOnce(page, heard) {
  const until = Date.now() + SOUND_WITHIN_MS;
  let probe = await menuSoundOf(page);
  while (!heard(probe) && Date.now() < until) {
    await sleep(100);
    probe = await menuSoundOf(page);
  }
  return probe;
}

/** What the log says of the menu's music: sounding, not rendered, or listed and never heard. */
function themeText(theme, listed) {
  if (theme) return 'the theme sounding';
  return listed ? '!! the theme listed, never heard' : 'no theme (awaiting its render?)';
}

/** What the log says of the menu's sound: its state, its theme (`listed` or not) and its hum. */
function menuSoundText({ state, theme, hum }, listed) {
  const humSaid = hum ? 'the hum' : 'no hum (awaiting its render?)';
  return `${state}, ${themeText(theme, listed)}, ${humSaid}`;
}

/** Whether the speaker's lamp is lit on `page`: the menu's sound waits for a gesture. */
const lampLit = async (page) => (await page.locator('.sound-toggle--waiting').count()) === 1;

/**
 * The menu's sound before the first key and after it: waiting, the speaker's lamp lit, until a
 * key lets the browser's sound start — then playing, the lamp out, and the theme sounding within
 * SOUND_WITHIN_MS where the music's manifest (`list`) has it; or the run fails.
 */
async function menuSoundAtFirstKey(page, press, list) {
  const before = await menuSoundOf(page);
  const litBefore = await lampLit(page);
  await press();
  const listed = list['menu-theme'] !== undefined;
  const after = await menuSoundOnce(page, (probe) => !listed || probe.theme);
  const litAfter = await lampLit(page);
  console.log(
    `menu sound         before a key: ${before.state}, the speaker’s lamp ` +
      `${litBefore ? 'lit' : '!! out'}; after it: ${menuSoundText(after, listed)}, the lamp ` +
      (litAfter ? '!! still lit' : 'out'),
  );
  if (before.state !== 'waiting' || !litBefore || after.state !== 'playing' || litAfter) {
    fail(`menu sound: ${before.state} before the first key, ${after.state} after it`);
  }
  heardWhereListed(after.theme, listed, 'the theme');
}

/** Fails where the music's manifest lists a piece (`listed`) the menu's sound never `heard`. */
function heardWhereListed(heard, listed, what) {
  if (listed && !heard) fail(`menu sound: ${what} is listed, and never sounded`);
}

/**
 * Whether this browser plays the score's pieces — AAC in .m4a, as a keep cuts them — asked once,
 * where the music's manifest (`list`) names a piece so kept: canPlayType's answer, said; none
 * fails the run, for the game's music would be silent in it.
 */
async function checkPieceCodec(page, list) {
  const pieces = Object.values(list).filter((entry) => entry?.file?.endsWith('.m4a'));
  if (pieces.length === 0) {
    console.log('music codec        no piece of the score kept yet: every recording an MP3');
    return;
  }
  const answer = await page.evaluate(() =>
    new globalThis.Audio().canPlayType('audio/mp4; codecs="mp4a.40.2"'),
  );
  console.log(
    `music codec        ${pieces.length} pieces of the score as AAC in .m4a: canPlayType says ` +
      (answer === '' ? '!! nothing' : `„${answer}"`),
  );
  if (answer === '') fail('music codec: this browser plays no AAC in MP4, the score’s pieces');
}

/**
 * The menu's sound in the lobby on `page`, and whether the music's manifest (`list`) has the
 * lobby's own piece (`listed`): read once that piece sounds where it is listed — a bar and its
 * crossing after the doors close — else as it stands.
 */
async function lobbySoundOf(page, list) {
  const listed = list.lobby !== undefined;
  const probe = await menuSoundOnce(page, (heard) => !listed || heard.piece === 'lobby');
  return { ...probe, listed };
}

/**
 * The lobby's sounds on the host's page — the music kept in the lobby (`lobby`, read there by
 * `lobbySoundOf`): its own piece of the score, sounding where the music's manifest lists it, or
 * the theme at the lobby's weight where that awaits its render — the round's chime as it came up,
 * the ready chirp as the guest said ready — and the menu's sound gone once the run has started;
 * or the run fails.
 */
async function menuSoundAfterStart(page, lobby) {
  const { state, played } = await menuSoundOf(page);
  const { opened = 0, ready = 0 } = played;
  const kept = keptInLobby(lobby);
  console.log(
    `menu sound         in the lobby ${kept ? `playing ${lobbyMusic(lobby)}` : '!! not kept'}` +
      `, the round's chime ${opened}×, the ready chirp ${ready}×; the run started: ${state}`,
  );
  if (!kept || state !== 'off' || opened < 1 || ready < 1) {
    fail(`menu sound: ${lobby.state} in the lobby, ${state} in the run, ${opened}×, ${ready}×`);
  }
  heardWhereListed(lobby.piece === 'lobby', lobby.listed, 'the lobby’s piece');
}

/** What the lobby plays, as the log says it: its own piece, or the theme at its weight. */
const lobbyMusic = (lobby) =>
  lobby.piece === 'lobby' ? 'its own piece' : 'the theme at the lobby’s weight';

/** Whether the menu's sound played on in the lobby (`lobby`: the probe there). */
const keptInLobby = (lobby) => lobby.state === 'playing' && lobby.place === 'lobby';

/** The end card's music off the page's probe (client world/endTheme.ts). */
const endThemeOf = (page) =>
  page.evaluate(() => globalThis.__escapelab?.endTheme ?? { asked: '!! no probe', playing: null });

/** The menu's quiet window holds the screen's pace under SHOTS_SOFTWARE_GL, ms p95. */
const MENU_P95_MS = 16.8;

/**
 * menu.png: the start screen as a game's menu over its living scene — the lit lab of the first
 * mission baked for the window and drifting, the title, the menu, the profile — walked by the
 * keys (`walkMenuKeys`), its music heard as the music's manifest has it; its quiet window, the
 * scene drifting, has to keep the screen's pace under SHOTS_SOFTWARE_GL (MENU_P95_MS) and the
 * gate's allowance anyway; at 1280×720 it has to fit as at 1440×820 (menu-1280.png), the scene
 * baked anew for each. Returns the music's manifest, which the lobby's check reads too.
 */
async function captureMenu(page) {
  const list = await musicListOf(page);
  const scene = await sceneBaked(page, { w: SIZES[0].width, h: SIZES[0].height });
  await capture(page, 'menu.png');
  console.log(`menu.png           ${sceneText(scene)}`);
  await menuSoundAtFirstKey(page, () => walkMenuKeys(page), list);
  await checkPieceCodec(page, list);
  const look = await frameWindow(page, 'on the menu, its scene drifting', () => sleep(SAMPLE_MS));
  if (SOFTWARE_GL && look !== null && look.p95 > MENU_P95_MS) {
    const reached = `${look.p95.toFixed(1)} ms p95 at ${loadText(look.load)}`;
    fail(`menu: its window reached ${reached}, over ${MENU_P95_MS}`);
  }
  await overflow(page, 'menu @ 1440x820');
  await page.setViewportSize({ width: 1280, height: 720 });
  await sceneBaked(page, { w: 1280, h: 720 });
  await overflow(page, 'menu @ 1280x720');
  await capture(page, 'menu-1280.png');
  await page.setViewportSize(SIZES[0]);
  await sceneBaked(page, { w: SIZES[0].width, h: SIZES[0].height });
  return list;
}

/**
 * „Einsatz starten" open over the menu, the mission cards in it (menu-missions.png, screens');
 * the walkthrough's mission is picked and „Runde eröffnen" opens its room — where screens is on,
 * the picked lab coming in as the scene behind first, and the door wipe caught on the way
 * (`pickedAndOpened`).
 */
async function openMissionRound(page) {
  await openMenuPanel(page, 'Einsatz starten');
  const cards = () => page.locator('.mission').first().waitFor({ timeout: 10_000 });
  await inGroup('screens', () => shootMissions(page), cards);
  const card = page.locator('.mission', { hasText: MISSION }).first();
  if ((await card.count()) === 0) {
    throw new Error(`no mission card reads "${MISSION}" — SHOTS_MISSION has to name one`);
  }
  await card.click();
  const open = () => page.locator('.menu-panel button', { hasText: 'Runde eröffnen' }).click();
  await inGroup('screens', () => pickedAndOpened(page, open), open);
}

/** menu-missions.png: the mission cards of „Einsatz starten" on a first run (checkFirstRunCard). */
async function shootMissions(page) {
  await sleep(300);
  await capture(page, 'menu-missions.png');
  await checkFirstRunCard(page);
}

/**
 * The walkthrough's mission picked, its lab coming in as the menu's scene, then `open` — „Runde
 * eröffnen" — behind the door wipe (menu-to-lobby.png, `captureDoors`).
 */
async function pickedAndOpened(page, open) {
  const scene = await sceneBaked(page, { missionId: MISSION.toLowerCase() });
  console.log(`menu-missions.png  ${MISSION} picked: ${sceneText(scene)}`);
  await captureDoors(page, open);
}

/** The door wipe's close, ms (client screens/DoorWipe.tsx `CLOSE_MS`). */
const DOOR_CLOSE_MS = 170;
/** How far into their close menu-to-lobby.png holds the doors, ms: about two thirds shut. */
const DOOR_SHOT_MS = 130;

/**
 * In the page: holds the door wipe `ms` into its close, its leaves paused there, and keeps back
 * the timer that would open them (`close` ms) — holdPanelFade's way with a device's fade.
 */
function holdDoors({ ms, close }) {
  const style = document.createElement('style');
  style.id = 'shots-door-hold';
  style.textContent =
    '.door-wipe--closing .door-leaf ' +
    `{ animation-delay: -${ms}ms !important; animation-play-state: paused !important; }`;
  document.head.append(style);
  // The browser's own setTimeout throws unless it is called on the window.
  const plain = globalThis.setTimeout;
  const kept = [];
  globalThis.__doorHold = { plain, kept };
  globalThis.setTimeout = (run, delay, ...args) => {
    if (delay !== close) {
      return plain.call(globalThis, run, delay, ...args);
    }
    kept.push(() => run(...args));
    return plain.call(globalThis, () => undefined, 0);
  };
}

/** In the page: lets the doors held by holdDoors go — their timer runs now, they open. */
function releaseDoors() {
  const hold = globalThis.__doorHold;
  document.getElementById('shots-door-hold')?.remove();
  if (hold !== undefined) {
    globalThis.setTimeout = hold.plain;
    delete globalThis.__doorHold;
    for (const run of hold.kept) {
      hold.plain.call(globalThis, run, 0);
    }
  }
}

/** How far the left leaf has shut its half of the window, 0 to 1; null without doors. */
const doorShut = (page) =>
  page.evaluate(() => {
    const leaf = document.querySelector('.door-leaf--left');
    return leaf === null ? null : leaf.getBoundingClientRect().right / (globalThis.innerWidth / 2);
  });

/**
 * „Runde eröffnen" pressed (`open`) with the door wipe held DOOR_SHOT_MS into its close over the
 * menu (holdDoors), shot as menu-to-lobby.png, then let go until the lobby stands behind them and
 * they have gone: whether the doors came, how far they had shut, 0 to 1, and whether the menu
 * still stood under them, the lobby not yet there, while they closed.
 */
async function shootHeldDoors(page, open) {
  await page.evaluate(holdDoors, { ms: DOOR_SHOT_MS, close: DOOR_CLOSE_MS });
  await open();
  const came = await page
    .locator('.door-wipe--closing')
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  await sleep(150);
  const shut = (await doorShut(page)) ?? 0;
  const menu = await page.locator('.menu').count();
  const lobby = await page.locator('.lobby').count();
  await capture(page, 'menu-to-lobby.png');
  await page.evaluate(releaseDoors);
  await page.locator('.lobby').waitFor({ timeout: 10_000 });
  await page.locator('.door-wipe').waitFor({ state: 'detached', timeout: 5000 });
  return { came, shut, held: menu === 1 && lobby === 0 };
}

/** Whether the scene `after` is the scene `before` drifting on: the same lab, more frames drawn. */
const driftsOn = (before, after) =>
  before !== null &&
  after !== null &&
  after.missionId === before.missionId &&
  after.paints > before.paints;

/** What the log says of the held doors and of the scene behind the lobby once they have gone. */
function doorShotText({ came, shut, held }, before, after, behind) {
  const over = held ? 'the menu' : '!! the lobby';
  const doors = came ? `${Math.round(shut * 100)} % shut over ${over}` : '!! no doors';
  const scene = driftsOn(before, after)
    ? `${after.missionId}'s lab drifting on (${before.paints} → ${after.paints} frames)`
    : '!! a scene anew';
  return (
    `the doors held ${DOOR_SHOT_MS} of their ${DOOR_CLOSE_MS} ms close: ${doors}; the lobby ` +
    `over ${scene}${behind ? '' : ' !! not behind it'}`
  );
}

/**
 * menu-to-lobby.png: the door wipe from the menu to the lobby caught mid-close, the menu between
 * its leaves (shootHeldDoors); then the lobby has to stand over the menu's scene, drifting on —
 * not one made anew — or the run fails.
 */
async function captureDoors(page, open) {
  const before = await sceneOf(page);
  const held = await shootHeldDoors(page, open);
  const after = await sceneOf(page);
  const behind = (await page.locator('.menu-backdrop--lobby:visible').count()) === 1;
  console.log(`menu-to-lobby.png  ${doorShotText(held, before, after, behind)}`);
  if (!held.came || !held.held || !driftsOn(before, after) || !behind) {
    fail('menu-to-lobby.png: no doors over the menu, or no scene drifting on behind the lobby');
  }
}

/**
 * In the page — from its first moment as well, as an init script: tells the walkthrough of the
 * door wipe as it goes (`__doorsNote`, noteDoorsOn) — its doors closing, shut, opening, gone —
 * when, and how long its leaves' animations ask for.
 */
function watchDoors() {
  let was = 'gone';
  const note = () => {
    const doors = document.querySelector('.door-wipe');
    const stages = ['closing', 'shut', 'opening'];
    const state = stages.find((each) => doors?.classList.contains(`door-wipe--${each}`)) ?? 'gone';
    if (state === was) {
      return;
    }
    was = state;
    const leaves = [...(doors?.querySelectorAll('.door-leaf') ?? [])];
    const lengths = leaves.flatMap((leaf) =>
      leaf.getAnimations().map((move) => move.effect.getTiming().duration),
    );
    globalThis.__doorsNote({ state, at: Date.now(), lengths });
  };
  const observer = new globalThis.MutationObserver(note);
  observer.observe(document, { subtree: true, childList: true, attributes: true });
}

/**
 * The door wipes on `page` from now on, as the page tells of them (watchDoors) — on every page it
 * loads as well: the stages as they come, `{ state, at, lengths }`.
 */
async function noteDoorsOn(page) {
  const marks = [];
  await page.exposeFunction('__doorsNote', (mark) => marks.push(mark));
  await page.addInitScript(watchDoors);
  await page.evaluate(watchDoors);
  return marks;
}

/** The stages of the wipe noted in `marks` once its doors have gone — taken out of the list. */
async function doorsGone(marks) {
  for (let waited = 0; waited < 10_000; waited += 50) {
    if (marks.length > 1 && marks.at(-1).state === 'gone') {
      break;
    }
    await sleep(50);
  }
  return marks.splice(0);
}

/** How long the wipe in `marks` stood from stage `from` to stage `to`, ms; null without both. */
function doorSpan(marks, from, to) {
  const start = marks.find((mark) => mark.state === from);
  const end = marks.find((mark) => mark.state === to && mark.at >= (start?.at ?? Infinity));
  return start === undefined || end === undefined ? null : end.at - start.at;
}

/** The lengths the wipe in `marks` asked of its leaves' animations, ms, each once. */
const doorLengths = (marks) => [...new Set(marks.flatMap((mark) => mark.lengths))];

/**
 * Logs Cem's door wipes — into the lobby (`there`): closed and opened; out of it (`back`): shut
 * over the lobby, the page loaded anew, opened on the menu — or fails the run where one did not
 * come or go, or its leaves ask for more than 400 ms.
 */
function timeDoors(there, back) {
  const close = doorSpan(there, 'closing', 'opening');
  const open = doorSpan(there, 'opening', 'gone');
  const shut = doorSpan(back, 'closing', 'shut');
  const reopen = doorSpan(back, 'opening', 'gone');
  const asked = [...doorLengths(there), ...doorLengths(back)];
  const into = close === null || open === null ? '!! no doors' : `${close} + ${open} ms`;
  const out = shut === null || reopen === null ? '!! no doors' : `${shut} ms to shut, ${reopen} ms`;
  console.log(
    `door wipe          into the lobby ${into}; back to the menu ${out} to open on the page ` +
      `loaded anew (the sheet's ${doorLengths(there).join(' + ')} ms)`,
  );
  if ([close, open, shut, reopen].includes(null) || asked.some((ms) => ms > 400)) {
    fail(`door wipe: into the lobby ${into}; back to the menu ${out}`);
  }
}

/**
 * The menu's windows on a phone held sideways: today's largest phones and a common one, then
 * what an iPhone's notch leaves of 844 and 667 px (memory: phone-safe-area-insets).
 */
const MENU_SIDEWAYS = [
  { width: 932, height: 430, shot: 'menu-phone-932.png' },
  { width: 844, height: 390 },
  { width: 750, height: 369 },
  { width: 667, height: 375 },
];

/**
 * In the page: how the menu stands in its window — the controls under a fingertip's 44 px, the
 * items running out of the menu's column or the window, where the menu, the title and the
 * profile stand, and how far the page runs out sideways.
 */
function menuLayout() {
  const box = (selector) => document.querySelector(selector).getBoundingClientRect();
  const body = box('.menu-body');
  const floor = Math.min(body.bottom, globalThis.innerHeight) + 0.5;
  const controls = [...document.querySelectorAll('.menu button, .menu input, .menu summary')];
  const shown = controls.filter((el) => el.getBoundingClientRect().height > 0);
  const short = shown
    .filter((el) => el.getBoundingClientRect().height < 43.5)
    .map((el) => el.textContent.trim() || el.className);
  const clipped = [...document.querySelectorAll('.menu-item')]
    .filter((el) => el.getBoundingClientRect().bottom > floor)
    .map((el) => el.textContent.trim());
  return {
    width: globalThis.innerWidth,
    targets: shown.length,
    short,
    clipped,
    navRight: box('.menu-list').right,
    headLeft: box('.menu-head').left,
    headBottom: box('.menu-head').bottom,
    chipLeft: box('.profile-chip').left,
    chipTop: box('.profile-chip').top,
    sideways: document.documentElement.scrollWidth - globalThis.innerWidth,
  };
}

/** What the log says of `look` (menuLayout) — and what falls short, '' where nothing does. */
function menuLayoutText(look, upright) {
  // Sideways the menu stands left of the title and the profile, the scene beside it 40 % wide.
  const right = Math.min(look.headLeft, look.chipLeft);
  const placed = upright
    ? look.chipTop >= look.headBottom - 1
    : look.navRight <= right && look.width - look.navRight >= look.width * 0.4;
  const where = upright
    ? 'the profile under the title'
    : `the menu left (to ${Math.round(look.navRight)} px), the title and the profile right`;
  const faults = [
    placed ? '' : `!! not laid out so: ${JSON.stringify(look)}`,
    look.short.length === 0 ? '' : `!! under 44 px: ${look.short.join(', ')}`,
    look.clipped.length === 0 ? '' : `!! cut off: ${look.clipped.join(', ')}`,
    look.sideways <= 0 ? '' : `!! +${look.sideways}px sideways`,
  ].filter((fault) => fault !== '');
  return { text: `${where}, ${look.targets} targets ≥ 44 px`, faults: faults.join('; ') };
}

/** Logs the menu's layout on `page` (menuLayoutText); fails the run where it falls short. */
async function judgeMenuLayout(page, label, upright) {
  const { text, faults } = menuLayoutText(await page.evaluate(menuLayout), upright);
  console.log(`${label.padEnd(19)}${text}${faults === '' ? '' : `; ${faults}`}`);
  if (faults !== '') {
    fail(`${label}: ${faults}`);
  }
}

/**
 * The menu on the guest's phone: upright, the profile under the title (menu-phone.png, shot
 * before); then turned, in every window of MENU_SIDEWAYS, the menu left in its column whole and
 * the scene beside it, the title and the profile over it (menu-phone-932.png) — every target a
 * fingertip's at least, nothing cut off, nothing out sideways; then upright again.
 */
async function checkMenuPhones(page) {
  await judgeMenuLayout(page, 'menu-phone.png', true);
  for (const { width, height, shot } of MENU_SIDEWAYS) {
    await page.setViewportSize({ width, height });
    const scene = await sceneBaked(page, { w: width, h: height });
    if (shot !== undefined) {
      await capture(page, shot);
    }
    await judgeMenuLayout(page, shot ?? `menu @ ${width}x${height}`, false);
    if (scene?.baked?.w !== width) {
      fail(`menu @ ${width}x${height}: no scene beside the menu (${sceneText(scene)})`);
    }
  }
  await page.setViewportSize(SIZES[2]);
  await sceneBaked(page, { w: SIZES[2].width, h: SIZES[2].height });
}

/** A side page at the laptop's size for a capture of the menu, named `name`. */
async function sidePage(name, contexts) {
  const context = await browser.newContext({ viewport: SIZES[0] });
  contexts.push(context);
  const page = await openPage(context, name);
  page.on('pageerror', (e) => console.log(`[${name} error]`, e.message));
  await page.goto(traced(BASE));
  await page.getByPlaceholder('z. B. Anna').fill(name);
  return page;
}

/**
 * menu-open-rounds.png: a second crew opens a round of the other mission — Cem, in a window of
 * his own — and a fourth page's „Offene Runden" lists both rooms, each of their crew standing
 * there as a figure in their colour, painted; or the run fails.
 */
async function captureOpenRounds() {
  const other = MISSION === 'Blackout' ? 'Systemcheck' : 'Blackout';
  const contexts = [];
  try {
    const cem = await sidePage('Cem', contexts);
    const marks = await noteDoorsOn(cem);
    await openRound(cem, other);
    const there = await doorsGone(marks);
    await cem.locator('.room-code strong').waitFor({ timeout: 10_000 });
    const dora = await sidePage('Dora', contexts);
    await openMenuPanel(dora, 'Offene Runden');
    await dora.locator('.menu-panel .room').nth(1).waitFor({ timeout: 10_000 });
    await sleep(800);
    const rooms = await dora.locator('.menu-panel .room').count();
    const figures = await dora.locator('.menu-panel .room-member canvas').count();
    const painted = await dora.evaluate(() => globalThis.__escapelab?.figures?.length ?? 0);
    await capture(dora, 'menu-open-rounds.png');
    console.log(
      `menu-open-rounds.png ${rooms} rooms, ${figures} of their crew standing as figures, ` +
        `${painted} figures painted on the page`,
    );
    if (rooms < 2 || figures < 3 || painted < figures) {
      fail(`menu-open-rounds.png: ${rooms} rooms, ${figures} figures, ${painted} painted`);
    }
    await cem.locator('.lobby button', { hasText: 'Raum verlassen' }).click();
    const back = await doorsGone(marks);
    await cem.locator('.menu-item').first().waitFor({ timeout: 10_000 });
    timeDoors(there, back);
  } finally {
    for (const context of contexts) {
      await context.close();
    }
  }
}

/**
 * menu-join.png: the audience's „Beitreten" with the room's code typed in small letters; the field
 * has to show it in capitals and be no field a browser fills from its passwords — or the run
 * fails. Then „Zuschauen" beside it.
 */
async function watchFromMenu(page, code) {
  await openMenuPanel(page, 'Beitreten');
  const field = page.getByLabel('Raumcode');
  await field.fill(code.toLowerCase());
  const look = await field.evaluate((input) => ({
    value: input.value,
    autocomplete: input.getAttribute('autocomplete'),
    name: input.getAttribute('name'),
    type: input.getAttribute('type'),
  }));
  await capture(page, 'menu-join.png');
  const named = look.type === 'text' && look.name === 'room';
  const plain = look.value === code && look.autocomplete === 'off' && named;
  console.log(
    `menu-join.png      the code typed in small letters stands as „${look.value}"; ` +
      `autocomplete ${look.autocomplete}, name ${look.name}, type ${look.type}`,
  );
  if (!plain) {
    fail(`menu-join.png: the code field shows ${JSON.stringify(look)}`);
  }
  await page.locator('.join-with-code button', { hasText: 'Zuschauen' }).click();
}

/**
 * menu-bound.png: a new tab of Anna's browser while her run stands paused for Ben — the menu
 * opens on the run's card, „EINSATZ PAUSIERT", first and lit, every other item dimmed, the line
 * that no other room opens under it; or the run fails. The tab is closed again.
 */
async function captureBound(anna) {
  const page = await openPage(anna.context, 'drill Anna tab');
  try {
    await page.goto(traced(BASE));
    const card = page.locator('.menu-list .bound--run');
    await card.waitFor({ state: 'visible', timeout: 10_000 });
    await sleep(800);
    const kicker = await textOf(card.locator('.bound-kicker'));
    const dimmed = (await page.locator('.menu-list--bound').count()) === 1;
    const first = await page.evaluate(
      () => document.querySelector('.menu-list')?.firstElementChild?.matches('.bound') === true,
    );
    const line = await textOf(page.locator('.bound-line'));
    await capture(page, 'menu-bound.png');
    console.log(
      `menu-bound.png     Anna's new tab: „${kicker}" ${first ? 'first' : '!! not first'}, ` +
        `the rest ${dimmed ? 'dimmed' : '!! lit'}; „${line}"`,
    );
    if (kicker !== 'EINSATZ PAUSIERT' || !first || !dimmed || line === null) {
      fail(`menu-bound.png: „${kicker}", first ${first}, dimmed ${dimmed}, line „${line}"`);
    }
  } finally {
    await page.close();
  }
}

/**
 * lobby-title.png: a title comes on as a phosphor screen does, unsteady for a moment, once a
 * page load — the game's on the start screen as the page loads (`joined` says whether it did),
 * then the mission's the first time the lobby shows; shot once it has come on. Fails where
 * either did not come on.
 */
async function captureLobbyTitle(page, joined) {
  const title = page.locator('.lobby-head h1');
  await title.waitFor({ timeout: 10_000 });
  const comesOn = (await title.getAttribute('class'))?.includes('phosphor-title') === true;
  const animation = await title.evaluate((el) => globalThis.getComputedStyle(el).animationName);
  await sleep(1300); // past the 1.2 s it takes
  await capture(page, 'lobby-title.png');
  const start = joined ? 'as the page loaded' : '!! not';
  console.log(
    `lobby-title.png    the start screen's title came on ${start}` +
      `; the lobby's „${await textOf(title)}" ` +
      (comesOn ? `came on (${animation}) the first time it showed` : '!! did not come on'),
  );
  if (!joined || !comesOn) {
    fail(`lobby-title.png: the start screen's title came on ${joined}, the lobby's ${comesOn}`);
  }
}

/**
 * lobby-first.png: the host's device has won no run, so the room it opened stands on
 * „entspannt", the lobby saying why under the levels.
 */
async function captureFirstRun(page, seen) {
  const line = page.locator('.lobby-first-run');
  const shown = await line.waitFor({ state: 'visible', timeout: 3000 }).then(
    () => true,
    () => false,
  );
  await capture(page, 'lobby-first.png');
  const level = seen.view?.difficulty ?? 'no view';
  console.log(
    `lobby-first.png    the host's first room on "${level}", ` +
      (shown ? `„${await textOf(line)}"` : '!! no word why'),
  );
  if (level !== 'entspannt' || !shown) {
    fail(`lobby-first.png: a first room on "${level}"${shown ? '' : ', no word why'}`);
  }
}

/**
 * The host picks „Normal" in its lobby, which the walkthrough plays: its drones' flights, clocks
 * and alarm marks are counted at that level. Throws where the room stays on another.
 */
async function pickNormal(page, seen) {
  await page.locator('.level-chip', { hasText: 'Normal' }).click();
  if (!(await until(() => seen.view?.difficulty === 'normal', 5000))) {
    throw new Error(`the host picked „Normal", but the room stays on "${seen.view?.difficulty}"`);
  }
  await sleep(300);
}

/**
 * Turns `player`'s page to `size` and back, and fails the run unless the
 * HUD's Info button lies whole inside the window there: once the sign is
 * read, the Laborkennung's chip may never push it off the screen. Logs
 * whether the chip was up on that page, so a check without it says so.
 */
async function infoInView(player, size, how) {
  const { page, name } = player;
  const before = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: size.height });
  await sleep(700);
  const box = await page.locator(INFO_BUTTON).boundingBox();
  const chip = (await page.locator(CHIP).count()) > 0;
  const inside =
    box !== null &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= size.width + 0.5 &&
    box.y + box.height <= size.height + 0.5;
  const edge = box === null ? 'no Info button' : `right edge ${Math.round(box.x + box.width)}`;
  const where = `${name} @ ${size.width}x${size.height} ${how}, chip ${chip ? 'up' : 'not read'}`;
  console.log(
    `${inside ? 'ok  in view' : '!! cut off '} info button, ${where}: ${edge}/${size.width}`,
  );
  if (!inside) {
    fail(`the Info button is cut off @ ${size.width}x${size.height} for ${name} (${edge})`);
  }
  await page.setViewportSize(before);
  await sleep(400);
}

/** What a phone held sideways shows under its thumbs, CSS px: the pad, the buttons, the map. */
function thumbsLayout() {
  const rect = (selector) => {
    const box = document.querySelector(selector)?.getBoundingClientRect();
    return box === undefined || box.width === 0 ? null : box;
  };
  const canvas = document.querySelector('.world-canvas');
  const map = globalThis.__escapelab?.minimap ?? null;
  const cells = [...document.querySelectorAll('.world-pad-cell')].map((cell) => {
    const box = cell.getBoundingClientRect();
    return Math.min(box.width, box.height);
  });
  return {
    mid: canvas === null ? 0 : canvas.getBoundingClientRect().x + canvas.clientWidth / 2,
    pad: rect('.world-pad')?.toJSON() ?? null,
    thumb: rect('.world-thumb')?.toJSON() ?? null,
    cells,
    minimap: map === null ? null : Math.round(map.mh / map.dpr),
  };
}

/**
 * What a phone held sideways shows of its HUD, CSS px: the objective bar — folded into one row
 * with the crew strip, or not — and the band of world below it, from the bar's foot to the
 * canvas's, inside its 1-px border; the window's height and the canvas's.
 */
function hudLayout() {
  const canvas = document.querySelector('.world-canvas');
  const bar = document.querySelector('.stage-top');
  const box = canvas.getBoundingClientRect();
  const border = (box.height - canvas.clientHeight) / 2;
  const below = Math.max(box.top + border, bar === null ? 0 : bar.getBoundingClientRect().bottom);
  return {
    window: globalThis.innerHeight,
    height: canvas.clientHeight,
    bar: bar === null ? 0 : bar.offsetHeight,
    band: box.bottom - border - below,
    row: document.querySelector('.stage-top .stage-row') !== null,
    strip: document.querySelector('.hud') !== null,
    line: document.querySelector('.stage-top .radio-banner, .stage-top .toast') !== null,
  };
}

/** How much of the window's height the band of world below a phone's HUD row holds at least. */
const PHONE_BAND = 0.65;
/** How tall the HUD's one row on a phone held sideways stands at most, CSS px. */
const PHONE_ROW_PX = 44;

/**
 * The HUD of a phone held sideways (`seen`, hudLayout): what is wrong with it — the objective bar
 * and the crew strip not folded into one row of PHONE_ROW_PX at most, or the band of world below
 * it short of PHONE_BAND of the window's height — and its line for the log.
 */
function rowRules(seen) {
  const share = seen.band / seen.window;
  const percent = (x) => `${(x * 100).toFixed(1)} %`;
  const wrong = [
    (!seen.row || seen.strip) && 'the HUD is not folded into one row',
    seen.bar > PHONE_ROW_PX + 0.5 && `the HUD's row stands ${seen.bar} px`,
    share < PHONE_BAND && `the band holds ${percent(share)} of the window`,
  ];
  const text =
    `${seen.row ? 'one row' : '!! no row'} of ${seen.bar} px; the band ${Math.round(seen.band)} ` +
    `of ${seen.window} px, ${percent(share)} of the window, ` +
    `${percent(seen.band / seen.height)} of the canvas${seen.line ? ', a line on the air' : ''}`;
  return { text, wrong: wrong.filter(Boolean) };
}

/**
 * `shot`, the game on `who`'s phone held sideways as it is now: the objective bar and the crew
 * strip folded into one row, and the band of world below it (`rowRules`). The run fails where
 * either is not so.
 */
async function capturePhoneGame(page, shot, who) {
  await capture(page, shot);
  const row = rowRules(await page.evaluate(hudLayout));
  const { width, height } = page.viewportSize();
  console.log(`${shot.padEnd(18)} ${who} @ ${width}x${height}: the HUD ${row.text}`);
  if (row.wrong.length > 0) {
    fail(`${shot}: ${row.wrong.join(', ')}`);
  }
}

/**
 * What a phone held sideways shows of its controls, CSS px: the canvas's box, and inside its
 * 1-px border; the objective bar's foot, the pad's box and the right thumb's cluster's, the
 * cluster's buttons as they show, and how see-through the cluster stands.
 */
function controlsLayout() {
  const canvas = document.querySelector('.world-canvas');
  const box = canvas.getBoundingClientRect();
  const border = (box.width - canvas.clientWidth) / 2;
  const cluster = document.querySelector('.world-thumb');
  const plain = (el) => el.getBoundingClientRect().toJSON();
  return {
    frame: box.toJSON(),
    canvas: {
      left: box.left + border,
      top: box.top + border,
      right: box.right - border,
      bottom: box.bottom - border,
    },
    barFoot: document.querySelector('.stage-top').getBoundingClientRect().bottom,
    pad: plain(document.querySelector('.world-pad')),
    cluster: plain(cluster),
    buttons: [...cluster.children].map(plain).filter((button) => button.width > 0),
    opacity: Number(globalThis.getComputedStyle(cluster).opacity),
  };
}

/** How much of `band` the boxes cover, a share of its area: each box clipped to it. */
function coverOf(boxes, band) {
  const clipped = (box) =>
    Math.max(0, Math.min(box.right, band.right) - Math.max(box.left, band.left)) *
    Math.max(0, Math.min(box.bottom, band.bottom) - Math.max(box.top, band.top));
  const area = (band.right - band.left) * (band.bottom - band.top);
  return boxes.reduce((sum, box) => sum + clipped(box), 0) / area;
}

/** The right thumb's cluster on a touch screen, CSS px: its buttons, the air between, its edge. */
const CLUSTER = { button: 52, gap: 8, edge: 12 };
/** How much of the band of world below the bar the pad and the cluster cover at most. */
const CONTROLS_COVER = 0.3;
/** How long the cluster stays whole after a finger lifted, ms (client world/cluster.ts). */
const CLUSTER_AWAKE_MS = 2000;
/** The cluster's opacity at rest (client styles/world.css). */
const CLUSTER_REST = 0.6;

/**
 * The controls of a phone held sideways (`seen`, controlsLayout): what is wrong with them — the
 * cluster not two by two, its buttons not CLUSTER.button px with CLUSTER.gap between, or not
 * CLUSTER.edge px off the world canvas's right and bottom edges, or the pad and the cluster
 * covering more than CONTROLS_COVER of the band of world below the bar — and its line for the
 * log.
 */
function clusterRules(seen) {
  const band = { ...seen.canvas, top: Math.max(seen.canvas.top, seen.barFoot) };
  const share = coverOf([seen.pad, seen.cluster], band);
  const side = 2 * CLUSTER.button + CLUSTER.gap;
  const off = [seen.frame.right - seen.cluster.right, seen.frame.bottom - seen.cluster.bottom];
  const near = (a, b) => Math.abs(a - b) <= 0.5;
  const square = near(seen.cluster.width, side) && near(seen.cluster.height, side);
  const sized = seen.buttons.every((b) => near(b.width, CLUSTER.button) && near(b.height, b.width));
  const size = `${Math.round(seen.cluster.width)}×${Math.round(seen.cluster.height)}`;
  const edges = off.map(Math.round).join('/');
  const percent = `${(share * 100).toFixed(1)} %`;
  const wrong = [
    !square && `the cluster stands ${size}`,
    !sized && `the cluster's buttons are not ${CLUSTER.button} px`,
    !off.every((px) => near(px, CLUSTER.edge)) && `the cluster stands ${edges} px off the edges`,
    share > CONTROLS_COVER && `the controls cover ${percent} of the band`,
  ];
  const text =
    `the cluster ${size} px, ${seen.buttons.length} buttons, ${edges} px off the edges; ` +
    `pad and cluster cover ${percent} of the band`;
  return { text, wrong: wrong.filter(Boolean) };
}

/**
 * The cluster's wake on `page` (client world/cluster.ts): see-through at rest, whole the moment
 * a press comes down on „Sprint" in it, and see-through again once CLUSTER_AWAKE_MS have passed
 * after it lifted, its fade over — and its line for the log, and what is wrong with it. A press,
 * not a touch: the phone's first touch in a run takes its page fullscreen, and the walkthrough
 * resizes that window later on; any pointer wakes the cluster alike.
 */
async function clusterWake(page) {
  const opacity = () =>
    page.evaluate(() => {
      const cluster = document.querySelector('.world-thumb');
      return Number(globalThis.getComputedStyle(cluster).opacity);
    });
  const rest = await opacity();
  await page.locator('.world-sprint').click();
  const touched = await opacity();
  await sleep(CLUSTER_AWAKE_MS + 600);
  const after = await opacity();
  const asleep = (at) => Math.abs(at - CLUSTER_REST) < 0.01;
  const woke = asleep(rest) && touched > 0.99 && asleep(after);
  const later = `${after} ${CLUSTER_AWAKE_MS + 600} ms after`;
  return {
    text: `${rest} at rest, ${touched} as a press comes down on it, ${later}`,
    wrong: woke ? [] : [`the cluster at ${rest} → ${touched} → ${after}`],
  };
}

/**
 * The pad and the minimap of a phone held sideways (`seen`, thumbsLayout): what is wrong with
 * them — the pad not three by three at 48 px in the left half, the buttons not in the right
 * half, the minimap under 56 px — and its line for the log.
 */
function padRules(seen) {
  const smallest = seen.cells.length === 0 ? 0 : Math.min(...seen.cells);
  const at = (box) => (box === null ? 'none' : `${Math.round(box.x)}–${Math.round(box.right)}`);
  const checks = [
    [seen.pad === null || seen.pad.right > seen.mid, 'the pad is not in the left half'],
    [seen.thumb === null || seen.thumb.x < seen.mid, 'the buttons are not in the right half'],
    [seen.cells.length !== 9 || smallest < 48 - 0.5, `${seen.cells.length} pad cells`],
    [seen.minimap === null || seen.minimap < 56, `the minimap is ${seen.minimap} px tall`],
  ];
  const text =
    `the pad at x ${at(seen.pad)}, the buttons at x ${at(seen.thumb)} (middle ` +
    `${Math.round(seen.mid)}), ${seen.cells.length} cells of ${Math.round(smallest)} px; ` +
    `the minimap ${seen.minimap ?? 'not'} px tall`;
  return { text, wrong: checks.filter(([bad]) => bad).map(([, said]) => said) };
}

/**
 * game-phone-932.png: the guest's phone held sideways as a large phone is (SIZES[4]): the HUD in
 * its one row with the band of world below it (`rowRules`), the pad and the minimap (`padRules`)
 * and the cluster, its share of the band included (`clusterRules`), as on the smaller phone, and
 * nothing of the screen scrolling. The run fails where any of it is not so. Then the phone is
 * held at `then`.
 */
async function captureLargePhone(page, then) {
  const { name, width, height } = SIZES[4];
  await page.setViewportSize({ width, height });
  await sleep(700);
  await capturePhoneGame(page, `game-${name}.png`, "Ben's large phone sideways");
  await overflow(page, `game @ ${width}x${height}, Ben's large phone sideways`);
  const pad = padRules(await page.evaluate(thumbsLayout));
  const controls = clusterRules(await page.evaluate(controlsLayout));
  console.log(`controls           Ben's large phone: ${pad.text}; ${controls.text}`);
  const wrong = [...pad.wrong, ...controls.wrong];
  if (wrong.length > 0) {
    fail(`game-${name}.png: ${wrong.join(', ')}`);
  }
  await page.setViewportSize(then);
}

/**
 * pad-left.png: the guest's phone held sideways, the world under its thumbs —
 * the steering pad of eight ways round a still middle, 48 px a cell, in the
 * left half under the left thumb, and the minimap 56 px tall at least
 * (`padRules`); the buttons in the right half under the right one, two by two,
 * 52 px each, 8 px apart, 12 px off the world's edges, the pad and the cluster
 * covering 30 % of the band of world below the bar at most (`clusterRules`),
 * the cluster at 60 % until a press comes down on it, whole then and at 60 %
 * again 2 s after (`clusterWake`). The run fails where any of it is not so.
 */
async function capturePadLeft(page) {
  const pad = padRules(await page.evaluate(thumbsLayout));
  const controls = clusterRules(await page.evaluate(controlsLayout));
  await capture(page, 'pad-left.png');
  const wake = await clusterWake(page);
  console.log(`pad-left.png       Ben sideways: ${pad.text}`);
  console.log(`cluster            Ben sideways: ${controls.text}; at ${wake.text}`);
  const wrong = [...pad.wrong, ...controls.wrong, ...wake.wrong];
  if (wrong.length > 0) {
    fail(`pad-left: ${wrong.join(', ')}`);
  }
}

/** The stations whose device a phone has shown sideways this run: each once. */
const phoneDevices = new Set();

/**
 * What the page shows of its open device or relay console: the most its frame or the modal
 * round it scrolls; its controls shown, those under a fingertip's 44 px either way, and those
 * cut off by the frame or the window.
 */
function deviceReach() {
  const modal = document.querySelector('.station-modal, .relay-modal');
  const panel = modal?.querySelector('.panel') ?? null;
  if (modal === null || panel === null) {
    return null;
  }
  const frame = panel.getBoundingClientRect();
  const box = (el) => el.getBoundingClientRect();
  const said = (el) => {
    const { width, height } = box(el);
    const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20);
    return `„${name}" ${Math.round(width)}×${Math.round(height)}`;
  };
  const shown = [...panel.querySelectorAll('button, input, summary')].filter(
    (el) => box(el).width > 0 && globalThis.getComputedStyle(el).visibility !== 'hidden',
  );
  const out = (el) =>
    box(el).top < Math.max(frame.top, 0) - 1 ||
    box(el).bottom > Math.min(frame.bottom, globalThis.innerHeight) + 1 ||
    box(el).left < -1 ||
    box(el).right > globalThis.innerWidth + 1;
  return {
    scroll: Math.max(
      panel.scrollHeight - panel.clientHeight,
      modal.scrollHeight - modal.clientHeight,
    ),
    controls: shown.length,
    small: shown.filter((el) => box(el).width < 43.5 || box(el).height < 43.5).map(said),
    cut: shown.filter(out).map(said),
  };
}

/** How long a device a phone shows gets to finish its animations before it is measured, ms. */
const SETTLE_MS = 3000;

/**
 * In the page: waits until every animation of the open device or relay console that runs now,
 * ends, and moves a control's box — on a control or round one: the panel's rise as it came up,
 * from 0.98 of its size, the device's own from 0.94, a press giving — has ended, or `ms` have
 * passed, and says how long it waited on the page's clock and which of those still ran then: a
 * control measured mid-rise measures short. One that starts meanwhile, or moves no control — a
 * sign of the Signalkette flaring on, a token's bar draining beside its keys — is not waited for.
 */
async function deviceSettled(ms) {
  const modal = document.querySelector('.station-modal, .relay-modal');
  const controls = [...(modal?.querySelectorAll('button, input, summary') ?? [])];
  const t0 = globalThis.performance.now();
  const ends = (a) => a.playState === 'running' && a.effect?.getComputedTiming().endTime < Infinity;
  const moves = (a) => controls.some((control) => a.effect?.target?.contains(control) === true);
  const all = modal?.getAnimations({ subtree: true }) ?? [];
  const running = all.filter((a) => ends(a) && moves(a));
  // An animation cancelled meanwhile, its element gone, has ended too.
  const ended = running.map((a) =>
    a.finished.then(
      () => undefined,
      () => undefined,
    ),
  );
  let timer;
  const waited = new Promise((done) => {
    timer = globalThis.setTimeout(done, ms);
  });
  await Promise.race([Promise.all(ended), waited]);
  globalThis.clearTimeout(timer);
  const still = running
    .filter((a) => a.playState === 'running')
    .map((a) => a.animationName ?? a.transitionProperty ?? 'an animation');
  return { waited: Math.round(globalThis.performance.now() - t0), still };
}

/** The station `player` has open: its id, and its console's letter where it has two. */
function stationSlug(player) {
  const { map, puzzle } = player.seen.view;
  const armed = map.stations.find((station) => station.status === 'armed');
  const id = armed?.puzzleId ?? 'station';
  const two = map.stations.some((station) => station.puzzleId === id && station.console === 'b');
  return two && puzzle?.console != null ? `${id}-${puzzle.console}` : id;
}

/**
 * device-phone-<slug>.png: the device a phone has open — the guest's page, a touch screen —
 * with the phone held sideways: the device whole in the window, nothing of it scrolling, every
 * control in view and 44 px at least each way, measured once its animations ended on the page's
 * clock (deviceSettled). The run fails where it is not so (pageclock.mjs `deviceVerdict`);
 * where the device still rose after SETTLE_MS, a control measured short is skipped, the reason
 * naming the wait. Once a
 * station; a window without touch is left alone. The first device the phone opens is looked at
 * on a large phone held sideways as well (device-phone-932-<slug>.png). The phone goes back to
 * how it was held.
 */
async function captureDevicePhone(player, slug) {
  const { page } = player;
  const touch = await page.evaluate(() => globalThis.matchMedia('(pointer: coarse)').matches);
  if (!touch || phoneDevices.has(slug)) {
    return;
  }
  phoneDevices.add(slug);
  const held = page.viewportSize();
  const sizes = phoneDevices.size === 1 ? [SIZES[3], SIZES[4]] : [SIZES[3]];
  for (const size of sizes) {
    await deviceOnPhone(player, slug, size);
  }
  if (held !== null) {
    await page.setViewportSize(held);
    await sleep(300);
  }
}

/** The device `player`'s phone has open at `size` (`captureDevicePhone`), shot and checked. */
async function deviceOnPhone(player, slug, size) {
  const shot =
    size === SIZES[3] ? `device-phone-${slug}.png` : `device-phone-${size.width}-${slug}.png`;
  await phoneReach(player, size, { shot, unjudged: (why) => skip('device-phone (targets)', why) });
}

/**
 * The device `player`'s phone has open, held at `size`: the device whole in the window, nothing
 * of it scrolling, every control in view and 44 px at least each way (`deviceReach`), measured
 * once its animations ended on the page's clock (deviceSettled), or the run fails (pageclock.mjs
 * `deviceVerdict`) — shot as `shot` where one is named, and logged under `label`, the shot's name
 * by default. Where the device still moved after SETTLE_MS, a control measured short goes to
 * `unjudged` with why, the wait named: the caller skips it under its group's label.
 */
async function phoneReach(player, size, { shot = null, label = shot, unjudged }) {
  const { page } = player;
  await page.setViewportSize({ width: size.width, height: size.height });
  await sleep(500);
  const settled = await page.evaluate(deviceSettled, SETTLE_MS);
  const seen = await page.evaluate(deviceReach);
  if (shot !== null) {
    await capture(page, shot);
  }
  const name = label.padEnd(18);
  if (seen === null) {
    fail(`${label}: no device open on ${player.name}'s phone`);
    console.log(`${name} !! ${player.name}'s phone has no device open`);
    return;
  }
  const rest = settled.still.length === 0 ? '' : ` — !! ${settled.still.join(', ')} still ran`;
  console.log(
    `${name} ${player.name}'s phone sideways @ ${size.width}x${size.height}: ` +
      `${seen.controls} controls, scrolls ${seen.scroll}px, ${seen.small.length} under 44 px, ` +
      `${seen.cut.length} cut off; measured once settled, ${settled.waited} ms on the page's ` +
      `clock${rest}` +
      [...seen.small, ...seen.cut].map((what) => `\n                   !! ${what}`).join(''),
  );
  const { faults, unjudged: why } = deviceVerdict(seen, settled);
  if (faults.length > 0) {
    fail(`${label}: ${faults.join('; ')}`);
  }
  if (why !== null) {
    unjudged(`${label}: ${why}`);
  }
}

/**
 * After the sign step: the Info button on the guest's phone held sideways —
 * and where the host read the sign, in the host's window at the same size,
 * so that the chip is checked at that width in every mission.
 */
async function infoAfterSign(reader, guest) {
  const turned = SIZES[3];
  await infoInView(guest, turned, '(phone sideways)');
  if (reader !== undefined && reader.page !== guest.page) {
    await infoInView(reader, turned, '(window, no touch)');
  }
}

/**
 * lobby-landscape.png: the host's lobby on a phone held sideways, scrolled
 * to the mission panel's top, so that its strip of mission cards stands
 * clear of the start bar at the window's foot. The lobby may scroll down
 * there, but nothing may run out sideways: the strip scrolls in its own box.
 */
async function captureLobbySideways(page) {
  const { width, height } = SIZES[3];
  await page.setViewportSize({ width, height });
  await sleep(400);
  const shown = (await page.locator('.lobby-missions').count()) > 0;
  await page.locator('.lobby-panel').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await sleep(200);
  await capture(page, 'lobby-landscape.png');
  const over = await sideways(page, '.content');
  const cards = await page.locator('.lobby-mission').count();
  console.log(
    `lobby-landscape.png Anna's lobby @ ${width}x${height}: ` +
      (shown ? `${cards} mission cards, ` : '!! no mission strip, ') +
      (over > 0 ? `!! +${over}px sideways` : 'fits sideways'),
  );
}

/**
 * The crew figures a traced page paints in its lobby or on its title card
 * (client screens/CrewFigure.tsx, `window.__escapelab.figures`), each with
 * its last pose: colour, mood, how far off the ground (`rise`, tiles) and
 * how far a glance has turned its look (`glance`, radians); null without the
 * probe.
 */
function figuresOn(page) {
  return page.evaluate(() => globalThis.__escapelab?.figures ?? null);
}

/**
 * Polls the figures `page` paints every 20 ms until `pick` takes one, or
 * until `ms` have passed: that figure, or null.
 */
async function figureWhen(page, pick, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const found = ((await figuresOn(page)) ?? []).find(pick);
    if (found !== undefined || Date.now() >= end) {
      return found ?? null;
    }
    await sleep(20);
  }
}

/**
 * A shot of `page` with one of its figures in a pose. Waits (figureWhen) for a figure `pick`
 * takes, shoots, and reads the figures again: the shot is kept where the same figure still
 * `holds` the pose within `span` ms of the first read — a pose rises and falls once, so it held
 * in between, through the shot — else the next pose is waited for, until `ms` have passed. A
 * single read can land a slow page's shot on either side of a pose. Returns the last shot (null
 * where no figure took the pose), the figure as found and as read after it, the shots taken and
 * whether the last one held.
 */
async function figureShot(page, { pick, holds, span, ms }) {
  const end = Date.now() + ms;
  let last = { png: null, found: null, after: null, tries: 0, held: false };
  while (last.tries === 0 || Date.now() < end) {
    const found = await figureWhen(page, pick, Math.max(0, end - Date.now()));
    if (found === null) {
      return last;
    }
    const since = Date.now();
    const png = await page.screenshot();
    const after = ((await figuresOn(page)) ?? []).find((figure) => figure.color === found.color);
    const held = after !== undefined && holds(after) && Date.now() - since <= span;
    last = { png, found, after: after ?? null, tries: last.tries + 1, held };
    if (held) {
      return last;
    }
  }
  return last;
}

/** Keeps figureShot's last shot as `name`; shoots `page` now where it took none. */
async function keepFigureShot(page, name, caught) {
  if (caught.png === null) {
    await capture(page, name);
    return;
  }
  writeFileSync(join(OUT, name), caught.png);
  taken(name);
}

/** A figure counts as mid look-around turned this far from its way, radians (it turns 1.1). */
const GLANCE_SHOWN = 0.9;
/** How long the lobby gets for one of its figures to look round: each does every 4 to 7 s. */
const GLANCE_WAIT_MS = 15_000;
/** How far apart the reads round lobby-idle.png may lie, ms: a glance stays turned for ~870. */
const GLANCE_SPAN_MS = 800;

/**
 * lobby-idle.png: the host's lobby at 1440×1000, shot while a figure of the
 * crew stands turned in a glance round the room — the figures' probe says
 * when, before and after the shot (figureShot). Fails where no figure looks
 * round within GLANCE_WAIT_MS, or none is still turned once shot.
 */
async function captureLobbyIdle(page) {
  await page.setViewportSize(COLD_OPEN);
  await sleep(400);
  const glancing = (figure) => figure.mood === 'play' && Math.abs(figure.glance) >= GLANCE_SHOWN;
  const caught = await figureShot(page, {
    pick: glancing,
    holds: glancing,
    span: GLANCE_SPAN_MS,
    ms: GLANCE_WAIT_MS,
  });
  await keepFigureShot(page, 'lobby-idle.png', caught);
  const { found, after, tries, held } = caught;
  console.log(
    `lobby-idle.png     Anna's lobby @ ${COLD_OPEN.width}x${COLD_OPEN.height}: ` +
      (found === null
        ? `!! no figure looked round within ${seconds(GLANCE_WAIT_MS)}`
        : `${found.color} turned ${found.glance.toFixed(2)} rad in a glance, ` +
          `${after?.glance.toFixed(2) ?? '?'} once shot${held ? '' : ' !! no longer turned'}, ` +
          `shot ${tries} times`),
  );
  if (!held) {
    fail(`lobby-idle.png: no lobby figure caught turned round within ${seconds(GLANCE_WAIT_MS)}`);
  }
  await page.setViewportSize(SIZES[0]);
  await sleep(300);
}

/**
 * The guest searches the nearest closed locker it can walk to — opened, a locker is a source a
 * player can back a station from (core map.ts `backupsOf`), as the Systemcheck's Kabelprüfung
 * wants — and locker.png, reading's, shows it before it, „Durchsuchen" on offer; the find has to
 * reach the HUD line. Lockers lie undiscovered at first, so where they are comes from the
 * audience's view.
 */
async function captureLocker(page, seen, audience) {
  const { locker, why } = lockerInReach(seen, audience);
  if (locker === undefined) {
    await inGroup('reading', () => skip('locker.png', why));
    return;
  }
  if (!(await walkNear(page, seen, locker))) {
    const where = `${locker.x},${locker.y}`;
    const broke = `the guest's walk to the locker at ${where} broke off (stuck, or a door shut)`;
    await inGroup('reading', () => skip('locker.png', broke));
    return;
  }
  const target = sourceTarget(locker);
  const here = await until(() => presentAt(seen.view, target), COUNT_WAIT.ms);
  await inGroup('reading', async () => {
    await sleep(400); // the prompt is drawn from the next frame on
    await capture(page, 'locker.png');
  });
  const opened = () => seen.view.map.manuals.some((m) => m.id === locker.id && m.opened);
  const guest = { page, seen, name: 'the guest' };
  const searched = await pressUntil(guest, target, 'the open locker', opened);
  await inGroup('reading', () => reportLocker(page, locker, here, searched));
}

/**
 * The closed locker nearest by walking to `seen`'s player — where the lockers lie comes from the
 * audience's view (`audience`) — and why there is none, for the skip line.
 */
function lockerInReach(seen, audience) {
  const everything = audience.view?.map ?? seen.view.map;
  const lockers = everything.manuals.filter((m) => m.kind === 'locker' && !m.opened);
  const from = tileOf(seen);
  const options = lockers
    .map((locker) => ({ locker, path: from === null ? null : route(seen.view.map, from, locker) }))
    .filter((option) => option.path !== null)
    .sort((a, b) => a.path.length - b.path.length);
  const where = lockers.map((l) => `${l.x},${l.y}`).join(' · ');
  const why =
    lockers.length === 0
      ? 'no closed locker on this map'
      : `no locker in the guest's reach (${where})`;
  return { locker: options[0]?.locker, why };
}

/** locker.png's line: whether the guest was counted at the locker, and what searching it said. */
async function reportLocker(page, locker, here, searched) {
  const hud = page.locator('.hud-radio');
  const line = searched && (await hud.count()) > 0 ? (await hud.innerText()).trim() : '';
  console.log(
    `locker.png         guest: "${locker.label}" at ${locker.x},${locker.y}, ` +
      `${here ? 'counted at it' : '!! not counted at it'}; E: ` +
      (searched ? `searched, HUD line "${line}"` : '!! still shut'),
  );
}

/**
 * lit-room.png: the first room a solved station lit, with the guest walked
 * inside where a way leads there. The walkthrough solves a sync station
 * only, so elsewhere litRooms stays empty and this only says so.
 */
async function captureLitRoom(page, seen) {
  const map = seen.view?.map;
  const room = map?.litRooms[0];
  if (map == null || room === undefined) {
    skip('lit-room.png', 'litRooms is empty — no station solved in this run');
    return;
  }
  await page.keyboard.press('Escape');
  const label = map.labels.find((l) => l.text === room);
  const inside = label !== undefined && (await walkNear(page, seen, label));
  await sleep(1200); // past the lights coming up
  await capture(page, 'lit-room.png');
  console.log(
    `lit-room.png       guest: ${map.litRooms.join(', ')} lit, ` +
      (inside ? `guest inside ${room}` : `!! guest outside ${room}, no way in`),
  );
}

/** A page's voice as `?trace=1` shows it (window.__escapelab.voice); null without one. */
function voiceOf(page) {
  return page.evaluate(() => globalThis.__escapelab?.voice ?? null);
}

/** Every page's link states, for a log line: „Anna connected, Ben connecting". */
async function linkStates(pages) {
  const voices = await Promise.all(pages.map(({ page }) => voiceOf(page)));
  return pages
    .map(({ name }, i) => {
      const states = Object.values(voices[i]?.states ?? {});
      return `${name} ${states.length === 0 ? 'no link' : states.join('/')}`;
    })
    .join(', ');
}

/** Polls until every page has a voice link and all of them are connected; whether they came up. */
async function linksUp(pages) {
  const up = async ({ page }) => {
    const states = Object.values((await voiceOf(page))?.states ?? {});
    return states.length > 0 && states.every((state) => state === 'connected');
  };
  const end = Date.now() + LINK_MS;
  for (;;) {
    const all = (await Promise.all(pages.map(up))).every(Boolean);
    if (all || Date.now() > end) {
      return all;
    }
    await sleep(250);
  }
}

/** Seconds, one decimal, for a log line: „1.3 s". */
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/**
 * In the lobby both players switch their microphone on as a player would:
 * the button, then „Mikro an". The launch flags make it a fake one, handed
 * out without a prompt; the contexts are allowed to use it. Each page's voice
 * has MIC_MS to say `on`. The log gives how long each took from the click,
 * and how much of that the browser spent handing the microphone out.
 */
async function micsOn(players) {
  const origin = new URL(BASE).origin;
  const asked = [];
  for (const { page } of players) {
    await page.context().grantPermissions(['microphone'], { origin });
    asked.push(Date.now());
    await clickText(page, 'Mikrofon aktivieren');
  }
  const settled = (voice) => voice !== null && voice.mic !== 'off' && voice.mic !== 'asking';
  const outcomes = await Promise.all(
    players.map(async ({ page }, i) => {
      let voice = await voiceOf(page);
      while (!settled(voice) && Date.now() - asked[i] < MIC_MS) {
        await sleep(100);
        voice = await voiceOf(page);
      }
      const shown = voice?.mic === 'on' && (await page.locator('.voice-on').count()) > 0;
      return { voice, ms: Date.now() - asked[i], shown };
    }),
  );
  const lines = players.map(({ name }, i) => {
    const { voice, ms, shown } = outcomes[i];
    const wait = voice?.micWaitMs;
    const browser = wait == null ? '' : `, ${seconds(wait)} of it in the browser`;
    if (voice?.mic !== 'on') {
      return `!! ${name} ${voice?.mic ?? 'has no voice probe'} after ${seconds(ms)}${browser}`;
    }
    return `${name} on after ${seconds(ms)}${browser}` + (shown ? '' : ', !! no „Mikro an" shown');
  });
  console.log(`voice              microphones in the lobby: ${lines.join('; ')}`);
  const off = players.filter((_, i) => !outcomes[i].shown);
  if (off.length > 0) {
    const who = off.map(({ name }) => name).join(' and ');
    fail(`no microphone in the lobby for ${who} within ${seconds(MIC_MS)}`);
  }
}

/**
 * The guest says it is ready, and the host starts once its own page has the
 * guest ready and its start button enabled; the run then has START_MS to
 * show on both pages. A start the server did not take is pressed once more,
 * logged with what the host's page said. Throws, with what both pages show,
 * when the run does not come up.
 */
async function startRun(host, guest) {
  const from = Date.now();
  const readyOnHost = () =>
    host.seen.view?.players?.some((p) => p.name === guest.name && p.ready && p.connected) === true;
  const started = () => host.seen.view?.phase === 'playing';
  for (let attempt = 1; attempt <= 2 && !started(); attempt++) {
    if (guest.seen.view?.you?.ready !== true) {
      await clickText(guest.page, 'Ich bin bereit');
    }
    if (!(await until(readyOnHost, 5000))) {
      console.log(`start              !! ${host.name}'s page has no ready ${guest.name} after 5 s`);
      continue;
    }
    // The start reads „Mission starten" only once nothing blocks it.
    const start = host.page.locator('button.lobby-start:enabled', { hasText: 'Mission starten' });
    await start.waitFor({ state: 'visible', timeout: 10_000 });
    await start.click();
    if (!(await until(started, 5000))) {
      const banner = await textOf(host.page.locator('.banner.error'));
      console.log(
        `start              !! press ${attempt} did not start the run` +
          (banner === null ? '' : `: "${banner}"`),
      );
    }
  }
  const up = await Promise.all(
    [host, guest].map(({ page }) =>
      page.locator('.stage').waitFor({ timeout: START_MS }).then(
        () => true,
        () => false,
      ),
    ),
  );
  if (!up.every(Boolean)) {
    const shows = await Promise.all(
      [host, guest].map(async ({ name, page, seen }) => {
        const banner = await textOf(page.locator('.banner.error'));
        return `${name} ${seen.view?.phase ?? 'without a view'}` + (banner ? `, "${banner}"` : '');
      }),
    );
    throw new Error(`the run did not come up within ${seconds(START_MS)}: ${shows.join('; ')}`);
  }
  walking.since = Date.now();
  console.log(
    `start              ${guest.name} ready, the run up on both pages ` +
      `${seconds(Date.now() - from)} after the ready press`,
  );
}

/**
 * voice.png, voice-phone.png: in the run the link between the two comes up
 * on both ends, and while the host holds V for TALK_MS the speaking mark
 * shows beside the host's name — on its own page from its own level, on the
 * guest's from the sound that came over the link. Captured mid-hold.
 */
async function captureVoice(host, guest) {
  const crew = [host, guest];
  if (!(await linksUp(crew))) {
    const states = await linkStates(crew);
    console.log(`voice              !! no link after ${LINK_MS / 1000} s: ${states}`);
    fail('the voice link did not connect');
    return;
  }
  console.log(`voice              linked: ${await linkStates(crew)}`);
  const marked = async ({ page }) => {
    const row = page.locator('.hud-crew li', { hasText: host.name });
    return (await row.locator('.voice-speaking').count()) > 0;
  };
  const seen = crew.map(() => false);
  let shot = false;
  await host.page.keyboard.down('v');
  for (const end = Date.now() + TALK_MS; Date.now() < end; ) {
    const marks = await Promise.all(crew.map(marked));
    marks.forEach((mark, i) => {
      seen[i] ||= mark;
    });
    if (!shot && marks.every(Boolean)) {
      await capture(host.page, 'voice.png');
      await capture(guest.page, 'voice-phone.png');
      shot = true;
    }
    await sleep(100);
  }
  if (!shot) {
    await capture(host.page, 'voice.png');
    await capture(guest.page, 'voice-phone.png');
  }
  await host.page.keyboard.up('v');
  const deaf = crew.filter((_, i) => !seen[i]).map(({ name }) => name);
  console.log(
    `voice.png          ${host.name} held V for ${TALK_MS / 1000} s: ` +
      (deaf.length === 0
        ? 'the speaking mark showed on both pages'
        : `!! no speaking mark on ${deaf.join(' and ')}'s page`),
  );
  if (deaf.length > 0) {
    fail(`no speaking mark for ${host.name} on ${deaf.join(' and ')}'s page while V was held`);
  }
  await sleep(600); // the mark goes out before the next captures
}

/** After the guest's reload its link comes up again, and its microphone with it. */
async function voiceAfterReload(host, guest) {
  const crew = [host, guest];
  const up = await linksUp(crew);
  const mic = (await voiceOf(guest.page))?.mic ?? 'no voice';
  console.log(
    `voice              after ${guest.name}'s reload: ` +
      (up ? 'linked again' : `!! ${await linkStates(crew)}`) +
      `, ${guest.name}'s microphone ${mic === 'on' ? 'back on' : `!! ${mic}`}`,
  );
  if (!up) {
    fail(`the voice link did not come up again after ${guest.name}'s reload`);
  }
}

/** The audience listens in: a receive-only link to every player comes up. */
async function listenIn(watcher, players) {
  const audience = [{ name: 'audience', page: watcher }];
  await clickText(watcher, 'Crew mithören');
  const all = await linksUp(audience);
  const links = Object.keys((await voiceOf(watcher))?.states ?? {}).length;
  const heard = all && links === players.length;
  console.log(
    `voice              the audience listens in: ` +
      (heard ? `linked to all ${links} players` : `!! ${await linkStates(audience)}`),
  );
  if (!heard) {
    fail('the audience did not link up to every player');
  }
}

/** Where on the screen tile x,y of the editor's map is, measured afresh: the map refits. */
async function editorTile(page, x, y) {
  const canvas = page.locator('.editor-canvas');
  const box = await canvas.boundingBox();
  const px = Number(await canvas.getAttribute('data-tile-px'));
  if (box === null || !(px > 0)) {
    throw new Error('the editor shows no map (.editor-canvas with data-tile-px)');
  }
  return { x: box.x + (x + 0.5) * px, y: box.y + (y + 0.5) * px };
}

/** Picks an editor tool and presses its map at tile x,y. */
async function placeWith(page, tool, x, y) {
  await page.locator(`[data-tool="${tool}"]`).click();
  const at = await editorTile(page, x, y);
  await page.mouse.click(at.x, at.y);
}

/** The editor's error findings, as listed. */
async function editorErrors(page) {
  return page.locator('.editor-check-error .editor-finding').allInnerTexts();
}

/** The first line of what went wrong. */
const firstLine = (err) => String(err instanceof Error ? err.message : err).split('\n')[0];

/**
 * From the join screen into the editor: the new mission called „Probe", so
 * it is saved as custom-probe; a 7 × 5 room painted row by row with the
 * floor brush into its blank lab of wall, a start and the keypad's station.
 */
async function paintProbe(page) {
  await page.goto(paged(BASE));
  await page.locator('.menu-item', { hasText: 'Editor' }).click();
  await page.locator('.editor-canvas').waitFor({ timeout: 5000 });
  await page.locator('.editor-tab', { hasText: 'Mission' }).click();
  await page.getByLabel('Titel', { exact: true }).fill('Probe');
  await page.locator('[data-tool="floor"]').click();
  for (let y = 2; y <= 6; y++) {
    const from = await editorTile(page, 2, y);
    const to = await editorTile(page, 8, y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  }
  await placeWith(page, 'spawn', 3, 4);
  await placeWith(page, 'station', 7, 3);
}

/** editor.png with what the validator says now; it has to say something. */
async function captureValidator(page) {
  await sleep(700); // past the pause the validator waits for
  const errors = await editorErrors(page);
  await capture(page, 'editor.png');
  const said = errors.length === 0 ? '!! the validator says nothing' : errors.join(' | ');
  console.log(`editor.png         room, start, station: ${errors.length} error(s) — ${said}`);
  if (errors.length === 0) {
    fail('editor: the validator let a mission with one start pass');
  }
}

/** The editor has to fit a laptop and 1280×720, and a phone sideways. */
async function editorLayouts(page) {
  await overflow(page, 'editor @ 1440x820');
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(400);
  await overflow(page, 'editor @ 1280x720');
  await capture(page, 'editor-1280.png');
  await page.setViewportSize({ width: SIZES[2].width, height: SIZES[2].height });
  await sleep(400);
  const over = await sideways(page, '.content');
  await capture(page, 'editor-phone.png');
  const fits = over > 0 ? `!! +${over}px sideways` : 'scrolls down, fits sideways';
  console.log(`editor-phone.png   the editor @ 420x760 ${fits}`);
  if (over > 0) {
    fail(`editor: +${over}px sideways on a phone`);
  }
  await page.setViewportSize(SIZES[0]);
  await sleep(400);
}

/**
 * The „Notiz" tool: pressed deep in the rock it places nothing and the
 * status line says where a note may go; pressed on the wall over the probe's
 * room it pins one there, its form comes up, and the validator finds
 * nothing more to say than before. Fails otherwise.
 */
async function pinProbeNote(page) {
  const before = (await editorErrors(page)).length;
  await placeWith(page, 'note', 15, 9);
  const refused = await textOf(page.locator('.editor-status-note'));
  await placeWith(page, 'note', 5, 1);
  const form = page.locator('.editor-thing', { hasText: 'Notiz der letzten Schicht' });
  const pinned = await form.waitFor({ timeout: 3000 }).then(
    () => true,
    () => false,
  );
  await sleep(700); // past the pause the validator waits for
  const after = (await editorErrors(page)).length;
  console.log(
    `editor             „Notiz": in the rock „${refused ?? '!! no word'}"; on the wall over the ` +
      `room ${pinned ? 'pinned, its form up' : '!! not pinned'}, ` +
      `${after} error(s) as before ${before}`,
  );
  if (refused === null || !pinned || after !== before) {
    fail(`editor: the note tool said „${refused}", pinned ${pinned}, errors ${before} → ${after}`);
  }
}

/** A second start and a book make the probe sound; saved, its card has to be on the join screen. */
async function saveProbe(page) {
  await placeWith(page, 'spawn', 4, 4);
  await placeWith(page, 'source', 7, 5);
  const save = page.locator('.editor-actions button.primary:not([disabled])');
  const sound = await save.waitFor({ timeout: 3000 }).then(
    () => true,
    () => false,
  );
  if (!sound) {
    throw new Error(`the probe stays unsound: ${(await editorErrors(page)).join(' | ')}`);
  }
  await save.click();
  await page.locator('.editor-status-ok').waitFor({ timeout: 5000 });
  await clickText(page, 'Zurück');
  await openMenuPanel(page, 'Einsatz starten');
  await page.locator('.mission', { hasText: 'Probe' }).waitFor({ timeout: 5000 });
  await closeMenuPanel(page);
  console.log('editor             saved as custom-probe, and its card is on the menu’s missions');
}

/** The mission the editor imports for its test run and its link: „Probe", custom-probe. */
const PROBE_FILE = fileURLToPath(new URL('fixtures/probe-mission.json', import.meta.url));

/**
 * The editor at its own address (`path`), a mission file imported through
 * „Importieren" — the probe's, „Probe", unless told otherwise; a draft left
 * unsaved there is discarded when the editor asks.
 */
async function importProbe(page, file = PROBE_FILE, title = 'Probe', path = '/editor') {
  await page.goto(paged(new URL(path, BASE).href));
  await page.locator('.editor-canvas').waitFor({ timeout: 10_000 });
  await page.locator('.editor-actions input[type="file"]').setInputFiles(file);
  const imported = page.locator('.editor-status', { hasText: 'importiert' });
  const asked = page.locator('.editor-confirm button', { hasText: 'Verwerfen' });
  await imported.or(asked).first().waitFor({ timeout: 5000 });
  if (await asked.isVisible()) {
    await asked.click();
    await imported.waitFor({ timeout: 5000 });
  }
  await page.locator('.editor-name strong', { hasText: title }).waitFor({ timeout: 5000 });
}

/**
 * editor-play.png: „Probespiel" with a name saves the probe and opens a room
 * for it; the lobby has to show the probe, and its top bar the way back.
 */
async function playProbe(page) {
  const play = page.locator('.editor-actions button:not([disabled])', { hasText: 'Probespiel' });
  const sound = await play.waitFor({ timeout: 3000 }).then(
    () => true,
    () => false,
  );
  if (!sound) {
    throw new Error(`the imported probe stays unsound: ${(await editorErrors(page)).join(' | ')}`);
  }
  await play.click();
  await page.locator('.editor-play input').fill('Anna');
  await page.locator('.editor-play button[type="submit"]').click();
  await page.locator('.lobby', { hasText: 'Probe' }).waitFor({ timeout: 10_000 });
  const code = (await page.locator('.room-code strong').innerText()).trim();
  await sleep(500);
  await capture(page, 'editor-play.png');
  await overflow(page, 'editor-play @ 1440x820');
  const back = await page.locator('.topbar-editor').isVisible();
  console.log(
    `editor-play.png    Probespiel: room ${code}, the lobby shows „Probe"; ` +
      (back ? '„Zurück zum Editor" in the top bar' : '!! no way back to the editor'),
  );
  if (!back) {
    fail('editor: the test run’s lobby offers no „Zurück zum Editor"');
  }
}

/** „Zurück zum Editor": out of the room, the page reloads on the editor with the probe again. */
async function backToEditor(page) {
  await Promise.all([page.waitForEvent('load'), page.locator('.topbar-editor').click()]);
  await page.locator('.editor-name strong', { hasText: 'Probe' }).waitFor({ timeout: 10_000 });
  const path = new URL(page.url()).pathname;
  console.log(`editor             back from the lobby on ${path}, „Probe" open again`);
  if (path !== '/editor') {
    fail(`editor: back from the test run on ${path}, not on /editor`);
  }
}

/** „Teilen": the link off the clipboard, or out of the box the editor marks it in. */
async function sharedLink(page) {
  await clickText(page, 'Teilen');
  const copied = page.locator('.editor-status-ok', { hasText: 'Link kopiert' });
  const box = page.locator('.editor-share input');
  await copied.or(box).first().waitFor({ timeout: 5000 });
  if (await box.isVisible()) {
    return { link: await box.inputValue(), via: 'the marked box' };
  }
  const link = await page.evaluate(() => globalThis.navigator.clipboard.readText());
  return { link, via: 'the clipboard' };
}

/**
 * editor-shared.png: the link in a page of its own opens the editor on the
 * same mission — its title, and its card's line with the station count —
 * marked as shared and not saved.
 */
async function openShared(context, link, card) {
  const page = await openPage(context);
  page.on('pageerror', (e) => console.log('[shared error]', e.message));
  try {
    await page.goto(paged(link));
    await page.locator('.editor-name strong', { hasText: 'Probe' }).waitFor({ timeout: 10_000 });
    await page.locator('.editor-shared').waitFor({ timeout: 5000 });
    const seen = await page.locator('.editor-card-meta').innerText();
    await sleep(500);
    await capture(page, 'editor-shared.png');
    console.log(`editor-shared.png  the link opens „Probe" (${seen}), marked GETEILT`);
    if (seen !== card) {
      fail(`editor: the shared probe reads "${seen}", the original "${card}"`);
    }
  } finally {
    await page.close();
  }
}

/**
 * editor.png: the editor, opened from the join screen, with a room, a start
 * and a station in its lab and the validator naming what is missing — a
 * second start, a source for the keypad's rules. Made sound, the probe is
 * saved as custom-probe and has to show on the join screen. Then the
 * imported probe mission is played from the editor and shared by link
 * (editor-play.png, editor-shared.png). It is deleted through the API in any
 * case, so the walkthrough after it meets the shipped missions only.
 */
async function captureEditor() {
  // The link „Teilen" makes is read off the clipboard where the page may write it.
  const permissions = ['clipboard-read', 'clipboard-write'];
  const context = await browser.newContext({ viewport: SIZES[0], permissions });
  await wonBefore(context);
  const page = await openPage(context);
  page.on('pageerror', (e) => console.log('[editor error]', e.message));
  try {
    await paintProbe(page);
    await captureValidator(page);
    await editorLayouts(page);
    await pinProbeNote(page);
    await saveProbe(page);
  } catch (err) {
    console.log(`editor             !! ${firstLine(err)}`);
    fail(`editor: ${firstLine(err)}`);
  }
  try {
    await importProbe(page);
    await playProbe(page);
    await backToEditor(page);
    const card = await page.locator('.editor-card-meta').innerText();
    const { link, via } = await sharedLink(page);
    console.log(`editor             „Teilen": a link of ${link.length} characters, from ${via}`);
    await openShared(context, link, card);
  } catch (err) {
    console.log(`editor             !! ${firstLine(err)}`);
    fail(`editor: ${firstLine(err)}`);
  }
  const res = await page.request
    .delete(new URL('/missions/custom/custom-probe', BASE).href)
    .catch(() => null);
  // 404 is fine where the probe never got saved; anything else leaves it behind.
  const status = res?.status() ?? 'no answer';
  console.log(`editor             custom-probe deleted again: ${status}`);
  if (status !== 200 && status !== 404) {
    fail(`editor: custom-probe could not be deleted again (${status})`);
  }
  await context.close();
}

/**
 * The art tour's scratch copy of Blackout, by its id and title: saved as
 * custom-blackout, it keeps Blackout's dressing (the client seeds a custom
 * mission's looks by its id without „custom-").
 */
const ART_MISSION = { id: 'custom-blackout', title: 'Kunstprobe' };
/** The art tour's windows: as large as cold-open.png's. */
const ART_SIZE = COLD_OPEN;
/** How long the art tour's copy keeps its power on, s: its intro, with no announcement. */
const ART_LIGHTS_SEC = 10;
/** How long before the lights are due the opening's shot comes to rest on a spawn (client). */
const SHOT_HOLD_MS = 3000;

/**
 * Blackout as the art tour plays it: ten seconds of power before the lights
 * fail (an intro with no announcement), for two, starting in the Archiv and in
 * the Maschinenraum — a copy the server checks as it checks every mission.
 */
function artMission() {
  const blackout = structuredClone(BLACKOUT);
  // Where a won run leads on to is the shipped mission's business.
  delete blackout.next;
  return {
    ...blackout,
    ...ART_MISSION,
    listOrder: 99,
    players: { min: 2, max: 2 },
    intro: { lightsSec: ART_LIGHTS_SEC },
    map: { ...blackout.map, spawns: [ART_STARTS.archive, ART_STARTS.machine] },
  };
}

/**
 * Where the art tour's two start, from Blackout's map: on the Archiv's spawn, and on the
 * Maschinenraum's name — the tile its label stands on.
 */
const ART_STARTS = (() => {
  const machine = BLACKOUT.map.labels.find((label) => label.kind === 'machine');
  return { archive: BLACKOUT.map.spawns[0], machine: { x: machine.x, y: machine.y } };
})();

/** A page for the art tour in a context of its own, its errors logged under `name`. */
async function artPage(name, size = ART_SIZE) {
  const context = await browser.newContext({ viewport: size });
  await wonBefore(context);
  const page = await openPage(context);
  page.on('pageerror', (e) => console.log(`[${name} error]`, e.message));
  return { name, page, seen: eavesdrop(page), context };
}

/** The art tour's crew in the lobby of the scratch mission, the audience watching. */
async function artLobby() {
  const host = await artPage('art host');
  await host.page.goto(traced(BASE));
  await host.page.getByPlaceholder('z. B. Anna').fill('Anna');
  await openRound(host.page, ART_MISSION.title);
  await host.page.locator('.room-code strong').waitFor({ timeout: 10_000 });
  const code = (await host.page.locator('.room-code strong').innerText()).trim();
  const guest = await artPage('art guest');
  await guest.page.goto(traced(BASE));
  await guest.page.getByPlaceholder('z. B. Anna').fill('Ben');
  await byCode(guest.page, code);
  await guest.page.locator('.lobby').waitFor({ timeout: 10_000 });
  const watcher = await artPage('art audience');
  await watcher.page.goto(paged(BASE));
  await byCode(watcher.page, code, true);
  await watcher.page.locator('.spectate').waitFor({ timeout: 10_000 });
  return { host, guest, watcher };
}

/** Who of `players` started on the tile (x, y). */
const startedAt = (players, x, y) =>
  players.find(({ seen }) => {
    const spawn = seen.view?.map?.yourSpawn;
    return spawn?.x === x && spawn?.y === y;
  });

/**
 * The art captures, while the scratch mission's power is on: the audience's
 * whole lab lit (art-overview.png), each player's room round it lit
 * (room-archive.png, room-machine.png); then, two seconds into the dark, the
 * Maschinenraum with only the flashlight and its standby glows
 * (art-dark.png), its player's light probe read first (`checkLight`: under
 * SHOTS_WEBGL on the light layer). Fails where the run does not open with
 * the power on, or a start is not where the copy put it.
 */
async function artCaptures({ host, guest, watcher }) {
  await sleep(2700); // past the opening's card and the lab fading in, the lights at full
  if (host.seen.view?.lights?.out !== false) {
    throw new Error('the art tour’s mission did not open with the power on');
  }
  const crew = [host, guest];
  const archive = startedAt(crew, ART_STARTS.archive.x, ART_STARTS.archive.y);
  const machine = startedAt(crew, ART_STARTS.machine.x, ART_STARTS.machine.y);
  if (archive === undefined || machine === undefined) {
    throw new Error('the art tour’s starts are not the Archiv’s and the Maschinenraum’s');
  }
  await capture(watcher.page, 'art-overview.png');
  // The Archiv's player skips the opening and stands in its own room lit, as the lab with its
  // power on shows a player who walks it; the Maschinenraum's watches on, the shot at rest on
  // its spawn with the lab lit whole, between the bars, until the lights fail by themselves.
  await archive.page.keyboard.press('Space');
  await sleep(600); // the bars gone
  await capture(archive.page, 'room-archive.png');
  const rest = (machine.seen.view?.startedAt ?? Date.now()) + ART_LIGHTS_SEC * 1000 - SHOT_HOLD_MS;
  await sleep(Math.max(0, rest + 500 - Date.now()));
  await capture(machine.page, 'room-machine.png');
  await captureDecals(machine);
  const map = watcher.seen.view?.map;
  const kinds = (map?.labels ?? []).map((label) => `${label.text} ${label.kind ?? 'plain'}`);
  console.log(
    `art-overview.png   the audience, the power on: ${new Set(kinds).size} rooms by kind ` +
      `(${[...new Set(kinds)].join(', ')}), ${map?.decor?.length ?? 0} pieces of furniture; ` +
      `room-archive.png ${archive.name}, skipped into the lit lab; room-machine.png ` +
      `${machine.name}, the opening's shot at rest on its spawn`,
  );
  if (!(await until(() => machine.seen.view?.lights?.out === true, 12_000))) {
    throw new Error('the art tour’s lights never went out');
  }
  // Past the blackout's beat: the title and the bars of the shot it cut.
  await sleep(2500);
  await checkLight(machine);
  await capture(machine.page, 'art-dark.png');
  console.log(`art-dark.png       ${machine.name} in the Maschinenraum, 2.5 s into the dark`);
  await captureStandby(machine);
}

/** The floor's marks that are clutter, not the corridors' markings. */
const CLUTTER = (decal) => decal.kind !== 'lane' && decal.kind !== 'arrow';

/**
 * decals-lab.png: the Labor next door as the Maschinenraum's player sees it lit, four tiles
 * round its label — the marks on its floor (client world/decals.ts): spills, papers, coffee
 * rings, tape. The page's probe has to lay two or more on the Labor's floor and none on
 * furniture, a door, a plate or the exit — none in anybody's way, nothing that reads as a thing
 * to find — or the run fails; a mark under a station or a source, which is drawn over it, is
 * counted, not failed.
 */
async function captureDecals(player) {
  const map = player.seen.view?.map;
  const label = map?.labels.find((l) => l.text === 'LABOR');
  const probe = await graphicsOf(player.page);
  if (map == null || label === undefined || probe === null) {
    fail(`decals-lab.png: ${player.name}'s page shows no Labor, or carries no graphics probe`);
    return;
  }
  await shootAround(player.page, 'decals-lab.png', { x: label.x + 0.5, y: label.y + 0.5 }, 4);
  const key = (t) => `${t.x},${t.y}`;
  const floor = new Set(roomFloorOf(map, label).map(key));
  const solid = new Set([
    ...furniture(map),
    ...[...map.doors, ...map.plates, ...(map.exit === null ? [] : [map.exit])].map(key),
  ]);
  const beneath = new Set([...map.stations, ...map.manuals].map(key));
  const at = (d) => `${Math.floor(d.x)},${Math.floor(d.y)}`;
  const inLab = probe.decals.filter((d) => CLUTTER(d) && floor.has(at(d)));
  const inTheWay = probe.decals.filter((d) => solid.has(at(d))).length;
  const under = probe.decals.filter((d) => beneath.has(at(d))).length;
  const kinds = [...new Set(inLab.map((d) => d.kind))].join(', ');
  const fine = inLab.length >= 2 && inTheWay === 0;
  console.log(
    `decals-lab.png     ${player.name}: ${inLab.length} marks on the Labor's floor (${kinds}), ` +
      `${probe.decals.length} in the lab: ${inTheWay} on furniture, a door, a plate or the ` +
      `exit, ${under} under a station or a source${fine ? '' : ' !!'}`,
  );
  if (!fine) {
    fail(`decals-lab.png: ${inLab.length} marks in the Labor, ${inTheWay} in the way`);
  }
}

/**
 * standby-dark.png: the player in the Maschinenraum walks to its east end, up to the door to
 * the Labor, so that the generators sleep behind them out of their lamp's reach — only their
 * standby lamps and the wall screen glowing in the dark (client render/standby.ts).
 */
async function captureStandby(machine) {
  const door = BLACKOUT.map.doors.find((d) => d.id === 'labortuer');
  if (!(await walkNear(machine.page, machine.seen, { x: door.x - 1, y: door.y }))) {
    fail('standby-dark.png: the walk to the Maschinenraum’s east end found no way');
    return;
  }
  await sleep(1500); // the camera settles behind the walk
  await capture(machine.page, 'standby-dark.png');
  const at = tileOf(machine.seen);
  console.log(
    `standby-dark.png   ${machine.name} at ${at?.x},${at?.y}, the generators asleep behind them`,
  );
}

/**
 * The art tour, for Blackout only: its scratch copy saved through the
 * editor's route, played by two and watched by one through the captures of
 * `artCaptures`, then deleted again whatever happened.
 */
async function captureArtTour() {
  if (MISSION.toLowerCase() !== 'blackout') {
    skip('art-*.png', `the art tour plays Blackout's copy; this run plays ${MISSION}`);
    return;
  }
  const api = await request.newContext({ baseURL: BASE });
  const catalog = await (await api.get('/missions')).json();
  if (catalog.some((info) => info.id === ART_MISSION.id)) {
    skip('art-*.png', `this server has its own ${ART_MISSION.id}: the tour leaves it be`);
    await api.dispose();
    return;
  }
  const saved = await api.post('/missions/custom', { data: artMission() });
  if (saved.status() !== 201) {
    fail(`art tour: the scratch copy was not taken (${saved.status()}): ${await saved.text()}`);
    await api.dispose();
    return;
  }
  const pages = [];
  try {
    const lobby = await artLobby();
    pages.push(lobby.host, lobby.guest, lobby.watcher);
    await clickText(lobby.guest.page, 'Ich bin bereit');
    const start = lobby.host.page.locator('button.lobby-start:enabled', {
      hasText: 'Mission starten',
    });
    await start.waitFor({ state: 'visible', timeout: 10_000 });
    await start.click();
    await lobby.host.page.locator('.stage').waitFor({ timeout: START_MS });
    await lobby.guest.page.locator('.stage').waitFor({ timeout: START_MS });
    await artCaptures(lobby);
  } catch (err) {
    console.log(`art tour           !! ${firstLine(err)}`);
    fail(`art tour: ${firstLine(err)}`);
  } finally {
    for (const { context } of pages) {
      await context.close();
    }
    const gone = await api.delete(`/missions/custom/${ART_MISSION.id}`);
    console.log(`art tour           ${ART_MISSION.id} deleted again: ${gone.status()}`);
    await api.dispose();
  }
}

/**
 * The Serverraum's scratch mission (tools/fixtures/servers-probe.json,
 * „Serverprobe", custom-serverprobe) and the walkthrough of its pinned seed
 * (servers-plan.json): the seed, the table the terminal opens on, and the
 * moves core's solver plans for it from the two consoles' views. Node cannot
 * load core's TypeScript, so the plan is carried; core's test of the module
 * keeps it the solver's own, and the step below fails where the terminal
 * opens on another table.
 */
const SERVERS_FILE = fileURLToPath(new URL('fixtures/servers-probe.json', import.meta.url));
const SERVERS_MISSION = JSON.parse(readFileSync(SERVERS_FILE, 'utf8'));
const SERVERS_PLAN = JSON.parse(
  readFileSync(fileURLToPath(new URL('fixtures/servers-plan.json', import.meta.url)), 'utf8'),
);

/**
 * A player of a scratch mission's drill — `drill` names it in the log: „servers", „access" —
 * in a context of its own at laptop size, a touch screen where `touch` says so.
 */
async function probePlayer(drill, name, touch = false) {
  const context = await browser.newContext({ viewport: SIZES[0], hasTouch: touch });
  await wonBefore(context);
  const page = await openPage(context, `${drill} ${name}`);
  page.on('pageerror', (e) => console.log(`[${drill} ${name} error]`, e.message));
  return { name, page, seen: eavesdrop(page), context };
}

/**
 * The editor at /editor?seed=<seed>, the scratch mission `mission` imported from `file` and
 * started as its test run under `host`'s name: the room is pinned to the seed, as its lobby has
 * to say — the log's lines and a failure under `drill`'s name. Returns the room's code.
 */
async function openProbeRoom(host, { drill, file, mission, seed }) {
  const { title } = mission;
  await importProbe(host.page, file, title, `/editor?seed=${seed}`);
  const play = host.page.locator('.editor-actions button:not([disabled])', {
    hasText: 'Probespiel',
  });
  if (!(await attached(play, 3000))) {
    throw new Error(`„${title}" stays unsound: ${(await editorErrors(host.page)).join(' | ')}`);
  }
  await play.click();
  await host.page.locator('.editor-play input').fill(host.name);
  await host.page.locator('.editor-play button[type="submit"]').click();
  await host.page.locator('.lobby', { hasText: title }).waitFor({ timeout: 10_000 });
  const code = (await host.page.locator('.room-code strong').innerText()).trim();
  await host.page.locator('.room-seed').waitFor({ timeout: 3000 }).catch(() => undefined);
  const shown = await textOf(host.page.locator('.room-seed'));
  const pinned = shown === `Seed ${seed}`;
  console.log(
    `${drill.padEnd(19)}„${title}" imported at /editor, its test run in room ${code}, ` +
      (pinned ? `pinned to seed ${seed}` : `!! not pinned (${shown ?? 'no seed'})`),
  );
  if (!pinned) {
    fail(`${drill}: the test run is not pinned to seed ${seed} — ALLOW_SEED=1?`);
  }
  return code;
}

/** `guest` joins the room `code` from the menu. */
async function joinProbeRoom(guest, code) {
  await guest.page.goto(paged(BASE));
  await guest.page.getByPlaceholder('z. B. Anna').fill(guest.name);
  await byCode(guest.page, code);
  await guest.page.locator('.lobby').waitFor({ timeout: 10_000 });
}

/**
 * servers-manual.png: `reader` walks to the locker that holds the rules,
 * searches it and reads them, the first page open. Throws where it cannot.
 */
async function readServersManual(reader) {
  const [locker] = SERVERS_MISSION.map.manuals;
  const [spot] = locker.spots;
  if (!(await walkNear(reader.page, reader.seen, spot))) {
    throw new Error(`${reader.name} found no way to the ${locker.label} at ${spot.x},${spot.y}`);
  }
  const target = sourceTarget({ id: locker.id, label: locker.label, ...spot });
  const opened = () => reader.seen.view.map.manuals.some((m) => m.id === locker.id && m.opened);
  if (!(await pressUntil(reader, target, 'the open locker', opened))) {
    throw new Error(`${reader.name} pressed E at the ${locker.label}, but it stayed shut`);
  }
  const overlay = reader.page.locator('.reading-modal');
  if (!(await interactUntil(reader, overlay, target))) {
    throw new Error(`${reader.name} searched the ${locker.label}, but no .reading-modal opened`);
  }
  await sleep(500); // past the page's fade-in
  await capture(reader.page, 'servers-manual.png');
  const where = await textOf(overlay.locator('.book-where, .terminal-status'));
  const over = await sideways(reader.page, '.reading-modal .panel');
  console.log(
    `servers-manual.png ${reader.name} at the ${locker.label}: ${where ?? 'one sheet'}, ` +
      `${await pagesRunningOver(reader.page)} page(s) run over, ` +
      `panel ${over > 0 ? `!! +${over}px sideways` : 'fits sideways'}`,
  );
  await reader.page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'hidden', timeout: 3000 });
}

/**
 * Whoever the draw put nearer console A works it — the Serverraum's terminal, the
 * Zugangskontrolle's — the other one console B. Returns them in that order.
 */
function probeSeats(players) {
  const consoleA = players[0].seen.view.map.stations.find((s) => s.console === 'a');
  return [...players].sort((p, q) => stepsTo(p.seen, consoleA) - stepsTo(q.seen, consoleA));
}

/**
 * Both walk to their console and open its panel with E — the first E
 * switches the station on. Throws unless the terminal and the rack show.
 */
async function manServers({ terminal, rack }) {
  const stations = terminal.seen.view.map.stations;
  const seats = [
    [terminal, stations.find((s) => s.console === 'a')],
    [rack, stations.find((s) => s.console === 'b')],
  ];
  for (const [player, spot] of seats) {
    if (!(await walkNear(player.page, player.seen, spot))) {
      const where = `console ${spot.console} at ${spot.x},${spot.y}`;
      throw new Error(`${player.name} found no way to ${where}`);
    }
  }
  for (const [player, spot] of seats) {
    const modal = player.page.locator('.station-modal');
    if (!(await interactUntil(player, modal, consoleTarget(spot)))) {
      throw new Error(`${player.name} stands at console ${spot.console}, but no .station-modal`);
    }
  }
  const role = (player) => player.seen.view.puzzle?.role ?? null;
  if (!(await until(() => role(terminal) === 'terminal' && role(rack) === 'rack', 3000))) {
    throw new Error(`the Serverraum's panels say ${role(terminal)} and ${role(rack)}`);
  }
}

/** A table as one line of the log: „netz up, db E23, auth E42 off". */
function tableSaid(rows) {
  return (rows ?? [])
    .map((row) => `${row.service} ${row.running ? 'up' : row.code}${row.power ? '' : ' off'}`)
    .join(', ');
}

/** What each service needs running first, in the order of the table: the printed Netzplan. */
const NEEDS = ['—', 'NETZ', 'NETZ', 'NETZ, DNS', 'AUTH, DB', 'AUTH, DNS'];

/**
 * The terminal's column BRAUCHT as its page shows it, for the log — the run fails unless it is
 * the table's last and lists what each service needs, as NEEDS has it, and the rack has none.
 */
async function checkNeeds(terminal, rack) {
  const screen = terminal.page.locator('.station-modal .servers-crt');
  const heads = await screen.locator('.servers-table thead th').allInnerTexts();
  const needs = await screen.locator('.servers-needs').allInnerTexts();
  const onRack = await rack.page.locator('.station-modal .servers-needs').count();
  const listed = heads.at(-1) === 'BRAUCHT' && JSON.stringify(needs) === JSON.stringify(NEEDS);
  if (!listed || onRack > 0) {
    fail(`servers: BRAUCHT reads ${heads.at(-1)} ${needs.join(' | ')}; ${onRack} on the rack`);
  }
  return listed ? `BRAUCHT ${needs.join(' | ')}` : `!! BRAUCHT missing (${heads.join(' ')})`;
}

/**
 * servers-a.png, servers-b.png: both panels at laptop size, the terminal's
 * screen scrolled in, its table's last column BRAUCHT listing what each
 * service needs first (and none on the rack); each has to fit sideways at
 * 1440×820, 1280×720 and on a phone (420×760).
 */
async function captureServersConsoles({ terminal, rack }) {
  await sleep(1400); // past the panels' fade-in and the terminal's boot scroll
  await capture(terminal.page, 'servers-a.png');
  await capture(rack.page, 'servers-b.png');
  await captureRackDiagram(rack);
  const needs = await checkNeeds(terminal, rack);
  const sizes = [SIZES[0], { width: 1280, height: 720 }, SIZES[2]];
  const over = [];
  for (const player of [terminal, rack]) {
    for (const { width, height } of sizes) {
      await player.page.setViewportSize({ width, height });
      await sleep(250);
      const px = await sideways(player.page, '.station-modal .panel');
      if (px > 0) {
        over.push(`${player.name} @ ${width}x${height} +${px}px`);
      }
    }
    await player.page.setViewportSize(SIZES[0]);
  }
  const table = tableSaid(terminal.seen.view.puzzle?.rows);
  console.log(
    `servers-a.png      ${terminal.name} at ${seatOf(terminal)}: ${table}; ${needs}; ` +
      `servers-b.png ${rack.name} at ${seatOf(rack)}; ` +
      (over.length === 0 ? 'both fit sideways at all three sizes' : `!! ${over.join(', ')}`),
  );
  if (over.length > 0) {
    fail(`servers: a panel runs out sideways (${over.join(', ')})`);
  }
  await sleep(300);
}

/**
 * One move of the plan at its console — a switch at the rack (`rackMove`); a command at the
 * terminal, typed at the prompt where `typed` and the run plays devices (`typeCommand`, shot as
 * `shot` where one is named), else put together on the keys and sent with ⏎ — and its effect in
 * that console's view, or the solve. Returns the move as the log says it; throws where nothing
 * shows.
 */
async function serversMove({ terminal, rack }, move, typed, shot = null) {
  const index = terminal.seen.view.currentPuzzleIndex;
  const solved = () => terminal.seen.view.currentPuzzleIndex > index;
  if (move.by === 'partner') {
    return rackMove(rack, move.input, solved);
  }
  const { cmd, service } = move.input;
  const modal = terminal.page.locator('.station-modal');
  const last = terminal.seen.view.puzzle?.log?.at(-1)?.n ?? 0;
  const onTheKeys = async () => {
    await modal.locator(`.servers-key[data-cmd="${cmd}"]`).click();
    await modal.locator(`.servers-key[data-service="${service}"]`).click();
    await modal.locator('.servers-key--enter').click();
    return false;
  };
  const atThePrompt = async () => {
    await typeCommand(terminal, move.input, shot);
    return true;
  };
  const typedIt = typed ? await inGroup('devices', atThePrompt, onTheKeys) : await onTheKeys();
  const logged = () => (terminal.seen.view.puzzle?.log?.at(-1)?.n ?? 0) > last;
  if (!(await until(() => solved() || logged(), 3000))) {
    throw new Error(`${terminal.name} sent "${cmd} ${service}", but the log took no line`);
  }
  return `A ${cmd} ${service}${typedIt ? ' (getippt)' : ''}`;
}

/**
 * A switch thrown at the rack — `input` names the service and on or off — until its unit stands
 * so on the rack's view or the station solves (`solved`). Returns the move as the log says it;
 * throws where the unit stays.
 */
async function rackMove(rack, { power: service, on }, solved) {
  await rack.page.locator(`.station-modal .servers-switch[data-service="${service}"]`).click();
  const unit = () => rack.seen.view.puzzle?.rack?.find((u) => u.service === service);
  if (!(await until(() => solved() || unit()?.power === on, 3000))) {
    throw new Error(`${rack.name} switched ${service} ${on ? 'on' : 'off'}, but it stayed`);
  }
  return `B ${service} ${on ? 'an' : 'aus'}`;
}

/** Whether the terminal's prompt holds the focus on `page`. */
function promptFocused(page) {
  return page.evaluate(
    () => document.activeElement?.classList.contains('servers-input') === true,
  );
}

/**
 * A command typed at the terminal's prompt as a player types it — terminal-typing.png where
 * `shot` names it. The prompt has to hold the focus as the terminal opened; a click on the
 * screen's table takes the focus away, and the command's first letter typed then has to land at
 * the prompt all the same; Tab completes the command, a letter at a time where the words agree
 * no further, the service's first letter follows — the shot catches the line half typed, the
 * cursor lit after it — and Tab the service; Enter sends it, and the prompt has to hold the
 * focus again. The run fails where any of it does not hold.
 */
async function typeCommand(terminal, { cmd, service }, shot) {
  const { page, name } = terminal;
  const modal = page.locator('.station-modal');
  const input = modal.locator('.servers-input');
  const opened = await promptFocused(page);
  await modal.locator('.servers-table thead th').first().click();
  const lost = !(await promptFocused(page));
  await page.keyboard.type(cmd.charAt(0), { delay: 40 });
  const caught = (await input.inputValue()) === cmd.charAt(0);
  const steps = [];
  /** Tab, then the next letter where Tab stops short, until the line is `line`; whether it got there. */
  const tabTo = async (line) => {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const now = await input.inputValue();
      steps.push(now);
      if (now === line || !line.startsWith(now)) {
        return now === line;
      }
      await page.keyboard.type(line.charAt(now.length), { delay: 40 });
    }
    return false;
  };
  const command = await tabTo(`${cmd} `);
  await page.keyboard.type(service.charAt(0), { delay: 40 });
  const half = await input.inputValue();
  if (shot !== null) {
    // The block cursor blinks: the shot waits for its lit half.
    const lit = () => {
      const cursor = document.querySelector('.station-modal .servers-cursor');
      return cursor !== null && globalThis.getComputedStyle(cursor).opacity === '1';
    };
    await page.waitForFunction(lit, null, { timeout: 1500 }).catch(() => undefined);
    await capture(page, shot);
  }
  const whole = await tabTo(`${cmd} ${service}`);
  await page.keyboard.press('Enter');
  await sleep(150);
  const kept = await promptFocused(page);
  const label = `${shot ?? 'terminal typing'} `.padEnd(19);
  const ok = opened && lost && caught && command && whole && kept;
  console.log(
    `${label}${name}: the prompt ${opened ? 'held' : '!! did not hold'} the focus as it opened; ` +
      `a click on the screen ${lost ? 'took it' : '!! left it there'}, „${cmd.charAt(0)}" typed ` +
      `${caught ? 'went to the prompt' : '!! went elsewhere'}; Tab ${steps.map((s) => `„${s}"`).join(', ')}` +
      `${shot === null ? '' : `; shot at „${half}"`}; Enter sent it, the prompt ` +
      `${kept ? 'kept the focus' : '!! lost the focus'}`,
  );
  if (!ok) {
    fail(`${shot ?? 'terminal typing'}: typing at the terminal's prompt did not hold`);
  }
}

/**
 * servers-solved.png: the device right after the last move, solved — the
 * terminal's table up, the status strip sweeping green — before it closes
 * itself SOLVED_CLOSE_MS later. Returns when the shot came, ms after the
 * device showed solved; null where it never did.
 */
async function captureServersSolved(player) {
  const solved = player.page.locator('.station-modal .device--solved');
  if (!(await attached(solved, 3000))) {
    return null;
  }
  const seen = Date.now();
  await capture(player.page, 'servers-solved.png');
  return Date.now() - seen;
}

/**
 * A plan's moves played at both consoles, move by move, ~150 ms apart — the
 * first command typed at the prompt (`typeCommand`, caught as `typingShot`
 * where one is named), the rest put together on the keys — and the station
 * solved by the last move, without an alarm.
 */
async function playServers(crew, moves = SERVERS_PLAN.moves, typingShot = null) {
  const { terminal } = crew;
  const index = terminal.seen.view.currentPuzzleIndex;
  const alarms = terminal.seen.view.alarms.count;
  const from = Date.now();
  const said = await playMoves(crew, moves, typingShot);
  const shot = await inGroup('devices', () => captureServersSolved(terminal));
  const took = Date.now() - from;
  const solved = await until(() => terminal.seen.view.currentPuzzleIndex > index, 3000);
  const raised = terminal.seen.view.alarms.count - alarms;
  const alarmed = raised === 0 ? 'no alarm' : `!! ${raised} alarm(s)`;
  console.log(
    `servers            ${said.length} moves in ${seconds(took)} (${said.join(', ')}): ` +
      `${solved ? 'solved' : '!! not solved'}, ${alarmed}`,
  );
  const missed = await inGroup('devices', () => reportServersSolved(terminal, shot), () => false);
  if (!solved || raised > 0 || missed) {
    fail(`servers: the plan ended ${solved ? 'solved' : 'unsolved'} with ${raised} alarm(s)`);
  }
}

/**
 * The plan's `moves` at both consoles of `crew`, ~150 ms apart, the first command typed at the
 * prompt (`serversMove`, caught as `typingShot` where one is named). Returns the moves as the
 * log says them.
 */
async function playMoves(crew, moves, typingShot) {
  const said = [];
  for (const move of moves) {
    const typed = move.by === 'operator' && !said.some((line) => line.startsWith('A '));
    said.push(await serversMove(crew, move, typed, typed ? typingShot : null));
    if (said.length < moves.length) {
      await sleep(150);
    }
  }
  return said;
}

/**
 * servers-solved.png's line: how long after the device showed solved the shot came (`shot`, ms),
 * or that it never showed solved — which this returns, for the run to fail on.
 */
function reportServersSolved(terminal, shot) {
  console.log(
    `servers-solved.png ${terminal.name}: ` +
      (shot === null
        ? '!! the device never showed solved'
        : `shot ${shot} ms after it showed solved${shot >= SOLVED_CLOSE_MS ? ' (late)' : ''}`),
  );
  return shot === null;
}

/**
 * The Serverraum, proven in a scratch mission of its own: imported through
 * the editor at a pinned seed and started as its test run, the second player
 * joining by code. The player nearer the terminal reads the rules at the
 * locker first (servers-manual.png); both man their console (servers-a.png,
 * servers-b.png); the terminal's table has to be the one the plan was made
 * for, and the plan is played to the solve (servers-solved.png), logging how
 * long it took. The mission is deleted again whatever happened.
 */
async function captureServers() {
  if (MISSION.toLowerCase() === 'blackout') {
    skip(
      'servers (probe)',
      'Blackout plays its own Serverraum: its servers-*.png come from the run',
    );
    return;
  }
  const crew = [];
  try {
    const host = await probePlayer('servers', 'Anna');
    crew.push(host);
    const room = { drill: 'servers', file: SERVERS_FILE, mission: SERVERS_MISSION };
    const code = await openProbeRoom(host, { ...room, seed: SERVERS_PLAN.seed });
    const guest = await probePlayer('servers', 'Ben');
    crew.push(guest);
    await joinProbeRoom(guest, code);
    await startRun(host, guest);
    // Past the briefing's countdown, as in the walkthrough.
    await sleep(Math.max(0, host.seen.view.startedAt + 4200 - Date.now()));
    const [terminal, rack] = probeSeats([host, guest]);
    await readServersManual(terminal);
    await manServers({ terminal, rack });
    const rows = terminal.seen.view.puzzle?.rows ?? null;
    await captureServersConsoles({ terminal, rack });
    if (JSON.stringify(rows) !== JSON.stringify(SERVERS_PLAN.rows)) {
      console.log(`servers            !! seed ${SERVERS_PLAN.seed} opened on ${tableSaid(rows)}`);
      fail(
        `servers: seed ${SERVERS_PLAN.seed} deals another table than tools/fixtures/` +
          'servers-plan.json was made for — regenerate it from the core test',
      );
      return;
    }
    await playServers({ terminal, rack });
  } catch (err) {
    console.log(`servers            !! ${firstLine(err)}`);
    fail(`servers: ${firstLine(err)}`);
  } finally {
    for (const { context } of crew) {
      await context.close();
    }
    const api = await request.newContext({ baseURL: BASE });
    const gone = await api.delete(`/missions/custom/${SERVERS_MISSION.id}`).catch(() => null);
    const status = gone?.status() ?? 'no answer';
    console.log(`servers            ${SERVERS_MISSION.id} deleted again: ${status}`);
    await api.dispose();
  }
}

/**
 * The Zugangskontrolle's scratch mission (tools/fixtures/access-probe.json, „Zugangsprobe",
 * custom-zugangsprobe) and what its pinned seed deals (access-plan.json): the doors the
 * terminal asks for, the list on the clipboard, and the account core's solver logs in for each
 * door. The tokens are in no plan — they hang on the server's clock —: the drill reads each off
 * the token device as the player there would. Core's test of the module keeps the plan the
 * solver's own.
 */
const ACCESS_FILE = fileURLToPath(new URL('fixtures/access-probe.json', import.meta.url));
const ACCESS_MISSION = JSON.parse(readFileSync(ACCESS_FILE, 'utf8'));
const ACCESS_PLAN = JSON.parse(
  readFileSync(fileURLToPath(new URL('fixtures/access-plan.json', import.meta.url)), 'utf8'),
);
/** The least a period has to have left for the drill to read its token off the device. */
const ACCESS_READ_MS = 4000;
/**
 * How long the drill waits for the device to come round to an account: it turns through three, a
 * period each, so two periods and the one under way, and some slack.
 */
const ACCESS_TURN_MS = 3 * ACCESS_MISSION.puzzles[0].tokenSec * 1000 + 5000;

/** The open Zugangskontrolle as `player`'s page has it; null for none. */
function accessView(player) {
  const puzzle = player.seen.view?.puzzle ?? null;
  return puzzle?.kind === 'access' ? puzzle : null;
}

/**
 * `player` walks to console `letter` of the probe and opens its panel with E — at console B the
 * first E switches the station on — and the panel has to show its `part`: the terminal or the
 * device. Throws where it does not.
 */
async function manAccess(player, letter, part) {
  const spot = player.seen.view.map.stations.find((station) => station.console === letter);
  if (!(await walkNear(player.page, player.seen, spot))) {
    throw new Error(`${player.name} found no way to console ${letter} at ${spot.x},${spot.y}`);
  }
  const modal = player.page.locator('.station-modal');
  if (!(await interactUntil(player, modal, consoleTarget(spot)))) {
    throw new Error(`${player.name} stands at console ${letter}, but no .station-modal`);
  }
  if (!(await until(() => (accessView(player)?.[part] ?? null) !== null, 3000))) {
    throw new Error(`${player.name}'s console ${letter} shows no ${part}`);
  }
}

/**
 * access-list.png: `reader` walks to the clipboard and reads the list of this shift's accounts
 * under the rules — there once the station is on. The list has to be the one the plan was made
 * for, every account of it on the page, or the run fails naming the seed.
 */
async function readAccessList(reader) {
  const [clipboard] = ACCESS_MISSION.map.manuals;
  const [spot] = clipboard.spots;
  if (!(await walkNear(reader.page, reader.seen, spot))) {
    throw new Error(`${reader.name} found no way to the ${clipboard.label} at ${spot.x},${spot.y}`);
  }
  const target = sourceTarget({ id: clipboard.id, label: clipboard.label, ...spot });
  const overlay = reader.page.locator('.reading-modal');
  if (!(await interactUntil(reader, overlay, target))) {
    throw new Error(`${reader.name} at the ${clipboard.label}, but no .reading-modal opened`);
  }
  const list = overlay.locator('.access-roster');
  await list.waitFor({ timeout: 3000 });
  await sleep(500); // past the page's fade-in
  await capture(reader.page, 'access-list.png');
  const names = await list.locator('tbody tr td:first-child').allInnerTexts();
  const dealt = JSON.stringify(accessView(reader)?.roster) === JSON.stringify(ACCESS_PLAN.roster);
  const shown = ACCESS_PLAN.roster.every(({ name }) => names.includes(name));
  console.log(
    `access-list.png    ${reader.name} at the ${clipboard.label}: ${names.join(', ')}` +
      (dealt && shown ? '' : ` !! the plan's list is ${ACCESS_PLAN.roster.map((a) => a.name)}`),
  );
  await reader.page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'hidden', timeout: 3000 });
  if (!dealt || !shown) {
    fail(
      `access: seed ${ACCESS_PLAN.seed} deals another list than tools/fixtures/access-plan.json ` +
        'was made for — regenerate it from the core test',
    );
  }
}

/**
 * access-terminal.png, access-token.png: both devices at laptop size, the terminal's screen
 * scrolled in; the terminal has to ask for the doors the plan was made for, the device has to
 * show a token in its digits — the one its view holds.
 */
async function captureAccessConsoles({ terminal, token }) {
  await sleep(1400); // past the panels' fade-in and the terminal's boot scroll
  await capture(terminal.page, 'access-terminal.png');
  await capture(token.page, 'access-token.png');
  const doors = doorsAsked(terminal);
  const device = tokenDevice(token);
  const digits = (await textOf(token.page.locator('.station-modal .access-digits'))) ?? '';
  const asked = JSON.stringify(doors) === JSON.stringify(ACCESS_PLAN.doors);
  const read = digits.replace(/\s+/g, '') === device?.token;
  console.log(consolesSaid({ terminal, token, doors, device, digits, asked, read }));
  if (!asked) {
    fail(`access: seed ${ACCESS_PLAN.seed} asks for other doors than access-plan.json names`);
  }
  if (!read) {
    fail(`access: the device shows „${digits}", its view says ${device?.token}`);
  }
}

/** The doors `player`'s terminal asks for, in its order; none where it shows no terminal. */
const doorsAsked = (player) =>
  accessView(player)?.terminal?.doors.map((row) => row.door) ?? [];

/** The token device `player` has open: its account, token and period's end; null for none. */
const tokenDevice = (player) => accessView(player)?.device ?? null;

/** The log's line for both devices as shot (`captureAccessConsoles`). */
function consolesSaid({ terminal, token, doors, device, digits, asked, read }) {
  return (
    `access-terminal.png ${terminal.name} at ${seatOf(terminal)}: asks for ${doors.join(', ')}` +
    `${asked ? '' : ' !! not the plan’s doors'}; access-token.png ${token.name}: ` +
    `${device?.account ?? '?'} „${digits}"${read ? '' : ' !! not the view’s token'}`
  );
}

/** The access drill's phone targets, measured short while a device still moved: skipped. */
const accessUnjudged = (why) => skip('access (targets)', why);

/**
 * access-phone-932.png: the terminal on a large phone held sideways (SIZES[4]) — both pages are
 * touch screens — whole in the window, nothing of it scrolling, every control in view and 44 px
 * at least each way (`phoneReach`); the token device held the same way on its page, checked
 * without a shot. Both go back to laptop size.
 */
async function accessOnPhone({ terminal, token }) {
  await phoneReach(terminal, SIZES[4], { shot: 'access-phone-932.png', unjudged: accessUnjudged });
  await phoneReach(token, SIZES[4], { label: 'access token 932', unjudged: accessUnjudged });
  for (const { page } of [terminal, token]) {
    await page.setViewportSize({ width: SIZES[0].width, height: SIZES[0].height });
  }
  await sleep(300);
}

/**
 * `login <account>` at the terminal's prompt — `typed`: its first letter typed and Tab
 * completing the command, else the bezel's login key —, the account's name typed after it and
 * Enter; the prompt has to ask for the account's token then. Returns the line as sent.
 */
async function accessLogin(terminal, account, typed) {
  const { page } = terminal;
  const modal = page.locator('.station-modal');
  if (typed) {
    await page.keyboard.type('l', { delay: 40 });
    await page.keyboard.press('Tab');
  } else {
    await modal.locator('.servers-key[data-cmd="login"]').click();
  }
  await page.keyboard.type(account, { delay: 40 });
  const line = await modal.locator('.servers-input').inputValue();
  await page.keyboard.press('Enter');
  if (!(await until(() => accessView(terminal)?.terminal?.prompt === account, 3000))) {
    throw new Error(`${terminal.name} sent „${line}", but the prompt asks for no token of ${account}`);
  }
  return line;
}

/**
 * The token device watched until it shows `account` with ACCESS_READ_MS left at least, then its
 * six digits read off the display — the view's token, or the run fails. Returns them and how long
 * the device took to come round.
 */
async function readToken(token, account) {
  const from = Date.now();
  const ready = () => {
    const device = accessView(token)?.device ?? null;
    return device?.account === account && device.endsAt - Date.now() > ACCESS_READ_MS;
  };
  if (!(await until(ready, ACCESS_TURN_MS))) {
    throw new Error(`${token.name}'s device came round to ${account} with no time to read`);
  }
  await sleep(300); // the display takes the period's token
  const shown = await textOf(token.page.locator('.station-modal .access-digits'));
  const digits = shown?.replace(/\s+/g, '') ?? '';
  const told = accessView(token)?.device?.token;
  if (digits !== told) {
    throw new Error(`${token.name}'s display reads „${shown}", its view says ${told}`);
  }
  return { digits, waited: Date.now() - from };
}

/**
 * The token at the terminal's prompt — `typed`: in two groups as the device shows them and
 * Enter, else on the pad's keys and ⏎ —; the session has to open.
 */
async function sendToken(terminal, digits, typed) {
  const { page } = terminal;
  const modal = page.locator('.station-modal');
  if (typed) {
    await page.keyboard.type(`${digits.slice(0, 3)} ${digits.slice(3)}`, { delay: 40 });
    await page.keyboard.press('Enter');
  } else {
    for (const digit of digits) {
      await modal.locator(`.access-key[data-digit="${digit}"]`).click();
    }
    await modal.locator('.servers-key--enter').click();
  }
  if (!(await until(() => (accessView(terminal)?.terminal?.session ?? null) !== null, 3000))) {
    const last = accessView(terminal)?.terminal?.log.at(-1)?.text ?? 'nothing';
    throw new Error(`${terminal.name} sent ${digits}, but no session opened: „${last}"`);
  }
}

/** `door` released at the terminal on its key and ⏎; it has to stand released, or the station solve. */
async function releaseDoor(terminal, door) {
  const modal = terminal.page.locator('.station-modal');
  const index = terminal.seen.view.currentPuzzleIndex;
  await modal.locator(`.servers-key[data-door="${door}"]`).click();
  await modal.locator('.servers-key--enter').click();
  const released = () =>
    terminal.seen.view.currentPuzzleIndex > index ||
    accessView(terminal)?.terminal?.doors.some((row) => row.door === door && row.released) === true;
  if (!(await until(released, 3000))) {
    throw new Error(`${terminal.name} released ${door}, but it stays asked for`);
  }
}

/**
 * One door of the plan at both consoles: the login (`accessLogin`), the token read off the
 * device once it shows the account (`readToken`) and sent (`sendToken`), the door released —
 * the first door typed at the prompt, the next on the keys. At the first, the terminal asking
 * for the token is held sideways on the large phone as well, its numeric pad in place of the
 * door keys: whole, nothing scrolling, every control 44 px (`phoneReach`, no shot). Returns the
 * door as the log says it.
 */
async function accessDoor({ terminal, token }, { door, account }, typed) {
  const line = await accessLogin(terminal, account, typed);
  if (typed) {
    await phoneReach(terminal, SIZES[4], { label: 'access pad 932', unjudged: accessUnjudged });
    await terminal.page.setViewportSize({ width: SIZES[0].width, height: SIZES[0].height });
  }
  const { digits, waited } = await readToken(token, account);
  await sendToken(terminal, digits, typed);
  await releaseDoor(terminal, door);
  const how = typed ? 'getippt' : 'Tasten';
  return `${door.toUpperCase()}: „${line}", Token ${digits} nach ${seconds(waited)} (${how})`;
}

/**
 * The plan's doors played at both consoles, one after the other; the station has to solve on
 * the last without an alarm. The log says how long it took and how long the device kept each
 * account waiting.
 */
async function playAccess(crew) {
  const { terminal } = crew;
  const alarms = terminal.seen.view.alarms.count;
  const from = Date.now();
  const said = [];
  for (const [i, login] of ACCESS_PLAN.logins.entries()) {
    said.push(await accessDoor(crew, login, i === 0));
  }
  const solved = await until(() => terminal.seen.view.currentPuzzleIndex > 0, 3000);
  const raised = terminal.seen.view.alarms.count - alarms;
  console.log(
    `access             ${said.length} doors in ${seconds(Date.now() - from)} ` +
      `(${said.join('; ')}): ${solved ? 'solved' : '!! not solved'}, ` +
      (raised === 0 ? 'no alarm' : `!! ${raised} alarm(s)`),
  );
  if (!solved || raised > 0) {
    fail(`access: the plan ended ${solved ? 'solved' : 'unsolved'} with ${raised} alarm(s)`);
  }
}

/**
 * The Zugangskontrolle, proven in a scratch mission of its own, in a Systemcheck run as the
 * Serverraum is (Blackout says it leaves it out): imported through the editor at a pinned seed and
 * started as its test run, the second player joining by code, both on touch screens. The player nearer console B switches the station on at the token device, the other
 * reads the list at the clipboard (access-list.png) and takes the terminal; both devices are
 * shot at laptop size (access-terminal.png, access-token.png) and on a large phone held sideways
 * (access-phone-932.png, the token device checked too); then the plan's doors are played, each
 * token read off the device. The mission is deleted again whatever happened.
 */
async function captureAccess() {
  if (MISSION.toLowerCase() === 'blackout') {
    skip('access (probe)', 'Blackout plays no Zugangskontrolle: its probe plays in a Systemcheck run');
    return;
  }
  const crew = [];
  try {
    const host = await probePlayer('access', 'Anna', true);
    crew.push(host);
    const room = { drill: 'access', file: ACCESS_FILE, mission: ACCESS_MISSION };
    const code = await openProbeRoom(host, { ...room, seed: ACCESS_PLAN.seed });
    const guest = await probePlayer('access', 'Ben', true);
    crew.push(guest);
    await joinProbeRoom(guest, code);
    await startRun(host, guest);
    // Past the briefing's countdown, as in the walkthrough.
    await sleep(Math.max(0, host.seen.view.startedAt + 4200 - Date.now()));
    const [terminal, token] = probeSeats([host, guest]);
    await manAccess(token, 'b', 'device');
    await readAccessList(terminal);
    await manAccess(terminal, 'a', 'terminal');
    await captureAccessConsoles({ terminal, token });
    await accessOnPhone({ terminal, token });
    await playAccess({ terminal, token });
  } catch (err) {
    console.log(`access             !! ${firstLine(err)}`);
    fail(`access: ${firstLine(err)}`);
  } finally {
    for (const { context } of crew) {
      await context.close();
    }
    const api = await request.newContext({ baseURL: BASE });
    const gone = await api.delete(`/missions/custom/${ACCESS_MISSION.id}`).catch(() => null);
    console.log(`access             ${ACCESS_MISSION.id} deleted again: ${gone?.status() ?? 'none'}`);
    await api.dispose();
  }
}

/** Holds the keys towards (tx, ty) as long as the avatar takes to walk there in a line. */
async function walkStraight(player, tx, ty) {
  const at = whereIs(player.seen);
  const dx = tx - at.x;
  const dy = ty - at.y;
  const keys = [
    ...(Math.abs(dx) >= STEP_TOLERANCE ? [dx > 0 ? 'd' : 'a'] : []),
    ...(Math.abs(dy) >= STEP_TOLERANCE ? [dy > 0 ? 's' : 'w'] : []),
  ];
  for (const key of keys) await player.page.keyboard.down(key);
  await sleep((Math.hypot(dx, dy) / SPEED) * 1000);
  for (const key of keys) await player.page.keyboard.up(key);
}

/** Walks `player` onto `tile` and stops in its middle; false where no open way leads there. */
async function standOn(player, tile) {
  return (
    (await walkNear(player.page, player.seen, tile)) &&
    (await stepTo(player.page, player.seen, tile.x + 0.5, tile.y + 0.5))
  );
}

// --- Blackout to the won card: past the drones, through the emergencies ------

/**
 * Blackout on its pinned seed as core's test/blackoutPlan.ts plays it
 * through the reducer: who starts where, where the sources lie, and every
 * station's answer. Node cannot load core's TypeScript, so the plan is
 * carried; the walkthrough checks each instance in the browser against it
 * before it plays the answer, and fails naming the seed where one differs.
 */
const BLACKOUT_PLAN = JSON.parse(
  readFileSync(fileURLToPath(new URL('fixtures/blackout-plan.json', import.meta.url)), 'utf8'),
);

/** How long a walk past the drones waits for a gap before it runs anyway, in ms. */
const SNEAK_GIVE_UP_MS = 45_000;
/** How soon after a look the avatar sets off at the latest, in s: the keys' way to the page. */
const REACTION_S = 0.05;
/** How long a run stands at a haven before it looks again, in s. */
const SETTLE_S = 0.3;
/** How far a walker caught out in the open looks round for a haven to run to, in tiles. */
const REFUGE_TILES = 8;
/** How far short of a turn a run lets go of its key, in ms of running: inside STEP_TOLERANCE. */
const RUN_SHORT_MS = 30;
/** How long a run waits once it lets go, for the avatar to report where it stopped, in ms. */
const REPORT_MS = 100;

/** The doors shut on `map`, by tile key. */
const shutOn = (map) => new Set(map.doors.filter((d) => !d.open).map((d) => `${d.x},${d.y}`));

/** The tiles of `map`'s camera plates, by key: a walk past the patrols steps round them. */
const cameraPlates = (map) =>
  new Set(map.plates.filter((p) => p.freezesDrone).map((p) => `${p.x},${p.y}`));

/**
 * Every drone awake on `seen`'s stream as patrol.mjs takes it — its beat
 * from Blackout's file — and how old that look is, in s. A drone held still
 * by its plate flies on in the forecast: the plate may be let go any moment.
 */
function dronesOn(seen) {
  const drones = Object.entries(seen.drones ?? {}).flatMap(([id, at]) => {
    const def = BLACKOUT.map.drones.find((d) => d.id === id);
    if (def === undefined) {
      return [];
    }
    const beat = { waypoints: def.waypoints, speed: def.speed ?? 1.5 };
    return [{ id, beat, range: at.range, halfAngleDeg: at.halfAngleDeg, at }];
  });
  return { drones, age: (Date.now() - (seen.dronesAt ?? Date.now())) / 1000 };
}

/** The havens worked out so far, by the doors shut and the drones awake that decide them. */
const havensBy = new Map();

/** The havens of `sight` from `drones` (patrol.mjs `havens`), worked out once for each state. */
function havensOn(drones, sight) {
  const key = `${[...sight.shut].sort().join(';')}|${drones.map((d) => d.id).sort().join(',')}`;
  if (!havensBy.has(key)) {
    havensBy.set(key, havens(drones, sight));
  }
  return havensBy.get(key);
}

/**
 * How the runs went against the pace patrol.mjs RUN allows, for the log's
 * line at the end: how many ran outside it and by how much at most, and the
 * least and most a stop took beyond the running, in s.
 */
const running = { runs: 0, outside: 0, worstS: 0, stopS: [Infinity, 0] };

/** Holds a run of `path` that took `ms` against the fastest and the slowest RUN allows. */
function timeRun(path, ms) {
  const fast = arrivals(path, RUN.tile[0], RUN.corner[0]).at(-1);
  const slow = arrivals(path, RUN.tile[1], RUN.corner[1]).at(-1) + RUN.corner[1];
  const took = ms / 1000;
  const stop = (took - (path.length - 1) / SPEED) / cornersOf(path).length;
  running.runs += 1;
  running.stopS = [Math.min(running.stopS[0], stop), Math.max(running.stopS[1], stop)];
  if (took < fast || took > slow) {
    running.outside += 1;
    running.worstS = Math.max(running.worstS, took < fast ? fast - took : took - slow);
  }
}

/**
 * Runs `player` along `path` as a player runs: the key held down along each
 * straight, then stepped onto the turn — and the end — exactly; patrol.mjs
 * RUN times it so, and each run is held against it (`timeRun`). Stops at the
 * turn where an emergency came meanwhile — the drones flew on through it —
 * for the walk to look again. False where it stopped short.
 */
async function runPath(player, path) {
  const started = Date.now();
  const emergencyCount = () => emergencies.weathered + emergencies.missed;
  const before = emergencyCount();
  for (const i of cornersOf(path)) {
    const at = whereIs(player.seen);
    const [tx, ty] = [path[i].x + 0.5, path[i].y + 0.5];
    const dx = tx - at.x;
    const dy = ty - at.y;
    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'd' : 'a') : dy > 0 ? 's' : 'w';
    const ms = (Math.hypot(dx, dy) / SPEED) * 1000 - RUN_SHORT_MS;
    if (ms > 0) {
      await player.page.keyboard.down(key);
      await sleep(ms);
      await player.page.keyboard.up(key);
      walking.ms.set(player.page, (walking.ms.get(player.page) ?? 0) + ms);
      await sleep(REPORT_MS);
    }
    if (!(await stepTo(player.page, player.seen, tx, ty)) || emergencyCount() !== before) {
      return false;
    }
  }
  timeRun(path, Date.now() - started);
  return true;
}

/**
 * The way from `here` to the nearest haven within REFUGE_TILES that `unseen`
 * lets a walker run, else to a tile beside it where it may stand a moment
 * unseen; null for neither.
 */
function refugeFrom(map, here, safe, unseen) {
  const ways = [...safe]
    .map((key) => key.split(',').map(Number))
    .filter(([x, y]) => Math.abs(x - here.x) + Math.abs(y - here.y) <= REFUGE_TILES)
    .map(([x, y]) => route(map, here, { x, y }))
    .filter((way) => way !== null && way.length - 1 <= REFUGE_TILES * 2)
    .sort((a, b) => a.length - b.length);
  const aside = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([dx, dy]) => route(map, here, { x: here.x + dx, y: here.y + dy }))
    .filter((way) => way !== null && way.length === 2);
  return ways.find((way) => unseen(way, SETTLE_S)) ?? aside.find((way) => unseen(way, 1.5)) ?? null;
}

/**
 * What `player` runs next on its way along `path` past the drones: the
 * stretch to the next haven (patrol.mjs `stretchOf`) once no drone's flight,
 * foretold from the stream, would spot it on the way — nor at the end of
 * `path` for `hold` s; or, caught out in the open with that stretch watched,
 * the way to a haven it can reach unseen (`refugeFrom`); null to wait where
 * it is. `late`, it runs the stretch whatever the drones do.
 */
function nextRun(player, map, path, hold, late) {
  const sight = { tiles: map.tiles, shut: shutOn(map) };
  const { drones, age } = dronesOn(player.seen);
  const safe = havensOn(drones, sight);
  const stretch = stretchOf(path, safe);
  if (late) {
    return stretch;
  }
  const unseen = (way, stand) => {
    const run = arrivals(way, RUN.tile[1], RUN.corner[1]).at(-1) + RUN.corner[1];
    const delay = age + REACTION_S;
    const flying = flights(drones, delay + run + stand + 0.5);
    return spottedOn(way, flying, sight, { delay, hold: stand }) === null;
  };
  const arrives = stretch.length === path.length;
  if (unseen(stretch, arrives ? hold : SETTLE_S)) {
    return stretch;
  }
  const [here] = path;
  return safe.has(`${here.x},${here.y}`) ? null : refugeFrom(map, here, safe, unseen);
}

/** What the walks past the drones came to, for the log's line at the end. */
const sneaking = { walks: 0, waitedMs: 0, ranAnyway: 0 };

/** `player`'s map; throws, saying how the run stands, where its view has none. */
function mapOf(player) {
  const view = player.seen.view;
  if (view?.map == null) {
    const alarms = view?.alarms?.count ?? '?';
    throw new Error(
      `${player.name} has no map to walk on: the run is ${view?.phase}, ${alarms} alarm(s)`,
    );
  }
  return view.map;
}

/**
 * `player` walks onto `target` past the awake drones, as a crew times its
 * run past a patrol: from haven to haven — the tiles no drone ever looks at
 * — each stretch run in one go once no drone would spot it on the way, nor
 * at `target` for `hold` s once there (`nextRun`), round the camera plates.
 * An emergency is weathered first. After SNEAK_GIVE_UP_MS without a gap it
 * runs anyway, and the log says so. Throws where no open way leads there.
 */
async function sneakTo(player, target, hold = 1.2) {
  const since = Date.now();
  let late = false;
  sneaking.walks += 1;
  for (;;) {
    await weather();
    const from = tileOf(player.seen);
    if (from.x === target.x && from.y === target.y) {
      await stepTo(player.page, player.seen, target.x + 0.5, target.y + 0.5);
      return;
    }
    const path = await wayThere(player.seen, target, cameraPlates(mapOf(player)));
    if (path === null) {
      throw new Error(
        `${player.name} found no way from ${from.x},${from.y} to ${target.x},${target.y} — ` +
          doorsSaid(player.seen),
      );
    }
    const map = mapOf(player);
    if (!late && Date.now() - since > SNEAK_GIVE_UP_MS) {
      late = true;
      sneaking.ranAnyway += 1;
      console.log(
        `sneak              !! ${player.name} found no gap in the patrols to ` +
          `${target.x},${target.y}`,
      );
    }
    const run = nextRun(player, map, path, hold, late);
    if (run === null) {
      await sleep(60);
      sneaking.waitedMs += 60;
      continue;
    }
    await runPath(player, run);
  }
}

/**
 * Before a step that leaves `player` out in the open where it stands once
 * done — a station solved stops hiding whoever works it: waits until no
 * drone's flight, foretold from the stream, will look there for the next
 * `seconds`. After SNEAK_GIVE_UP_MS it goes on anyway, and the log says so.
 */
async function clearOfDrones(player, seconds) {
  const since = Date.now();
  for (;;) {
    const map = mapOf(player);
    const sight = { tiles: map.tiles, shut: shutOn(map) };
    const { drones, age } = dronesOn(player.seen);
    const flying = flights(drones, age + seconds + RUN.corner[1] + 0.5);
    const here = [tileOf(player.seen)];
    if (spottedOn(here, flying, sight, { delay: age, hold: seconds }) === null) {
      return;
    }
    if (Date.now() - since > SNEAK_GIVE_UP_MS) {
      console.log(`sneak              !! no moment ${player.name}'s spot stays out of sight`);
      return;
    }
    await sleep(60);
    sneaking.waitedMs += 60;
  }
}

/** The run report's line for a drone's sighting (core actions.ts DRONE_ALARM). */
const DRONE_SIGHTING = 'Von einer Drohne erfasst';

/** The drone sightings of the walkthrough, for the log's line at the end. */
const sightings = { count: 0 };

/** Where `seen`'s drones fly and look, for the log. */
function dronesSaid(seen) {
  const drones = Object.entries(seen.drones ?? {}).map(
    ([id, d]) =>
      `${id} at ${d.x.toFixed(1)},${d.y.toFixed(1)} looking ` +
      `${Math.round((d.facing * 180) / Math.PI)}°${d.frozen ? ' (held)' : ''}`,
  );
  return drones.join(', ') || 'no drone awake';
}

/**
 * Logs each drone sighting the moment the first of `crew` hears of it: how
 * long after the blackout, where each of the crew stood and where each drone
 * flew. Returns the function that stops listening.
 */
function watchSightings(crew) {
  const [first] = crew;
  const keyOf = (event) => `${event.at}|${event.kind}|${event.label}`;
  const heard = new Set(first.seen.view.events.map(keyOf));
  const timer = setInterval(() => {
    const view = first.seen.view;
    for (const event of view?.events ?? []) {
      if (heard.has(keyOf(event))) {
        continue;
      }
      heard.add(keyOf(event));
      if (event.kind === 'penalty' && event.label === DRONE_SIGHTING) {
        sightings.count += 1;
        const where = crew.map((p) => {
          const at = whereIs(p.seen);
          return `${p.name} at ${at.x.toFixed(1)},${at.y.toFixed(1)}`;
        });
        console.log(
          `sighting           !! ${seconds(event.at - view.lights.outAt)} after the blackout: ` +
            `${where.join(', ')}; ${dronesSaid(first.seen)}`,
        );
      }
    }
  }, 50);
  return () => clearInterval(timer);
}

/**
 * The crew whose pages weather a relay emergency together: filled while
 * Blackout is played through, empty elsewhere — then `weather` does nothing.
 */
const relayCrew = [];

/** Whether `seen`'s view has an emergency on. */
const emergencyOn = (seen) => seen.view?.map?.sabotage != null;

/** A control's name as a pattern that matches it whole. */
const wholeName = (name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/**
 * `owner` carries out the instruction `holder` reads out, on the relay
 * console the emergency put up on owner's page — a switch thrown, a dial
 * set, a button pressed — and waits for holder's instruction to move on.
 * False where the console does not show the control yet.
 */
async function carryOut(owner, holder, order) {
  const card = owner.page
    .locator('.relay-modal .relay-control')
    .filter({ has: owner.page.locator('.relay-name', { hasText: wholeName(order.control) }) });
  if ((await card.count()) === 0) {
    return false;
  }
  const before = JSON.stringify(order);
  if (typeof order.value === 'boolean') {
    const toggle = card.locator('.relay-switch');
    if ((await toggle.getAttribute('aria-pressed')) !== String(order.value)) {
      await toggle.click({ timeout: 2000 });
    }
  } else if (typeof order.value === 'number') {
    await card.locator('.relay-dial button', { hasText: wholeName(String(order.value)) }).click();
  } else {
    await card.locator('.relay-press').click({ timeout: 2000 });
  }
  const moved = () =>
    JSON.stringify(holder.seen.view.map?.sabotage?.relay?.instruction ?? null) !== before;
  await until(moved, 2000);
  return true;
}

/** The emergencies the walkthrough weathered, for the log's line at the end. */
const emergencies = { weathered: 0, missed: 0 };

/** The run report's lines for how an emergency ended (core actions.ts EMERGENCY_*). */
const EMERGENCY_CLEARED = 'Notfall behoben';
const EMERGENCY_MISSED = 'Notfall nicht rechtzeitig behoben';

/**
 * How the newest emergency on `seen`'s run report ended: the first line
 * after its start that clears or misses it — a sighting or a radio line may
 * follow it at once — or undefined while none has.
 */
function emergencyEnd(seen) {
  const events = seen.view.events;
  const start = events.findLastIndex(
    (e) => e.kind === 'sabotage' && e.label !== EMERGENCY_CLEARED,
  );
  return events
    .slice(start + 1)
    .find((e) => e.label === EMERGENCY_CLEARED || e.label === EMERGENCY_MISSED);
}

/**
 * A relay emergency weathered from both pages: each player's instruction is
 * carried out at the console of the player it names, round after round,
 * until it is over. Nothing while none is on, or outside Blackout's
 * walkthrough. Logs how it went.
 */
async function weather() {
  if (relayCrew.length === 0 || !relayCrew.some((p) => emergencyOn(p.seen))) {
    return;
  }
  const from = Date.now();
  const label = relayCrew.find((p) => emergencyOn(p.seen))?.seen.view.map.sabotage.label;
  for (const player of relayCrew) {
    if (await player.page.locator('.relay-modal').isVisible()) {
      await inGroup('devices', () => captureDevicePhone(player, 'relay'));
    }
  }
  while (relayCrew.some((p) => emergencyOn(p.seen)) && Date.now() - from < 70_000) {
    let acted = false;
    for (const holder of relayCrew) {
      const order = holder.seen.view.map?.sabotage?.relay?.instruction ?? null;
      const owner = relayCrew.find((p) => p.seen.view.you.name === order?.playerName);
      if (order !== null && owner !== undefined) {
        acted = (await carryOut(owner, holder, order)) || acted;
      }
    }
    if (!acted) {
      await sleep(100);
    }
  }
  const end = emergencyEnd(relayCrew[0].seen);
  const cleared = end?.label === EMERGENCY_CLEARED;
  emergencies[cleared ? 'weathered' : 'missed'] += 1;
  console.log(
    `emergency          "${label}" at both relay consoles for ${seconds(Date.now() - from)}: ` +
      (cleared ? 'cleared' : `!! ${end?.label ?? 'no word of it'}`),
  );
  if (!cleared) {
    fail(`emergency "${label}" was not cleared at the relay consoles`);
  }
}

/**
 * Seconds until the next emergency of Blackout's schedule, as its file has
 * it: once its `afterSolved` stations are done and until the last one is,
 * the first `firstAfterSec` after the lights went out, then every
 * `everySec`; Infinity while none can come, or one is on.
 */
function nextEmergencyIn(seen) {
  const sabotage = BLACKOUT.map.sabotage;
  const view = seen.view;
  const solved = view.currentPuzzleIndex;
  if (emergencyOn(seen) || solved < sabotage.afterSolved || solved >= view.puzzleCount) {
    return Infinity;
  }
  const since = (Date.now() - view.lights.outAt) / 1000;
  const first = sabotage.firstAfterSec;
  const every = sabotage.everySec;
  const next = since < first ? first : Math.ceil((since - first) / every) * every + first;
  return next - since;
}

/**
 * Before a step of about `seconds` that an emergency must not cut short:
 * where the next one is due before it would be done, wait for it and
 * weather it first.
 */
async function clearOfEmergencies(player, seconds) {
  const due = nextEmergencyIn(player.seen);
  if (due > seconds) {
    return;
  }
  console.log(`emergency          due in ${due.toFixed(1)} s: waited for it before the next step`);
  await until(() => emergencyOn(player.seen), (due + 6) * 1000);
  await weather();
}

/**
 * The drones a spot to work `player`'s station at hand from has to keep clear of, as
 * patrol.mjs takes them: those awake now and those its solve wakes — solved, a station hides
 * nobody, and its crew still stands there a moment — at Blackout's own reach and pace.
 */
function patrolsAround(player) {
  const index = player.seen.view.currentPuzzleIndex;
  return BLACKOUT.map.drones
    .filter((drone) => drone.activeAfterSolved <= index + 1)
    .map((drone) => ({
      id: drone.id,
      beat: { waypoints: drone.waypoints, speed: drone.speed ?? 1.5 },
      range: drone.range ?? 4.5,
      halfAngleDeg: drone.halfAngleDeg ?? 30,
    }));
}

/**
 * Where `player` stands to work or read at `target` — a station's console, the place the plan
 * lays a source — on the map as its page shows it: a free tile beside it, or the tile itself,
 * where the server counts it there; of those, one no drone ever looks at (`patrolsAround`,
 * patrol.mjs `havens`) where the room has one — a station hides whoever works it only once its
 * panel is open — then one beside the target rather than on it, then the nearest to `player`.
 * Never a camera plate: it would hold a drone still. Throws where no tile is free.
 */
function workSpot(player, target) {
  const map = mapOf(player);
  const solid = furniture(map);
  const plates = cameraPlates(map);
  const free = ({ x, y }) =>
    map.tiles[y]?.[x] === '.' && !solid.has(`${x},${y}`) && !plates.has(`${x},${y}`);
  const safe = havensOn(patrolsAround(player), { tiles: map.tiles, shut: shutOn(map) });
  const here = tileOf(player.seen) ?? target;
  const rank = (tile) => [
    safe.has(`${tile.x},${tile.y}`) ? 0 : 1,
    tile.x === target.x && tile.y === target.y ? 1 : 0,
    Math.abs(tile.x - here.x) + Math.abs(tile.y - here.y),
  ];
  const order = (a, b) => {
    const [first, second] = [rank(a), rank(b)];
    const i = first.findIndex((value, k) => value !== second[k]);
    return i < 0 ? 0 : first[i] - second[i];
  };
  const [spot] = [...NEIGHBOURS, [0, 0]]
    .map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))
    .filter(free)
    .sort(order);
  if (spot === undefined) {
    throw new Error(`no free tile to stand on by ${target.x},${target.y}`);
  }
  return spot;
}

/** Where `player` stands at the armed station's console `side` ('a', 'b', or null for one). */
const atConsole = (player, side) => workSpot(player, armedAt(player, side));

/**
 * Blackout's source of `kind` and where the pinned seed lays it: the crew
 * comes across it only once somebody is near, so the plan says where.
 */
function pinnedSource(kind) {
  const source = BLACKOUT.map.manuals.find((m) => m.kind === kind);
  const at = source === undefined ? undefined : BLACKOUT_PLAN.places[source.id];
  if (source === undefined || at === undefined) {
    throw new Error(`Blackout has no ${kind}, or its plan lays none`);
  }
  return { id: source.id, label: source.label, ...at };
}

/** Once `player` has come near, the crew knows of `source`, where the plan lays it. */
async function foundWherePinned(player, source) {
  const shown = () => player.seen.view.map.manuals.find((m) => m.id === source.id && m.known);
  await until(() => shown() !== undefined, 3000);
  const found = shown();
  if (found?.x !== source.x || found.y !== source.y) {
    const shown = found === undefined ? 'nowhere in sight' : `at ${found.x},${found.y}`;
    differs(source.label, shown, `at ${source.x},${source.y}`);
  }
}

/** Fails the walkthrough where an instance differs from what Blackout's pinned plan holds. */
function differs(what, shown, pinned) {
  throw new Error(
    `Blackout seed ${SEED} no longer deals the pinned ${what}: ${shown} instead of ${pinned} — ` +
      'regenerate tools/fixtures/blackout-plan.json from core test/blackoutPlan.ts',
  );
}

/** The armed station's spot at console `side` ('a', 'b'), or its only one (null). */
function armedAt(player, side) {
  const spots = player.seen.view.map.stations.filter((s) => s.status === 'armed');
  const spot = spots.find((s) => (s.console ?? null) === side);
  if (spot === undefined) {
    throw new Error(`no armed station${side === null ? '' : ` with a console ${side}`}`);
  }
  return spot;
}

/**
 * `player` opens the armed station's panel with E at its console `side` ('a', 'b', or null for
 * its only one); throws where none comes.
 */
async function openPanel(player, side) {
  const spot = armedAt(player, side);
  const modal = player.page.locator('.station-modal');
  if (!(await interactUntil(player, modal, consoleTarget(spot)))) {
    const at = `${player.name} stands at "${spot.title}"`;
    throw new Error(`${at}, but no .station-modal after ${TRIES}`);
  }
  await sleep(300); // past its fade-in
}

/** Whether the station `index` is solved on `player`'s view. */
const solvedPast = (player, index) => player.seen.view.currentPuzzleIndex > index;

/**
 * The meter at console B reads every wire still whole that it has no reading
 * of this round — once its page has heard of the cut before, which `box`'s
 * page shows first — and the readings have to be the plan's for this round.
 */
async function measureRound(meter, box, round, r) {
  const left = (player) => player.seen.view.puzzle?.liveLeft;
  const since = Date.now();
  if (!(await until(() => left(meter) === left(box), CATCH_UP_MS))) {
    throw new Error(
      `${meter.name}'s meter shows ${left(meter)} live wire(s) after ${seconds(CATCH_UP_MS)}, ` +
        `${box.name}'s box ${left(box)}`,
    );
  }
  const waited = Date.now() - since;
  if (waited >= 100) {
    console.log(
      `circuit            ${meter.name}'s meter caught up with the cut after ${waited} ms`,
    );
  }
  const wires = meter.seen.view.puzzle?.readings ?? [];
  for (const [i, pinned] of round.readings.entries()) {
    if (pinned !== null && wires[i] == null) {
      await meter.page.locator(`.station-modal .circuit-probe[data-index="${i}"]`).click();
      await until(() => meter.seen.view.puzzle?.readings?.[i] != null, 3000);
      await sleep(120);
    }
  }
  const read = JSON.stringify(meter.seen.view.puzzle?.readings ?? null);
  if (read !== JSON.stringify(round.readings)) {
    differs(`readings of round ${r + 1}`, read, JSON.stringify(round.readings));
  }
}

/**
 * The Notstrom-Kasten to the end, as the pinned seed wires it: the meter at
 * console B reads every wire still live and the box at console A cuts the
 * one the rules name — round after round, the readings and the cuts the
 * plan pins. Fails naming the seed where the box's wires, the serial or a
 * round's readings differ.
 */
async function finishNotstrom(box, meter) {
  const pin = BLACKOUT_PLAN.notstrom;
  const index = box.seen.view.currentPuzzleIndex;
  for (const [player, side] of [
    [box, 'a'],
    [meter, 'b'],
  ]) {
    if (!(await walkNear(player.page, player.seen, armedAt(player, side)))) {
      throw new Error(`${player.name} found no way back to console ${side} of the fuse box`);
    }
    await openPanel(player, side);
  }
  await inGroup('devices', () => captureDevicePhone(meter, stationSlug(meter)));
  const wires = (box.seen.view.puzzle?.wires ?? []).map((wire) => wire.colour).join(', ');
  if (wires !== pin.wires.join(', ')) {
    differs('fuse box', wires, pin.wires.join(', '));
  }
  const serial = box.seen.view.edgework?.serial ?? meter.seen.view.edgework?.serial;
  if (serial !== BLACKOUT_PLAN.serial) {
    differs('Laborkennung', serial, BLACKOUT_PLAN.serial);
  }
  for (const [r, round] of pin.rounds.entries()) {
    await measureRound(meter, box, round, r);
    const cut = box.page.locator(`.station-modal .circuit-board [data-index="${round.cut}"]`);
    await cut.click({ timeout: 3000 });
    const done = () => solvedPast(box, index) || box.seen.view.puzzle?.wires?.[round.cut]?.cut;
    if (!(await until(done, 3000))) {
      throw new Error(`${box.name} cut wire ${round.cut + 1} of round ${r + 1}, but it held`);
    }
  }
  if (!(await until(() => solvedPast(box, index), 5000))) {
    throw new Error('every pinned wire is cut, but the Notstrom-Kasten did not solve');
  }
  console.log(
    `notstrom           ${meter.name} measured, ${box.name} cut wires ` +
      `${pin.rounds.map((round) => round.cut + 1).join(', ')} of ${wires} (serial ` +
      `${serial}, seed ${SEED}): solved`,
  );
}

/**
 * Both walk to their console of the Signalkette — the guest beside console A
 * at the Flur's east end, where the Flur drone does not look as it wakes, the
 * host beside console B in the Maschinenraum (`atConsole`) — open their panels
 * and work it as the plan pins it (`solveSignal`).
 */
async function playSignalkette(host, guest) {
  const title = armedAt(host, 'a').title;
  if (!(await standOn(guest, atConsole(guest, 'a')))) {
    throw new Error(`${guest.name} found no way to console A of "${title}"`);
  }
  if (!(await standOn(host, atConsole(host, 'b')))) {
    throw new Error(`${host.name} found no way to console B of "${title}"`);
  }
  await openPanel(guest, 'a');
  await inGroup('devices', () => captureDevicePhone(guest, stationSlug(guest)));
  await openPanel(host, 'b');
  await solveSignal([host, guest], title, BLACKOUT_PLAN.signalkette.stages);
}

/**
 * The Serverraum's rules in its locker: `reader` searches it with E, reads
 * them (servers-manual.png) — `watcher`'s window showing them reading it
 * (pose-reading.png) — and puts them down again. Throws where it cannot.
 */
async function readLocker(reader, locker, watcher) {
  const target = sourceTarget(locker);
  const opened = () => reader.seen.view.map.manuals.some((m) => m.id === locker.id && m.opened);
  if (!(await pressUntil(reader, target, 'the open locker', opened))) {
    throw new Error(`${reader.name} pressed E at the ${locker.label}, but it stayed shut`);
  }
  const overlay = reader.page.locator('.reading-modal');
  if (!(await interactUntil(reader, overlay, target))) {
    throw new Error(`${reader.name} searched the ${locker.label}, but no .reading-modal opened`);
  }
  await sleep(500); // past the page's fade-in
  await inGroup('devices', () => capture(reader.page, 'servers-manual.png'));
  await inGroup('graphics', () => capturePose(watcher, reader, 'reading', 'pose-reading.png'));
  await inGroup('devices', async () => {
    const where = (await textOf(overlay.locator('.book-where, .terminal-status'))) ?? 'one sheet';
    console.log(`servers-manual.png ${reader.name} at the ${locker.label}: ${where}`);
  });
  await reader.page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'hidden', timeout: 3000 });
}

/**
 * The Serverraum on the pinned seed: the host walks past the patrol to the
 * terminal, the guest to the locker; it searches it and reads the rules
 * (servers-manual.png). Clear of the next emergency the guest takes the rack
 * — out in the open until the panels are up — and both open their panels at
 * once (servers-a.png, servers-b.png), the terminal has to open on the plan's
 * table, and the plan's moves are played at both consoles (`playServers`), the
 * first command typed at the prompt (terminal-typing.png, `typeCommand`) —
 * at a moment no drone will look at the rack for a while: solved, the
 * station hides nobody, and the guest stands there until the next walk. An
 * emergency that drops the station anyway is weathered, and it is opened and
 * played again.
 */
async function playServerraum(host, guest) {
  const locker = pinnedSource('locker');
  await sneakTo(host, atConsole(host, 'a'));
  await inGroup('graphics', () => captureRackLeds(host));
  await sneakTo(guest, workSpot(guest, locker));
  await foundWherePinned(guest, locker);
  await readLocker(guest, locker, host);
  await clearOfEmergencies(host, 55);
  await sneakTo(guest, atConsole(guest, 'b'), 3);
  const crew = { terminal: host, rack: guest };
  const role = (player) => player.seen.view.puzzle?.role ?? null;
  await pastEmergencies(async () => {
    await openPanel(host, 'a');
    await openPanel(guest, 'b');
    if (!(await until(() => role(host) === 'terminal' && role(guest) === 'rack', 3000))) {
      throw new Error(`the Serverraum's panels say ${role(host)} and ${role(guest)}`);
    }
    const rows = host.seen.view.puzzle?.rows ?? null;
    await inGroup('devices', () => captureServersConsoles(crew));
    await inGroup('devices', () => captureDevicePhone(guest, stationSlug(guest)));
    if (JSON.stringify(rows) !== JSON.stringify(BLACKOUT_PLAN.subsysteme.rows)) {
      differs('terminal table', tableSaid(rows), tableSaid(BLACKOUT_PLAN.subsysteme.rows));
    }
    await clearOfDrones(guest, 9);
    await playServers(crew, BLACKOUT_PLAN.subsysteme.moves, 'terminal-typing.png');
  });
}

/**
 * A step of a station that an emergency may drop: run once more after the
 * emergency is weathered — the station opens on the same instance again.
 * Throws what the second try throws, or the first where no emergency came.
 */
async function pastEmergencies(step) {
  const sabotages = (p) => p.seen.view.events.filter((e) => e.kind === 'sabotage').length;
  const before = sabotages(relayCrew[0]);
  try {
    await step();
  } catch (err) {
    if (sabotages(relayCrew[0]) === before && !relayCrew.some((p) => emergencyOn(p.seen))) {
      throw err;
    }
    console.log(`emergency          cut a station short (${firstLine(err)}): once more after it`);
    await weather();
    await step();
  }
}

/** E at a loose part or a drop-off where `player` stands, until `done` holds; throws otherwise. */
async function handle(player, what, done) {
  for (let i = 0; i < 3 && !done(); i++) {
    await player.page.keyboard.press('e');
    await until(done, 1500);
  }
  if (!done()) {
    throw new Error(`${player.name} pressed E for ${what}, but nothing happened`);
  }
}

/** Picks the text size reading `label` („Klein", „Normal", „Groß") in the settings, then Esc. */
async function chooseTextSize(page, label) {
  await page.locator('.settings-toggle').click();
  const sizes = page.locator('.settings-options[aria-label="Textgröße"]');
  await sizes.waitFor({ timeout: 3000 });
  await sizes.locator('.settings-option', { hasText: label }).click();
  await page.keyboard.press('Escape');
  await page.locator('.settings-card').waitFor({ state: 'hidden', timeout: 2000 });
}

/** How the open book shows its Morsetafel: the page it stands on, its rows, the table facing it. */
function morseOnShow() {
  const pages = [...document.querySelectorAll('.reading-modal .book-pages > .book-leaves > .page')];
  const headed = (page, first) =>
    [...page.querySelectorAll('.manual-table table')].find(
      (table) => table.querySelector('th')?.textContent?.trim() === first,
    ) ?? null;
  const morse = pages.find((page) => headed(page, 'Buchstabe') !== null) ?? null;
  const facing = pages.some((page) => page !== morse && headed(page, 'Wort') !== null);
  const table = morse === null ? null : headed(morse, 'Buchstabe');
  return {
    page: morse?.getAttribute('aria-label') ?? null,
    rows: table === null ? 0 : table.querySelectorAll('tbody tr').length,
    facing,
  };
}

/** Pages of the open book whose lines run past the sheet's edge, or past its foot. */
function pagesCut() {
  return [...document.querySelectorAll('.reading-modal .page')].filter((page) => {
    const text = page.querySelector('.page-text');
    if (text === null) {
      return false;
    }
    const sheet = page.getBoundingClientRect();
    const wide = [...text.querySelectorAll('*')].some(
      (el) => el.getBoundingClientRect().right > sheet.right + 0.5,
    );
    const over = text.scrollHeight > text.clientHeight + 1;
    return wide || text.scrollWidth > text.clientWidth + 1 || over;
  }).length;
}

/**
 * book-morse-1.15.png: the pages of the cabinet `reader` stands at (`cabinet`, a source target)
 * at the large text size („Groß") at 1280×720, where they lie open as a spread: the Morsetafel
 * whole on its page — all 13 rows, over no page turn — and the Frequenztabelle facing it, read
 * together; no line runs past the sheet's edge and no page past its foot. The run fails where
 * the table breaks, the two lie apart or a page is cut. The text size goes back to normal, and
 * the cabinet is read once more on the phone held sideways (captureBookSideways) and upright
 * beside the notepad's drawer (captureBookUpright), which leaves the window the phone it was.
 */
async function captureMorseBook(reader, cabinet) {
  const { page } = reader;
  await page.setViewportSize({ width: 1280, height: 720 });
  await chooseTextSize(page, 'Groß');
  const overlay = page.locator('.reading-modal');
  if (!(await interactUntil(reader, overlay, cabinet))) {
    throw new Error(`${reader.name} stands at the cabinet, but no .reading-modal opened`);
  }
  await sleep(500);
  let shown = await page.evaluate(morseOnShow);
  for (let turns = 0; shown.page === null && turns < 6; turns++) {
    await page.keyboard.press('ArrowRight');
    await sleep(600);
    shown = await page.evaluate(morseOnShow);
  }
  const cut = await page.evaluate(pagesCut);
  await capture(page, 'book-morse-1.15.png');
  const where = await textOf(overlay.locator('.book-where'));
  console.log(
    `book-morse-1.15.png ${reader.name} at the AKTENSCHRANK, „Groß": ${where}, the Morsetafel ` +
      `on ${shown.page ?? '!! no page'} with ${shown.rows} rows, the Frequenztabelle ` +
      `${shown.facing ? 'facing it' : '!! not in view'}, ${cut} page(s) cut`,
  );
  const wrong = [
    shown.rows !== 13 && `the Morsetafel shows ${shown.rows} of 13 rows on one page`,
    !shown.facing && 'the Frequenztabelle does not face the Morsetafel',
    cut > 0 && `${cut} page(s) cut at the sheet's edge or foot`,
  ];
  if (wrong.some(Boolean)) {
    fail(`book-morse-1.15: ${wrong.filter(Boolean).join(', ')}`);
  }
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'hidden', timeout: 3000 });
  await chooseTextSize(page, 'Normal');
  await captureBookSideways(reader, cabinet);
  await captureBookUpright(reader, cabinet);
}

/** How long a turned leaf takes to lie still: Book.tsx LEAF_MS, 450 ms, and a margin. */
const LEAF_TURN_MS = 600;

/**
 * Every page of the open book from its first to its last, turned over with the arrow keys —
 * or, where `tapped`, by the arrows under the sheet, as a thumb turns it while the notepad
 * holds the keys — as `sheetOnPhone` reads it, with the words under the book that say where it
 * lies open.
 */
async function bookThrough(page, tapped = false) {
  const back = page.locator('.reading-modal .turn-back');
  const next = page.locator('.reading-modal .turn-next');
  const turn = async (dir) => {
    if (tapped) {
      await (dir < 0 ? back : next).click();
    } else {
      await page.keyboard.press(dir < 0 ? 'ArrowLeft' : 'ArrowRight');
    }
    await sleep(LEAF_TURN_MS);
  };
  for (let i = 0; i < 16 && !(await back.isDisabled()); i++) {
    await turn(-1);
  }
  const read = [];
  for (let i = 0; i < 16; i++) {
    const where = await textOf(page.locator('.reading-modal .book-where'));
    read.push({ where, ...(await page.evaluate(sheetOnPhone)) });
    if (await next.isDisabled()) {
      break;
    }
    await turn(1);
  }
  return read;
}

/**
 * book-phone-landscape.png: the pages of `cabinet` on `reader`'s phone held sideways (844×390)
 * at the normal text size, shot where the book opens. Every page from the first to the last
 * lies open alone, its body at 14 px at least, its text scrolling inside the sheet to its last
 * line — the Morsetafel's at least — no line past the sheet's edge, the frame not scrolling.
 * The run fails where any of it is not so; the book is put down after.
 */
async function captureBookSideways(reader, cabinet) {
  const { page, name } = reader;
  const { width, height } = SIZES[3];
  await page.setViewportSize({ width, height });
  const overlay = page.locator('.reading-modal');
  if (!(await interactUntil(reader, overlay, cabinet))) {
    throw new Error(`${name} stands at the cabinet, but no .reading-modal opened sideways`);
  }
  await sleep(500);
  await capture(page, 'book-phone-landscape.png');
  const opened = await page.evaluate(sheetOnPhone);
  const pages = await bookThrough(page);
  const scrolling = pages.filter((sheet) => sheet.rises > 0).map((sheet) => sheet.where);
  console.log(
    `book-phone-landscape.png ${name} at the AKTENSCHRANK @ ${width}x${height}: ` +
      `${sheetSaid(opened)}; ${pages.length} page(s) turned through, the text scrolling ` +
      `inside the sheet on ${scrolling.length} (${scrolling.join(', ')})`,
  );
  const wrong = pages.flatMap((sheet) =>
    sheetWrong(sheet).map((what) => `${sheet.where}: ${what}`),
  );
  if (scrolling.length === 0) {
    wrong.push('no page scrolls inside its sheet');
  }
  if (wrong.length > 0) {
    fail(`book-phone-landscape.png: ${wrong.join(', ')}`);
  }
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'hidden', timeout: 3000 });
}

/**
 * book-phone-notepad.png: the pages of `cabinet` on `reader`'s phone held upright (420×760) at
 * the normal text size, read as the book opens with the notepad's drawer down, then shot with
 * the drawer up under the frame by its tab. Either way the page lies open alone, its body at
 * 14 px at least, no line past the sheet's edge, the frame not scrolling; with the drawer up
 * every page from the first to the last — turned by the arrows under the sheet, the pad holding
 * the keys — its text scrolling inside the sheet to its last line, and the drawer along the
 * foot (`notingSide`). The run fails where any of it is not so; the book is put down by its tab
 * after, and the pad goes away. An emergency due meanwhile is waited out first: it would shut
 * the book halfway through.
 */
async function captureBookUpright(reader, cabinet) {
  const { page, name } = reader;
  const { width, height } = SIZES[2];
  await page.setViewportSize({ width, height });
  await clearOfEmergencies(reader, 20);
  const overlay = page.locator('.reading-modal');
  if (!(await interactUntil(reader, overlay, cabinet))) {
    throw new Error(`${name} stands at the cabinet, but no .reading-modal opened upright`);
  }
  await sleep(500);
  const down = await page.evaluate(sheetOnPhone);
  const touch = await padUp(page, '.reading-modal');
  await sleep(600); // the drawer up, the frame settled above it
  await capture(page, 'book-phone-notepad.png');
  const up = await page.evaluate(sheetOnPhone);
  const side = await notingSide(page);
  const pages = await bookThrough(page, true);
  const scrolling = pages.filter((sheet) => sheet.rises > 0).map((sheet) => sheet.where);
  console.log(
    `book-phone-notepad.png ${name} at the AKTENSCHRANK @ ${width}x${height}: the drawer down, ` +
      `${sheetSaid(down)}; up${touch ? ' by its tab' : ' by N'}, ${sheetSaid(up)}; ` +
      `${pages.length} page(s) turned through, the text scrolling inside the sheet on ` +
      `${scrolling.length} (${scrolling.join(', ')}); the pad ${side.said}`,
  );
  const wrong = [
    ...sheetWrong(down).map((what) => `the drawer down: ${what}`),
    ...pages.flatMap((sheet) => sheetWrong(sheet).map((what) => `${sheet.where}: ${what}`)),
  ];
  if (scrolling.length === 0) {
    wrong.push('no page scrolls inside its sheet beside the drawer');
  }
  if (!side.ok) {
    wrong.push('the pad is not a drawer under the page');
  }
  if (wrong.length > 0) {
    fail(`book-phone-notepad.png: ${wrong.join(', ')}`);
  }
  await putSourceDown(page, overlay, touch, 'book-phone-notepad.png', 'AKTENSCHRANK');
}

/**
 * The radio panel in the Labor on the pinned seed: the guest, left at the
 * rack in the open, takes the key there round to the cabinet past the
 * patrols and unlocks it from a haven beside it, reads it at the
 * large text size (book-morse-1.15.png), while the host waits by the
 * terminal, where no drone looks either; then the host walks to the panel,
 * switches it on — from then on the panel hides them both — and tunes and
 * sends as the plan pins it. Fails naming the seed where the lamp or the
 * dial differ.
 */
async function playFrequenz(host, guest) {
  const pin = BLACKOUT_PLAN.frequenz;
  // The key on the guest's map, glimpsed or known — out of the guest's sight, where it was laid.
  const key =
    guest.seen.view.map.items.find((item) => item.kind === 'key') ??
    BLACKOUT.map.items.find((item) => /schl/i.test(item.label));
  if (key === undefined) {
    throw new Error('the cabinet’s key lies nowhere on the map');
  }
  await sneakTo(guest, { x: Math.floor(key.x), y: Math.floor(key.y) }, 2.5);
  const you = guest.seen.view.you.id;
  await handle(guest, 'the key', () => guest.seen.view.map.items.some((i) => i.carriedBy === you));
  const cabinet = pinnedSource('cabinet');
  await sneakTo(guest, workSpot(guest, cabinet), 2.5);
  await foundWherePinned(guest, cabinet);
  const atCabinet = sourceTarget(cabinet);
  const unlocked = () => guest.seen.view.map.manuals.some((m) => m.id === cabinet.id && m.opened);
  if (!(await pressUntil(guest, atCabinet, 'the unlocked cabinet', unlocked))) {
    throw new Error(`${guest.name} pressed E for the cabinet, but nothing happened`);
  }
  await inGroup('reading', () => captureMorseBook(guest, atCabinet));
  await sneakTo(host, atConsole(host, null));
  await clearOfEmergencies(host, 25);
  const index = host.seen.view.currentPuzzleIndex;
  await pastEmergencies(async () => {
    await openPanel(host, null);
    const lamp = host.seen.view.puzzle;
    if (lamp?.pattern !== pin.pattern || lamp?.dial !== pin.dial) {
      const shown = `${lamp?.pattern} at step ${lamp?.dial}`;
      differs('radio panel', shown, `${pin.pattern} at ${pin.dial}`);
    }
    const knob = pin.turns < 0 ? 'Frequenz runter' : 'Frequenz hoch';
    for (let i = 0; i < Math.abs(pin.turns); i++) {
      const button = host.page.locator(`.station-modal button[aria-label="${knob}"]`);
      await button.click({ timeout: 3000 });
      await sleep(150);
    }
    const tuned = () => host.seen.view.puzzle?.dial === pin.dial + pin.turns;
    if (!(await until(tuned, 3000))) {
      const dial = host.seen.view.puzzle?.dial;
      throw new Error(`${host.name} turned the dial, but it stands at ${dial}`);
    }
    await host.page.locator('.station-modal .morse-send').click({ timeout: 3000 });
    if (!(await until(() => solvedPast(host, index), 5000))) {
      const step = pin.dial + pin.turns;
      throw new Error(`${host.name} sent at step ${step}, but the radio panel held`);
    }
  });
  console.log(
    `frequenz           ${guest.name} unlocked the cabinet, ${host.name} turned the dial ` +
      `${pin.turns} from step ${pin.dial} and sent (seed ${SEED}): solved`,
  );
}

/** The spare fuse as `player`'s view shows it once the crew has found it; undefined before. */
const knownFuse = (player) =>
  player.seen.view.map.items.find((item) => item.known && item.requiredFor !== null);

/**
 * The spare fuse to the reactor and the restart, on the pinned seed: the
 * guest, out in the open at the cabinet once the radio panel is done, goes
 * round to the reactor first; the host goes to where the plan lays the fuse —
 * nobody finds it from across the room — takes it up and puts it in at its
 * drop-off, both past the patrols, and both press the reactor together
 * (`pressLastSync`). Fails naming the seed where the fuse or its drop-off lie
 * elsewhere than pinned.
 */
async function playReaktor(host, guest) {
  const pin = BLACKOUT_PLAN.ersatzsicherung;
  await sneakTo(guest, atConsole(guest, null));
  await sneakTo(host, pin.from);
  await until(() => knownFuse(host) !== undefined, 3000);
  const fuse = knownFuse(host);
  if (fuse === undefined) {
    differs('spare fuse', 'nowhere found', `at ${pin.from.x},${pin.from.y}`);
  }
  if (fuse.deliverTo?.x !== pin.to.x || fuse.deliverTo.y !== pin.to.y) {
    differs('fuse drop-off', JSON.stringify(fuse.deliverTo), JSON.stringify(pin.to));
  }
  const lies = { x: Math.floor(fuse.x), y: Math.floor(fuse.y) };
  if (lies.x !== pin.from.x || lies.y !== pin.from.y) {
    differs('spare fuse', `at ${lies.x},${lies.y}`, `at ${pin.from.x},${pin.from.y}`);
  }
  const you = host.seen.view.you.id;
  await handle(host, 'the fuse', () => host.seen.view.map.items.some((i) => i.carriedBy === you));
  await sneakTo(host, pin.to);
  await handle(host, 'its drop-off', () =>
    host.seen.view.map.items.some((i) => i.id === fuse.id && i.delivered));
  console.log(
    `fuse               ${host.name} carried the fuse from ${lies.x},${lies.y} to ` +
      `${pin.to.x},${pin.to.y} and put it in`,
  );
  await clearOfEmergencies(host, 25);
  const onPhone = () => inGroup('devices', () => captureDevicePhone(guest, stationSlug(guest)));
  await pastEmergencies(() => pressLastSync([host, guest], onPhone));
}

/**
 * Both make for the hatch in the Archiv's corner the moment it opens — the
 * escape on the loop, each by the shortest way past the patrols — up to the
 * tiles beside it, from where the escape's captures go on (`captureEscape`).
 */
async function runForTheHatch(host, guest) {
  const exit = host.seen.view.map.exit;
  if (!(await until(() => host.seen.view.map.exit?.open === true, 5000))) {
    throw new Error('every station is solved, but the hatch did not open');
  }
  const [beside, other] = besideTheHatch(host.seen.view.map, exit);
  const from = Date.now();
  await sneakTo(guest, other);
  await sneakTo(host, beside);
  console.log(
    `escape             ${host.name} and ${guest.name} ran from the reactor to the hatch in ` +
      `${seconds(Date.now() - from)}`,
  );
}

/**
 * How much of the clock the scripted crew has to leave at least, as a share of the mission's
 * limit at „Normal": a win that leaves less says the limit is to be weighed anew (N-xxl).
 */
const CLOCK_LEFT_AT_LEAST = 0.4;

/** „381.3 s left on the clock, 42 % of 900 s" — and „!!" where the share falls under the floor. */
function clockLeft(leftMs, limitSec) {
  const share = leftMs / 1000 / limitSec;
  const under = share < CLOCK_LEFT_AT_LEAST ? ` !! under ${CLOCK_LEFT_AT_LEAST * 100} %` : '';
  const percent = Math.round(share * 100);
  return `${seconds(leftMs)} left on the clock, ${percent} % of ${limitSec} s${under}`;
}

/** A run in which no relay emergency came says that device-phone-relay.png is left out. */
function relayLeftOut() {
  if (!phoneDevices.has('relay')) {
    skip('device-phone-relay', 'no relay emergency came in this run (v-relay.mjs measures it)');
  }
}

/**
 * Blackout from the end of the station step to the won card, on its pinned
 * seed: the Notstrom-Kasten finished, the Signalkette, the Serverraum, the
 * radio panel, the spare fuse and the reactor — each instance checked
 * against the plan before its answer is played — past the patrols and
 * through the emergencies; then the escape round the loop and the win
 * (escape.png, pullback.png, won.png, end.png, won-phone.png). Logs each
 * drone sighting as it comes (`watchSightings`), and how long the run took
 * from the blackout to the win.
 */
async function playBlackoutToTheEnd(host, guest, watcher) {
  relayCrew.push(host, guest);
  const stopWatching = watchSightings([host, guest]);
  try {
    await guest.page.setViewportSize(SIZES[2]);
    const pair = { box: host, meter: guest };
    const stations = [
      () => finishNotstrom(pair.box, pair.meter),
      () => playSignalkette(host, guest),
      () => playServerraum(host, guest),
      () => playFrequenz(host, guest),
      () => playReaktor(host, guest),
    ];
    for (const station of stations) {
      await station();
      // The next step plans its walks from both pages' views: both have to show this solve.
      await viewsCaughtUp([host, guest]);
    }
    await runForTheHatch(host, guest);
    await inGroup('devices', relayLeftOut);
    await captureEscape(host, guest);
    await captureEnd(host, watcher);
  } finally {
    stopWatching();
  }
  const { lights, finishedAt, deadlineAt, penaltySeq } = host.seen.view;
  console.log(
    `blackout           won ${seconds(finishedAt - lights.outAt)} after the lights went out, ` +
      `${clockLeft(deadlineAt - finishedAt, BLACKOUT.timeLimitSec)}, ${penaltySeq} alarm(s), ` +
      `${sightings.count} of them drones; ${sneaking.walks} walks past the drones, ` +
      `${seconds(sneaking.waitedMs)} waited for a gap, ${sneaking.ranAnyway} run without one; ` +
      `${running.runs} runs, ${running.outside} outside the pace foretold ` +
      `(by up to ${seconds(running.worstS * 1000)}), a stop ` +
      `${running.stopS.map((s) => s.toFixed(2)).join('–')} s; ` +
      `${emergencies.weathered} emergencies cleared, ${emergencies.missed} missed`,
  );
  await capturePhoneCard(guest);
}

/**
 * The Kabelprüfung as the pinned seed draws it: `holder` stands on the
 * Kontrolle's plate, beside the locker whose rules make it the backup, while
 * `cutter` walks through to the box, opens it and cuts the pinned wire.
 * Throws, naming the seed, where the box shows other wires than pinned.
 */
async function cutPinnedWire(cutter, holder, pinned) {
  const map = cutter.seen.view.map;
  const box = map.stations.find((s) => s.status === 'armed');
  const plate = map.plates.find((p) => !p.freezesDrone);
  if (box === undefined || plate === undefined) {
    throw new Error('the Kabelprüfung is not armed, or there is no plate to hold its door');
  }
  await holdPlate(holder, plate);
  if (!(await walkNear(cutter.page, cutter.seen, box))) {
    throw new Error(`${holder.name} holds the plate, but ${cutter.name} found no way to "${box.title}"`);
  }
  const modal = cutter.page.locator('.station-modal');
  if (!(await interactUntil(cutter, modal, consoleTarget(box)))) {
    const at = `${cutter.name} stands at "${box.title}"`;
    throw new Error(`${at}, but no .station-modal after ${TRIES}`);
  }
  await until(() => cutter.seen.view.puzzle?.wires != null, 3000);
  const colors = (cutter.seen.view.puzzle?.wires ?? []).map((wire) => wire.color);
  if (colors.join(',') !== pinned.colors.join(',')) {
    throw new Error(
      `Systemcheck seed ${SEED} no longer draws the pinned wiring box: ` +
        `${colors.join(', ') || 'no wires'} instead of ${pinned.colors.join(', ')} — ` +
        'draw the box for the seed anew and update PINNED_WIRING',
    );
  }
  const backed = await until(() => cutter.seen.view.puzzle?.backup != null, 3000);
  const index = cutter.seen.view.currentPuzzleIndex;
  await modal.locator(`button[aria-label^="Kabel ${pinned.cut},"]`).click({ timeout: 3000 });
  if (!(await until(() => cutter.seen.view.currentPuzzleIndex > index, 5000))) {
    const alarms = cutter.seen.view.alarms.count;
    throw new Error(
      `${cutter.name} cut wire ${pinned.cut} of "${box.title}", but it did not solve ` +
        `(${backed ? 'backed up' : `no backup at ${holder.name}'s plate`}, ${alarms} alarm(s))`,
    );
  }
  console.log(
    `wiring             ${holder.name} holds the plate by the locker, ${cutter.name} cuts wire ` +
      `${pinned.cut} of ${colors.join(', ')} (seed ${SEED}): "${box.title}" solved`,
  );
}

/**
 * The last station, a sync for the whole crew: all gather at it, open it and press together;
 * `opened` comes in between, with the panels up.
 */
async function pressLastSync(players, opened = async () => undefined) {
  const station = players[0].seen.view.map.stations.find((s) => s.status === 'armed');
  if (station === undefined) {
    throw new Error('no station is armed after the Kabelprüfung');
  }
  // In this order: whoever holds a plate door open steps off it last.
  await gatherAt(station, players);
  for (const player of players) {
    const modal = player.page.locator('.station-modal');
    if (!(await interactUntil(player, modal, consoleTarget(station)))) {
      throw new Error(`${player.name} stands at "${station.title}", but no .station-modal`);
    }
  }
  await sleep(400); // past the panel's fade-in
  await opened();
  const solved = await pressTogether(players, station);
  const line = `"${station.title}"`;
  await inGroup('audio', () => checkRadioVoice(players[0], solved.listening, line));
}

/**
 * The two tiles beside the hatch the crew runs for: diagonally below it to
 * the right where that is free floor — as the Systemcheck has it — else the
 * nearest free floor round it; the first for the host, the second for the
 * guest. Throws where fewer than two are free.
 */
function besideTheHatch(map, exit) {
  const solid = furniture(map);
  const free = ({ x, y }) =>
    map.tiles[y]?.[x] === '.' && !solid.has(`${x},${y}`) && !(x === exit.x && y === exit.y);
  const round = [
    [1, 1],
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]
    .map(([dx, dy]) => ({ x: exit.x + dx, y: exit.y + dy }))
    .filter(free);
  if (round.length < 2) {
    throw new Error(`fewer than two free tiles beside the hatch at ${exit.x},${exit.y}`);
  }
  return round.slice(0, 2);
}

/** What the host's page says of the escape: the goal, the checklist, the clock. */
async function escapeHud(page) {
  return page.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const mates = [...document.querySelectorAll('.escape-mate')].map(
      (li) => `${li.textContent.trim()}${li.classList.contains('escape-mate--out') ? ' ✓' : ' …'}`,
    );
    return {
      goal: text('.stage-goal--escape h1'),
      mates,
      clock: document.querySelector('.stage-clock .countdown')?.className ?? 'no clock',
    };
  });
}

/** In the escape: the music under pressure, and what each page keeps decoded. */
async function soundOfTheEscape(host, guest) {
  await escapeMusic(host);
  await audioKept([host, guest], 'in the escape');
}

/**
 * escape.png: the hatch open and the siren on — the light turned red, the
 * clock pulsing, the checklist under the goal. The host walks up beside the
 * hatch and its frames are sampled there (the escape's quiet window); the
 * guest steps onto it and is ticked off. The shot waits until the hatch has
 * ground open. Fails unless the goal, the checklist and the clock say so.
 */
async function captureEscape(host, guest) {
  const open = () => host.seen.view.map?.exit?.open === true;
  if (!(await until(open, 5000))) {
    throw new Error('every station is solved, but the hatch did not open');
  }
  const exit = host.seen.view.map.exit;
  const openedAt = Date.now();
  const [beside] = besideTheHatch(host.seen.view.map, exit);
  if (!(await standOn(host, beside))) {
    throw new Error(`${host.name} found no way to ${beside.x},${beside.y} beside the hatch`);
  }
  const siren = 'in the escape, the siren on';
  const pacing = () => pace(host, SAMPLE_MS);
  await frameWindow(host.page, siren, pacing);
  await inGroup('graphics', () => keySceneAtTwo(host, siren, pacing, 'escape-dpr2.png'));
  await inGroup('audio', () => soundOfTheEscape(host, guest));
  const guestId = guest.seen.view.you.id;
  const ticked = () => host.seen.view.map?.exit?.atExit.includes(guestId) === true;
  if (!(await standOn(guest, exit)) || !(await until(ticked, 3000))) {
    throw new Error(`${guest.name} did not get onto the hatch, or the checklist never ticked`);
  }
  await inGroup('audio', () => partnerSide(host, guest, 'at the hatch'));
  await sleep(Math.max(600, openedAt + 2400 - Date.now())); // the hatch ground open, the light red
  await capture(host.page, 'escape.png');
  const hud = await escapeHud(host.page);
  console.log(
    `escape.png         ${host.name}: "${hud.goal}", checklist ${hud.mates.join(', ')}, ` +
      `clock "${hud.clock}"`,
  );
  const tickedOff = hud.mates.some((mate) => mate.startsWith(guest.name) && mate.endsWith('✓'));
  // Amber with minutes left: red is the clock's last minute only.
  const amber = hud.clock.includes('countdown--escape') && !hud.clock.includes('critical');
  if (hud.goal !== 'NOTAUSGANG ENTRIEGELT' || !tickedOff || !amber) {
    fail(`escape.png: goal "${hud.goal}", checklist ${hud.mates.join(', ')}, clock ${hud.clock}`);
  }
}

/** The end screen whole: the window as tall as the screen runs, then back. */
async function captureWholeEnd(page) {
  await page.locator('.standing, .standing-line').first().waitFor({ timeout: 5000 }).catch(() => {});
  const before = page.viewportSize();
  const height = await page.evaluate(() => {
    const content = document.querySelector('.content');
    return Math.ceil(content.getBoundingClientRect().top + content.scrollHeight + 4);
  });
  await page.setViewportSize({ width: before.width, height: Math.max(before.height, height) });
  await sleep(500);
  await capture(page, 'end.png');
  await page.setViewportSize(before);
  return height;
}

/**
 * won-phone.png: the guest's title card on a phone held upright; the card
 * may not run out sideways there. Then won-landscape.png: the phone turned
 * sideways (`captureLandscapeCard`).
 */
async function capturePhoneCard(guest) {
  const { page } = guest;
  await page.setViewportSize({ width: SIZES[2].width, height: SIZES[2].height });
  if (!(await attached(page.locator('.end-title'), 6000))) {
    throw new Error(`${guest.name}'s page never showed the title card`);
  }
  await sleep(1700); // past the card's way out of the white
  await capture(page, 'won-phone.png');
  const over = await sideways(page, '.content');
  console.log(
    `won-phone.png      ${guest.name} @ 420x760: ` +
      (over > 0 ? `!! +${over}px sideways` : 'the card fits sideways'),
  );
  if (over > 0) {
    fail(`won-phone.png: the end screen runs out ${over}px sideways on a phone`);
  }
  await captureLandscapeCard(guest);
}

/**
 * won-landscape.png: the title card on a phone held sideways, 844×390, in two
 * columns — the crew's shot left; the word, the time and the rank right, all
 * of them in the window, and the top bar on one line. Fails where the scene
 * is not beside the words, or the facts lie below the window's foot.
 */
async function captureLandscapeCard(guest) {
  const { page } = guest;
  const turned = SIZES[3];
  await page.setViewportSize({ width: turned.width, height: turned.height });
  await sleep(500);
  await capture(page, 'won-landscape.png');
  const layout = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const [scene, word, facts] = ['.end-scene', '.end-title-word', '.end-facts'].map((selector) =>
      box(`.end-title ${selector}`),
    );
    const bar = document.querySelector('.topbar');
    // One line: the bar no higher than twice its tallest item — a second row would be.
    const tallest = Math.max(0, ...[...(bar?.children ?? [])].map((c) => c.offsetHeight));
    const oneLine = bar !== null && bar.offsetHeight < 2 * tallest;
    return { scene, word, facts, oneLine, barHeight: bar?.offsetHeight ?? 0 };
  });
  const { scene, word, facts, oneLine, barHeight } = layout;
  const columns = scene !== null && word !== null && facts !== null &&
    scene.right <= word.left && scene.right <= facts.left;
  const inView = facts !== null && facts.bottom <= turned.height;
  console.log(
    `won-landscape.png  ${guest.name} @ ${turned.width}x${turned.height}: ` +
      `${columns ? 'two columns' : '!! not two columns'}, ` +
      `the facts ${inView ? 'in the window' : '!! below its foot'}, ` +
      `the top bar ${oneLine ? 'one line' : '!! wrapped'} (${barHeight}px)`,
  );
  if (!columns || !inView || !oneLine) {
    fail(`won-landscape.png: two columns ${columns}, facts in view ${inView}, bar ${oneLine}`);
  }
}

/** A won card's figure counts as mid-jump this far off the ground, tiles (it jumps 10/64). */
const JUMP_SHOWN = 0.12;
/** How long the card gets for one of its figures to be caught mid-jump: each jumps every 1.6 s. */
const JUMP_WAIT_MS = 5000;
/**
 * How far apart the reads round figure-celebrate.png may lie, ms: under the 800 ms a figure
 * stands between two flights, so that two reads in the air are of one flight.
 */
const JUMP_SPAN_MS = 600;
/** Whether figure-celebrate.png was taken: only a run played to its end has a won card. */
let celebrateShot = false;

/**
 * Whether the won card's figures lie wholly in the window, below the top bar: a figure out of
 * it stops moving (client CrewFigure.tsx `runFigure`), its probe keeping its last pose.
 */
function figuresInView(page) {
  return page.locator('.end-title').evaluate((card) => {
    const bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const figures = [...card.querySelectorAll('.end-mate canvas')];
    return (
      figures.length > 0 &&
      figures.every((figure) => {
        const box = figure.getBoundingClientRect();
        return box.top >= bar && box.bottom <= globalThis.innerHeight;
      })
    );
  });
}

/**
 * figure-celebrate.png: the host's won card at 1440×1000, scrolled back to its top — „Bild
 * speichern" (captureAchievements) scrolls it down, and on a page whose card runs taller its
 * figures leave the window and stand still — and shot while a figure of the crew is high in
 * its jump and still in the air after the shot, as the figures' probe says (figureShot). Fails
 * where the figures do not lie in the window, a figure on the card does not celebrate, or none
 * is caught in the air within JUMP_WAIT_MS.
 */
async function captureCelebrate(page) {
  celebrateShot = true;
  const before = page.viewportSize();
  await page.setViewportSize(COLD_OPEN);
  await page.locator('.end-title').evaluate((card) => {
    for (let box = card.parentElement; box !== null; box = box.parentElement) {
      box.scrollTop = 0;
    }
  });
  await sleep(500);
  const inView = await figuresInView(page);
  const caught = await figureShot(page, {
    pick: (figure) => figure.mood === 'celebrate' && figure.rise >= JUMP_SHOWN,
    holds: (figure) => figure.mood === 'celebrate' && figure.rise > 0,
    span: JUMP_SPAN_MS,
    ms: JUMP_WAIT_MS,
  });
  await keepFigureShot(page, 'figure-celebrate.png', caught);
  reportCelebrate(caught, (await figuresOn(page)) ?? [], inView);
  if (before !== null) {
    await page.setViewportSize(before);
  }
  await sleep(300);
}

/** figure-celebrate.png's line in the log; the run fails where the crew was not caught so. */
function reportCelebrate({ found, after, tries, held }, shot, inView) {
  const cheering = shot.filter((figure) => figure.mood === 'celebrate').length;
  console.log(
    `figure-celebrate.png Anna's card @ ${COLD_OPEN.width}x${COLD_OPEN.height}: ` +
      (inView ? '' : '!! its figures out of the window; ') +
      (found === null
        ? '!! no figure caught in the air'
        : `${found.color} ${found.rise.toFixed(3)} tiles up, ${after?.rise.toFixed(3) ?? '?'} ` +
          `once shot${held ? '' : ' !! landed'}, shot ${tries} times`) +
      `; ${cheering} of ${shot.length} figures celebrating`,
  );
  if (!inView || !held || shot.length === 0 || cheering !== shot.length) {
    fail(
      `figure-celebrate.png: ${cheering} of ${shot.length} figures celebrate, in the window ` +
        `${inView}, caught in the air ${held}`,
    );
  }
}

/**
 * pullback.png, won.png, end.png: the host steps onto the hatch beside the
 * guest and the run is won. The world plays its end — pullback.png in the
 * middle of it — then the end screen opens on its title card (won.png),
 * its crew jumping (figure-celebrate.png), and end.png has all of it. The
 * audience's page has to show the same card, its crew jumping too
 * (won-audience.png).
 */
async function captureEnd(host, watcher) {
  const exit = host.seen.view.map.exit;
  // One straight walk: once the run is won the world takes no keys, so no step corrects it.
  const won = () => host.seen.view?.phase === 'won';
  const walk = walkStraight(host, exit.x + 0.5, exit.y + 0.5);
  if (!(await until(won, 5000))) {
    throw new Error('both stand on the hatch, but the run was not won');
  }
  const wonAt = Date.now();
  await walk;
  await sleep(700);
  await capture(host.page, 'pullback.png');
  const card = host.page.locator('.end-title');
  if (!(await attached(card, 6000))) {
    throw new Error('the run was won, but no title card came up');
  }
  const cardAt = Date.now() - wonAt;
  await sleep(1700); // past the card's way out of the white
  await capture(host.page, 'won.png');
  await captureAchievements(host);
  const says = await textOf(card.locator('.end-title-word'));
  const figures = await card.locator('.end-mate canvas').count();
  const facts = (await textOf(card.locator('.end-facts')))?.replace(/\s+/g, ' ') ?? 'none';
  await inGroup('graphics', () => captureCelebrate(host.page));
  const tall = await captureWholeEnd(host.page);
  const watched = watcher.locator('.spectate .end-title-word');
  const audience = (await attached(watched, 6000)) ? await textOf(watched) : null;
  if (audience !== null) {
    await sleep(1700); // past the card's way out of the white there too
    await capture(watcher, 'won-audience.png');
  }
  const crowd = ((await figuresOn(watcher)) ?? []).filter((f) => f.mood === 'celebrate').length;
  console.log(
    `won.png            ${host.name}: the card after ${seconds(cardAt)}, "${says}", ` +
      `${figures} figures outside, "${facts}"; end.png ${tall}px tall; ` +
      `the audience's card "${audience ?? '!! none'}", ${crowd} figures celebrating on it`,
  );
  if (says !== 'GESCHAFFT' || figures !== 2 || audience !== 'GESCHAFFT' || crowd !== 2) {
    fail(`won.png: "${says}", ${figures} figures, the audience's card "${audience}" (${crowd})`);
  }
  await inGroup('audio', () => checkEndMusic(host.page));
}

/**
 * The won card's music on the host's page: its card asked for the won sting and theme — the
 * theme playing, or none while it awaits its render — or the run fails.
 */
async function checkEndMusic(page) {
  const { asked, playing } = await endThemeOf(page);
  const theme = playing ?? 'no theme (awaiting its render?)';
  console.log(`end music          the card asked for its ${asked} sting, then ${theme}`);
  if (asked !== 'won') {
    fail(`end music: the won card asked for ${asked}`);
  }
}

/**
 * next-mission.png: the end screen of a won run whose mission leads on to
 * another offers it as the main button, „Nochmal" beside it. The guest
 * clicks it, then the host, whose click names the mission; it has to open
 * on both pages, with the power on where it has an intro. Throws where the
 * button is missing, fails where the next run does not come up.
 */
async function captureNextMission(host, guest) {
  const onward = (page) =>
    page.locator('.end-screen .actions button.primary', { hasText: 'Weiter:' });
  if (!(await attached(onward(host.page), 5000))) {
    throw new Error('the won run leads on to another mission, but no „Weiter" on its end screen');
  }
  await host.page.locator('.end-screen .actions').scrollIntoViewIfNeeded();
  await sleep(400);
  await capture(host.page, 'next-mission.png');
  const label = await textOf(onward(host.page));
  const again = host.page.locator('.end-screen .actions button', { hasText: 'Nochmal' });
  const beside = await textOf(again);
  const next = host.seen.view.nextMissionId;
  const guestReady = () => host.seen.view.players.some((p) => p.name === guest.name && p.ready);
  await onward(guest.page).click();
  const confirmed = await until(guestReady, 3000);
  await onward(host.page).click();
  const there = ({ seen }) => seen.view?.phase === 'playing' && seen.view.missionId === next;
  const opened = await until(() => [host, guest].every(there), START_MS);
  const lit = opened && host.seen.view.lights.out === false;
  const yes = confirmed ? 'said yes' : '!! no yes from the guest';
  const outcome = opened
    ? `${next} opened on both pages, ${lit ? 'the power on' : '!! the lights out'}`
    : `!! ${next} never opened`;
  console.log(
    `next-mission.png   ${host.name}: "${label}", beside it "${beside}"; ` +
      `${guest.name} ${yes}, then ${host.name}: ${outcome}`,
  );
  if (!label?.startsWith('Weiter: ') || beside !== 'Nochmal' || !confirmed || !opened || !lit) {
    fail(`next-mission.png: "${label}" beside "${beside}", ${next} opened ${opened}, lit ${lit}`);
  }
  await inGroup('audio', () => checkEndMusicGone(host.page));
}

/** The end card's music gone with its card once the next run is up; or the run fails. */
async function checkEndMusicGone(page) {
  const { asked } = await endThemeOf(page);
  console.log(`end music          ${asked === null ? 'gone with its card' : `!! still ${asked}`}`);
  if (asked !== null) {
    fail(`end music: the next run still holds the ${asked} card's music`);
  }
}

/**
 * The Systemcheck on its pinned seed to the end: the Kabelprüfung, the
 * Synchronkalibrierung, the escape and the win (escape.png, pullback.png,
 * won.png, end.png, won-phone.png), then on into the mission it leads on to
 * (next-mission.png).
 */
async function playToTheEnd(host, guest, watcher, pinned) {
  await cutPinnedWire(host, guest, pinned);
  await viewsCaughtUp([host, guest]);
  await pressLastSync([host, guest]);
  await captureEscape(host, guest);
  await captureEnd(host, watcher);
  await capturePhoneCard(guest);
  await captureNextMission(host, guest);
  await captureAccount(host);
}

/** What the first row of „Meine Einsätze" has to say of the Systemcheck just won. */
const WON_ROW = [/Systemcheck/, /Geschafft/, /Anna/, /Ben/];

/**
 * my-runs.png and account-delete.png, after the won Systemcheck: a second tab of the host's
 * browser — its pass, its account — opens „Meine Einsätze" off the menu, the run just won leading
 * the list with the crew and a rank, and fitting a phone sideways; then the settings delete the
 * account at the second word, „Konto löschen" and „Endgültig löschen" (account-delete.png shows
 * the first answered), the profile says „Gast" with no name, and „Meine Einsätze" lists nothing
 * any more. The run fails wherever that does not hold.
 */
async function captureAccount(host) {
  const page = await openPage(host.page.context(), 'host tab');
  try {
    await page.goto(paged(BASE));
    const row = await captureMyRuns(page);
    await page.locator('.history-back').click();
    await deleteAccount(page);
    // The slot's text as written: the chip sets it in capitals.
    const slot = (await page.locator('.profile-slot').textContent())?.trim() ?? null;
    const name = await page.locator('.profile-name').inputValue();
    await page.locator('.menu-item', { hasText: 'Meine Einsätze' }).click();
    const empty = await attached(page.getByText('Noch kein Einsatz mit diesem Konto.'), 10_000);
    console.log(
      `account-delete.png ${host.name}'s account deleted: profile "${slot}"` +
        `${name === '' ? ', no name' : ` !! still "${name}"`}` +
        (empty ? ', „Meine Einsätze" empty' : ', !! „Meine Einsätze" still lists runs'),
    );
    if (slot !== 'Gast' || name !== '' || !empty) {
      fail(`account-delete: profile "${slot}", name "${name}", runs listed ${!empty} (row ${row})`);
    }
  } finally {
    await page.close();
  }
}

/**
 * my-runs.png: „Meine Einsätze" off the menu of `page`, its first row the run just won (WON_ROW)
 * with a rank, the page fitting both the window and a phone; the row's text, for the log.
 */
async function captureMyRuns(page) {
  await page.locator('.menu-item', { hasText: 'Meine Einsätze' }).click();
  const first = page.locator('.my-runs-table tbody tr').first();
  if (!(await attached(first, 10_000))) {
    fail('my-runs: „Meine Einsätze" lists no run after the won Systemcheck');
    return null;
  }
  await sleep(300);
  await capture(page, 'my-runs.png');
  const row = (await first.innerText()).replace(/\s+/g, ' ').trim();
  const ranked = (await first.locator('.my-runs-rank').count()) === 1;
  const { width, height } = page.viewportSize();
  await overflow(page, `my-runs @ ${width}x${height}`);
  await page.setViewportSize({ width: SIZES[2].width, height: SIZES[2].height });
  await sleep(300);
  const over = await sideways(page, '.content');
  await page.setViewportSize({ width, height });
  const holds = WON_ROW.every((part) => part.test(row)) && ranked;
  console.log(
    `my-runs.png        first row "${row}"${ranked ? '' : ' !! no rank'}; ` +
      (over > 0 ? `!! +${over}px sideways on a phone` : 'fits a phone sideways'),
  );
  if (!holds || over > 0) {
    fail(`my-runs: first row "${row}", ranked ${ranked}, ${over}px sideways on a phone`);
  }
  return row;
}

/**
 * The account of `page`'s pass deleted in the settings: „Konto löschen" asks first, saying what
 * goes (account-delete.png), „Endgültig löschen" sends it off, the settings say it is gone, and
 * Esc closes them.
 */
async function deleteAccount(page) {
  await page.locator('.menu-item', { hasText: 'Einstellungen' }).click();
  await page.locator('.settings-account-delete').click();
  await page.locator('.settings-account-ask').waitFor({ timeout: 5000 });
  await sleep(400);
  const inSight = await page.locator('.settings-account-actions').evaluate((actions) => {
    const card = actions.closest('.settings-card').getBoundingClientRect();
    return actions.getBoundingClientRect().bottom <= card.bottom + 0.5;
  });
  await capture(page, 'account-delete.png');
  if (!inSight) {
    fail('account-delete: „Endgültig löschen" asked below the settings’ fold');
  }
  await clickText(page, 'Endgültig löschen');
  const gone = await attached(page.getByText('Konto gelöscht.', { exact: false }), 10_000);
  if (!gone) {
    fail('account-delete: the settings never said the account is gone');
  }
  await page.keyboard.press('Escape');
  await page.locator('.settings-card').waitFor({ state: 'hidden', timeout: 3000 });
}

/**
 * Where the mission's seed is pinned — the Systemcheck's wiring box,
 * Blackout's every station — the walkthrough plays the run out to the card;
 * elsewhere the captures of the end are skipped, saying why. Where the run plays graphics, the
 * hatch's dust is watched for meanwhile, and the watch stopped however the play ends: one
 * left polling after a step threw would hold the process open, and a CI job
 * with it, until the job's time limit.
 */
async function playPinnedOut(anna, ben, watcher) {
  const stopHatchDust = whenOn(
    'graphics',
    () => watchHatchDust(watcher, anna.seen),
    async () => undefined,
  );
  try {
    const mission = MISSION.toLowerCase();
    const pinned = mission === 'systemcheck' ? PINNED_WIRING.get(SEED) : undefined;
    if (pinned !== undefined) {
      await playToTheEnd(anna, ben, watcher, pinned);
    } else if (mission === 'blackout' && SEED === BLACKOUT_PLAN.seed) {
      await playBlackoutToTheEnd(anna, ben, watcher);
      skip('next-mission.png', 'Blackout leads on to no other mission');
      skip('my-runs.png', 'taken after the won Systemcheck, with account-delete.png');
    } else if (mission === 'blackout') {
      skip('escape.png', `seed ${SEED} is not the one tools/fixtures/blackout-plan.json pins`);
    }
  } finally {
    await stopHatchDust();
  }
}

/** Whether `promise` settles in time: true when it resolves, false when it rejects. */
const settled = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

/** One of the settings' volumes as its row reads: „Funk 100". */
const rowText = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * settings.png: the gear in the top bar opens the settings over the running world — the three
 * volumes, the talk key, the text size and less motion — and nothing pauses under them: the
 * clock counts on. Esc closes them again. The run fails where no panel comes up, where it runs
 * out sideways, where the clock stands still under it, or where Esc leaves it open.
 */
async function captureSettings(page) {
  const clock = page.locator('.stage-top .countdown');
  const ticking = await clock.isVisible();
  await page.locator('.settings-toggle').click();
  const card = page.locator('.settings-card');
  if (!(await settled(card.waitFor({ timeout: 3000 })))) {
    fail('settings: the gear in the top bar opened no panel');
    return;
  }
  const before = ticking ? await textOf(clock) : null;
  await sleep(1300);
  const after = ticking ? await textOf(clock) : null;
  const over = await sideways(page, '.settings-card');
  await capture(page, 'settings.png');
  const volumes = (await page.locator('.settings-volume').allInnerTexts()).map(rowText);
  const key = await textOf(page.locator('.settings-kbd'));
  const lit = await page.locator('.settings-option--on').allInnerTexts();
  await page.keyboard.press('Escape');
  const closed = await settled(card.waitFor({ state: 'hidden', timeout: 2000 }));
  const stood = ticking && before === after;
  const clockSaid = !ticking
    ? 'no clock up'
    : stood
      ? `!! the clock stood at ${before}`
      : `the clock ran on, ${before} → ${after}`;
  console.log(
    `settings.png       ${volumes.join(', ')}; talk key ${key}; ${lit.join(', ')}; ` +
      clockSaid +
      (closed ? '; Esc closed it' : '; !! Esc left it open') +
      (over > 0 ? `; !! +${over}px sideways` : ''),
  );
  const wrong = [stood && 'the clock stood', !closed && 'Esc left it open', over > 0 && 'sideways'];
  if (wrong.some(Boolean)) {
    fail(`settings: ${wrong.filter(Boolean).join(', ')}`);
  }
}

/** A colour as '#rrggbb', from its channels. */
const hexOf = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/** Whether the channels `rgb` come out as the colour `hex`, give or take a little blending. */
function looksLike(rgb, hex) {
  const want = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return want.every((c, i) => Math.abs(c - (rgb[i] ?? 0)) <= 40);
}

/**
 * minimap-goal.png: the world with its minimap pointing at the goal — the console(s) of the
 * station up next, a pulsing dot each (client render/hud.ts). The traced page says where the
 * minimap lies and what it points at (`window.__escapelab.minimap`); a dot has to show in the
 * goal's colour on the canvas, unless somebody of the crew stands on it and their dot covers it.
 * A world whose minimap points at nothing skips the shot.
 */
async function captureMinimapGoal({ name, page, seen }) {
  const probe = await page.evaluate(() => globalThis.__escapelab?.minimap ?? null);
  if (probe === null || probe.goal.length === 0) {
    skip('minimap-goal.png', probe === null ? `${name}'s minimap is off` : 'no goal on it now');
    return;
  }
  // The pixel the dot's middle lies in: on a lab of 36 tiles a cell is 5 px, the dot's teal core
  // under its dark rim not 2 px across, and the pixel half a step on already takes the rim's edge.
  const spots = probe.goal.map((dot) => ({
    x: Math.floor(probe.ox + dot.x * probe.cell),
    y: Math.floor(probe.oy + dot.y * probe.cell),
  }));
  const colors = await page.evaluate((at) => {
    const g = document.querySelector('.world-canvas')?.getContext('2d');
    const rgbAt = ({ x, y }) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return at.map((spot) => (g == null ? null : rgbAt(spot)));
  }, spots);
  await capture(page, 'minimap-goal.png');
  const crew = Object.values(seen.crew ?? {});
  const covered = (dot) => crew.some((p) => Math.hypot(p.x - dot.x, p.y - dot.y) < 0.75);
  const shows = probe.goal.some((dot, i) => colors[i] !== null && looksLike(colors[i], dot.color));
  const hidden = probe.goal.every(covered);
  const where = probe.goal.map((dot) => `${dot.x - 0.5},${dot.y - 0.5}`).join(' and ');
  console.log(
    `minimap-goal.png   ${name}: ${probe.goal.length} goal dot(s) in ${probe.goal[0].color} at ` +
      `${where}, ${probe.cell} px a cell; on the canvas ` +
      `${colors.map((c) => (c === null ? 'nothing' : hexOf(c))).join(', ')}` +
      (shows ? '' : hidden ? ' (under the crew’s dots)' : " !! none in the goal's colour"),
  );
  if (!shows && !hidden) {
    fail('minimap-goal: no goal dot shows on the minimap');
  }
}

/** The keys that walk one tile's way, by its step. */
const WALK_KEYS = new Map([
  ['1,0', 'd'],
  ['-1,0', 'a'],
  ['0,1', 's'],
  ['0,-1', 'w'],
]);

/**
 * The longest straight run of open floor out of `tile` — no wall, furniture, shut door or
 * tile `avoid` names — as its step and its length in tiles.
 */
function longestRun(map, tile, avoid) {
  const closed = new Set(map.doors.filter((d) => !d.open).map((d) => `${d.x},${d.y}`));
  const solid = furniture(map);
  const blocked = (key) => closed.has(key) || solid.has(key);
  const open = (x, y) => map.tiles[y]?.[x] === '.' && !blocked(`${x},${y}`) && !avoid(x, y);
  let best = null;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    let tiles = 0;
    while (open(tile.x + dx * (tiles + 1), tile.y + dy * (tiles + 1))) {
      tiles += 1;
    }
    if (best === null || tiles > best.tiles) {
      best = { dx, dy, tiles };
    }
  }
  return best;
}

/**
 * The avatar watched in the page for `ms`, frame by frame on the page's own clock: how far it
 * went and when each footfall landed (the traced page's `self` and `footfalls`), and where the
 * camera led it at the end.
 */
async function watchGait(page, ms) {
  return page.evaluate(
    (wait) =>
      new Promise((resolve) => {
        const probe = globalThis.__escapelab;
        const from = { ...probe.self, t: globalThis.performance.now() };
        const falls = [];
        let count = probe.footfalls;
        const tick = (now) => {
          if (probe.footfalls !== count) {
            count = probe.footfalls;
            falls.push(now);
          }
          if (now - from.t < wait) {
            globalThis.requestAnimationFrame(tick);
          } else {
            const to = { ...probe.self, t: now };
            resolve({ from, to, falls, lead: probe.camera?.lead ?? null });
          }
        };
        globalThis.requestAnimationFrame(tick);
      }),
    ms,
  );
}

/**
 * One leg of the sprint check: `keys` held for `ms`; from 120 ms in to `measureMs` the pace,
 * in tiles a second, and the footfalls a second, from the time between the first and the last
 * that landed meanwhile — then a shot, which `shoot` names, the keys still held — and the
 * camera's lead as the watch ended.
 */
async function leg({ page }, keys, ms, measureMs, shoot) {
  for (const key of keys) {
    await page.keyboard.down(key);
  }
  const start = Date.now();
  await sleep(120);
  const { from, to, falls, lead } = await watchGait(page, Math.max(200, measureMs - 120));
  if (shoot !== null) {
    await capture(page, shoot);
  }
  await sleep(Math.max(0, start + ms - Date.now()));
  for (const key of [...keys].reverse()) {
    await page.keyboard.up(key);
  }
  walking.ms.set(page, (walking.ms.get(page) ?? 0) + (Date.now() - start));
  await sleep(200); // the last update goes out
  const pace = Math.hypot(to.x - from.x, to.y - from.y) / ((to.t - from.t) / 1000);
  const span = falls.length < 2 ? null : (falls.at(-1) - falls[0]) / (falls.length - 1);
  return { pace, steps: span === null ? null : 1000 / span, lead };
}

/**
 * sprint.png: the player runs out along the longest straight stretch of open floor from where
 * they stand, Shift held, and is shot halfway with the camera leading the run; then walks back
 * to the same tile. The log gives both paces and both footfall rates; the run fails where the
 * sprint is not about 1.3 times the walk, or its steps come no faster. Plates, the hatch and an
 * unread Laborkennung stay off the stretch: nothing the walkthrough does later changes.
 */
async function captureSprint(player) {
  const { name, page, seen } = player;
  const map = seen.view?.map;
  const home = tileOf(seen);
  if (map == null || home === null) {
    skip('sprint.png', `${name} stands on no map`);
    return;
  }
  const sign = seen.view.presence.signSeen ? null : map.edgeworkSign;
  const avoid = (x, y) =>
    map.plates.some((p) => p.x === x && p.y === y) ||
    (map.exit !== null && map.exit.x === x && map.exit.y === y) ||
    (sign !== null && Math.hypot(sign.x - x, sign.y - y) < 2.5);
  const run = longestRun(map, home, avoid);
  if (run === null || run.tiles < 3) {
    skip('sprint.png', `${name} has no 3 tiles of open floor in a line from ${home.x},${home.y}`);
    return;
  }
  await stepTo(page, seen, home.x + 0.5, home.y + 0.5);
  const out = WALK_KEYS.get(`${run.dx},${run.dy}`);
  const back = WALK_KEYS.get(`${-run.dx},${-run.dy}`);
  const outMs = ((run.tiles - 0.4) / (SPEED * SPRINT_FACTOR)) * 1000;
  const sprint = await leg(player, [out, 'Shift'], outMs, Math.min(800, outMs - 150), 'sprint.png');
  const away = whereIs(seen);
  const gone = Math.hypot(away.x - (home.x + 0.5), away.y - (home.y + 0.5));
  const backMs = (Math.max(0.3, gone - 0.2) / SPEED) * 1000;
  const walk = await leg(player, [back], backMs, Math.min(900, backMs - 60), null);
  await stepTo(page, seen, home.x + 0.5, home.y + 0.5);
  reportSprint(name, run, sprint, walk);
}

/** The sprint check's line in the log, and its failure where the sprint is no sprint. */
function reportSprint(name, run, sprint, walk) {
  const fixed = (n, digits = 2) => (n === null ? '?' : n.toFixed(digits));
  const ratio = sprint.pace !== null && walk.pace !== null ? sprint.pace / walk.pace : null;
  const quicker = sprint.steps !== null && walk.steps !== null ? sprint.steps / walk.steps : null;
  const lead = sprint.lead === null ? null : Math.hypot(sprint.lead.x, sprint.lead.y);
  const fine = ratio !== null && ratio > 1.15 && ratio < 1.45 && quicker !== null && quicker > 1.1;
  console.log(
    `sprint.png         ${name} over ${run.tiles} tiles: ` +
      `sprinting ${fixed(sprint.pace)} tiles/s, ` +
      `walking ${fixed(walk.pace)} (×${fixed(ratio)}); footfalls ${fixed(sprint.steps, 1)}/s ` +
      `against ${fixed(walk.steps, 1)}/s (×${fixed(quicker)}); camera ${fixed(lead)} tiles ahead` +
      (fine ? '' : ' !! no sprint'),
  );
  if (!fine) {
    fail(`sprint: ×${fixed(ratio)} the walk's pace, ×${fixed(quicker)} its footfalls`);
  }
}

// ── the gameplay package's captures: the controller, the keys, the Erfolge, the Tagesschicht
//
// The host's page opens with `?fakepad=1` (`padded`): the client's controller layer then takes a
// controller the walkthrough plays through `window.__escapelab.pad` (client input/padRuntime.ts),
// for nothing until it is used.
//
// daily.png  the host's lobby with the Tagesschicht switched on, named by today's UTC day — the
//   server's view has to say so — then off again, as the walkthrough plays the room's pinned
//   seed; a mission without one skips it
// settings-controller.png  the settings' controller section with R1, Y and L2 held on the
//   walkthrough's controller: those have to light up in the live test, the controller has to
//   count as connected, and the key table has to list all twelve actions
// gamepad-prompts.png  the host beside the nearest source or the station up, the controller used
//   last: the HUD's buttons have to name its buttons (X, View); a key pressed has to turn them
//   back (N, I)
// pad-quickchat.png  the quick chat the controller's ▶ opened in the world, its first phrase in
//   the focus and its button naming ▶; ▼ and A have to say the second phrase and shut it, and ◀
//   has to ping the floor within two tiles of the host
// chat-slot.png  Blackout's wheel on the second step of „Kabel …", „Kabel 3" in the focus: A has
//   to send it filled in, the guest hear „Kabel 3" and the host's HUD strip show it; C, the
//   digit of „Dienst …" and 2 have to say „Dienst DNS" — a mission without such phrases skips it
// console-plate.png  the heads of a two-console station's devices, one over the other: each has
//   to engrave what the view says its machine does, the two apart — or the run fails
// partner-funk.png  the PARTNER LED line of the first seat's device at that station, both
//   players at its consoles: each line has to end in „· Funk" and each page has to play the
//   partner over the station's intercom in full, gain 1 — or the run fails
// rack-diagram.png  the rack console's cabling diagram as its player opens it: six boxes, each
//   LED as the rack's unit says, no code anywhere — or the run fails
// achievements.png  the won card once its plaques are in: the ones the view says the run earned,
//   all new to the host's device — or the run fails
// share-card.png  the picture „Bild speichern" downloads from the won card, 1200 × 630
// danger-sense.png  Blackout's scratch copy with its drones up from the start: the player
//   starting at (21,8) the moment a drone closes in within five tiles — the probe naming it
//   (client world/danger.ts); a Systemcheck run skips it
// drone-close.png  right after it, the window round the nearest awake drone: its rotors' blur,
//   its nav lights blinking red and green out of step, its hotspot on the floor ahead (client
//   world/droneLights.ts) — or the run fails

/** `url` with `?fakepad=1`: the page takes the walkthrough's controller. */
function padded(url) {
  const withPad = new URL(url);
  withPad.searchParams.set('fakepad', '1');
  return withPad.href;
}

/** Saves what `locator` shows as `name` in the output folder, and counts it. */
async function captureElement(locator, name) {
  await locator.screenshot({ path: join(OUT, name) });
  taken(name);
}

/** Calls `method` on the page's controller with `args` (client input/padRuntime.ts PadProbe). */
function onPad(page, method, ...args) {
  return page.evaluate(
    ([name, rest]) => globalThis.__escapelab?.pad?.[name](...rest),
    [method, args],
  );
}

/** Today's UTC day, as the Tagesschicht names it, and as the lobby's switch prints it. */
function todayShift() {
  const day = new Date().toISOString().slice(0, 10);
  return { day, label: `Tagesschicht ${day.slice(8, 10)}.${day.slice(5, 7)}.` };
}

/**
 * daily.png: the host switches the Tagesschicht on in the lobby — the server's view has to say
 * so and the switch name today's UTC date — and off again for the pinned seed the walkthrough
 * plays. A mission without one skips it.
 */
async function captureDaily(page, seen) {
  const toggle = page.locator('.lobby-levels button.daily-switch');
  if ((await toggle.count()) === 0) {
    skip('daily.png', `${MISSION} offers no Tagesschicht`);
    return;
  }
  const { day, label } = todayShift();
  await toggle.click();
  const on = await until(() => seen.view?.daily?.on === true, 3000);
  await sleep(300);
  await capture(page, 'daily.png');
  const said = await textOf(toggle);
  await toggle.click();
  const off = await until(() => seen.view?.daily?.on === false, 3000);
  console.log(
    `daily.png          "${said}": ${on ? `on, today ${day}` : '!! never on'}, ` +
      (off ? 'off again for the pinned seed' : '!! still on'),
  );
  if (!on || !off || said !== label) {
    fail(`daily.png: "${said}" (${label}), on ${on}, off again ${off}`);
  }
}

/** The buttons the live test lights, by their names. */
function litButtons(page) {
  return page.locator('.pad-test .pad-key--lit').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-button')),
  );
}

/**
 * settings-controller.png: the gear opens the settings, the controller's section in view; the
 * walkthrough's controller holds R1, Y and L2 — none of them acts over a dialog — and the live
 * test has to light exactly those, the controller connected, the key table all twelve actions.
 * Esc closes the settings again: a real key, which turns the prompts back to the keys.
 */
async function captureControllerSettings(page) {
  await page.locator('.settings-toggle').click();
  const section = page.locator('.settings-pad');
  if (!(await settled(section.waitFor({ timeout: 3000 })))) {
    fail('settings-controller.png: the settings show no controller');
    return;
  }
  const held = ['r1', 'y', 'l2'];
  for (const button of held) {
    await onPad(page, 'press', button);
  }
  await section.scrollIntoViewIfNeeded();
  await sleep(300);
  await capture(page, 'settings-controller.png');
  const lit = await litButtons(page);
  const status = await textOf(section.locator('.settings-note').first());
  const actions = await page.locator('.settings-bindings tr[data-action]').count();
  for (const button of held) {
    await onPad(page, 'release', button);
  }
  await page.keyboard.press('Escape');
  const closed = await settled(page.locator('.settings-card').waitFor({ state: 'hidden' }));
  console.log(
    `settings-controller.png lit ${lit.join(', ') || 'nothing'}; "${status}"; ` +
      `${actions} actions with their keys; ${closed ? 'Esc closed it' : '!! still open'}`,
  );
  const lights = [...lit].sort().join(' ') === [...held].sort().join(' ');
  if (!lights || !status?.startsWith('Verbunden') || actions !== 12 || !closed) {
    fail(`settings-controller.png: lit ${lit.join(' ')}, "${status}", ${actions} actions`);
  }
}

/** What the HUD's notepad and info buttons say now. */
async function hudButtons(page) {
  const notes = await textOf(page.locator('.hud .hud-notes'));
  const info = await textOf(page.locator('.hud .hud-info:not(.hud-notes):not(.hud-mic)'));
  return `${notes} · ${info}`;
}

/**
 * gamepad-prompts.png: the player walks up to the nearest open source — else the station up —
 * the E prompt over it, then taps L3 on the walkthrough's controller, which does nothing but
 * count as using it: the HUD's buttons have to name the controller's buttons; a key pressed
 * has to turn them back. Then back to where the player stood.
 */
async function captureGamepadPrompts(player) {
  const { page, seen } = player;
  const from = tileOf(seen);
  const station = seen.view?.map?.stations.find((s) => s.status === 'armed');
  const target = nearestManual(seen) ?? station;
  if (from === null || target === undefined || !(await walkNear(page, seen, target))) {
    skip('gamepad-prompts.png', `${player.name} found no source or station to stand at`);
    return;
  }
  await sleep(400); // the prompt over it, the camera settled
  await onPad(page, 'tap', 'l3');
  await sleep(250);
  await capture(page, 'gamepad-prompts.png');
  const pad = await hudButtons(page);
  const prompt = await page.evaluate(() => globalThis.__escapelab?.highlight?.subject ?? null);
  await page.keyboard.press('Shift');
  await sleep(250);
  const keys = await hudButtons(page);
  console.log(
    `gamepad-prompts.png ${player.name} at ${JSON.stringify(prompt)}: "${pad}" on the ` +
      `controller, "${keys}" after a key`,
  );
  if (pad !== 'Notizen [X] · Info [View]' || keys !== 'Notizen [N] · Info [I]') {
    fail(`gamepad-prompts.png: "${pad}" on the controller, "${keys}" after a key`);
  }
  await walkNear(page, seen, from);
}

/** Where the page's focus is in the quick chat's wheel: its phrase's place from 1; 0 for none. */
function wheelFocus(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll('.chat-wheel [role="menuitem"]')];
    return items.indexOf(document.activeElement) + 1;
  });
}

/**
 * pad-quickchat.png: in the world, the walkthrough's controller's ▶ opens the quick chat — its
 * first phrase in the focus, the chat's button naming ▶ — then ▼ moves to the second phrase and
 * A says it: the wheel has to shut and the host's page send that line. Then ◀ pings: the page has
 * to send a ping on the floor within two tiles of where the avatar stands. Any of these that
 * fails, fails the run.
 */
async function captureQuickChat(player) {
  const { page, seen } = player;
  const sentBefore = seen.sent.length;
  await onPad(page, 'tap', 'dright');
  const wheel = page.locator('.chat-wheel');
  const open = await settled(wheel.waitFor({ timeout: 3000 }));
  await sleep(250);
  const first = await wheelFocus(page);
  const glyph = await textOf(page.locator('.world-chat-toggle .world-key'));
  await capture(page, 'pad-quickchat.png');
  await onPad(page, 'tap', 'ddown');
  await sleep(250);
  const second = await wheelFocus(page);
  await onPad(page, 'tap', 'a');
  const shut = await settled(wheel.waitFor({ state: 'detached', timeout: 3000 }));
  const said = seen.sent.slice(sentBefore).find((msg) => msg.kind === 'chat');
  const at = whereIs(seen);
  await onPad(page, 'tap', 'dleft');
  const sentPing = () => seen.sent.slice(sentBefore).find((msg) => msg.kind === 'ping');
  const pinged = await until(() => sentPing() !== undefined, 3000);
  const ping = sentPing();
  const away =
    ping === undefined || at === null ? Infinity : Math.hypot(ping.x - at.x, ping.y - at.y);
  const phrase = said === undefined ? null : seen.view?.chat?.[said.phrase];
  const saidText = said === undefined ? '!! nothing' : `„${phrase?.text ?? said.phrase}"`;
  console.log(
    `pad-quickchat.png  ▶ ${open ? 'opened the wheel' : '!! opened nothing'}, phrase ${first} in ` +
      `the focus, the button "${glyph}"; ▼ to ${second}, A said ${saidText}` +
      `${shut ? ', the wheel shut' : ' !! the wheel still open'}; ◀ pinged ` +
      (pinged ? `(${ping.x}, ${ping.y}), ${away.toFixed(2)} tiles away` : '!! nothing'),
  );
  if (!open || first !== 1 || glyph !== '[▶]' || second !== 2 || said === undefined || !shut) {
    const what = `open ${open}, focus ${first} then ${second}, "${glyph}", said ${said}`;
    fail(`pad-quickchat.png: ${what}`);
  }
  if (!pinged || !(away <= 2.05)) {
    fail(`pad-quickchat.png: ◀ pinged ${JSON.stringify(ping)} from ${JSON.stringify(at)}`);
  }
}

/**
 * The HUD's radio strip on `page` once it reads `line`, or as it reads after `ms` of waiting
 * for it; null while it carries nothing — a radio line on the air holds it.
 */
async function hudLineOnceIt(page, line, ms) {
  const end = Date.now() + ms;
  let strip = await textOf(page.locator('.hud .hud-radio'));
  while (strip !== line && Date.now() < end) {
    await sleep(100);
    strip = await textOf(page.locator('.hud .hud-radio'));
  }
  return strip;
}

/**
 * The phrase with a slot of the kind `slot` (`{n}`, `{name}`) in a page's quick chat, by its
 * place in the wheel; -1 where it has none.
 */
const slotPhrase = (seen, slot) =>
  (seen.view?.chat ?? []).findIndex((phrase) => phrase.text.includes(slot));

/**
 * The quick chat's second step, driven by keys: C opens the wheel, the digit of the phrase
 * with a name in its slot opens its second step, 2 says it with the slot's second name. What
 * the page sent for it, or null.
 */
async function sayByKeys(player, place) {
  const { page, seen } = player;
  const sentBefore = seen.sent.length;
  await page.keyboard.press('c'); // the chat's key, as the walkthrough leaves it bound
  await page.keyboard.press(String(place + 1));
  const stepped = await settled(page.locator('.chat-wheel--slot').waitFor({ timeout: 3000 }));
  await page.keyboard.press('2');
  const sent = await until(() => seen.sent.length > sentBefore, 3000);
  return stepped && sent ? (seen.sent.at(-1) ?? null) : null;
}

/**
 * chat-slot.png: Blackout's quick chat carries a station's data. The walkthrough's controller
 * opens the wheel with ▶, ▼ walks down to „Kabel …" and A opens its second step, the first
 * value in the focus; ▶ ▶ moves to „Kabel 3", which is shot, and A says it: the host's page has
 * to send the phrase's place with „3", the guest has to hear „Kabel 3" from the host, and the
 * host's HUD strip has to show „Anna: Kabel 3" unless a radio line holds it. Then the keys do
 * the same for „Dienst …": C, its digit, 2 — „Dienst DNS". A mission without such phrases skips
 * it; anything else that goes wrong fails the run.
 */
async function captureChatSlot(player, other) {
  const { page, seen } = player;
  const wire = slotPhrase(seen, '{n}');
  const service = slotPhrase(seen, '{name}');
  if (wire < 0 || service < 0) {
    skip('chat-slot.png', `${MISSION}'s quick chat carries no number and no name`);
    return;
  }
  await sleep(1300); // past the server's chat cooldown after pad-quickchat.png's line
  const sentBefore = seen.sent.length;
  const eventsBefore = seen.view?.events?.length ?? 0;
  await onPad(page, 'tap', 'dright');
  const opened = await settled(page.locator('.chat-wheel').waitFor({ timeout: 3000 }));
  await sleep(250); // the first phrase takes the focus as the wheel comes up
  for (let step = 0; step < wire; step++) {
    await onPad(page, 'tap', 'ddown');
    await sleep(200);
  }
  const onPhrase = await wheelFocus(page);
  await onPad(page, 'tap', 'a');
  const stepped = await settled(page.locator('.chat-wheel--slot').waitFor({ timeout: 3000 }));
  await sleep(250);
  const firstValue = await wheelFocus(page);
  for (let step = 0; step < 2; step++) {
    await onPad(page, 'tap', 'dright');
    await sleep(150);
  }
  const onValue = await wheelFocus(page);
  await capture(page, 'chat-slot.png');
  await onPad(page, 'tap', 'a');
  const wheelGone = page.locator('.chat-wheel').waitFor({ state: 'detached', timeout: 3000 });
  const shut = await settled(wheelGone);
  const said = seen.sent.slice(sentBefore).find((msg) => msg.kind === 'chat');
  const me = seen.view?.you?.id;
  const heard = await until(
    () => other.seen.heard.some((line) => line.playerId === me && line.text === 'Kabel 3'),
    3000,
  );
  const shown = `${player.name}: Kabel 3`;
  const strip = await hudLineOnceIt(page, shown, 5000);
  // The strip carries the newer of the last chat line and the run's last line: one the run
  // said after the chat — the mission control's hint, as a longer walkthrough may meet it —
  // takes it over, rightly.
  const newer = (seen.view?.events?.length ?? 0) > eventsBefore;
  await sleep(1300); // past the cooldown again
  const keyed = await sayByKeys(player, service);
  const keyedHeard = await until(
    () => other.seen.heard.some((line) => line.playerId === me && line.text === 'Dienst DNS'),
    3000,
  );
  console.log(
    `chat-slot.png      ▶ ${opened ? 'opened the wheel' : '!! opened nothing'}, ▼ to ` +
      `${onPhrase}, A ${stepped ? 'opened the second step' : '!! opened no second step'}, ` +
      `${firstValue} in the focus, ▶▶ to ${onValue}; A sent ${JSON.stringify(said ?? null)}` +
      `${shut ? ', the wheel shut' : ' !! the wheel still open'}; ${other.name} heard ` +
      `${heard ? '„Kabel 3"' : '!! nothing'}; the HUD strip "${strip ?? '(on the air)'}"` +
      `${strip !== shown && newer ? ', a line of the run newer than the chat' : ''}; ` +
      `keys sent ${JSON.stringify(keyed)}, ${other.name} heard ` +
      `${keyedHeard ? '„Dienst DNS"' : '!! nothing'}`,
  );
  const wrong = [
    !opened && 'the wheel never opened',
    onPhrase !== wire + 1 && `▼ came to ${onPhrase}, not ${wire + 1}`,
    !stepped && 'A opened no second step',
    firstValue !== 1 && `the second step opened on ${firstValue}`,
    onValue !== 3 && `▶▶ came to ${onValue}`,
    (said?.phrase !== wire || said?.value !== '3') && `A sent ${JSON.stringify(said)}`,
    !shut && 'the wheel stayed open',
    !heard && `${other.name} never heard „Kabel 3"`,
    strip !== null && strip !== shown && !newer && `the HUD strip read "${strip}"`,
    (keyed?.phrase !== service || keyed?.value !== 'DNS') &&
      `the keys sent ${JSON.stringify(keyed)}`,
    !keyedHeard && `${other.name} never heard „Dienst DNS"`,
  ].filter(Boolean);
  if (wrong.length > 0) {
    fail(`chat-slot.png: ${wrong.join('; ')}`);
  }
}

/**
 * settings-controller.png, gamepad-prompts.png, pad-quickchat.png and chat-slot.png, one after
 * the other.
 */
async function captureControls(player, other) {
  await captureControllerSettings(player.page);
  await captureGamepadPrompts(player);
  await captureQuickChat(player);
  await captureChatSlot(player, other);
}

/**
 * rack-diagram.png: the rack console's cabling diagram (client puzzles/RackDiagram.tsx) as its
 * player opened it — six boxes, each LED as the view's unit says, no code anywhere — or the run
 * fails.
 */
async function captureRackDiagram(rack) {
  const diagram = rack.page.locator('.station-modal .rack-diagram');
  if (!(await settled(diagram.waitFor({ timeout: 3000 })))) {
    fail('rack-diagram.png: the rack shows no cabling diagram');
    return;
  }
  await captureElement(diagram, 'rack-diagram.png');
  const leds = await diagram.locator('.services-box').evaluateAll((boxes) =>
    boxes.map((box) => [
      box.getAttribute('data-service'),
      box.querySelector('.services-led')?.getAttribute('class') ?? '',
    ]),
  );
  const units = rack.seen.view?.puzzle?.rack ?? [];
  const off = units.filter(
    (unit) => !leds.some(([service, led]) => service === unit.service && led.endsWith(unit.led)),
  );
  const codes = /E\d\d/.test(await diagram.innerText());
  console.log(
    `rack-diagram.png   ${rack.name}: ${leds.length} boxes, ` +
      `${units.map((unit) => `${unit.service} ${unit.led}`).join(', ')}` +
      `${off.length > 0 ? ` !! LEDs off the rack: ${off.map((u) => u.service).join(', ')}` : ''}` +
      `${codes ? ' !! a code on the rack' : ''}`,
  );
  if (leds.length !== 6 || off.length > 0 || codes) {
    fail(`rack-diagram.png: ${leds.length} boxes, ${off.length} LEDs off, codes ${codes}`);
  }
}

/** How long the won card's plaques take to come in: after 1.2 s, 300 ms apart, 450 ms each. */
const plaquesInMs = (count) => 1200 + 300 * Math.max(0, count - 1) + 450 + 300;

/** A PNG's size, from its header. */
function pngSize(path) {
  const png = readFileSync(path);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * achievements.png: the won card once its plaques are in — the ones the view says the run
 * earned, every one new to the host's device, which has won nothing before; share-card.png:
 * the picture „Bild speichern" downloads, 1200 × 630. Fails otherwise.
 */
async function captureAchievements(player) {
  const { page, seen } = player;
  const earned = seen.view?.achievements ?? [];
  await sleep(plaquesInMs(earned.length));
  await captureElement(page.locator('.end-title'), 'achievements.png');
  const shown = await page
    .locator('.end-title .plaque')
    .evaluateAll((plaques) => plaques.map((plaque) => plaque.getAttribute('data-achievement')));
  const fresh = await page.locator('.end-title .plaque--new').count();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.locator('.end-title .share-save').click(),
  ]);
  const path = join(OUT, 'share-card.png');
  await download.saveAs(path);
  taken('share-card.png');
  const { width, height } = pngSize(path);
  console.log(
    `achievements.png   ${player.name}: ${shown.join(', ') || 'no plaque'} (${fresh} new); ` +
      `share-card.png "${download.suggestedFilename()}" ${width}×${height}`,
  );
  const plaques = JSON.stringify(shown) === JSON.stringify(earned) && fresh === earned.length;
  if (!plaques || width !== 1200 || height !== 630) {
    const said = `${shown.join(' ')} of ${earned.join(' ')}, ${fresh} new`;
    fail(`achievements: ${said}, the picture ${width}×${height}`);
  }
}

/** The danger sense's scratch copy of Blackout, by its id and title. */
const DANGER_MISSION = { id: 'custom-gefahr', title: 'Gefahrprobe' };
/** How long the danger sense gets to hear a drone close in, ms: a patrol's round and more. */
const DANGER_WAIT_MS = 45_000;
/** What stands over the world as a run starts: the location card, the briefing's count. */
const DANGER_COVERS = '.intro-card, .briefing';
/** How near the shot wants the drone sensed, tiles: nearer, its glow shows plainer. */
const DANGER_SHOT_TILES = 3.5;

/**
 * Where the danger sense's player starts: by the Flurwache's beat, on the tile nearest to it
 * that the drone never looks at (patrol.mjs `havens`, every door shut as the run starts) — so
 * that it passes within DANGER_SHOT_TILES of a player it does not spot — and on nothing else of
 * the map: no plate, door, console, part or source's place.
 */
const UNDER_THE_PATROL = (() => {
  const { map } = BLACKOUT;
  const drone = map.drones.find((d) => d.frozenByPlate !== undefined);
  const beat = { waypoints: drone.waypoints, speed: drone.speed };
  const shut = new Set(map.doors.map((door) => `${door.x},${door.y}`));
  const watcher = { beat, range: drone.range, halfAngleDeg: drone.halfAngleDeg };
  const safe = havens([watcher], { tiles: map.tiles, shut });
  const middles = drone.waypoints.map(({ x, y }) => ({ x: x + 0.5, y: y + 0.5 }));
  const offLeg = (p, a, b) => {
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.hypot(dx, dy) ** 2;
    const along = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    return Math.hypot(p.x - a.x - along * dx, p.y - a.y - along * dy);
  };
  const legs = middles.map((a, i) => [a, middles[(i + 1) % middles.length]]);
  const offBeat = ({ x, y }) =>
    Math.min(...legs.map(([a, b]) => offLeg({ x: x + 0.5, y: y + 0.5 }, a, b)));
  const spots = map.manuals.flatMap((m) => m.spots);
  const things = [map.plates, map.doors, map.stations, map.items, spots].flat();
  const taken = new Set(things.map(({ x, y }) => `${x},${y}`));
  const solid = furniture(map);
  return [...safe]
    .filter((key) => !taken.has(key) && !solid.has(key))
    .map((key) => key.split(',').map(Number))
    .map(([x, y]) => ({ x, y }))
    .sort((a, b) => offBeat(a) - offBeat(b))[0];
})();

/**
 * Blackout as the danger sense's capture plays it: no intro, so the lights are out from the
 * start; its drones up with them; for two, one starting under the Flur's patrol
 * (UNDER_THE_PATROL), the other on the Archiv's spawn.
 */
function dangerMission() {
  const blackout = structuredClone(BLACKOUT);
  delete blackout.next;
  delete blackout.intro;
  return {
    ...blackout,
    ...DANGER_MISSION,
    listOrder: 98,
    daily: false,
    players: { min: 2, max: 2 },
    map: {
      ...blackout.map,
      spawns: [UNDER_THE_PATROL, blackout.map.spawns[0]],
      drones: blackout.map.drones.map((drone) => ({ ...drone, activeAfterSolved: 0 })),
    },
  };
}

/** The danger probe of a traced page (client world/danger.ts); null before its first look. */
function dangerOf(page) {
  return page.evaluate(() => globalThis.__escapelab?.danger ?? null);
}

/**
 * Waits up to `ms` for `page`'s danger sense to name a drone closing in, DANGER_SHOT_TILES or
 * nearer: the probe, or null.
 */
async function dangerSensed(page, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const danger = await dangerOf(page);
    if (danger?.drone != null && danger.distance <= DANGER_SHOT_TILES) {
      return danger;
    }
  }
  return null;
}

/**
 * danger-sense.png: Blackout's scratch copy, saved through the editor's route and played by
 * two; the player starting under the Flur's patrol stands still, past the location card, until a
 * drone closes in, and is shot the moment the probe names it DANGER_SHOT_TILES away, the edge
 * glowing toward it. Fails where none comes that near in DANGER_WAIT_MS, or a card still covers
 * the world. The copy is deleted again whatever happened.
 */
async function captureDangerSense() {
  if (MISSION.toLowerCase() !== 'blackout') {
    skip('danger-sense.png', `the danger sense plays Blackout's copy; this run plays ${MISSION}`);
    return;
  }
  const api = await request.newContext({ baseURL: BASE });
  const saved = await api.post('/missions/custom', { data: dangerMission() });
  if (saved.status() !== 201) {
    fail(`danger-sense: the scratch copy was not taken (${saved.status()}): ${await saved.text()}`);
    await api.dispose();
    return;
  }
  const pages = [];
  try {
    const host = await artPage('Anna', SIZES[0]);
    pages.push(host);
    await host.page.goto(traced(BASE));
    await host.page.getByPlaceholder('z. B. Anna').fill('Anna');
    await openRound(host.page, DANGER_MISSION.title);
    await host.page.locator('.room-code strong').waitFor({ timeout: 10_000 });
    const code = (await host.page.locator('.room-code strong').innerText()).trim();
    const guest = await artPage('Ben', SIZES[0]);
    pages.push(guest);
    await guest.page.goto(traced(BASE));
    await guest.page.getByPlaceholder('z. B. Anna').fill('Ben');
    await byCode(guest.page, code);
    await guest.page.locator('.lobby').waitFor({ timeout: 10_000 });
    await startRun(host, guest);
    const { x, y } = UNDER_THE_PATROL;
    const under = startedAt([host, guest], x, y);
    if (under === undefined) {
      throw new Error(`nobody of the danger sense’s crew started at (${x},${y})`);
    }
    // The location card, and under it the briefing's count, stand over the world as the run
    // starts: the glow shows once both are gone.
    await under.page.locator('.intro-card').waitFor({ state: 'attached', timeout: 5000 });
    await under.page.waitForFunction(
      (covers) => document.querySelector(covers) === null,
      DANGER_COVERS,
      { timeout: 20_000 },
    );
    const danger = await dangerSensed(under.page, DANGER_WAIT_MS);
    if (danger === null) {
      const near = `${DANGER_SHOT_TILES} tiles in ${seconds(DANGER_WAIT_MS)}`;
      fail(`danger-sense.png: no drone closed in on ${under.name} to ${near}`);
      return;
    }
    await capture(under.page, 'danger-sense.png');
    if ((await under.page.locator(DANGER_COVERS).count()) > 0) {
      fail('danger-sense.png: the location card or the briefing stood over the world at the shot');
    }
    console.log(
      `danger-sense.png   ${under.name} at ${x},${y}: ${danger.drone} closing in, ` +
        `${danger.distance.toFixed(1)} tiles, ${danger.ticks} tick(s)`,
    );
    await captureDroneClose(under);
  } catch (err) {
    console.log(`danger-sense       !! ${firstLine(err)}`);
    fail(`danger-sense: ${firstLine(err)}`);
  } finally {
    for (const { context } of pages) {
      await context.close();
    }
    const gone = await api.delete(`/missions/custom/${DANGER_MISSION.id}`);
    console.log(`danger-sense       ${DANGER_MISSION.id} deleted again: ${gone.status()}`);
    await api.dispose();
  }
}

/** How many times, and how far apart, a drone's nav lights are read: over two of their beats. */
const NAV_READS = 20;
const NAV_READ_MS = 100;

/**
 * drone-close.png: a drone close by in the dark (client world/droneLights.ts), right after the
 * danger sense's shot — the window round the awake drone nearest the player, two and a half
 * tiles each way: its rotors' blur, its nav lights, its searchlight's hotspot on the floor ahead.
 * The page's probe has to name that hotspot ahead of the drone where it looks, and its nav
 * lights read NAV_READS times NAV_READ_MS apart have to blink — each lit and out at least once
 * — and never burn together, or the run fails.
 */
async function captureDroneClose(player) {
  const { page } = player;
  const self = await selfOn(page);
  const near = (d) => Math.hypot(d.x - (self?.x ?? 0), d.y - (self?.y ?? 0));
  const probe = await graphicsWhen(page, (p) => p.drones.some((d) => d.hotspot !== null), 3000);
  const drone = (probe?.drones ?? [])
    .filter((d) => !d.frozen && d.hotspot !== null)
    .sort((a, b) => near(a) - near(b))[0];
  if (drone === undefined) {
    skip('drone-close.png', 'no awake drone with its hotspot on the floor in this window');
    return;
  }
  await shootAround(page, 'drone-close.png', drone, 2.5);
  const reads = [];
  for (let i = 0; i < NAV_READS; i++) {
    const seen = (await graphicsOf(page))?.drones.find((d) => d.id === drone.id);
    if (seen !== undefined) {
      reads.push(seen.nav);
    }
    await sleep(NAV_READ_MS);
  }
  const lit = (side) => reads.filter((nav) => nav[side] > 0).length;
  const both = reads.filter((nav) => nav.port > 0 && nav.starboard > 0).length;
  const blinks = ['port', 'starboard'].every((side) => lit(side) > 0 && lit(side) < reads.length);
  const { hotspot } = drone;
  const way = Math.atan2(hotspot.y - drone.y, hotspot.x - drone.x);
  const fine = blinks && both === 0 && Math.cos(way - drone.facing) > 0.99;
  const where = `${hotspot.x.toFixed(2)},${hotspot.y.toFixed(2)}`;
  const at = `${drone.x.toFixed(2)},${drone.y.toFixed(2)}`;
  console.log(
    `drone-close.png    ${player.name}: ${drone.id} at ${at}, its hotspot at ${where}; ` +
      `red lit ${lit('port')}, green ${lit('starboard')}, both ${both} of ${reads.length} reads` +
      (fine ? '' : ' !!'),
  );
  if (!fine) {
    fail(`drone-close.png: hotspot ${where}, nav red ${lit('port')} green ${lit('starboard')}`);
  }
}

// ── the reconnect drill: a crew of three in Blackout, one away and back ──────────────────────
//
// A room of its own, before the walkthrough: Anna opens Blackout, Ben and Cem join, all three
// switch their microphones on and skip the opening. Ben's network goes (`context.setOffline`):
// his page finds its line dead and says so over the world (reconnect-overlay.png); the server,
// whose pings Ben's browser still answers, cuts his silent socket, and the pause card on
// Anna's page counts (pause-waiting.png); 60 s into the pause it offers the way on without
// him, Anna presses it and the clock runs again (continue-without.png). Ben's network back,
// his page is back on its pass at once and Anna's says so (back-toast.png); the voice links
// come up again. Ben in a new tab of his browser finds the run's card on the join screen and
// goes back (rejoin-card.png), his first tab told the seat went to the other. Ben's network
// goes once more, a phone named Ben asks for his seat by the room's code and his name, Anna's
// pause card asks her (takeover-ask.png), she lets it in, and his browser, back, is refused
// (takeover.png). Any step that fails, fails the run.

/** How long the drill waits for what one step brings, ms. */
const DRILL_STEP_MS = 40_000;
/** The run's first drop lets the crew go on after this long (core FIRST_WAIT_MS), ms. */
const DRILL_WAIT_MS = 60_000;
/** How far past the minute the button may come: the card's margin and a poll, ms. */
const DRILL_BUTTON_SLACK_MS = 3000;

/** A player of the drill: a page of its own in a context of its own, its socket listened in on. */
async function drillPlayer(name) {
  const context = await browser.newContext({ viewport: SIZES[0] });
  await wonBefore(context);
  const page = await openPage(context, `drill ${name}`);
  page.on('pageerror', (e) => console.log(`[drill ${name} error]`, e.message));
  return { name, context, page, seen: eavesdrop(page) };
}

/** `player` joins room `code` from the menu, by the code's own field. */
async function joinByCode(player, code) {
  await player.page.goto(traced(BASE));
  await player.page.getByPlaceholder('z. B. Anna').fill(player.name);
  await byCode(player.page, code);
}

/**
 * The drill's crew in Blackout's dark: Anna opens the room, Ben and Cem join and say yes,
 * the microphones on, the run started, the opening skipped by all three.
 */
async function drillCrew() {
  const anna = await drillPlayer('Anna');
  const ben = await drillPlayer('Ben');
  const cem = await drillPlayer('Cem');
  const crew = [anna, ben, cem];
  await anna.page.goto(traced(BASE));
  await anna.page.getByPlaceholder('z. B. Anna').fill('Anna');
  await openRound(anna.page, MISSION);
  await anna.page.locator('.room-code strong').waitFor({ timeout: 10_000 });
  const code = (await anna.page.locator('.room-code strong').innerText()).trim();
  for (const player of [ben, cem]) {
    await joinByCode(player, code);
    await player.page.locator('.lobby').waitFor({ timeout: 10_000 });
  }
  await micsOn(crew);
  for (const player of [ben, cem]) {
    await clickText(player.page, 'Ich bin bereit');
  }
  const ready = () => anna.seen.view?.players?.filter((p) => p.ready).length === 2;
  if (!(await until(ready, 10_000))) {
    throw new Error('Ben and Cem never stood ready on Anna’s page');
  }
  await clickText(anna.page, 'Mission starten');
  for (const { page } of crew) {
    await page.locator('.stage').waitFor({ timeout: START_MS });
  }
  await sleep(1800); // past the location card
  for (const { page } of crew) {
    await page.keyboard.press('Space');
  }
  if (!(await until(() => anna.seen.view?.lights?.out === true, 15_000))) {
    throw new Error('the drill’s lights never went out');
  }
  await sleep(2500); // past the title of the blackout
  return { code, anna, ben, cem, crew };
}

/** Whether `page` shows the pause card waiting for `name`. */
const waitingFor = (page, name) =>
  page.locator('.overlay.pause:not(.line-lost) h1', { hasText: `Warten auf ${name}` }).count();

/** Polls `check` (async) until it holds or `ms` have passed; whether it held. */
async function untilAsync(check, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) {
      return true;
    }
    if (Date.now() > end) {
      return false;
    }
    await sleep(200);
  }
}

/** Fails the run where the way on came off the minute, or the clock stood after the press. */
function judgeWayOn(offeredAfter, before, after) {
  if (offeredAfter < DRILL_WAIT_MS || offeredAfter > DRILL_WAIT_MS + DRILL_BUTTON_SLACK_MS) {
    fail(`continue-without: the way on came ${seconds(offeredAfter)} into the pause, not at 60 s`);
  }
  if (before === null || before === after) {
    fail(`continue-without.png: the clock stands at ${before} after the press`);
  }
}

/**
 * Ben's network goes: his page's own card, the server's cut, Anna's pause card and its counter,
 * the way on 60 s into the pause, the clock running again once Anna pressed it.
 */
async function benAway({ anna, ben }) {
  const off = Date.now();
  await ben.context.setOffline(true);
  if (!(await untilAsync(async () => (await waitingFor(anna.page, 'Ben')) > 0, DRILL_STEP_MS))) {
    throw new Error(`Anna’s page never waited for Ben, ${seconds(Date.now() - off)} offline`);
  }
  const pausedAt = anna.seen.view?.pausedAt ?? Date.now();
  await sleep(2500);
  const count = await textOf(anna.page.locator('.pause-count'));
  await capture(anna.page, 'pause-waiting.png');
  await captureBound(anna);
  const button = anna.page.locator('.pause-go-on', { hasText: 'Ohne Ben weiter' });
  await button.waitFor({ state: 'visible', timeout: DRILL_WAIT_MS + DRILL_STEP_MS });
  const offeredAfter = Date.now() - pausedAt;
  await button.click();
  if (!(await until(() => anna.seen.view?.pausedFor === null, 5000))) {
    throw new Error('the run did not go on without Ben after the press');
  }
  await sleep(600);
  const before = await textOf(anna.page.locator('.countdown'));
  await sleep(2200);
  const after = await textOf(anna.page.locator('.countdown'));
  await capture(anna.page, 'continue-without.png');
  console.log(
    `pause-waiting.png  Anna waits for Ben, the counter at ${count}, ` +
      `${seconds(pausedAt - off)} after his network went; the way on after ` +
      `${seconds(offeredAfter)} of pause; continue-without.png the clock ${before} → ${after}`,
  );
  judgeWayOn(offeredAfter, before, after);
  return off;
}

/** Ben's own card while his network is gone: the line lost, the next try and the ways on. */
async function benOwnCard({ ben }) {
  const card = ben.page.locator('.line-lost');
  await card.waitFor({ state: 'visible', timeout: DRILL_STEP_MS });
  const retry = await textOf(card.locator('.line-retry'));
  const ways = await card.locator('button').allInnerTexts();
  await capture(ben.page, 'reconnect-overlay.png');
  console.log(`reconnect-overlay.png Ben's own card: „${retry}", ${ways.join(' · ')}`);
  if (!/^Verbinde neu · Versuch \d+/.test(retry ?? '')) {
    fail(`reconnect-overlay.png: the card says „${retry}", no try counted`);
  }
  const wanted = ['Jetzt versuchen', 'Seite neu laden', 'Einsatz aufgeben'];
  if (wanted.some((way) => !ways.includes(way))) {
    fail(`reconnect-overlay.png: the card offers ${ways.join(', ')}`);
  }
}

/**
 * Ben's network back: his page back on its pass, the card gone, Anna's page saying so, the
 * voice links of all three up again.
 */
async function benBack({ anna, ben, crew }, off) {
  await ben.context.setOffline(false);
  const back = Date.now();
  await ben.page.locator('.line-lost').waitFor({ state: 'hidden', timeout: DRILL_STEP_MS });
  const toast = anna.page.locator('.crew-back');
  const said = await toast.waitFor({ state: 'visible', timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  const words = said ? await textOf(toast) : null;
  if (said) {
    await capture(anna.page, 'back-toast.png');
  }
  const linked = await linksUp(crew);
  console.log(
    `back-toast.png     Ben back ${seconds(Date.now() - back)} after his network, away ` +
      `${seconds(back - off)}: Anna's page says „${words}"; voice ` +
      (linked ? 'linked again' : `!! ${await linkStates(crew)}`),
  );
  if (words !== 'Ben ist zurück') {
    fail(`back-toast.png: Anna's page said „${words}" for Ben's return`);
  }
  if (!linked) {
    fail('the voice links did not come up again after Ben’s reconnect');
  }
}

/** Ben in a new tab of his browser: the run's card on the join screen, and back to the run. */
async function benRejoins({ ben }) {
  const page = await openPage(ben.context, 'drill Ben tab');
  const tab = { name: 'Ben', context: ben.context, page, seen: eavesdrop(page) };
  await page.goto(traced(BASE));
  const card = page.locator('.bound--run');
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  const facts = await textOf(card.locator('.bound-facts'));
  await capture(page, 'rejoin-card.png');
  await card.locator('.bound-back').click();
  await page.locator('.stage').waitFor({ timeout: 10_000 });
  const moved = ben.page.locator('.banner.error', { hasText: 'anderen Fenster' });
  const told = await moved.waitFor({ timeout: 5000 }).then(
    () => true,
    () => false,
  );
  console.log(
    `rejoin-card.png    Ben's new tab finds the run (${facts}) and goes back to it; ` +
      `the first tab ${told ? 'told the seat went to the other' : '!! told nothing'}`,
  );
  if (!told) {
    fail('rejoin: Ben’s first tab was not told that his seat went to the new one');
  }
  return tab;
}

/**
 * A phone named Ben asks for his seat by the room's code and his name: Anna's pause card has
 * to ask her, whose seat and with the time left (takeover-ask.png), and she lets it in.
 */
async function annaLetsIn(anna, phone, code) {
  await joinByCode(phone, code);
  const ask = anna.page.locator('.takeover-ask', { hasText: 'Ben meldet sich' });
  await ask.waitFor({ state: 'visible', timeout: DRILL_STEP_MS });
  const words = await textOf(ask.locator('p'));
  await capture(anna.page, 'takeover-ask.png');
  console.log(`takeover-ask.png   Anna's card: „${words}"`);
  await ask.locator('.takeover-allow').click();
}

/**
 * Ben's network goes once more; a phone named Ben asks for his seat, Anna lets it in
 * (`annaLetsIn`), it sits down; his browser, back, is refused.
 */
async function benTakenOver({ code, anna }, tab) {
  await tab.context.setOffline(true);
  if (!(await untilAsync(async () => (await waitingFor(anna.page, 'Ben')) > 0, DRILL_STEP_MS))) {
    throw new Error('Anna’s page never waited for Ben the second time');
  }
  const phone = await drillPlayer('Ben');
  try {
    await annaLetsIn(anna, phone, code);
    await phone.page.locator('.stage').waitFor({ timeout: 10_000 });
    const on = await until(() => anna.seen.view?.pausedFor === null, 5000);
    await tab.context.setOffline(false);
    const refusal = tab.page.locator('.banner.error', { hasText: 'anderen Gerät' });
    const refused = await refusal.waitFor({ timeout: DRILL_STEP_MS }).then(
      () => true,
      () => false,
    );
    // The banner's own words, without its „schließen".
    const words = refused
      ? await refusal.evaluate((banner) => banner.firstChild?.textContent?.trim() ?? null)
      : null;
    await capture(tab.page, 'takeover.png');
    console.log(
      `takeover.png       a phone named Ben, let in, sits down on his seat` +
        (on ? ', the run on' : ' — !! the run still waits') +
        `; his browser back: „${words ?? 'nothing said'}"`,
    );
    if (!on || !refused) {
      fail('takeover: the phone did not take Ben’s seat, or his browser was not refused');
    }
  } finally {
    await phone.context.close();
  }
}

/**
 * The reconnect drill (see above): Blackout for three, Ben away and back, on in a new tab,
 * taken over by a phone. Skipped for any other mission; the contexts closed whatever happened.
 */
async function captureReconnect() {
  if (MISSION.toLowerCase() !== 'blackout') {
    skip('reconnect', `the reconnect drill plays Blackout for three; this run plays ${MISSION}`);
    return;
  }
  const from = Date.now();
  const contexts = [];
  try {
    const drill = await drillCrew();
    contexts.push(...drill.crew.map(({ context }) => context));
    const off = await benAway(drill);
    await benOwnCard(drill);
    await benBack(drill, off);
    const tab = await benRejoins(drill);
    await benTakenOver(drill, tab);
  } catch (err) {
    console.log(`reconnect          !! ${firstLine(err)}`);
    fail(`reconnect: ${firstLine(err)}`);
  } finally {
    for (const context of contexts) {
      await context.close();
    }
    console.log(`reconnect          the drill took ${seconds(Date.now() - from)}`);
  }
}

// ── the server the run owns, and the restart drill ────────────────────────────────────────────
//
// Where the run owns its server (SHOTS_SERVER), a room of its own after the reconnect drill:
// Anna, Ben and Cem in Blackout's dark. The server gets SIGTERM, as Render sends it before a
// deploy replaces the instance: it stands the run still, hands every page the room's last
// snapshot and closes its socket with 1012, and exits 0. Every page's own card says the server
// restarts (restart-maintenance.png). Started again on the same port with the same ROOM_SECRET,
// the server knows no room: the pages resume with their snapshots, the room is taken up again,
// and every page is back in the run within RESTART_BACK_MS (restart-recovered.png), the clock
// where it stood. Skipped, the reason logged, where the run does not own its server or plays
// another mission.

/** The server the run started (`startServer`), and how it ended; null while it owns none. */
let owned = null;

/** How long every page may take to be back in the run once the server is up again, ms. */
const RESTART_BACK_MS = 15_000;

/** Whether the server at BASE answers /health, asked over `api`. */
async function healthy(api) {
  try {
    return (await api.get('/health', { timeout: 2000 })).ok();
  } catch {
    return false;
  }
}

/**
 * Starts the server the run owns (SHOTS_SERVER) on BASE's port, its log appended to server.log
 * under OUT; resolves once it answers /health, and throws where it has not within SERVER_UP_MS
 * or ended meanwhile — or where another server answers there already, one the run would only
 * think it owns.
 */
async function startServer() {
  mkdirSync(OUT, { recursive: true });
  if (await healthyAtBase()) {
    throw new Error(`${BASE} answers already: the run cannot own a server there`);
  }
  const port = new URL(BASE).port || '80';
  const args = SERVER_ENTRY.endsWith('.ts') ? ['--import', 'tsx', SERVER_ENTRY] : [SERVER_ENTRY];
  const log = createWriteStream(join(OUT, 'server.log'), { flags: 'a' });
  const child = spawn(process.execPath, args, {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: port, ALLOW_SEED: '1', TLS: 'off', ROOM_SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const exited = new Promise((done) => {
    child.once('exit', (code, signal) => done({ code, signal }));
  });
  const server = { child, exited, ended: null };
  exited.then((end) => {
    server.ended = end;
  });
  owned = server;
  const from = Date.now();
  const api = await request.newContext({ baseURL: BASE });
  try {
    while (!(await healthy(api))) {
      if (server.ended !== null || Date.now() - from > SERVER_UP_MS) {
        throw new Error(`the server at ${BASE} did not come up (${JSON.stringify(server.ended)})`);
      }
      await sleep(200);
    }
  } finally {
    await api.dispose();
  }
  console.log(`server             ${SERVER_ENTRY} up on ${port} in ${seconds(Date.now() - from)}`);
}

/** Whether a server answers /health at BASE right now. */
async function healthyAtBase() {
  const api = await request.newContext({ baseURL: BASE });
  try {
    return await healthy(api);
  } finally {
    await api.dispose();
  }
}

/** Ends the server the run owns with `signal`; how it ended — null where it owns none. */
async function stopServer(signal = 'SIGTERM') {
  if (owned === null) {
    return null;
  }
  const { child, exited } = owned;
  owned = null;
  child.kill(signal);
  return exited;
}

/** Whether `player`'s page shows its line's card saying the server restarts. */
const restartCard = (player) =>
  player.page
    .locator('.line-lost h1', { hasText: 'WARTUNG · Der Server startet neu' })
    .isVisible();

/** Whether `player`'s page is back in the run: no card of its line, the run on and not waiting. */
async function backInTheRun(player) {
  const view = player.seen.view;
  const card = await player.page.locator('.line-lost').count();
  return card === 0 && view?.phase === 'playing' && view.pausedFor === null;
}

/**
 * SIGTERM for the server the run owns: it exits 0, and every page's own card says the server
 * restarts (restart-maintenance.png). Returns when the server went down.
 */
async function serverDown({ anna, crew }) {
  const clock = await textOf(anna.page.locator('.countdown'));
  const sent = Date.now();
  const end = await stopServer('SIGTERM');
  const took = Date.now() - sent;
  if (end?.code !== 0) {
    fail(`restart: the server ended ${JSON.stringify(end)} on SIGTERM, not exit 0`);
  }
  const shown = await untilAsync(
    async () => (await Promise.all(crew.map(restartCard))).every(Boolean),
    DRILL_STEP_MS,
  );
  const retry = await textOf(anna.page.locator('.line-lost .line-retry'));
  await capture(anna.page, 'restart-maintenance.png');
  console.log(
    `restart-maintenance.png SIGTERM: the server exits ${end?.code} in ${seconds(took)}, the ` +
      `clock at ${clock}; ` +
      (shown ? `every page: „WARTUNG · Der Server startet neu", „${retry}"` : '!! not all'),
  );
  if (!shown) {
    fail('restart-maintenance.png: not every page says the server restarts');
  }
  return { clock };
}

/**
 * The server started again on the same port, the same ROOM_SECRET: every page back in the run
 * within RESTART_BACK_MS (restart-recovered.png), the clock going again where it stood.
 */
async function serverBack({ anna, crew }, { clock }) {
  await startServer();
  const up = Date.now();
  const back = await untilAsync(
    async () => (await Promise.all(crew.map(backInTheRun))).every(Boolean),
    RESTART_BACK_MS,
  );
  const took = Date.now() - up;
  await sleep(1200);
  const after = await textOf(anna.page.locator('.countdown'));
  await capture(anna.page, 'restart-recovered.png');
  console.log(
    `restart-recovered.png ` +
      (back ? `every page back in the run ${seconds(took)} after the server was up` : '!! not') +
      `; the clock ${clock} → ${after}`,
  );
  if (!back) {
    fail(`restart-recovered.png: not every page back in the run within ${seconds(took)}`);
  }
}

/**
 * The restart drill (see above): skipped where the run does not own its server or plays another
 * mission; the contexts closed, and the server running again, whatever happened.
 */
async function captureRestart() {
  if (MISSION.toLowerCase() !== 'blackout') {
    skip('restart', `the restart drill plays Blackout for three; this run plays ${MISSION}`);
    return;
  }
  if (owned === null) {
    skip('restart', 'the run does not own its server (SHOTS_SERVER unset): none to restart');
    return;
  }
  const from = Date.now();
  const contexts = [];
  try {
    const drill = await drillCrew();
    contexts.push(...drill.crew.map(({ context }) => context));
    const before = await serverDown(drill);
    await serverBack(drill, before);
  } catch (err) {
    console.log(`restart            !! ${firstLine(err)}`);
    fail(`restart: ${firstLine(err)}`);
  } finally {
    for (const context of contexts) {
      await context.close();
    }
    if (owned === null) {
      await startServer();
    }
    console.log(`restart            the drill took ${seconds(Date.now() - from)}`);
  }
}

/**
 * The drills before the walkthrough, each in a room of its own, by the group each belongs to:
 * the editor, the Serverraum's scratch mission (a Systemcheck run's), the art tour, the danger
 * sense, the reconnect drill, the restart drill and the Zugangskontrolle's scratch mission (a
 * Systemcheck run's).
 */
const DRILLS = [
  ['editor', captureEditor],
  ['devices', captureServers],
  ['art', captureArtTour],
  ['drones', captureDangerSense],
  ['reconnect', captureReconnect],
  ['restart', captureRestart],
  ['access', captureAccess],
];

/**
 * The run: the browser and what draws its pages, the drills of the groups on, and the
 * walkthrough as far as they reach (`walkthrough`).
 */
async function run() {
  mkdirSync(OUT, { recursive: true });
  if (CPU_SLOWDOWN > 1) {
    console.log(`cpu                every page slowed down ${CPU_SLOWDOWN}× (SHOTS_CPU_SLOWDOWN)`);
  }
  browser = await chromium.launch({
    headless: !HEADED,
    args: [...VOICE_FLAGS, ...(SOFTWARE_GL ? SOFTWARE_GL_FLAGS : [])],
  });
  await logRendering();
  for (const [group, drill] of DRILLS) {
    await inGroup(group, drill);
  }
  await walkthrough();
  await browser.close();
  console.log('screenshots in', OUT);
}

/**
 * The walkthrough, stage by stage as far as the groups on reach (tools/groups.mjs `reaches`):
 * the menu and the lobby to the started run (`lobbyStage`), the mission's opening
 * (`openingStage`), and the run to its end (`runStage`). A stage's own steps count to its
 * group — screens, intro, run — where that is on; where it is not, the stage only leads on to a
 * later one, and its time counts to none.
 */
async function walkthrough() {
  if (!reaches(PLAN.on, 'lobby')) {
    return;
  }
  const lobby = await asStage('screens', lobbyStage);
  if (!reaches(PLAN.on, 'opening')) {
    return;
  }
  const opened = await asStage('intro', () => openingStage(lobby));
  if (reaches(PLAN.on, 'run')) {
    await asStage('run', () => runStage(opened));
  }
}

/** Plays `stage`, its time counted to the group `name` where that is on, to none where not. */
function asStage(name, stage) {
  return inGroup(name, stage, stage);
}

/**
 * The menu and the lobby, as far as the run's start: the host opens the menu and a round of the
 * mission (`hostOpensRound`), the guest's phone joins by the code (`guestJoins`), the lobby's
 * captures with the crew in it, and the run started from it (`startTheRun`). Returns the room's
 * code and the crew in the run.
 */
async function lobbyStage() {
  const { host, hostSeen, code, lobbySound } = await hostOpensRound();
  const { guest, guestSeen } = await guestJoins(code);
  // crew, ready, start — nothing to pick: the start draws who begins where
  await host.locator('.seat .seat-name', { hasText: /^Ben$/ }).waitFor({ timeout: 10_000 });
  await sleep(300);
  await inGroup('screens', () => capture(host, 'lobby-filled.png'));
  await inGroup('screens', captureOpenRounds);
  await inGroup('graphics', () => captureLobbyIdle(host));
  await inGroup('screens', () => lobbyAtSizes(host, guest));
  const anna = { name: 'Anna', page: host, seen: hostSeen, traced: true };
  const ben = { name: 'Ben', page: guest, seen: guestSeen };
  await startTheRun(anna, ben, lobbySound);
  return { code, anna, ben };
}

/**
 * The host's page: the menu over its scene, walked by the keys, its frames, at a laptop's sizes
 * (menu.png), the history (history.png), a round of the mission opened (`openMissionRound`),
 * the room's code and seed, and the lobby's own captures — its title, the first room's level —
 * with „Normal" picked as the walkthrough plays it, and the daily shift. Returns the host's page
 * and socket, the room's code, and the menu's sound as the lobby keeps it (screens').
 */
async function hostOpensRound() {
  const hostCtx = await browser.newContext({ viewport: SIZES[0] });
  const host = await openPage(hostCtx, 'host');
  const hostSeen = eavesdrop(host);
  host.on('console', (m) => {
    if (m.type() === 'error') console.log('[host console]', m.text());
  });
  host.on('pageerror', (e) => console.log('[host error]', e.message));
  // Only the host's page keeps a frame trace: every frame sample reads it.
  await host.goto(padded(seeded(traced(BASE))));
  // The game's title comes on as a phosphor screen does as the page loads (lobby-title.png).
  const titleCameOn = (await host.locator('.menu h1.phosphor-title').count()) === 1;
  await host.getByPlaceholder('z. B. Anna').fill('Anna');
  await host.locator('.menu-item').first().waitFor({ timeout: 10_000 });
  // The menu, its music as the music's manifest lists it (`captureMenu` returns the list).
  const musicList = await inGroup('screens', () => captureMenu(host));
  await inGroup('screens', () => captureHistory(host, 'history.png'));
  await openMissionRound(host);
  // The lobby's music, its own piece where it is listed (checked as the run starts).
  const lobbySound = await inGroup('screens', () => lobbySoundOf(host, musicList));
  await host.locator('.room-code strong').waitFor({ timeout: 10_000 });
  const code = (await host.locator('.room-code strong').innerText()).trim();
  console.log('room code:', code, `(${MISSION})`);
  await seedBesideTheCode(host);
  await inGroup('screens', () => captureLobbyTitle(host, titleCameOn));
  await inGroup('screens', () => captureFirstRun(host, hostSeen));
  await pickNormal(host, hostSeen);
  await inGroup('screens', () => capture(host, 'lobby-host.png'));
  await inGroup('screens', () => captureDaily(host, hostSeen));
  return { host, hostSeen, code, lobbySound };
}

/** The lobby names the seed beside the code once the server has pinned the room to it. */
async function seedBesideTheCode(host) {
  if (SEED === null) {
    return;
  }
  const label = host.locator('.room-seed');
  await label.waitFor({ timeout: 3000 }).catch(() => undefined);
  const shown = await textOf(label);
  console.log(
    `seed               ${SEED}: ` +
      (shown === `Seed ${SEED}`
        ? 'the room is pinned to it'
        : `!! the room is not pinned (${shown ?? 'no seed beside the code'}): ` +
          'the server takes one only with ALLOW_SEED=1, so the draw is chance'),
  );
}

/**
 * The guest's phone — touch-capable on purpose: the on-screen D-pad is hidden for `pointer:
 * fine`, so a default context would never show it — opens the menu (`guestMenu`, screens') and
 * joins the room `code` by its code. Returns its page and socket.
 */
async function guestJoins(code) {
  const guestCtx = await browser.newContext({ viewport: SIZES[2], hasTouch: true });
  const guest = await openPage(guestCtx, 'guest');
  const guestSeen = eavesdrop(guest);
  // Traced for its voice links; its frames are never sampled.
  await guest.goto(traced(BASE));
  await guest.getByPlaceholder('z. B. Anna').fill('Ben');
  await guest.locator('.menu-item').first().waitFor({ timeout: 10_000 });
  await inGroup('screens', () => guestMenu(guest));
  await byCode(guest, code);
  await guest.locator('.lobby').waitFor({ timeout: 10_000 });
  return { guest, guestSeen };
}

/**
 * The menu on the guest's phone: upright over its scene (menu-phone.png), turned sideways
 * (`checkMenuPhones`), and its history (history-phone.png).
 */
async function guestMenu(guest) {
  await sceneBaked(guest);
  await capture(guest, 'menu-phone.png');
  await checkMenuPhones(guest);
  await captureHistory(guest, 'history-phone.png');
}

/**
 * The lobby at its sizes: on the guest's phone (lobby-phone.png) — a phone scrolls the lobby
 * down and the crew's row sideways, but nothing else may run out past the window's edge — in
 * the host's window at 1440×820 and 1280×720 (lobby-1280.png) and on a phone held sideways
 * (lobby-landscape.png); the host's window at a laptop's size again after.
 */
async function lobbyAtSizes(host, guest) {
  await capture(guest, 'lobby-phone.png');
  const phoneOver = await sideways(guest, '.content');
  console.log(
    `lobby-phone.png    Ben's lobby @ 420x760 ` +
      (phoneOver > 0 ? `!! +${phoneOver}px sideways` : 'fits sideways'),
  );
  await overflow(host, 'lobby @ 1440x820');
  await host.setViewportSize({ width: 1280, height: 720 });
  await sleep(400);
  await overflow(host, 'lobby @ 1280x720');
  await capture(host, 'lobby-1280.png');
  await captureLobbySideways(host);
  await host.setViewportSize(SIZES[0]);
  await sleep(300);
}

/**
 * Both microphones on (voice), the run started by the host once the guest says it is ready —
 * its opening card waited for from before the start (intro-card.png, intro's) — and the menu's
 * sound gone with the start (screens'). Throws where the sockets show no running view.
 */
async function startTheRun(anna, ben, lobbySound) {
  await inGroup('voice', () => micsOn([anna, ben]));
  // The card stands 1.5 s at most: it is waited for from before the start, and shot as it comes.
  const opening = whenOn('intro', () => captureIntroCard(anna));
  await startRun(anna, ben);
  await opening;
  await inGroup('screens', () => menuSoundAfterStart(anna.page, lobbySound));
  await sleep(500); // presence follows the start within a tick
  if (ben.seen.view?.map == null || anna.seen.view?.map == null) {
    throw new Error('no running view on the sockets — does the client still talk on /ws?');
  }
}

/**
 * The mission's opening: in a mission with an intro, the Leitstelle's first line listened for on
 * the guest's radio from its opening squelch on (audio), and the opening itself — taken by intro
 * (`introShots`), or skipped on both pages where the run leaves intro out (`skipTheOpening`).
 * Returns what the run goes on from: the code and the crew, whether the mission has an intro,
 * what is listened for, and the player at the sign the opening found, if any.
 */
async function openingStage({ code, anna, ben }) {
  const intro = anna.seen.view.lights.out === false;
  if (!intro) {
    return { code, anna, ben, intro, listening: null, signedEarly: undefined };
  }
  const listening = whenOn('audio', () => hearRadio(ben, 40_000));
  const take = () => introShots(anna, ben);
  const signedEarly = await inGroup('intro', take, () => skipTheOpening(anna, ben));
  return { code, anna, ben, intro, listening, signedEarly };
}

/**
 * The run to its end: Blackout past its opening and its lever (`afterTheLights`), the first
 * moments (`firstMoments`), the briefing over (`briefingOver`), the game at its sizes
 * (`inTheGame`), the audience (`audienceJoins`), the sources (`readTheSources`), the first
 * station (`stationStep`), the world on its own again (`afterTheStation`), the mission played
 * out (`playPinnedOut`), what the run left out (`runLeftOut`), and the views and the walking.
 */
async function runStage(opened) {
  const { code, anna, ben, intro } = opened;
  if (intro) {
    await afterTheLights(anna, ben, opened.listening);
  }
  const { operator, reader, atSign } = await firstMoments(anna, ben, opened);
  if (atSign !== undefined) {
    await inGroup('hud', () => infoAfterSign(atSign, ben));
  }
  await briefingOver(anna, ben);
  const steady = await inTheGame(anna, ben);
  const audience = await audienceJoins(anna, ben, code);
  await readTheSources({ anna, ben, operator, reader, atSign }, audience.seen);
  await stationStep(anna, ben, operator, reader);
  await afterTheStation(anna, ben, steady);
  await playPinnedOut(anna, ben, audience.page);
  await runLeftOut();
  reportViews({ Anna: anna.seen, Ben: ben.seen, 'the audience': audience.seen });
  reportWalking();
}

/**
 * The briefing's countdown over — server and browsers share this clock — then the start's sound
 * (audio): the bed of a room dark from the start dead, the radio's chain band-passed, and the
 * mission's opening line through it.
 */
async function briefingOver(anna, ben) {
  await sleep(Math.max(0, ben.seen.view.startedAt + 4200 - Date.now()));
  await inGroup('audio', () => soundOfTheStart(anna));
}

/** The bed of a room dark from the start dead; the radio's chain on noise and on a recording. */
async function soundOfTheStart(anna) {
  if (anna.seen.view.lights.outAt === anna.seen.view.startedAt) {
    await bedDead(anna, 'with the lights out from the start');
  }
  await checkRadioBand(anna.page);
  await checkRadioLine(anna.page, anna.seen.view.missionId);
}

/**
 * The game on the crew's screens, the briefing over: the zoom each page starts at (hud), the
 * voice between the two (voice), the game at the host's window sizes and on the guest's phone,
 * upright, sideways with its pad and on a large phone (hud), the camera's frame (graphics); then
 * at laptop size the light's way (graphics), the run's pacing window (perf), the HUD's panels
 * and controls (hud) and the walk cycle (graphics). Returns the zoom each page started at, held
 * against the end (`zoomHeld`).
 */
async function inTheGame(anna, ben) {
  // The world's zoom follows the canvas height: nothing the run brings up in
  // the HUD — the sign's chip, a long radio line, the notes — may change it.
  const steady = await inGroup('hud', () => layoutsNow([anna, ben]), () => []);
  await inGroup('voice', () => captureVoice(anna, ben));
  await inGroup('hud', () => gameAtSizes(anna.page, ben.page));
  // Ben turns the phone sideways: the landscape layout, pad and all. Its zoom has to hold
  // there too, so the end of the run turns the phone once more and compares.
  const turned = SIZES[3];
  await ben.page.setViewportSize({ width: turned.width, height: turned.height });
  await sleep(700);
  await inGroup('hud', () => phoneSideways(ben.page, steady));
  await inGroup('graphics', () => captureCamera(anna, ben));
  const upright = () => ben.page.setViewportSize(SIZES[2]);
  await inGroup('hud', () => captureLargePhone(ben.page, SIZES[2]), upright);
  await sleep(400);
  // info panel and spectator view at laptop size
  await anna.page.setViewportSize(SIZES[0]);
  await sleep(400);
  await inGroup('graphics', () => checkLight(anna));
  const pacing = () => pace(anna, SAMPLE_MS);
  await frameWindow(anna.page, 'pacing, after the game screenshots', pacing, { setsPace: true });
  await inGroup('hud', () => hudPanels(anna, ben));
  await inGroup('graphics', () => captureWalkCycle(anna));
  return steady;
}

/** The world's canvas each of `players` shows now (`layoutOf`), by name. */
async function layoutsNow(players) {
  const now = [];
  for (const { name, page } of players) {
    now.push({ name, page, start: await layoutOf(page) });
  }
  return now;
}

/**
 * The game in the host's window at each size without touch (game-laptop-13.png …), and on the
 * guest's phone, phone-sized and touch-capable all along (game-phone-touch.png).
 */
async function gameAtSizes(host, guest) {
  for (const size of SIZES.filter((s) => !s.hasTouch)) {
    await host.setViewportSize({ width: size.width, height: size.height });
    await sleep(700);
    await capture(host, `game-${size.name}.png`);
    await overflow(host, `game @ ${size.width}x${size.height}`);
  }
  await capture(guest, 'game-phone-touch.png');
}

/**
 * The guest's phone held sideways: the game in its one row (game-phone-landscape.png) and its
 * pad (pad-left.png); the zoom it shows now is kept with `steady`, to hold at the end.
 */
async function phoneSideways(guest, steady) {
  const turned = SIZES[3];
  await capturePhoneGame(guest, `game-${turned.name}.png`, "Ben's phone sideways");
  await overflow(guest, `game @ ${turned.width}x${turned.height}, Ben's phone sideways`);
  await capturePadLeft(guest);
  steady.push({ name: 'Ben sideways', page: guest, start: await layoutOf(guest), turn: turned });
}

/**
 * The HUD's panels and controls in the host's window: the info panel (info-panel.png), the
 * settings, the controller, the quick chat, the minimap's goal and the sprint.
 */
async function hudPanels(anna, ben) {
  await anna.page.keyboard.press('i');
  await sleep(400);
  await capture(anna.page, 'info-panel.png');
  await anna.page.keyboard.press('Escape');
  await captureSettings(anna.page);
  await captureControls(anna, ben);
  await captureMinimapGoal(anna);
  await captureSprint(anna);
}

/**
 * The audience joins from the menu by the room's code `code` (menu-join.png) and watches
 * (spectate.png), listens in on the crew (voice), and a second audience page joins at density 2
 * (dpr2.png, graphics). Returns its page and socket — traced for its voice links; its frames are
 * never sampled.
 */
async function audienceJoins(anna, ben, code) {
  const watcherCtx = await browser.newContext({ viewport: SIZES[0] });
  const page = await openPage(watcherCtx, 'audience');
  const seen = eavesdrop(page);
  await page.goto(traced(BASE));
  await watchFromMenu(page, code);
  await page.locator('.spectate').waitFor({ timeout: 10_000 });
  await sleep(1200);
  await capture(page, 'spectate.png');
  await overflow(page, 'spectate @ 1440x820');
  await inGroup('voice', () => listenIn(page, [anna, ben]));
  await inGroup('graphics', () => captureDpr2(code));
  return { page, seen };
}

/**
 * The sources: the guest searches the nearest locker (`captureLocker`, its shot reading's), the
 * host's info panel is closed where it is still open, and reading's own steps follow
 * (`readingSteps`) — `audience`, the audience's socket, places every source before the crew has
 * come across it.
 */
async function readTheSources(crew, audience) {
  const { anna, ben } = crew;
  await captureLocker(ben.page, ben.seen, audience);
  // The host's info panel may still be open; close it the way a player would.
  const closeInfo = anna.page.locator('.info-card button', { hasText: 'Schließen' });
  if (await closeInfo.isVisible()) {
    await closeInfo.click();
  }
  await inGroup('reading', () => readingSteps(crew, audience));
}

/**
 * Reading, the sign, notes: whoever has a source in reach reads it (`readOrSkip`), the reader
 * walks to the sign where nobody started at it (`signWalk`), the guest's notepad takes the
 * Laborkennung and keeps it over a reload (notepad.png), both note a block from an open source
 * (reading-notepad*.png, highlight*.png) and the host's pad shows both (notepad-captured*.png);
 * then the voice comes back after the guest's reload (voice).
 */
async function readingSteps({ anna, ben, operator, reader, atSign }, audience) {
  await readOrSkip(operator, reader);
  if (atSign === undefined) {
    await signWalk(reader, ben);
  }
  await captureNotepad(ben.page, ben.seen);
  await captureNoting(anna, 'reading-notepad.png', 'highlight.png', audience);
  await captureNotepadCaptured();
  await captureNoting(ben, 'reading-notepad-phone.png', 'highlight-phone.png', audience);
  await inGroup('voice', () => voiceAfterReload(anna, ben));
}

/**
 * reading.png: whatever lies within the reader's reach is read; locked away from it, the
 * operator reads instead — skipped where neither has a source in reach.
 */
async function readOrSkip(operator, reader) {
  if (await captureReading(reader.page, reader.seen, reader.name)) {
    return;
  }
  console.log(
    `reading.png        ${reader.name}: no manual object in reach — ` +
      `${operator.name} reads instead`,
  );
  if (!(await captureReading(operator.page, operator.seen, operator.name))) {
    skip('reading.png', 'no manual object in reach of either player');
  }
}

/**
 * sign.png where nobody started at the Laborkennung: the reader walks to it and reads it, the
 * Info button checked in view after (hud) — skipped where the map has none or no way leads there.
 */
async function signWalk(reader, guest) {
  const sign = reader.seen.view.map.edgeworkSign;
  if (sign === null) {
    skip('sign.png', 'this map has no Laborkennung');
  } else if (await walkNear(reader.page, reader.seen, sign)) {
    await captureSign(reader.page, reader.name);
    await inGroup('hud', () => infoAfterSign(reader, guest));
  } else {
    skip(
      'sign.png',
      stepsTo(reader.seen, sign) === Infinity
        ? `the sign at ${sign.x},${sign.y} is out of ${reader.name}'s reach`
        : `${reader.name}'s walk to the sign at ${sign.x},${sign.y} broke off ` +
            '(stuck, or a door shut)',
    );
  }
}

/**
 * The first station: worked at two consoles (`bothConsolesFirst`) or at one
 * (`oneConsoleFirst`). The draw may leave both starts shut off from the first station until a
 * plate is held; then there is no station to capture this time — unless it is worked at two
 * consoles, where one holds the plate for the other.
 */
async function stationStep(anna, ben, operator, reader) {
  const firstSpots = operator.seen.view.map.stations.filter((s) => s.status === 'armed');
  const station = firstSpots[0];
  if (firstSpots.some((s) => s.console === 'b')) {
    await bothConsolesFirst([anna, ben]);
  } else if (station === undefined || stepsTo(operator.seen, station) === Infinity) {
    const why =
      station === undefined
        ? 'no station is armed'
        : 'no open way from either start to the armed station';
    await inGroup('devices', () => skip('station', why));
  } else {
    await oneConsoleFirst(operator, reader, station);
  }
}

/**
 * A first station worked at two consoles (`manBothConsoles`), then left: the last shift's
 * notes come only for an open station, so it is left open while one of the crew goes to read
 * (hint-*.png, reading).
 */
async function bothConsolesFirst(players) {
  const pair = await manBothConsoles(players);
  if (pair === null) {
    return;
  }
  for (const { page } of [pair.box, pair.meter]) {
    await page.keyboard.press('Escape');
    await page.locator('.station-modal').waitFor({ state: 'hidden', timeout: 3000 });
  }
  await inGroup('reading', () => askForNotes(pair.meter, pair.box));
}

/**
 * A first station worked at one console: the operator walks up and opens it (station.png,
 * devices), the reader joins at it — a sync station both press, which solves it
 * (`captureBothAtStation`) — and the operator steps back (`stepBack`). After a sync station the
 * crew works the next at its two consoles (`captureConsoles`); at any other the last shift's
 * notes are asked for at its source (reading).
 */
async function oneConsoleFirst(operator, reader, station) {
  if (!(await walkNear(operator.page, operator.seen, station))) {
    throw new Error(`${operator.name} got stuck on the way to "${station.puzzleId}"`);
  }
  const modal = operator.page.locator('.station-modal');
  if (!(await interactUntil(operator, modal, consoleTarget(station)))) {
    throw new Error(
      `${operator.name} stands at "${station.puzzleId}", but no .station-modal after ${TRIES}`,
    );
  }
  await sleep(300); // past its fade-in
  await inGroup('devices', () => shootStation(operator, station));
  // A sync station needs the whole crew's press: the walkthrough solves it.
  const sync = operator.seen.view.puzzle?.kind === 'button-sync';
  await captureBothAtStation(reader, operator, station, sync);
  // The last shift's notes come only for an open station: leave it open, go read.
  await stepBack(operator, modal);
  if (sync) {
    await inGroup('reading', syncLeavesNoNotes);
    // Where the next station has two consoles, the crew captures both; a Signalkette it works.
    // Both walk there by their own page's view, so both have to show the solve first.
    await viewsCaughtUp([operator, reader]);
    await captureConsoles(operator, reader);
  } else {
    await inGroup('reading', () => askForNotes(reader, operator));
  }
}

/** station.png: the operator's open panel, and whether it fits sideways. */
async function shootStation(operator, station) {
  const stationSideways = await sideways(operator.page, '.station-modal .panel');
  await capture(operator.page, 'station.png');
  console.log(
    `station.png        ${operator.name}: "${station.title}", panel ` +
      (stationSideways > 0 ? `!! +${stationSideways}px sideways` : 'fits sideways'),
  );
}

/** A solved sync station leaves no station open to ask the last shift's notes for. */
function syncLeavesNoNotes() {
  skip(
    'hint-*.png',
    'notes come for an open station only: the sync station is solved, ' +
      'and nobody has opened the next yet',
  );
}

/**
 * The world on its own again once the first station is done — whatever the host still has open
 * closes first: the run's pacing window after it (perf), mission control's nudge (audio), the
 * frame windows' word where no panel was sampled (perf), the room the station lit
 * (lit-room.png), and each page's zoom held since the briefing (`zoomHeld`, hud).
 */
async function afterTheStation(anna, ben, steady) {
  const onTop = anna.page.locator('.station-modal, .reading-modal').first();
  if (await onTop.isVisible()) {
    await anna.page.keyboard.press('Escape');
    await onTop.waitFor({ state: 'hidden', timeout: 3000 });
  }
  await frameWindow(anna.page, 'pacing, after the station step', () => pace(anna, SAMPLE_MS));
  await inGroup('audio', () => captureNudge([anna, ben]));
  await inGroup('perf', panelLeftOut);
  await captureLitRoom(ben.page, ben.seen);
  await inGroup('hud', () => zoomHeld(steady));
}

/** A run whose host page had no station panel open in a frame window says so. */
function panelLeftOut() {
  if (!panelSampled) {
    skip('frames', 'no station panel was open on the host page, so none was sampled with one');
  }
}

/**
 * The world's zoom held: each page of `steady` — turned to its window again where it was turned
 * — shows the canvas it started at after the briefing, whatever the HUD has brought up since.
 */
async function zoomHeld(steady) {
  for (const { name, page, start, turn } of steady) {
    if (turn !== undefined) {
      await page.setViewportSize({ width: turn.width, height: turn.height });
      await sleep(700);
    }
    const end = await layoutOf(page);
    const banners = end.banners.length === 0 ? '' : `, ${end.banners.join(' ')} up`;
    console.log(
      `canvas             ${name}: ${start.size} after the briefing, ${end.size} at the end` +
        (end.size === start.size
          ? ', the world zoom held'
          : ` — !! the world zoom moved (HUD ${start.hud} → ${end.hud}px${banners})`),
    );
  }
}

/**
 * What the run left out by its end, each said where its group is on: the figures' flinch, the
 * panel's fade and the crew celebrating (graphics), the partner never heard to one side (audio),
 * the solved device's shot that came late and a display that never lost its colour (devices).
 */
async function runLeftOut() {
  await inGroup('graphics', graphicsLeftOut);
  await inGroup('audio', sidesLeftOut);
  await inGroup('devices', solvedShotLeftOut);
  await inGroup('devices', greyLeftOut);
}

/** figure-flinch.png, panel-close.png and figure-celebrate.png, where the run took none. */
function graphicsLeftOut() {
  if (!flinchShot) {
    skip('figure-flinch.png', 'the walkthrough works no Signalkette in this mission');
  }
  if (!panelCloseShot) {
    skip('panel-close.png', 'no player stepped back from a station standing open');
  }
  if (!celebrateShot) {
    skip('figure-celebrate.png', 'the walkthrough does not play this mission to a won card');
  }
}

/** The partner's side told apart once a run at least, or the run fails. */
function sidesLeftOut() {
  if (sides.checked === 0) {
    fail("the partner's side was never told apart: the crew never stood apart sideways");
  }
}

/** device-solved.png late, and no sync station came after it to shoot again: skipped. */
function solvedShotLeftOut() {
  if (!solvedShot.taken && solvedShot.late.length === 1) {
    skipLateShot();
  }
}

/**
 * The views line: how many views each page took while a run was on, from its first such view to
 * its last, and how many a second. A step to a station, a find or a door sends every page one; a
 * change in what a player has in sight only that player's page.
 */
function reportViews(pages) {
  const said = Object.entries(pages).map(([name, seen]) => {
    const at = seen.viewsAt;
    const span = at.length < 2 ? 0 : (at.at(-1) - at[0]) / 1000;
    const rate = span > 0 ? (at.length / span).toFixed(2) : '–';
    return `${name} ${at.length} in ${span.toFixed(0)} s (${rate}/s)`;
  });
  console.log(`views              while a run is on: ${said.join(', ')}`);
}

// ── the graphics package's captures: figures, the air, the props, the density ──
//
// What the world's picture shows of them, the traced pages hand back (`?trace=1`,
// `window.__escapelab.graphics`, client world/render/graphicsProbe.ts): the walk cycle's phase
// and the light the figure's shadow follows, the motes lit in the light cones, the hatch
// grinding open, the canvas's backing store.
//
// walk-cycle-a.png, walk-cycle-b.png  the host walking out along the longest open stretch from
//   its tile, shot as its legs stand wide one way and then the other — the probe's phase in
//   each shot's window, half a cycle apart — or the run fails
// shadow-blob.png  the host standing still again, the blob of shadow under it in the light it
//   stands in, the probe saying which
// dust.png  in Blackout two seconds into the dark, after blackout.png — in a mission without
//   an intro after the game screenshots — the host's lamp lighting motes in its cone (the
//   breaker's smoke rising in Blackout); skipped where fewer than four show within 4 s
// rack-leds.png  Blackout's Serverraum as the host comes to its terminal, the racks' LEDs
//   blinking round it; the Systemcheck has no server room and skips it
// hatch-dust.png  the audience's world round the hatch as it grinds open, dust falling off its
//   rim — the probe counting the grains — waited for from before the last station's presses
// dpr2.png  a second audience page at twice the density: the canvas's backing store has to be
//   its box's CSS pixels times two, rounded — or the run fails

/** How far round a figure a figure's shot reaches, tiles each way. */
const FIGURE_SHOT = 1.1;
/** The walk cycle's two windows the walk shots are taken in: legs wide one way, then the other. */
const STRIDE_WINDOWS = [
  ['walk-cycle-a.png', 0.18, 0.32],
  ['walk-cycle-b.png', 0.68, 0.82],
];
/** Whether dust.png was taken this run: a mission with an intro takes it at the blackout. */
let dustShot = false;

/** The graphics probe of a traced page; null where there is none. */
function graphicsOf(page) {
  return page.evaluate(() => globalThis.__escapelab?.graphics ?? null);
}

/** Waits up to `ms` for the graphics probe of `page` to satisfy `check`: the probe, or null. */
async function graphicsWhen(page, check, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const probe = await graphicsOf(page);
    if (probe !== null && check(probe)) {
      return probe;
    }
    if (Date.now() >= until) {
      return null;
    }
    await sleep(30);
  }
}

/** Where the world point (x, y), in tiles, lies on `page`, CSS px, and a tile's size there. */
function onPage(page, x, y) {
  return page.evaluate(
    ([wx, wy]) => {
      const camera = globalThis.__escapelab?.camera;
      const canvas = document.querySelector('.world-canvas');
      if (camera === undefined || canvas === null) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      const dpr = canvas.width / rect.width;
      return {
        x: rect.left + rect.width / 2 + ((wx - camera.x) * camera.scale) / dpr,
        y: rect.top + rect.height / 2 + ((wy - camera.y) * camera.scale) / dpr,
        tile: camera.scale / dpr,
      };
    },
    [x, y],
  );
}

/** A shot of `page` round the world point `at`, `tiles` tiles each way, as `name`; counted. */
async function shootAround(page, name, at, tiles) {
  const spot = await onPage(page, at.x, at.y);
  if (spot === null) {
    skip(name, 'the page shows no world to frame');
    return false;
  }
  const view = page.viewportSize();
  const half = spot.tile * tiles;
  const x = Math.max(0, Math.round(spot.x - half));
  const y = Math.max(0, Math.round(spot.y - half));
  const width = Math.min(view.width - x, Math.round(half * 2));
  const height = Math.min(view.height - y, Math.round(half * 2));
  await page.screenshot({ path: join(OUT, name), clip: { x, y, width, height } });
  taken(name);
  return true;
}

/** Where `page`'s own figure stands as it steers it, tiles; null without the probe. */
function selfOn(page) {
  return page.evaluate(() => globalThis.__escapelab?.self ?? null);
}

/**
 * dust.png: the motes `player`'s lamp lights in its cone, once four or more show within 4 s —
 * in Blackout with the breaker's smoke rising two seconds into the dark.
 */
async function captureDust({ name, page }) {
  const lit = await graphicsWhen(page, (probe) => probe.particles.litMotes >= 4, 4000);
  if (lit === null) {
    const now = await graphicsOf(page);
    skip('dust.png', `${name}'s lamp lit ${now?.particles.litMotes ?? 0} motes within 4 s`);
    return;
  }
  await capture(page, 'dust.png');
  dustShot = true;
  const { litMotes, dust = 0, smoke = 0 } = lit.particles;
  console.log(
    `dust.png           ${name}'s lamp lights ${litMotes} of ${dust} motes in its cone; ` +
      `${smoke} wisps of the breaker's smoke in the air`,
  );
}

/**
 * walk-cycle-a.png and walk-cycle-b.png: `player` walking out along the longest open stretch
 * from its tile, shot in each stride window — the run fails where either never comes — then
 * back; then shadow-blob.png as it stands, and in a mission without an intro dust.png.
 */
async function captureWalkCycle(player) {
  const { name, page, seen } = player;
  const map = seen.view?.map;
  const home = tileOf(seen);
  const avoid = (x, y) =>
    map.plates.some((p) => p.x === x && p.y === y) || (map.exit?.x === x && map.exit?.y === y);
  const run = map == null || home === null ? null : longestRun(map, home, avoid);
  if (run === null || run.tiles < 2) {
    skip('walk-cycle-a.png', `${name} has no 2 tiles of open floor in a line from its tile`);
    return;
  }
  await stepTo(page, seen, home.x + 0.5, home.y + 0.5);
  const phases = await walkTheStride(player, run);
  await stepTo(page, seen, home.x + 0.5, home.y + 0.5);
  if (phases.length < STRIDE_WINDOWS.length) {
    console.log(`walk-cycle         !! ${name}'s legs never stood wide both ways on the walk`);
    fail(`${name}'s walk cycle never reached both stride windows`);
  } else {
    const at = phases.map((p) => p.toFixed(2)).join(' and ');
    console.log(
      `walk-cycle         ${name} shot at walk phases ${at}: legs wide one way, then the other`,
    );
  }
  await captureShadow(player);
  if (!dustShot) {
    await captureDust(player);
  }
  if (MISSION.toLowerCase() !== 'blackout') {
    skip('rack-leds.png', `${MISSION} has no server room: Blackout's Serverraum takes it`);
  }
}

/** Holds the key out along `run`, shooting each stride window as it comes; their phases. */
async function walkTheStride({ page }, run) {
  const out = WALK_KEYS.get(`${run.dx},${run.dy}`);
  const ms = ((run.tiles - 0.4) / SPEED) * 1000;
  const phases = [];
  await page.keyboard.down(out);
  const start = Date.now();
  try {
    for (const [shot, from, to] of STRIDE_WINDOWS) {
      const left = Math.max(0, start + ms - Date.now());
      const at = await graphicsWhen(
        page,
        ({ gait }) => gait.moving && gait.phase >= from && gait.phase <= to,
        left,
      );
      const self = at === null ? null : await selfOn(page);
      if (self === null) {
        break;
      }
      await shootAround(page, shot, { x: self.x, y: self.y - 0.15 }, FIGURE_SHOT);
      phases.push(at.gait.phase);
    }
  } finally {
    await page.keyboard.up(out);
    walking.ms.set(page, (walking.ms.get(page) ?? 0) + (Date.now() - start));
  }
  await sleep(200);
  return phases;
}

/** shadow-blob.png: `player` standing still, the shadow under it in the light it stands in. */
async function captureShadow({ name, page }) {
  const standing = ({ gait, ground }) => !gait.moving && ground !== null;
  const still = await graphicsWhen(page, standing, 2000);
  const self = await selfOn(page);
  if (still === null || self === null) {
    skip('shadow-blob.png', `${name}'s figure never stood still in the probe's sight`);
    return;
  }
  await sleep(150);
  await shootAround(page, 'shadow-blob.png', { x: self.x, y: self.y }, FIGURE_SHOT);
  const light = { lit: 'under the ceiling lights', dark: 'in the dark' }[still.ground];
  console.log(`shadow-blob.png    ${name} standing ${light ?? 'unlit'}: its blob of shadow`);
}

/** rack-leds.png: Blackout's Serverraum round its terminal as `player` comes to it. */
async function captureRackLeds({ name, page }) {
  await sleep(400);
  const isTerminal = (s) => s.puzzleId === 'subsysteme' && s.console === 'a';
  const terminal = BLACKOUT.map.stations.find(isTerminal);
  const round = { x: terminal.x + 2.5, y: terminal.y + 0.5 };
  if (await shootAround(page, 'rack-leds.png', round, 2.3)) {
    console.log(`rack-leds.png      ${name} by the terminal: the racks' LEDs blinking round it`);
  }
}

/**
 * hatch-dust.png, watched for on the audience's page `watcher` from now on: as the hatch grinds
 * open there, dust falling off its rim — the probe counting the grains. Returns what stops the
 * watch once the run is played out (playPinnedOut, however the play ends), resolved when the
 * watch is over; it fails nothing, and never rejects: a shot that throws ends it with a skip
 * saying why, so that stopping it cannot stand in for the error a step threw.
 */
function watchHatchDust(watcher, seen) {
  let stopped = false;
  const watch = (async () => {
    while (!stopped) {
      const probe = await graphicsOf(watcher).catch(() => null);
      const exit = seen.view?.map?.exit;
      if (probe !== null && exit != null && probe.hatch > 0.12 && probe.hatch < 0.85) {
        const grains = probe.particles.debris ?? 0;
        await shootAround(watcher, 'hatch-dust.png', { x: exit.x + 0.5, y: exit.y + 0.5 }, 2.5);
        console.log(
          `hatch-dust.png     the audience: the hatch grinding open, ${grains} grains of dust falling`,
        );
        return;
      }
      await sleep(40);
    }
    skip('hatch-dust.png', 'the audience never saw the hatch grinding open');
  })().catch((err) => {
    skip('hatch-dust.png', `the watch broke off: ${String(err?.message ?? err).split('\n')[0]}`);
  });
  return () => {
    stopped = true;
    return watch;
  };
}

/** How long a page at twice the density has to size its canvas with its first frames, ms. */
const DPR2_MS = 8000;

/** Whether a canvas's backing store is its box's CSS pixels times `density`, rounded. */
const timesItsBox = (backing, density) =>
  backing.cssWidth > 0 &&
  backing.width === Math.round(backing.cssWidth * density) &&
  backing.height === Math.round(backing.cssHeight * density);

/**
 * dpr2.png: a second audience page at twice the density, joined to room `code`; its canvas's
 * backing store has to come to its box's CSS pixels times two within DPR2_MS — the world sizes
 * it as it draws, on a slowed page only after a while — or the run fails.
 */
async function captureDpr2(code) {
  const context = await browser.newContext({ viewport: SIZES[0], deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    await page.goto(traced(BASE));
    await byCode(page, code, true);
    await page.locator('.spectate').waitFor({ timeout: 10_000 });
    const sized = await graphicsWhen(page, ({ backing }) => timesItsBox(backing, 2), DPR2_MS);
    const backing = (sized ?? (await graphicsOf(page)))?.backing ?? null;
    await sleep(800);
    await capture(page, 'dpr2.png');
    const crisp = sized !== null;
    const sizes =
      backing === null
        ? 'no canvas'
        : `canvas ${backing.width}×${backing.height} ` +
          `for a box of ${backing.cssWidth}×${backing.cssHeight}`;
    const verdict = crisp ? ', a device pixel each' : ' — !! not 2×';
    console.log(`dpr2.png           the audience at 2×: ${sizes}${verdict}`);
    if (!crisp) {
      fail(`the canvas at twice the density is not twice its box: ${sizes}`);
    }
  } finally {
    await context.close();
  }
}

// ── the camera package's captures: one frame in CSS pixels, at every density ──
//
// The world's frame is fixed in CSS pixels (client world/viewport.ts `tileCss`): 11.5 tiles of
// height on a canvas 600 px tall or more, 9 below, the band below the objective bar holding a
// drone's reach twice with keys and 1.5 times by touch, a tile 28 to 96 px. A player's page
// logs its frame — CSS px a tile, the tiles across and down, the band below the bar as it
// stands now — off its traced camera.
//
// camera-1440.png, camera-1280.png  the host's window at 1440×820 and at 1280×720
// camera-dpr2.png  the host's window at 1440×820 drawn at density 2, shot at its own pixels:
//   the run fails where its tiles across or down lie more than SAME_FRAME_TILES from density 1's
// camera-phone.png  the guest's phone held sideways
// cold-open-dpr2.png, panel-dpr2.png, escape-dpr2.png  in Blackout, its key scenes — the lab
//   lit before the blackout, the first station's open panel, the escape — on the host's page
//   drawn at density 2 as well, after their own window: a window of its frames there for
//   information alone, and its frame held against density 1's as camera-dpr2.png's is
//
// A page is drawn at density 2 through CDP for the look, its window's size kept, and set back to
// 1 the same way: Playwright fixes a context's density once it is made, and a player in a context
// of its own would change the crew the pinned draw is played by. Playwright's own screenshot
// stays at the context's density, so the shots at 2 come through CDP as well.

/** How far the frame at density 2 may lie from density 1's, tiles across or down. */
const SAME_FRAME_TILES = 0.2;
/** How long the world gets at a new density, its canvas backed anew, to bake its sprites, ms. */
const DENSITY_SETTLE_MS = 600;
/** Each page's CDP session that sets its density (`setDensity`), kept for the run. */
const densitySessions = new WeakMap();

/**
 * What the camera of `page`, a traced player's, frames now: the canvas's box, CSS pixels, the
 * density it is drawn at, CSS px a tile, the tiles across and down, and how many tiles of the
 * band below the objective bar show, with whether a line is on the air; null without a world.
 */
function cameraFrame(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.world-canvas');
    const camera = globalThis.__escapelab?.camera;
    const bar = document.querySelector('.stage-top');
    if (canvas === null || camera === undefined || canvas.clientWidth === 0) {
      return null;
    }
    const density = canvas.width / canvas.clientWidth;
    const css = camera.scale / density;
    const reach = bar === null ? 0 : bar.offsetHeight;
    return {
      box: `${canvas.clientWidth}×${canvas.clientHeight}`,
      density,
      css,
      across: canvas.width / camera.scale,
      down: canvas.height / camera.scale,
      band: (canvas.clientHeight - reach) / css,
      line: bar?.querySelector('.radio-banner') != null,
    };
  });
}

/** `frame` (`cameraFrame`) as the log gives it. */
function frameText(frame) {
  const air = frame.line ? ', a line on the air' : '';
  return (
    `${frame.css.toFixed(1)} CSS px a tile at density ${frame.density.toFixed(2)}, ` +
    `${frame.across.toFixed(1)} × ${frame.down.toFixed(1)} tiles, ` +
    `${frame.band.toFixed(1)} below the objective bar${air}`
  );
}

/** Logs the frame `page` shows under `shot`, `who` and its window named; the frame, or null. */
async function logFrame(page, who, shot) {
  const frame = await cameraFrame(page);
  if (frame === null) {
    console.log(`${shot.padEnd(18)} !! ${who}: no world on the page`);
    fail(`${shot}: ${who}'s page shows no world`);
    return null;
  }
  console.log(`${shot.padEnd(18)} ${who}, canvas ${frame.box}: ${frameText(frame)}`);
  return frame;
}

/**
 * Holds `dense`, the frame of `who`'s window at density 2, against `plain`, the same window's at
 * 1, as the line `camera`: the run fails where their tiles across or down lie more than
 * SAME_FRAME_TILES apart.
 */
function sameFrame(plain, dense, who) {
  const apart = Math.max(
    Math.abs(dense.across - plain.across),
    Math.abs(dense.down - plain.down),
  );
  const tiles = (frame) => `${frame.across.toFixed(1)} × ${frame.down.toFixed(1)}`;
  const same = apart <= SAME_FRAME_TILES;
  console.log(
    `camera             ${who}: ${tiles(dense)} tiles at density 2, ${tiles(plain)} at 1` +
      (same ? ', the same frame' : ` — !! ${apart.toFixed(2)} tiles apart`),
  );
  if (!same) {
    fail(`${who}: the frame at density 2 lies ${apart.toFixed(2)} tiles from density 1's`);
  }
}

/** Draws `page` at `density` through its CDP session (`densitySessions`); the session. */
async function setDensity(page, density) {
  let cdp = densitySessions.get(page);
  if (cdp === undefined) {
    cdp = await page.context().newCDPSession(page);
    densitySessions.set(page, cdp);
  }
  const { width, height } = page.viewportSize();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: density,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });
  return cdp;
}

/**
 * Runs `look` with `page` drawn at density 2, once its world has backed the canvas at twice its
 * box and baked anew, handing it the page's CDP session for shots at its own pixels; then draws
 * it at 1 again and waits for the canvas to follow. Fails where the canvas comes to neither
 * within DPR2_MS.
 */
async function atDensityTwo(page, look) {
  const cdp = await setDensity(page, 2);
  try {
    if ((await graphicsWhen(page, ({ backing }) => timesItsBox(backing, 2), DPR2_MS)) === null) {
      fail(`${named.get(page)}: the canvas did not come to twice its box at density 2`);
      return;
    }
    await sleep(DENSITY_SETTLE_MS);
    await look(cdp);
  } finally {
    await setDensity(page, 1);
    if ((await graphicsWhen(page, ({ backing }) => timesItsBox(backing, 1), DPR2_MS)) === null) {
      fail(`${named.get(page)}: the canvas did not come back to its box at density 1`);
    }
  }
}

/** Saves what the page of `cdp` shows, at its own device pixels, as `name`, and counts it. */
async function captureDense(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  taken(name);
}

/**
 * camera-1440.png, camera-dpr2.png, camera-1280.png and camera-phone.png: the frame each screen
 * gets at one moment of the run, each logged — the host's window at 1440×820, the same drawn at
 * density 2 and held against it (`sameFrame`), the host's window at 1280×720, and the guest's
 * phone as it is held now, sideways. The host's window is left at 1440×820.
 */
async function captureCamera(host, guest) {
  await host.page.setViewportSize(SIZES[0]);
  await sleep(700);
  const laptop = `${host.name} @ ${SIZES[0].width}×${SIZES[0].height}`;
  await capture(host.page, 'camera-1440.png');
  const plain = await logFrame(host.page, laptop, 'camera-1440.png');
  await atDensityTwo(host.page, async (cdp) => {
    await captureDense(cdp, 'camera-dpr2.png');
    const dense = await logFrame(host.page, laptop, 'camera-dpr2.png');
    if (plain !== null && dense !== null) {
      sameFrame(plain, dense, laptop);
    }
  });
  await host.page.setViewportSize({ width: 1280, height: 720 });
  await sleep(700);
  await capture(host.page, 'camera-1280.png');
  await logFrame(host.page, `${host.name} @ 1280×720`, 'camera-1280.png');
  await host.page.setViewportSize(SIZES[0]);
  await capture(guest.page, 'camera-phone.png');
  const { width, height } = guest.page.viewportSize();
  await logFrame(guest.page, `${guest.name}'s phone @ ${width}×${height}`, 'camera-phone.png');
}

/**
 * One of Blackout's key scenes on `player`'s page at density 2 as well, right after its own
 * window (`when` naming it): its frame held against density 1's just before (`sameFrame`), a
 * window of its frames for information alone with `quiet` filling it, and `shot` at its own
 * pixels. Another mission looks at none of its scenes at 2.
 */
async function keySceneAtTwo(player, when, quiet, shot) {
  if (MISSION.toLowerCase() !== 'blackout') {
    return;
  }
  const plain = await cameraFrame(player.page);
  await atDensityTwo(player.page, async (cdp) => {
    const dense = await cameraFrame(player.page);
    if (plain === null || dense === null) {
      console.log(`${shot.padEnd(18)} !! ${player.name}: no world on the page ${when}`);
      fail(`${shot}: ${player.name}'s page shows no world ${when}`);
      return;
    }
    sameFrame(plain, dense, `${player.name} ${when}`);
    await frameWindow(player.page, `${when}, at density 2`, quiet, { gating: false });
    await captureDense(cdp, shot);
    console.log(`${shot.padEnd(18)} ${player.name} ${when}: ${frameText(dense)}`);
  });
}

/**
 * Says first which groups the run leaves out or pulls in (SHOTS_ONLY, SHOTS_SKIP), runs the
 * walkthrough, then prints the summary as the last line. A step that
 * throws ends the walkthrough there and counts as failed; the exit code is set
 * rather than forced, so a log piped through tee keeps its last lines.
 */
async function main() {
  for (const line of PLAN.lines) {
    console.log(line);
  }
  console.log(`load               ${loadText(LOAD_AT_START)} as the run begins (1-minute average)`);
  try {
    if (SERVER_ENTRY !== null) {
      await startServer();
    }
    await run();
  } catch (err) {
    console.error(err);
    // Playwright appends its call log to the message: the first line names the step.
    fail(String(err instanceof Error ? err.message : err).split('\n')[0]);
  }
  // A step that threw leaves the browser running, and the process with it.
  if (browser?.isConnected()) {
    await browser.close();
  }
  await stopServer();
  summarize();
  process.exitCode = tally.failures.length === 0 ? 0 : 1;
}

await main();

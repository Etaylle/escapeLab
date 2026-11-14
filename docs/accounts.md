# EscapeLab — accounts

An account is what the game keeps of a player across runs, restarts and deploys: the name and
the crew colour they chose, the runs they played and the Erfolge those runs earned („Konten wie
bei Dota", backlog K-1a). With a Kennwort it gets an Ausweisnummer, and any device signs into it
(K-1c, „Sign in" below). Signing in with Google comes last (K-1b) as one more way into the same
account. Code: `packages/server/src/{accounts.ts,login.ts,store/}`, `packages/server/prisma/`,
`packages/core/src/login.ts`, and in the client `pass.ts`, `achievements.ts`,
`screens/{ProfileChip,MyRuns,Settings,LoginSection}.tsx`.

## One account per crew pass

Every browser profile holds a crew pass, the Dienstausweis (gameplay.md, „Verbindung und
Wiedereintritt"): an id and a secret minted once. The first time a pass asks where it sits
(`whereami`, as the menu comes up), takes a seat (`create-room`, `join-room`) or comes back to
one (`resume`), the server finds its account through the identity `pass`/`<pass id>` — or makes
one. The identity keeps a SHA-256 of the pass's secret, never the secret; a pass shown with
another secret is refused („Dieser Ausweis gilt hier nicht."). Seating never waits for the
store: the account comes to the socket a moment later (`account`), and the seat is bound to it
then. A pass leads into one account; an account has a pass for every device signed into it.

- **Name.** Typed in the menu's profile; once it has stood still for 0.6 s the account takes it
  (`profile`). A seat taken under a name gives the account that name, so the seat's name and the
  account's are one. An account made at the menu starts with the name the device kept, one made
  at a comeback with its seat's.
- **Colour.** Chosen in a lobby (`select-color`), it becomes the account's. The next seat wears
  it wherever nobody else in the room does (`create-room` and `join-room` carry it).
- **Profile.** The chip at the top right of the menu shows the account: its name, its colour and
  the figure in it, and „Konto · 3 Einsätze" — „Gast" while the server has told of none (line
  down, store away).
- **The pass is the device's key.** Without a Kennwort it is the account's only way in: a browser
  whose storage is cleared mints a new pass and with it gets a new account; the old one stays
  where it was, out of reach. With a Kennwort, any device's pass signs into the account
  („Sign in").
- **One pass a socket, so many new accounts an address.** A socket speaks for the first pass it
  shows; another is refused there („Diese Verbindung gehört schon einem anderen
  Dienstausweis."). An address may make 60 new accounts a minute; past that a pass without one
  still takes its seat, its account waits, and asked for by its name it is refused („Von dieser
  Adresse kommen in dieser Minute zu viele neue Konten."). A pass with an account always
  arrives in it. A change to an account — a new name, another colour, a deletion — counts
  against its socket, 30 a minute; past that a name or a deletion is refused („Zu viele
  Kontoänderungen über diese Verbindung in einer Minute."). An arrival, the menu come back to,
  or a name or colour the account has already changes nothing and counts nothing, and colours
  clicked through within a second are kept as one, the last — at once where the server goes
  down before the second is over, and the store closes only after. A player's first minute — the
  menu loaded and come back to three times, a name typed in two goes, a room opened, four
  colours tried — leaves most of the minute's changes; a lecture behind one address, thirty new
  students, stays under the address's new accounts. „Meine Einsätze" only reads, and is never
  held back.
- **Whose address.** Behind Render (`RENDER` set) the socket's address is the proxy's, the same
  for everybody, and a client may send any `X-Forwarded-For` it likes: the address is
  Cloudflare's `cf-connecting-ip`, else `true-client-ip`, else the last `X-Forwarded-For` entry,
  the one the proxy appended — the first socket read that way puts one line in the log, as
  Cloudflare names every client on Render. Without Render nobody's header is trusted: the
  socket's own address, so a machine on the LAN counts as itself whatever it claims. Only a
  valid IP address is counted by; a request without one counts as `unknown`, together with
  every other such. A limiter forgets an address once its minute has passed — at the next
  check, or by its timer — and keeps no key longer than 64 characters.

## Sign in

In the settings' „Konto" (its section „Ausweis"), the only way in, an account without a Kennwort
reads what one gives it — „Mit Ausweisnummer und Kennwort holt dieses Konto seine Einsätze und
Erfolge auf jedes Gerät." — and offers „Kennwort setzen" and „Anmelden". The first Kennwort,
typed twice, makes the server mint the account's Ausweisnummer: „EL-", then eight characters of
digits and capitals without 0, O, 1 and I in two fours (`EL-7K3M-9Q2D`), each drawn from the
system's CSPRNG, minted anew where one is taken. It is shown once large until „Notiert", and in
„Konto" from then on, with a button to copy it. It is read however it is typed: any case, spaces
or dashes, „EL" or not.

- **The Kennwort** has 8 to 128 characters and nothing else asked of it. It is NFKC-normalised —
  the same umlaut from any keyboard — and its characters are counted so, client and server alike;
  it is kept as `scrypt$N$r$p$salt$hash` (N 2^15, r 8, p 1, a random 16-byte salt, a 32-byte key,
  hex), compared in constant time; never logged, never sent back, and a store error that names
  its hash is logged with the hash cut. There is no e-mail and no recovery: „Konto" says plainly
  that a forgotten Kennwort on a lost device loses the account. On a page reached without
  encryption — neither https nor this machine — each form that asks a Kennwort says so in a line
  („Diese Verbindung ist unverschlüsselt: Das Kennwort geht lesbar durchs Netz.") and asks all
  the same.
- **Kennwort ändern** asks for the present one and replaces it only where it is still the one
  checked („Das Kennwort wurde eben an anderer Stelle geändert."). On a pass signed in already it
  does not go through the number lock, which others' guesses may hold; its wrong present
  Kennwörter count against that pass instead (the limits below). A new Kennwort signs every other
  pass of the account out in the same transaction, as „Abmelden" does, the form saying so first:
  a seat such a pass holds stays the account's, its line dropped. Its way in stays, kept under
  64 zeros — the hash of no secret anyone could show — so that the device, the next time it shows
  the pass (the menu come back to, any ask of the account, a resume), is told it signed out, as
  its own „Abmelden" is answered, and starts anew on a new pass.
- **Anmelden** re-points the device's pass to the account. The account the pass led into before
  is deleted where nothing is left of it — no way in, no run, no Erfolg; one that played runs
  stays, its names in the Bestenliste, out of reach (the sign-in says so first). The device's
  Erfolge are the new account's from then on, and the join screen asks where it sits anew. A
  sign-in is refused while a run on binds the pass („Ein laufender Einsatz bindet diesen
  Dienstausweis: Anmelden erst danach."), before any Kennwort is tried and again once it is, as
  a run may start meanwhile; a lobby seat goes along. The pass moves only where the account's
  login still keeps the Kennwort just checked: a change made at once either waits for the
  sign-in and then signs its pass out with the rest, or comes first and the sign-in is told it is
  wrong. Signing in again, as a page sends it twice, changes nothing.
- **Wrong** is one answer for a wrong Ausweisnummer and a wrong Kennwort: „Ausweisnummer oder
  Kennwort stimmen nicht." — and every try costs the same scrypt work, a number nobody holds
  included, so neither the words nor the time tell which numbers are given.
- **Abmelden**, offered to an account with a Kennwort only — without one it would be out of reach
  for good, and the server refuses it („Ohne Kennwort wäre dieses Konto nach dem Abmelden nicht
  mehr erreichbar.") — lets the device's pass go of the account, which stays whole and waits for
  its Kennwort: the pass's way in is deleted. The device mints a new pass, a guest's, forgets the
  Erfolge, the rooms' snapshots and the tab's room of the old one, and loads anew; another tab
  of the browser that sees the pass change loads anew too. A seat the pass held — a run's, or a
  lobby's — stays the account's (gameplay.md, „Verbindung und Wiedereintritt"): its line drops
  as a drop does („Abgemeldet: Der Platz bleibt beim Konto."), and the pass keeps its way in for
  that seat alone under 64 zeros, as above, so that the run credits the account as ever; the pass
  itself gets in nowhere any more, and shown again it is told it signed out.
- **Konto wechseln** is both in one dialog and one transaction: a new pass, minted by the
  device, signs into the other account and the old pass signs out; a wrong Kennwort changes
  nothing. After a sign-out or a switch the socket speaks for the device's next pass.

| Limit | Counts | Kept | Lets go |
| --- | --- | --- | --- |
| 60 tries a minute | every try at a Kennwort from an address — Cloudflare's `cf-connecting-ip` behind Render, else the socket's own, as above; a right one is given back once it is checked | in memory | once the oldest is a minute old |
| every 5th wrong Kennwort locks: 60 s, then twice the last lock, 3600 s at most | per Ausweisnummer, from any address, a number nobody holds too: its wrong Kennwörter, counted without a window, however they are paced | in memory | a right sign-in after the lift, and a quiet hour, clear the count and the escalation |
| the same for „Kennwort ändern" | per pass signed in already: its wrong present Kennwörter | in memory | as above |
| 4 Kennwörter at once, 32 waiting | every Kennwort checked or kept, on the whole server | in memory | as each is done; one more is refused („Die Kennwortprüfung ist gerade ausgelastet — in einem Moment wieder möglich.") |
| 30 changes a minute | every try, a Kennwort set or changed, a sign-out (the socket's changes, as above) | per socket | after a minute |

A number's wrong Kennwörter are counted until a right one or a quiet hour, however they are paced.
Every 5th counted wrong try locks the number: 60 s the first time, then twice the previous lock —
120, 240, 480, 960, 1920 and 3600 s, which is the cap. The quiet hour runs from the later of the
last counted wrong try and the end of the last lock, so five wrong tries right after a 3600 s lock
lifts lock it again for 3600 s, not 60. During a lock every try on the number is refused, not
derived, and counts nothing. A right sign-in after the lift and a quiet hour both clear the
counter and the escalation. At most five guesses per lock, about 120 a day at the cap. A pass's
„Kennwort ändern" is counted and locked by the same rule, apart from the number's.

Every try is counted the moment its turn at the server's four comes, before its Kennwort is
derived — as a wrong one, given back where it was right: tries sent at once are held to the limits
as tries one after the other, so forty sent at once on one number have five derived at most, and
an address sixty. Waiting for a turn counts nothing yet. Only wrong tries are left counting: sixty
right sign-ins of a lecture behind one NAT go through in the same minute. A try refused counts
nothing. The log says when an address reaches its limit, when a number or a pass locks and for
how long, and when the queue refuses one, naming none; a restart forgets the limits.

## What is kept

With `DATABASE_URL` the server keeps everything in Postgres (`packages/server/prisma/
schema.prisma`, tables in snake_case):

| Table | What it holds |
| --- | --- |
| `accounts` | the display name, the colour, when the account was made and last seen |
| `identities` | a way in: provider `pass` — a device's pass id, the SHA-256 of its secret, or 64 zeros once it signed out of a seat or its account's Kennwort changed — or `login` — the account's Ausweisnummer, the scrypt hash of its Kennwort, one an account at most; the account |
| `runs` | the report of each finished run (core `report.ts`) without names, and the columns the Bestenliste ranks by: mission, difficulty, outcome, duration, alarms, crew size, Tagesschicht, seed, room code, start and end; each run once, by its room code and its start |
| `run_members` | a seat of each run: its place in the crew, what it did, the account of the pass that held it where it had one, and only then the name played under |
| `achievements` | an account, the plaque by mission („blackout:ohne-alarm"), the end of the run that first earned it |

No e-mail address, no Kennwort — only its scrypt hash —, no IP address, nothing from Google. A
login is a row of `identities` like a pass's: no table of its own, no migration.

## Runs and Erfolge

Every finished run is written in one transaction: the run, a seat for each of its crew — by the
account of their pass where it has one — and the Erfolge the run earned for each of those
accounts, each once, dated by the first run that earned it. A seat counts for an account only
where its pass showed the account's secret: the room hands over each seat's pass id with the
hash of the secret the seat was bound with, and an id alone credits nobody. A seat taken over by
another device (the crew's yes to an „Übernahme") is that device's pass's from then on: the run,
its Erfolge and the seat's name go to the claiming pass's account; so is a seat a device of the
account took back without a yes (gameplay.md, „Verbindung und Wiedereintritt"), and a seat whose
pass signed out credits the account still by the way in kept for it („Sign in"). A seat without
an account keeps no name: its account was deleted while the run went on, or none was made, and no
account could take the name off again. A sign-in locks the account it leaves in the database
before it counts what is left of it: a run landing at that moment with a seat for it keeps the
seat, and one whose account went while it was written is written once more without it (the log:
`an account of the crew of … went meanwhile: asked again`). A run is kept once: a room taken up again from a snapshot made before
its end may finish it a second time, and the log says `run of … in room … kept already` — the
unique key on room and start, no other (`runs_once`). Where this server's Bestenliste did not
count that run yet — another instance kept it during a deploy, or the write landed while its
answer was lost with the connection — it reads the run back and counts it then. A new instance
also looks for the runs the old one kept around its opening as its Bestenliste is read (at most
every 5 s, for five minutes) and counts them from the next read on. A run
the store cannot take is logged and dropped; the room plays on. The Bestenliste and the mission
cards' records count
every run once as the server starts, then run by run. „Meine Einsätze", the menu's item beside
the Bestenliste, lists the account's newest 50 runs (`my-runs`): mission, day, outcome, the time
on the clock, the crew — the account's own seat marked — and the rank, S to C, reckoned from the
report as the end screen reckons it from the run (core `grade.ts`).

The browser's list of Erfolge (`escapelab.achievements`) is a cache: every `account` message fills
it, and a won run adds its plaques at once. The won card lets a plaque come in as new where the
cache did not know it, or knows it first from this very run.

## Deleting an account

In the settings, „Konto löschen" asks first, saying what goes and what stays; „Endgültig löschen"
sends `delete-account`. The server deletes the account, its identities — every device's pass and
its login, so the Ausweisnummer opens nothing any more —, its Erfolge and its seats in the runs. The runs stay — the Bestenliste keeps their times and counts — without its name: its
seat is gone, the crew shows the others, and the Bestenliste takes the name off the runs the
account held, reading no other. The device forgets
the name, the colour and the Erfolge it kept; the pass stays, and the next visit to the menu
starts a new, empty account. The server's log says „an account was deleted, as its pass asked",
naming nobody.

## Without a database

Without `DATABASE_URL` — development, the LAN, CI — finished runs go to the run log file as
before (README, „Laufprotokoll"), and the accounts and their seats in the runs live in memory
until the server stops. Deleting an account there forgets it and its seats and takes its name
off the runs it played since the server started: off the Bestenliste, off `GET /runs.jsonl` and
off the rest of the crew's „Meine Einsätze". The run log file keeps the names it was written
with, so the Bestenliste counted from it after a restart shows them again; „Konto löschen" says
so there (the account's view names its store, `store: 'run-log'`). The start-up log names the
store in one line either way.

## Operating it

- **Render:** either the two variables Neon's integration sets — `DATABASE_URL` through Neon's
  pooler for the server's queries, `DATABASE_URL_UNPOOLED` direct for the migrations, as Prisma's
  schema engine does not go through PgBouncer — or `DATABASE_URL` alone, Neon's direct connection,
  which then does for both: the schema's `directUrl` is `DATABASE_URL_UNPOOLED`, and where it is
  unset or empty the server sets it to `DATABASE_URL` as it starts, as the server package's
  `prisma` script does for the CLI run by hand. The pooled URL takes no flag: Neon's pooler runs
  PgBouncer 1.24, which keeps prepared statements in transaction mode, and Prisma advises against
  `pgbouncer=true` from 1.21 on. The server applies the migrations itself before it opens the
  store and listens (`src/store/migrate.ts`, its CLI's lines in the log as `migrate: …`, with
  no URL, host, port or user among them), whatever started it: Render's Start Command, `node`
  straight in `packages/server`, or `pnpm run start`, which only starts the server — Prisma's
  own lines, run before it, would name the host. Where they do not apply, it ends with
  `not started: the migrations did not apply (P…)` and exit code 1, before it listens: README,
  „Hosting auf Render" — there too what a start does with Neon away (P1001) or after a migration
  that broke off (P3009, `prisma migrate resolve`).
- **A connection lost:** Neon closes a connection that stood idle for five minutes. The pool
  hands out none idle for more than a minute (`max_idle_connection_lifetime=60`, unless
  `DATABASE_URL` sets its own), and a request whose connection the database closed all the same
  is asked once more, of a fresh client — a pool of its own: Prisma 6.19's pool may go on
  handing out a closed connection, one that had not run the request's statement before, until
  it has stood idle for its lifetime. The log says `the database had lost the connection
  (P1017): asked again`; the client replaced closes a minute later, once the requests still
  running on it have ended, never earlier — asked again after `$disconnect`, Prisma throws
  „Engine is not yet connected" uncaught and the process ends. A connection that could not be
  opened (P1001, P1002) is asked again of the same client. A refusal, a unique key say, is never
  asked again — but a run's seat for an account that went meanwhile (P2003), written once more
  without it („Runs and Erfolge"). A paused Neon takes seconds to wake and open a connection, past the 2 s Prisma
  gives a transaction to start: the run's transaction waits up to 15 s, and one that did not
  start in time is asked once more as well (`did not start the transaction in time (P2028):
  asked again`).
- **Changing the schema:** edit `prisma/schema.prisma`, then make the migration with
  `pnpm --filter @escapelab/server prisma migrate dev --name <what>` against a database of your
  own, and commit it; the next deploy applies it. `packages/server/test/schema.test.ts` checks that
  the migrations make exactly the schema, every table and column in snake_case and every foreign
  key indexed.
- **Tests:** `TEST_DATABASE_URL` (README, „Entwicklung"); the store contract runs against the run
  log and against Postgres alike (`test/storeContract.ts`).

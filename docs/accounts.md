# EscapeLab — accounts

An account is what the game keeps of a player across runs, restarts and deploys: the name and
the crew colour they chose, the runs they played and the Erfolge those runs earned („Konten wie
bei Dota", backlog K-1a). Signing in with Google comes later (K-1b) as one more way into the same
account. Code: `packages/server/src/{accounts.ts,store/}`, `packages/server/prisma/`, and in the
client `pass.ts`, `achievements.ts`, `screens/{ProfileChip,MyRuns,Settings}.tsx`.

## One account per crew pass

Every browser profile holds a crew pass, the Dienstausweis (gameplay.md, „Verbindung und
Wiedereintritt"): an id and a secret minted once. The first time a pass asks where it sits
(`whereami`, as the menu comes up), takes a seat (`create-room`, `join-room`) or comes back to
one (`resume`), the server finds its account through the identity `pass`/`<pass id>` — or makes
one. The identity keeps a SHA-256 of the pass's secret, never the secret; a pass shown with
another secret is refused („Dieser Ausweis gilt hier nicht."). Seating never waits for the
store: the account comes to the socket a moment later (`account`).

- **Name.** Typed in the menu's profile; once it has stood still for 0.6 s the account takes it
  (`profile`). A seat taken under a name gives the account that name, so the seat's name and the
  account's are one. An account made at the menu starts with the name the device kept, one made
  at a comeback with its seat's.
- **Colour.** Chosen in a lobby (`select-color`), it becomes the account's. The next seat wears
  it wherever nobody else in the room does (`create-room` and `join-room` carry it).
- **Profile.** The chip at the top right of the menu shows the account: its name, its colour and
  the figure in it, and „Konto · 3 Einsätze" — „Gast" while the server has told of none (line
  down, store away).
- **The key stays on the device.** No sign-in, no password, no e-mail: the pass is the key. A
  browser whose storage is cleared mints a new pass and with it gets a new account; the old one
  stays where it was, out of reach.
- **One pass a socket, so many writes an address.** A socket speaks for the first pass it shows;
  another is refused there („Diese Verbindung gehört schon einem anderen Dienstausweis."). Each
  address gets 120 writes to the accounts a minute — an account made or visited as its pass
  arrives, a name, a colour, a deletion — counted by the first address of `X-Forwarded-For`
  behind Render's proxy, else the socket's. Past it a seat is still taken and its account waits;
  a name or a deletion is refused („Zu viele Kontoänderungen von dieser Adresse in einer
  Minute."). „Meine Einsätze" only reads, and is never held back.

## What is kept

With `DATABASE_URL` the server keeps everything in Postgres (`packages/server/prisma/
schema.prisma`, tables in snake_case):

| Table | What it holds |
| --- | --- |
| `accounts` | the display name, the colour, when the account was made and last seen |
| `identities` | provider `pass`, the pass's id, the hash of its secret, the account |
| `runs` | the report of each finished run (core `report.ts`) without names, and the columns the Bestenliste ranks by: mission, difficulty, outcome, duration, alarms, crew size, Tagesschicht, seed, room code, start and end |
| `run_members` | a seat of each run: its place in the crew, what it did, the account of the pass that held it where it had one, and only then the name played under |
| `achievements` | an account, the plaque by mission („blackout:ohne-alarm"), the end of the run that first earned it |

No e-mail address, no password, no IP address, nothing from Google.

## Runs and Erfolge

Every finished run is written in one transaction: the run, a seat for each of its crew — by the
account of their pass where it has one — and the Erfolge the run earned for each of those
accounts, each once, dated by the first run that earned it. A seat without an account keeps no
name: its account was deleted while the run went on, or none was made, and no account could take
the name off again. A run the store cannot take is
logged and dropped; the room plays on. The Bestenliste and the mission cards' records count
every run once as the server starts, then run by run. „Meine Einsätze", the menu's item beside
the Bestenliste, lists the account's newest 50 runs (`my-runs`): mission, day, outcome, the time
on the clock, the crew — the account's own seat marked — and the rank, S to C, reckoned from the
report as the end screen reckons it from the run (core `grade.ts`).

The browser's list of Erfolge (`escapelab.achievements`) is a cache: every `account` message fills
it, and a won run adds its plaques at once. The won card lets a plaque come in as new where the
cache did not know it, or knows it first from this very run.

## Deleting an account

In the settings, „Konto löschen" asks first, saying what goes and what stays; „Endgültig löschen"
sends `delete-account`. The server deletes the account, its identities, its Erfolge and its seats
in the runs. The runs stay — the Bestenliste keeps their times and counts — without its name: its
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

- **Render:** `DATABASE_URL` in the environment (Neon's direct connection), the start script
  applies the migrations first: README, „Hosting auf Render" — there too what a start does with
  Neon away (P1001) or after a migration that broke off (P3009, `prisma migrate resolve`).
- **A connection lost:** Neon closes a connection that stood idle for five minutes. The pool
  hands out none idle for more than a minute (`max_idle_connection_lifetime=60`, unless
  `DATABASE_URL` sets its own), and a request whose connection was lost all the same is asked
  once more: the log says `the database had lost the connection (P1017): asked again`. A
  refusal, a unique key say, is never asked again. Prisma 6.19 can stay stuck on a closed
  connection after a transaction lost one; the minute's lifetime ends that too.
- **Changing the schema:** edit `prisma/schema.prisma`, then make the migration with
  `pnpm --filter @escapelab/server prisma migrate dev --name <what>` against a database of your
  own, and commit it; the next deploy applies it. `packages/server/test/schema.test.ts` checks that
  the migrations make exactly the schema, every table and column in snake_case and every foreign
  key indexed.
- **Tests:** `TEST_DATABASE_URL` (README, „Entwicklung"); the store contract runs against the run
  log and against Postgres alike (`test/storeContract.ts`).

# Fixtures and the demo mode

`--demo` exists so a fresh clone prints a real table on the first command, with
no RPC, no key and no waiting. It is not a mock: the fixture loader produces the
same `LaunchRecord[]` the live reader produces, and every layer above it is the
same code. What you see in demo is what the tool does.

## Where the numbers came from

Every fixture file carries an `origin`, and the banner prints it on every run:

```
source demo 11 launches from 3 fixture file(s) · SYNTHETIC, not chain data
demo mode fixture data, not a live read of Robinhood Chain
```

- **`synthetic`** - shaped by hand in `scripts/make-fixtures.ts` to exercise every
  branch of the verdict logic: a clean original with six copies, a first born
  that is the operator's own bait with the flow on number three, and a launch
  nobody bothered to copy. This is what ships.
- **`capture`** - written by `scripts/capture-fixtures.ts` from a real read, with
  the block it was taken at.

A tool that shows a beautiful table built from numbers it invented is a
screenshot generator. novamp says which one it is on every run rather than in a
footnote, and any screenshot taken from the shipped fixtures should say the same.

## Capturing real launches

```sh
cp .env.example .env                              # point RPC_URL somewhere you trust
npx tsx scripts/capture-fixtures.ts --busiest 3   # the three busiest name fights
npx tsx scripts/capture-fixtures.ts PEANUT        # or one fight by name
```

Both forms run the deep read first (holders, early buyers, deployer funding), so
the captured file works offline afterwards and `--demo` stops calling itself
synthetic.

## Regenerating the synthetic set

```sh
npx tsx scripts/make-fixtures.ts
```

Seeded, so the same run produces the same bytes and regenerating does not churn
the diff. Edit the `Spec` blocks at the bottom of that file to add a case.

## Adding a case worth shipping

If you hit a launch pattern novamp gets wrong, the most useful bug report is a
captured fixture plus one sentence about what the table should have said.
Fixtures are small, they are the input to every unit test, and a case in a file
is worth ten in an issue thread.

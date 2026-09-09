# Contributing

## The two things that help most

**1. A launch novamp got wrong.**

Capture it and say what the table should have said:

```sh
npx tsx scripts/capture-fixtures.ts THATNAME
```

Attach the file from `fixtures/clusters/` to the issue. A case in a file is worth
ten in an issue thread, because it becomes a test.

**2. A glyph the confusables table misses.**

`src/vamp/confusables.ts` is hand-kept and covers Latin, Greek, Cyrillic,
fullwidth forms and the common symbol substitutions. If a launch slipped past it,
that is one line there and one assertion in `test/normalize.test.ts`.

## Running things

```sh
npm install
npm run typecheck
npm test                       # 127 offline tests, no network
npx tsx src/cli.ts vamp NOVA --demo
```

Tests never touch the network. If a change makes a test need an RPC, the change
is in the wrong layer: see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## House rules

**No signer. Ever.** No `PRIVATE_KEY`, no `sendTransaction`, no `writeContract`,
no wallet client, not behind a flag and not "just for testing". CI has a job that
greps for exactly this and fails the build. A pull request that adds one will be
closed without discussion.

**A rule that cannot be unit tested does not go in `src/vamp/`.** That directory
is pure functions over `LaunchRecord`. If it needs an RPC it belongs in
`src/read/`.

**Unread is not zero.** A refused log chunk, a capped holder scan, a missing field:
these produce `unknown` and score zero points, never a confident number. This is
the single easiest way to make the tool lie, and most bugs of this shape look
harmless in review.

**Say what the number means next to the number.** Every point in the score prints
its reason. A rule without a readable reason string is half a rule.

**Comments explain why, not what.** The code says what it does. Write down the
thing the next person would otherwise have to rediscover: why the curve is
excluded from concentration, why birth order does not use the timestamp, why
folding is deliberately lossy.

## Pull requests

- one thing per PR
- `npm run typecheck && npm test` green
- if it changes a rule, update [docs/RULES.md](docs/RULES.md) in the same commit
- if it changes what the tool cannot do, update [docs/LIMITATIONS.md](docs/LIMITATIONS.md)

Nothing here needs a CLA and nobody is going to ask you to assign copyright.

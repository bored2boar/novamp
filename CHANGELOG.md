# Changelog

## 0.2.0

The version that answers "and then what". 0.1.0 could resolve a fight; this one
tells you whether you are already in one, who keeps starting them, and how far
back you can actually look.

**Added**

- `novamp wallet <address>` - balance-checks a wallet against the index and says
  which positions are copies, with the original beside each one. Copies first.
- `src/store/` - an append-only local index under `.novamp/`, one JSONL file per
  UTC day, which is what makes `--since 6h|24h|7d|30d|all` an honest offer on a
  chain where thirty days is 26 million blocks. Demo runs never write to it.
- `--since` on every reading command, plus `novamp index` to see how deep yours
  goes. A window wider than the index says how far short it fell rather than
  quietly returning less.
- `novamp farms` - deployers ranked by copies shipped, names touched, median lag,
  and how many other wallets share their funder.
- `novamp board` - the same engine behind a page on 127.0.0.1, with filters,
  sorting and a twenty second refresh. Local only, one HTML file, no build step.
- `novamp watchlist add|remove|list|run` - alerts on a new live copy of a watched
  name, or a cluster flipping to CONTESTED. Terminal always, Telegram optionally,
  deduplicated on disk. One outbound POST, no webhook, no command handler.
- `--csv` on `vamp` and `farms`, carrying every reason and flag, so the scoring
  can be re-run against somebody else's weights.

**Fixed**

- `looseKey` no longer collapses a short ticker out of existence: `AAA` folded to
  `a` and fell below the length bar, which made every launch under it invisible.
- `describeWindow` prefers `7d` over `1w` below a fortnight, so the label matches
  what was typed.

**Known gaps**

- The chain readers still have not been run against mainnet by the author.
- A wide `--since` is only as deep as your local index; `novamp index` says how
  deep that is.

## 0.1.0

First public cut. Everything below the decision layer is written; everything
above it is exercised by `--demo` and covered by tests.

**Added**

- `vamp <name>` - the clone resolver: folds a name into a key, groups every
  launch fighting over it, orders them by birth, and labels each one ORIGINAL,
  TAINTED, CONTESTED, VAMP or DEAD.
- Clustering on the ticker **and** the token name, joined transitively, so a
  copy that takes a new symbol and keeps the name lands in the same fight.
- Homoglyph folding over Latin, Greek, Cyrillic, fullwidth forms and symbol
  substitutions, plus zero-width stripping, leetspeak, plural and filler-word
  removal, with a capped Damerau-Levenshtein for the fuzzy join.
- The taint check: a first born is not called ORIGINAL when two or more grounds
  hold against it, including the heaviest one, another launch in the same cluster
  funded from the same wallet.
- Risk flags with the bonding curve and the Uniswap v4 pool excluded from
  concentration, and `UNKNOWN` rather than a comfortable number when a scan does
  not complete.
- A 0-100 score where every point prints its reason.
- The proven-wallet registry and convergence detection.
- `scan`, `watch`, `stats` (vamp ratio and vamp lag), `narrative`, `smart
  list|build`, `doctor --probe`.
- `--demo` on every command, with fixtures that state their own origin.
- `scripts/capture-fixtures.ts` to replace the synthetic set with real launches.
- 59 offline tests and a CI job that fails the build if a signing primitive
  appears in `src/`.

**Known gaps**

- The chain readers in `src/read/` have not been run against mainnet by the
  author. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
- Exempt wallets are not recovered from launch calldata yet, so a live run
  underestimates declared bundles.
- Pair symbol and decimals are not read, so reserves print raw for launches
  quoted in anything other than ETH.

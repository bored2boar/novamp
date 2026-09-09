# Changelog

## 0.3.0

Every input the score read was measured before or during entry. Birth order, dev
buy, exemptions, concentration, who bought and how fast: all of it visible in the
first seconds, all of it arrangeable by the operator. This release adds the
signals he cannot stage.

**Added**

- **The sell side.** `src/read/sells.ts` replays `CurveBuy` and `CurveSell` from
  the launch to reconstruct the quote reserve, so every sale is measured as a
  share of what was on the curve when it landed rather than in absolute size.
  Three new rules: the deployer selling inside five minutes (-25, the heaviest
  penalty in the file), a sale taking 8 %+ of the reserve inside three minutes,
  and more quote leaving the curve than entering it.
- **Size instead of count.** `src/vamp/flow.ts` denominates the early flow in
  quote: total in, median ticket, and `top3Share`. Counting wallets is exactly
  what a farm is optimised against, because wallets are free. A launch where
  three wallets are 85 % of the money is one person with three wallets.
- **A registry built on realized results.** `src/smart/realized.ts` matches every
  early entry against what the wallet actually sold. A position with no sale is
  open, not a win, and a wallet whose record is nearly all open cannot qualify.
  New bars: 5 closed positions, 3 profitable, a realized multiple over 1.15.
- New columns in the `vamp --csv` export for all of the above, so the scoring can
  be re-run against somebody else's weights.
- `scan` and `vamp --all` now print early money in, top-3 concentration, and what
  the sell side did.

**Changed**

- Trimmed three weak positives to make room without inflating the top of the
  scale: each social link 3 to 2 points (a link is free and proves nothing about
  who is behind it), fresh deployer 3 to 2, curve 50 %+ filled 6 to 4 (the new
  ETH-in rule already covers most of what curve fill stood in for).
- The registry replaces `graduated` and `hitRate` with `closed`, `profitable`,
  `realizedMultiple` and `open`. Old registry files will not load; rebuild with
  `novamp smart build`.

**Known gaps**

- The new readers, like the existing ones, have not been run against mainnet by
  the author.
- Only a wallet's first buy on a launch is counted, so positions that were added
  to have their money in understated. See docs/SMART-WALLETS.md.

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

# Limitations

The things novamp cannot do, gets wrong, or has not proved yet. This file is
maintained on purpose, and it is the first place to look when the tool tells you
something that does not match what you can see with your own eyes.

## The live path has not been run against mainnet by the author

This is the big one, and it is at the top because it belongs at the top.

The chain readers in `src/read/` are written against the documented pons v2 ABI
and against how the public Robinhood RPC is known to behave. They typecheck, and
the logic above them is unit tested. They have **not** been exercised against
mainnet by the author, because the machine this was written on cannot reach the
endpoint.

Everything above the reader is exercised end to end by `--demo`, which drives the
same clustering, verdict, risk and scoring code the live path drives.

So: `--demo` is proven, and `--live` is written. If your first live run throws,
that is a bug worth an issue rather than a design decision, and it is the first
thing being fixed.

## Read only is a property of this tree, not a sandbox

There is no signer, no key setting, and no write path in `src/`, and CI fails the
build if one appears. A fork can obviously add one. Read the exact commit you
run, and check the `no-signer` job on the commit you cloned.

`swarm --exec` is the one place novamp starts a process that could do anything at
all, and it is worth being exact about what that does and does not mean. novamp
spawns a file you named, with no shell, passing the finding on stdin and nothing
in argv. It holds no key, has nothing to give that process, and cannot tell what
it did. Everything about that executor - what it spends, whether it has caps,
whether it is correct - is outside this repository and outside every guarantee
made in it. If you run `--exec` against a script you did not write and read, the
`no-signer` badge is telling you nothing useful about your setup. See
[EXEC.md](EXEC.md).

## A headline before a burst is a coincidence in time

`swarm` checks that a headline carried the name, that it has a timestamp, and
that it landed before the first launch. That is more than most things claiming to
be news bots do, and it is still not causation. Two unrelated stories in an hour
is normal; a word appearing in a headline and in a ticker at the same time is
often just a word having a busy day.

The lookback also cuts both ways. A story that broke four hours ago and only
reached the launch farms now falls outside the window and reads as "no headline";
a wire item republished at the top of the hour can read as fresh when the story
is old. novamp reports what it matched and when, so the lag is visible; it does
not try to resolve a story back to its first appearance, because it cannot.

## `swarm` only sees as far back as your index

A burst that started before your first run of the day is a burst novamp saw the
tail of, and `priorMembers` will read as zero when the earlier launches simply
are not in the index. On a fresh clone the first hour of `--watch` is the least
reliable hour it will ever have. See [INDEX.md](INDEX.md).

## Name folding is deliberately lossy

`PEANUTCOIN` folds onto `peanut`. So does a token genuinely called `PEANUT COIN`
that has nothing to do with the squirrel. The table marks how each member joined
so you can see it, but the join happened. See [RULES.md](RULES.md) section 1 for
why the trade goes this way.

The confusables table in `src/vamp/confusables.ts` is hand-kept and covers Latin,
Greek, Cyrillic, fullwidth forms and the common symbol substitutions. It is not
the full Unicode confusables set. A glyph it misses is a one-line fix and a
welcome issue.

## Funding traces are bounded and often inconclusive

Standard JSON-RPC has no "transactions by address", so `traceFunding` walks
blocks backwards from the deployer's first activity, capped at 5 000 blocks. On a
public endpoint that gets rate limited quickly.

When the trace comes back empty the answer is **unknown**, never "independent".
Two launches that novamp did not link may still be one operator.

## The launch index is a window, not history

`INDEX_LOOKBACK_BLOCKS` defaults to 400 000 blocks, which at roughly 100 ms per
block is around eleven hours. A copy launched outside that window is invisible,
and a deployer's record only counts what is inside it. Widening the window makes
every command slower and makes a public RPC refuse more often.

## Holder counts are reconstructed, and capped

There is no `eth_getTokenHolders`. The holder set comes from Transfer logs, then
one balance read per address, capped at 400 reads. Past that cap, and after any
refused log chunk, the snapshot is marked incomplete and the concentration number
is a floor rather than a total. `assessRisk` reports `UNKNOWN` in that case rather
than a number that looks precise.

## Exempt wallets are not read on the live path yet

The count of wallets declared exempt from the opening tax is one of the strongest
signals in the scoring, and it lives in the launch transaction's calldata rather
than in a view function. The live reader currently reports `0` for it. The demo
fixtures carry real-shaped values, so the rule is exercised, but a live run
underestimates bundles until `read/exemptions.ts` lands. It is the top item on
the roadmap for a reason.

## The reserve behind a sale is reconstructed, not read

There is no historical `realQuoteReserve` on chain, so `readSells` replays
`CurveBuy` and `CurveSell` from the launch and keeps a running balance. It
ignores fees skimmed off the curve and anything that moved outside those two
events, so `shareOfReserve` is an approximation. It is accurate enough to tell a
fifth of everything from a rounding error, which is the only question asked of
it, and it should not be quoted as an exact figure.

## Only a wallet's first buy is counted

The buyer list keeps one entry per wallet per launch. A wallet that added to its
position later has its money in understated and, in the registry, its realized
multiple overstated. The registry bars are set strict enough to survive that, but
it is a real bias and it is not zero.

## The proven-wallet registry is only as good as its window

See [SMART-WALLETS.md](SMART-WALLETS.md). Short version: a registry built from
eleven hours of launches cannot see a wallet that trades twice a week, and a
position whose sale falls outside the window looks open forever.

## Signals describe measurements, not intent

A deployer balance that fell may be a sell, a transfer, or a burn. A fee routed
to a third party may be a builder deal or a rug. A top 10 at 45 % may be four
exchanges. novamp reports what it measured and labels the level; the decision is
still yours, and there is no automation here that could take it from you.

## Nothing here is trading advice

There is no buy button, no signal service, no private channel, and no claim that
any number predicts a price. See the `Never` section in the README.

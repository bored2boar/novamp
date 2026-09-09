# Roadmap

No dates. Ordered by what is actually blocking the tool from being trusted.

## Shipped in 0.3

The sell side, size-denominated flow, and a proven-wallet registry built on
realized results rather than on graduations. Details in
[CHANGELOG.md](CHANGELOG.md).

## Shipped in 0.2

`novamp wallet`, the local index behind `--since`, `novamp farms`, the board on
127.0.0.1, the watchlist with Telegram alerts, and CSV export. All of it is in
[CHANGELOG.md](CHANGELOG.md) and none of it changed the rule that nothing here
signs anything.

## Now

**Exempt wallets on the live path.** The count of wallets declared exempt from
the opening tax is one of the strongest signals in the scoring, and it sits in the
launch transaction's calldata rather than in a view function. The live reader
reports `0` for it today, which means a live run underestimates bundles. The
fixtures carry real-shaped values so the rule is exercised, but that is not the
same as it working. Top of the list.

**A live run.** Everything above `src/read/` is exercised end to end by `--demo`.
The readers themselves have not been run against mainnet by the author, for the
reason in [docs/LIMITATIONS.md](docs/LIMITATIONS.md). Until that happens the live
path is written rather than proven, and the README will keep saying so.

**Pair symbol and price.** Some pons launches are quoted in tokenised equity
rather than ETH. Reserve is printed as a raw number until novamp reads the pair
token's own symbol and decimals, and it will not guess a dollar figure for a
price it has not read.

## Next

**Fingerprint clustering beyond the funder.** Shared funding is the heaviest link
novamp has and it is beatable by an operator who funds through a mixer. The next
layer clusters on timing between launches, on identical calldata shapes, and on
metadata that is the same size rather than the same bytes.

**A holder scan that scales.** 400 balance reads and a Transfer sweep per token is
fine for a six member cluster and hopeless for a window. An explorer API where one
is available, and a cheaper approximation where it is not.

**Every buy, not the first one.** The buyer list keeps each wallet's first buy on
a launch, which understates anyone who added to a position and overstates their
realized multiple. Fixing it is a heavier read and it is what the registry needs
next.

**Flow as a delta, not a level.** The sell side landed in 0.3, but the score is
still a snapshot: it reads the same at T+30s and T+30m. Sampling at T+60, T+120
and T+300 and scoring the *change* is what would make it read a launch losing
momentum rather than a launch that started badly.

**Backtesting the score.** The score is a set of opinions until it is tested
against what the chain actually did to each launch afterwards. Once `stats` has
been logging for long enough, every rule in `potential.ts` gets checked against
outcomes and the ones that do not survive get deleted, publicly. Until that test
exists, the honest thing to say is that the number orders a cluster well and
predicts nothing, and that is what the README says.

## Later

**Confusables from the source.** The hand-kept table becomes a generated one from
Unicode TR39, filtered to what can appear in a ticker.

## Never

- **No signer, ever.** No key setting, no transaction path, no "just for
  convenience" write mode. CI fails the build if a signing primitive appears in
  `src/`, `bin/`, `scripts/` or `examples/`.

  `swarm --exec` is not an exception to this and is the reason it can stay
  absolute. novamp spawns a program **you** wrote, with no shell, and hands it
  the finding on stdin; the key lives in your process, on your disk, outside this
  tree. Splitting it that way is what lets the decision half be read, audited and
  cloned by somebody who will never trust it with money. A version that signed
  would have to be trusted before it could be checked, which is backwards.
- **No hosted service holding anything of yours.** Nothing to sign up for.
- **No paid alpha channel.** A sharper private version would mean the public
  rules are worse on purpose.
- **No promise of returns.** Not on the tool, not on any token, not implied by a
  score.
- **No closed core.** If a future website computes something this repository
  cannot, the repository is decoration.
- **No licence change.**

## How to check any of this

Commits show what shipped and when. Issues show what was asked for and whether it
was built or dropped. If something here goes quiet for weeks, ask in public.

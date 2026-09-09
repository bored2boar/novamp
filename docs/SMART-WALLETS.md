# The proven-wallet registry

The only part of novamp that carries an opinion from one run to the next, so it
gets its own file, its own command, and this document arguing against itself.

## What earns a wallet a place

Realized results. For every wallet, on every launch it entered early, how much
quote went in and how much came back out.

| Bar | Default |
|---|---|
| early entries | 8 or more |
| closed positions | 5 or more |
| profitable positions | 3 or more |
| realized multiple | 1.15 or better |
| top win share | 60 % or less |

An "early entry" is a first buy inside two minutes of a launch. A position is
**closed** once the wallet has sold anything on that token, and only closed
positions count toward the multiple. A position with no sale is **open**: its
outcome is unknown, and it counts for nothing in either direction.

`realizedMultiple` is total quote out over total quote in across closed
positions. The 1.15 bar leaves room for the opening tax and the curve fee without
letting break-even wallets through.

`topEntryShare` asks what share of a wallet's total *gain* came from its single
best position. Over 60 % and the record is one lucky ticket wearing a track
record's clothes, and copying that wallet copies a coin flip that already landed.
Losing positions do not dilute this number, because a loss is not one of the wins.

### What changed in 0.3, and why

Before 0.3 a wallet was credited whenever a launch it entered later reached the
pool phase. That was a bad proxy and this document said so at the time. A wallet
can be early to ten launches that all graduated and still have lost money on
every one of them, because entering early and exiting well are different skills
and only the second one pays.

## Why the method is weaker than it looks

**The window is too short.** `INDEX_LOOKBACK_BLOCKS` defaults to roughly eleven
hours. A wallet that trades twice a week is invisible, and eleven hours of
launches is not enough history to separate skill from a good afternoon. Build
from the widest window your RPC will tolerate, and rebuild often.

**Only the first buy is counted.** The buyer list holds each wallet's first buy
on a launch, so a wallet that added to a position later has its money in
understated and its multiple overstated. Fixing it means keeping every buy rather
than the first, which is a heavier read. Until then this is a floor on the money
in, and the bars are set strict enough to survive it.

**The window cuts positions in half.** A wallet that bought inside the window and
sold after it looks open forever. That is why `open` is reported separately and
why five closed positions are required: a wallet whose record is nearly all open
cannot qualify no matter how good it looks.

**Sales are matched by token, not by lot.** A wallet that bought twice and sold
once has both buys and the one sale pooled. For a five minute memecoin position
that is close enough; for anything held across days it is not.

**A wallet can be several people, and several wallets can be one person.** Nothing
here deduplicates an operator running twenty addresses. If those addresses all
qualify, a single person can manufacture a convergence event.

**Survivorship.** The registry is built from launches that are in the window
*now*. Wallets that blew up and stopped trading are not there to drag the
averages down.

## What to do about all that

Treat the registry as a starting list, not an oracle:

```sh
novamp smart list --all      # see everything, including what got filtered
novamp smart build           # rebuild from your own window
```

It is a plain JSON file at `fixtures/smart-wallets.json`. Delete a wallet you
think is luck. Add one you have watched yourself. Nothing in novamp will
overwrite it unless you run `build`.

## What ships in the repository

A synthetic registry that matches the synthetic fixtures, so `--demo` has
something for convergence to find. Its `source` field says so, and `doctor`
prints it. It is not a list of real wallets and must not be used as one.

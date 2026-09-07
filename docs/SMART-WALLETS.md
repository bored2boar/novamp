# The proven-wallet registry

The only part of novamp that carries an opinion from one run to the next, so it
gets its own file, its own command, and this document arguing against itself.

## What earns a wallet a place

Outcome, not follower count. A wallet is in the registry if, inside the window it
was built from:

| Bar | Default |
|---|---|
| early entries | 8 or more |
| graduations | 3 or more |
| hit rate | 12 % or better |
| top entry share | 60 % or less |

An "early entry" is a first buy inside two minutes of a launch. A "graduation" is
one of those launches reaching phase 2.

`topEntryShare` is the one that does the real work. It asks what share of a
wallet's success came from its single best launch. Over 60 % and the record is
one lucky ticket wearing a track record's clothes, and copying that wallet copies
a coin flip that already landed.

The bars are deliberately strict. A registry that lets in every wallet with one
graduation turns convergence into noise, and convergence is the only part of
novamp that could ever be called alpha.

## Why the method is weaker than it looks

**The window is too short.** `INDEX_LOOKBACK_BLOCKS` defaults to roughly eleven
hours. A wallet that trades twice a week is invisible, and eleven hours of
launches is not enough history to separate skill from a good afternoon. Build
from the widest window your RPC will tolerate, and rebuild often.

**"Graduated" is not "made money".** A wallet that entered a launch that later
graduated is counted as a hit whether it sold at the top, sold at the bottom, or
is still holding. Measuring realised profit means reconstructing every sell for
every wallet, which is a different and much heavier tool. Until that exists, the
registry measures *being early to things that worked*, which is correlated with
making money and is not the same as it.

**`topEntryShare` uses a weak proxy.** Curve fill stands in for launch size,
because it is the only size signal available for free. It is rough.

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

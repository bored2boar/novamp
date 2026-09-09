# The rules

Everything novamp decides, in one place. If a number in the terminal surprises
you, it came from a line below and from a function you can open.

Nothing here is a model. Every rule is a plain function over a snapshot, which is
why the whole set is unit tested offline and why two people running the same
command on the same window get the same answer.

---

## 1. What counts as the same fight

`src/vamp/normalize.ts`, `src/vamp/cluster.ts`

Nothing on a permissionless launchpad stops anyone reusing a ticker, so most
copies simply reuse it, and catching those is string equality. The rules below
exist for everything that is *nearly* the same, which is most of what an exact
match drops on the floor.

### Two fields, not one

A pons v2 launch carries two strings a copy can borrow, and both are indexed:

| Shape | Example | Caught by |
|---|---|---|
| same ticker | `PEANUT` / `PEANUT` | exact match on the symbol key |
| nearly the same ticker | `PEANUTS`, `PEANUTCOIN`, `PEANUT2` | folding plus the fuzzy join |
| lookalike ticker | `PEANUТ` (Cyrillic Te) | homoglyph folding |
| **same name, new ticker** | `PNUT` named "Peanut the Squirrel" | the name key |

The last row is the one a symbol-only matcher misses entirely, and it is the
shape a copy takes once the obvious ticker is already gone.

Membership is transitive, which is why clustering is union-find rather than a
bucket map: A shares a symbol with B, B shares a name with C, and all three are
one fight.

Names get a higher bar than symbols (4 characters against 3). A symbol is chosen
to be distinctive; a name is prose, and joining every launch called "Dog" into
one cluster helps nobody. A name that folds to the same key as its own symbol is
ignored, because it adds nothing.

### The two keys

| Key | What it folds | Example |
|---|---|---|
| `tight` | invisible characters, combining marks, homoglyphs, case, punctuation | `PEANUТ` (Cyrillic Te) → `peanut` |
| `loose` | everything `tight` does, plus leetspeak, repeated letters, filler words | `PEANUTCOIN` → `peanut` |

Clusters join on `loose`, then merge keys within an edit or two of each other
(`nearEnough`). Keys shorter than four characters get no fuzzy slack at all,
because `PEP` and `POP` are two jokes, not one.

Filler words dropped from the ends: `coin token inu the official real og v2 v3 x
eth sol meme fi dao ai new classic reborn`, and never past three characters of
remaining name.

### On homoglyphs specifically

They are the tail, not the headline. Where they actually appear is against
*automated* filters, not human eyes: scanner blocklists, alert bots, anything
comparing strings exactly. Folding them is a few lines and a lookup table, so
novamp folds them, and the table always says which characters were folded rather
than pretending two rows were identical.

### The trade this makes

Folding is lossy. A token genuinely named `W3B3` will fold onto `webe`, and a
`PEANUT COIN` unrelated to the squirrel will land in the squirrel's cluster.
Every member carries how it joined (`exact`, `tight`, `name`, `loose`) and the
table prints it, so a false join costs a reader one glance. A missed vamp costs
them money. novamp takes the visible cost.

## 2. Who was first

`src/vamp/cluster.ts`

Birth order is `(block, txIndex, logIndex)`, in that order. Not the timestamp:
Robinhood Chain seals a block roughly every 100 ms and two launches in one block
share a timestamp, so the timestamp cannot break the tie that matters most.

## 3. When being first stops meaning anything

`src/vamp/verdict.ts`, `taintOf()`

The first born is called `ORIGINAL` unless **two or more** of these hold:

| Ground | Default line |
|---|---|
| dev buy | over `TAINT_DEV_SHARE_PCT` (10 %) of supply |
| declared bundle | `TAINT_EXEMPT_WALLETS` (4) or more wallets exempt from the opening tax |
| serial deployer | `TAINT_SERIAL_LAUNCHES` (5) or more launches, none graduated |
| concentration | top 10 hold `RISK_HOLDER_RED_PCT` (30 %) or more |
| shared funder | another launch in the same cluster was funded by the same wallet |

Any one of these on its own is common enough to be innocent. Two together is the
pattern.

The shared-funder ground is the heaviest and the hardest to dodge. An operator
can randomise the dev buy down to the wei, shuffle the tax, rewrite the socials
and use a fresh wallet every time. Those wallets still had to be funded, and when
two members of one name fight trace back to one funder, the fight was staged.

## 4. The five labels

| Label | Means |
|---|---|
| `ORIGINAL` | first born, and nothing above holds against it |
| `TAINTED` | first born, but it looks like the operator's own bait |
| `CONTESTED` | not first, but the proven wallets and the flow are here anyway |
| `VAMP` | a later copy with nothing of its own |
| `DEAD` | nothing is trading: no early buyers and a curve that has not moved |

`CONTESTED` only appears when the first born is `TAINTED` **and** the challenger
has something real: convergence, two or more proven wallets, or a score of 65+.
It is the state that costs the most money in this market and the reason the tool
exists.

Cluster level: `SOLO` (one launch), `CLEAN` (a clear original), `CONTESTED`, or
`FARM` (two or more members funded from the same wallet, which outranks
everything else).

## 5. Risk flags

`src/vamp/risk.ts`

| Code | Level | Line |
|---|---|---|
| `top10-concentration` | amber / red | 20 % / 30 % of the float, curve and pool excluded |
| `deployer-holding` | amber / red | deployer holds 10 % / 30 % of supply |
| `declared-bundle` | amber / red | any / 4+ wallets exempt from the opening tax |
| `creator-tax` | amber / red | over 2 % / over 5 % |
| `fees-routed` | amber | creator fees paid to an address that is not the deployer |
| `serial-deployer` | red | 5+ launches in the window, none graduated |
| `hidden-chars` | red | the symbol contains characters that are not what they look like |
| `name-fold` | amber | this member joined the cluster by folding, not by matching |
| `holders-unread` | unknown | the scan did not complete: the number is a floor |

**What gets excluded from concentration and why.** The bonding curve holds the
unsold supply and the Uniswap v4 pool holds the float after graduation. Both are
contracts, both are enormous, and a top-holder table that leaves them in reports
that every launch on the chain is 90 % held by one address. True and useless. The
deployer is kept in, because a deployer sitting on 24 % is exactly what the
number exists to warn you about.

An incomplete holder scan reports `UNKNOWN`, never a comfortable number. A tool
that turns a rate limit into a confident answer is worse than one that says it
could not read.

## 6. The score

`src/vamp/potential.ts`

Starts at 35 and clamps to 0..100. Every point below prints next to the total.

| Signal | Points |
|---|---|
| first launch under this name | +14 |
| second, behind a tainted first born | +8 |
| copy, under 2 minutes behind | -15 |
| copy, over 2 minutes behind | -22 |
| proven wallets converging | +16 |
| 2+ proven wallets, spread out | +10 |
| one proven wallet | +4 |
| no proven wallet | -5 |
| 25+ distinct buyers in the first minute | +10 |
| 10+ distinct buyers | +5 |
| 3 or fewer distinct buyers | -12 |
| every early buy paid the opening tax | -10 |
| 2 ETH or more of early buys | +8 |
| 0.5 ETH or more of early buys | +4 |
| under 0.05 ETH of early buys | -10 |
| top 3 wallets are 70 %+ of the early money | -14 |
| early money spread out, top 3 under 35 % | +6 |
| the deployer sold inside 5 minutes | **-25** |
| the deployer sold later | -12 |
| a sale took 8 %+ of the reserve inside 3 minutes | -14 |
| more quote left the curve than went into it | -12 |
| money going in, nothing coming back out yet | +5 |
| dev buy 1-6 % | +10 |
| dev buy 6-10 % | -4 |
| dev buy over 10 % | -20 |
| no dev buy | -8 |
| 4+ wallets exempt from the opening tax | -18 |
| 1-3 exempt | -6 |
| top 10 over 30 % | -18 |
| top 10 over 20 % | -8 |
| top 10 under 12 % | +6 |
| deployer graduated 30 %+ of launches | +14 |
| fresh deployer | +2 |
| deployer: 5+ launches, none graduated | -22 |
| each social link, capped at 6 | +2 |
| no socials | -12 |
| graduated to the pool | +8 |
| curve 50 %+ filled | +4 |
| curve barely moved | -10 |

Inputs that could not be read score **zero**, not a penalty. "Unread" and "bad"
are different things and the reasons list says which one happened.

### Size, not count

`src/vamp/flow.ts`

`uniqueEarlyBuyers` counts wallets, and wallets are the cheapest thing in this
market. Twenty five addresses spending a dollar each and twenty five spending
five hundred are the same number and a completely different event, so every rule
in the block above is denominated in quote instead.

`top3Share` is the one that does the work. A launch where three wallets are 85 %
of the money is one person with three wallets, however many other addresses
walked past afterwards.

The median ticket is reported rather than the mean, and it is a real ticket
somebody paid rather than the average of two: an average of wei is not a number
anybody was ever charged.

### What came back out

`src/read/sells.ts`, `src/vamp/flow.ts`

Everything on the buy side is arrangeable by the operator. He picks the dev buy,
the exemptions, the socials, and he can fund twenty wallets to walk in behind
him. What he cannot stage is somebody taking money back out.

Three questions, and they are the only signals in novamp that describe what a
launch is *doing* rather than how it was set up:

- **did the deployer sell, and how fast.** Inside five minutes is the heaviest
  single penalty in the file.
- **did one sale take a meaningful bite.** A sale is measured as a share of the
  quote reserve it hit, not in absolute size: half an ETH out of forty is noise,
  half an ETH out of two is the launch ending. Over 8 % counts.
- **is more leaving than arriving.** Quote out over quote in across the window.

**How the reserve is reconstructed.** There is no historical `realQuoteReserve`
to read, so `readSells` replays `CurveBuy` and `CurveSell` in chain order from
the launch and keeps a running balance. It ignores fees skimmed off the curve
and anything that moved outside those two events. It is an approximation, it is
labelled as one in the source, and it is accurate enough for "was that a fifth of
everything or a rounding error", which is the only question asked of it.

**Intent is not inferred.** A deployer taking money out is reported, never
interpreted. He may be paying for a marketing push and he may be leaving. The
rule says what happened and how fast.

### What the score is not

It is not a prediction. Almost every input is visible within two minutes of a
launch, and two minutes of flow tells you nothing about what a coin does in an
hour. The honest reading of a 90 is *"if any launch under this name goes
anywhere, it is probably this one"*, never *"this one goes somewhere"*.

That distinction is the whole difference between this and a signal service, and
it is why novamp has no buy button and no plan to grow one.

## 7. Convergence

`src/smart/convergence.ts`

`CONVERGENCE_MIN_WALLETS` (3) registry wallets whose first buys land inside
`CONVERGENCE_WINDOW_SEC` (90 s) of each other. The tightest qualifying window is
the one reported, not the first one found.

One good wallet buying is a coincidence. Three inside ninety seconds is the
closest thing to a signal that exists here, because those wallets are not talking
to each other through your timeline: they are reading the same thing off the
chain and reacting to it.

Which wallets qualify for the registry is [its own document](SMART-WALLETS.md).

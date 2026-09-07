<p align="center">
  <b>novamp</b><br>
  <i>the token that stole the name is not the token you meant to buy</i>
</p>

<p align="center">
  <img alt="tests" src="https://img.shields.io/badge/tests-98%20passing-9AE66E?style=flat-square&labelColor=0C0F14">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-D9D9D9?style=flat-square&labelColor=0C0F14">
  <img alt="chain" src="https://img.shields.io/badge/Robinhood%20Chain-4663-FFD93B?style=flat-square&labelColor=0C0F14">
  <img alt="runtime deps" src="https://img.shields.io/badge/runtime%20deps-2-D9D9D9?style=flat-square&labelColor=0C0F14">
  <img alt="custody" src="https://img.shields.io/badge/signing-none-FF6B5E?style=flat-square&labelColor=0C0F14">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-FFD93B?style=flat-square&labelColor=0C0F14">
</p>

**A read-only clone resolver for pons v2 launches on Robinhood Chain.**

*Vamping* is copying somebody else's launch: same name, same picture, minutes
later, a wallet that has done it two hundred times before. On a chain sealing a
block every 100 ms with tens of thousands of launches a day, a name that catches
gets copied inside a minute, and most of what retail loses is not lost to the rug
they bought. It is lost to buying number seven while reading number one's
timeline.

novamp answers one question: **out of every token fighting over this name, which
one is real, and does being first still mean anything here?**

> **No key. No signer. No transaction path.** There is no `PRIVATE_KEY` setting in
> this repository and no code that would use one. CI fails the build if a signing
> primitive appears in `src/`.

---

## Sixty seconds

```sh
git clone https://github.com/bored2boar/novamp && cd novamp
npm install
npm run doctor                    # config, fixtures and index, no network
npx novamp vamp NOVA --demo       # a real clone fight, from the bundled fixtures
npx novamp board --demo           # the same thing as a page on 127.0.0.1
```

```
source demo 11 launches from 3 fixture file(s) · SYNTHETIC, not chain data
demo mode fixture data, not a live read of Robinhood Chain

NOVA · key "nova"  FARM
3 launch(es) under this name · 2 copies · first copy 1m 3s after the original

#  SYMBOL  VERDICT    SCORE  RISK       LAG  TOP10    DEV  SMART  BUYERS  TOKEN
─  ──────  ─────────  ─────  ─────  ───────  ─────  ─────  ─────  ──────  ─────────────
3  NOVA    CONTESTED     81  GREEN  +2m 28s    12%   2.8%     4★      11  0x23cab7…0e80
1  NOVA    TAINTED        0  RED      first    48%  14.9%      0       2  0x23c848…c0ed
2  N0VA    DEAD           0  RED     +1m 3s    39%  11.2%      0       0  0x23c913…f755

→ first born is suspect: dev buy 14.90%; 7 wallets exempt from the opening tax;
  deployer has 22 launches and no graduation; top 10 hold 47.5%; 1 other launch
  in this cluster was funded from the same wallet
→ flow is on NOVA (rank 3), not on the first born
→ 2 launches in this cluster were funded from 0x2c88fa10…: one operator, several wallets

why NOVA scores 81:
  -22  copy, 2m behind the first
  +16  4 proven wallets, converging inside 27s
  +5   11 distinct buyers in the first minute
  +10  dev buy 2.80%, inside the 1-6% band
  +6   top 10 hold 11.9%, spread out
  +14  deployer graduated 2 of 4 launches
  +9   3 social link(s)
  +8   graduated to the pool
```

That is the case worth building a tool for. The first launch under the name is
the operator's own bait, the second is his too, and the one people should be
looking at is number three.

---

## What it does

| The problem | What novamp does | Command |
|---|---|---|
| fourteen tokens, one name, sixty seconds | groups every launch fighting over a name, matching on the ticker **and** the token name, with plurals, filler words, leetspeak and lookalike characters folded | `vamp` |
| "is this the real one?" | birth order by `(block, txIndex, logIndex)`, then five labels: ORIGINAL, TAINTED, CONTESTED, VAMP, DEAD | `vamp` |
| first is not always real | a first born loaded with a bundle, a serial deployer, or a wallet funded by the same hand as the copies is called TAINTED, not ORIGINAL | `vamp` |
| you are already in one of them | full breakdown of one token, plus the cluster it turns out to be number six of | `scan` |
| "how concentrated is this?" | top-10 holders with the curve and the pool excluded, green under 20 %, red over 30 % | `vamp`, `scan` |
| who actually knows something | wallets with a real record, and an alert when three of them land inside ninety seconds | `smart`, `vamp` |
| how bad is it out there | vamp ratio and vamp lag for the whole window | `stats` |
| a word is trending | which fights exist under it, from free RSS feeds | `narrative` |
| **you are already holding some of these** | balance-checks your wallet against the index and tells you which positions are copies, with the original beside each one | `wallet` |
| who keeps producing the copies | deployers ranked by copies shipped, names touched, and how many other wallets share their funder | `farms` |
| a terminal is the wrong shape for this | the same engine behind a page on 127.0.0.1, with filters and sorting | `board` |
| tell me when somebody copies my bag | watchlist plus Telegram, fired on a new live copy or a cluster flipping to CONTESTED | `watchlist` |
| "your scoring is wrong" | CSV with every reason and flag, so you can re-run it against your own weights | `--csv` |
| how far back can I actually look | a local append-only index that grows as you use the tool | `index`, `--since` |

Full list in [docs/COMMANDS.md](docs/COMMANDS.md).

### What counts as the same fight

Nothing stops anyone reusing a ticker, so most copies simply reuse it, and
catching those is string equality. That is not where a matcher earns its keep.
It earns it on everything that is *nearly* the same, which is most of what an
exact match drops on the floor.

A launch carries two strings a copy can borrow, and novamp indexes both:

```
#  SYMBOL      joined by
1  PEANUT      first born, name "Peanut the Squirrel"
2  PEANUТ      folded: the last character is Cyrillic Te, not T
3  PEAN0T      folded: leetspeak, then one edit away
4  PEANUTCOIN  folded: filler word stripped
6  PNUT        different symbol, same token name
7  PEANUTS     folded: plural
```

`PNUT` is the row that matters most in practice. Once the obvious ticker is
taken, a copy takes a different one and keeps the name, and a symbol-only
matcher never sees the fight at all. Membership is transitive: A shares a symbol
with B, B shares a name with C, all three are one cluster.

The lookalike-character case is real but it is the tail, not the headline. It
shows up where a copy is trying to beat *automated* filters — scanner
blocklists, alert bots, anything doing an exact string compare — rather than a
human eye. novamp folds Cyrillic, Greek, fullwidth forms, zero-width joiners,
accents and leetspeak because it is cheap to fold them, and every join is
labelled in the table so you can see when it happened.

### The one you run on yourself

```
novamp wallet 0xYOURS --since 7d
```

```
0xdeadBEEF…dDeEfF  2 of your 4 position(s) are copies  · checked 11 launches · window 7d

YOU HOLD  VERDICT   RANK     LAG  SCORE  RISK   THE ONE YOU MEANT
PEANUТ    VAMP      #2/7    +41s      0  RED    → PEANUT 0xa0c54f…f6b5
PNUT      VAMP      #6/7  +7m 1s      0  RED    → PEANUT 0xa0c54f…f6b5
NOVA      TAINTED   #1/3   first      0  RED    -
KETTLE    ORIGINAL  #1/1   first     75  GREEN  -
```

Copies first, because the reason you ran it is the bad news. It reads; it cannot
sell anything for you.

### About `--since`

A block on this chain seals every 100 ms, so thirty days is around **26 million
blocks** and no public RPC will sweep that. Any tool offering a 30 day filter
straight off an endpoint is either paying an indexer or lying.

novamp does neither. Every live run appends what it read to plain append-only
files under `.novamp/`, and `--since 6h|24h|7d|30d|all` is answered from the
accumulation. Day one gives you hours; a month of running gives you a month. When
the window you asked for is wider than the index covers, the command says how far
short it fell instead of quietly returning less:

```
! the local index only goes back 3d, 4d short of the 7d you asked for.
  Keep running novamp and the window fills in.
```

`novamp index` shows yours. [docs/INDEX.md](docs/INDEX.md) has the rest.

---

## Install

Node 20 or newer. Two runtime dependencies: `viem` and `commander`.

```sh
git clone https://github.com/bored2boar/novamp && cd novamp
npm install
cp .env.example .env      # only needed for live reads
npm run doctor
```

Everything works with `--demo` and no `.env` at all. For live reads, point
`RPC_URL` at an endpoint you trust. The public Robinhood RPC works and rate limits
log reads hard; a private provider makes `scan` and `stats` comfortable.

---

## What works today, and what does not

This is v0.1. Being straight about the line is more useful than pretending there
isn't one.

**Proven.** Name folding, clustering on both the ticker and the token name, birth
order, the taint check, the five labels, risk flags, the score, convergence, the
operator ranking, the local index, the CSV export and the watchlist rules. All of it is exercised end to end
by `--demo`, which drives exactly the same code the live path drives, and all of
it is covered by 98 offline tests.

**Written, not yet proven.** The chain readers in `src/read/`. They are written
against the documented pons v2 ABI and typecheck, but they have not been run
against mainnet by the author, because the machine this was written on cannot
reach the endpoint. If your first live run throws, that is a bug worth an issue.

**Known gaps.** Exempt wallets are not recovered from launch calldata yet, so a
live run underestimates bundles. Funding traces are bounded and often
inconclusive. A wide `--since` is only as deep as your local index.

All of it, in detail and without softening: [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

---

## The score is the weakest part, and here is why

Every input the score reads is visible in the first two minutes of a launch:
birth order, dev buy, exemptions, concentration, who bought and how fast. Two
minutes of flow does not tell you what a coin does in an hour.

So the honest reading of a 90 is **"if any launch under this name goes anywhere,
it is probably this one"**, and never "this one goes somewhere". novamp orders a
cluster. It does not predict a price, it has no buy button, and it is not going
to grow one.

What would make the number worth more is sell-side flow, and what would make it
trustworthy is testing every rule against what the chain actually did to each
launch afterwards. Both are on the [roadmap](ROADMAP.md), and until that test
exists this paragraph stays here rather than quietly disappearing.

Every rule, with its points: [docs/RULES.md](docs/RULES.md).

---

## Layout

```
src/
├── chain/      constants, ABI slice, the RPC gate
├── read/       five readers: launches, holders, buyers, funding, wallet
├── source/     live chain or fixture file, one interface
├── store/      the local append-only index that makes --since real
├── vamp/       confusables → normalize → cluster → risk → potential → verdict → farms
├── smart/      the proven-wallet registry and convergence
├── narrative/  free RSS in, keywords out
├── alerts/     watchlist and one outbound POST to Telegram
├── export/     CSV, written by hand rather than pulled from npm
├── board/      node:http on 127.0.0.1 and one HTML file
├── ui/         table and render
└── commands/   thin wiring
fixtures/       what --demo reads, with an honest origin field
docs/           rules, limitations, architecture, commands, wallets, index, fixtures
test/           98 offline tests over the rules
```

One rule shapes the whole tree: **nothing that makes a decision touches the
network.** Reading is one layer, deciding is another, and they meet at a plain
object. That is why `--demo` is a real exercise of the tool rather than a mock of
its output. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Never

- no signer, no key setting, no write path, not for convenience and not behind a flag
- no hosted service holding anything of yours
- no paid alpha channel, because a sharper private version means the public rules are worse on purpose
- no promise of returns, on the tool or on anything else
- no closed core: if a future page computes something this repository cannot, the repository is decoration
- no licence change

---

## Contributing

The most useful thing you can send is a launch novamp got wrong: a captured
fixture plus one sentence about what the table should have said. See
[docs/FIXTURES.md](docs/FIXTURES.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

Second most useful: a glyph the confusables table misses. That is a one line fix
in `src/vamp/confusables.ts` and a test in `test/normalize.test.ts`.

MIT. Runs on your machine, not anyone else's.

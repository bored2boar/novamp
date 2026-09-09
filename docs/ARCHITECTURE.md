# Architecture

One rule shapes the whole tree: **nothing that makes a decision is allowed to
touch the network.**

Reading is one layer, deciding is another, and they meet at a plain object. That
is why `--demo` is a real exercise of the tool rather than a mock of its output,
and why every rule in the thing has an offline unit test.

```
                 ┌──────────────────┐         ┌──────────────────┐
   chain ───────▶│  src/read/*      │         │  fixtures/*.json │
                 │  logs, balances  │         │  demo mode       │
                 └────────┬─────────┘         └────────┬─────────┘
                          │                            │
                          ▼                            ▼
                        ┌──────────────────────────────────┐
                        │        LaunchRecord[]            │  src/types.ts
                        └────────────────┬─────────────────┘
                                         │   no network below this line
                     ┌───────────────────┼───────────────────┐
                     ▼                   ▼                   ▼
            ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
            │ vamp/normalize │  │ smart/registry │  │ vamp/risk      │
            │ vamp/cluster   │  │ smart/converge │  │                │
            └───────┬────────┘  └───────┬────────┘  └───────┬────────┘
                    └──────────┬────────┴───────────────────┘
                               ▼
                     ┌──────────────────┐
                     │  vamp/verdict    │  labels, relative to the first born
                     │  vamp/potential  │  the 0-100 and its reasons
                     └────────┬─────────┘
                              ▼
                     ┌──────────────────┐
                     │  ui/render       │  the table you actually read
                     └──────────────────┘
```

## The layers

### `src/chain/`

Constants and the RPC gate. `config.ts` holds the chain id, the factory address
and the block time, kept away from transport code so they can be checked at a
glance. `abi/pons.ts` is the slice of pons v2 novamp reads, and it contains no
`buy`, no `sell`, no `claim` and no `approve`.

`gate.ts` is one queue in front of the endpoint: a small in-flight cap, a minimum
spacing between calls, a wider spacing for `eth_getLogs`, and a retry that only
fires on the errors a busy endpoint actually throws. Firing a cluster's worth of
log reads at a public RPC in parallel gets you a 429 and half a table.

### `src/read/`

Four readers, each answering one question, each of which can fail without taking
the others down.

| File | Question | Cost |
|---|---|---|
| `launches.ts` | what launched in this window, and what is it called | one log sweep plus a few reads per launch |
| `holders.ts` | who holds it, and how concentrated | heavy: a log sweep plus one balance read per address |
| `buyers.ts` | who bought early, how fast, what tax did they pay | medium |
| `sells.ts` | what came back out, and how big against the reserve it hit | medium |
| `funding.ts` | where did this deployer's first ETH come from | heavy and often inconclusive |

The split matters because of how the commands use it. `recent()` runs only the
cheap reader over the whole window. `deepen()` runs the expensive three over the
handful of launches in the cluster the user actually asked about. Doing it the
other way round turns a two second answer into a rate limited four minute one.

### `src/source/`

`LaunchSource` is the seam. `live.ts` reads the chain, `demo.ts` replays a
fixture file, and everything above cannot tell the difference. The demo banner
prints the `origin` field of the fixtures verbatim so a synthetic set never
passes itself off as a capture.

### `src/vamp/`

The decisions, in dependency order:

- `confusables.ts` - the table of characters that look like other characters
- `normalize.ts` - name to key, plus a capped Damerau-Levenshtein
- `flow.ts` - early money by size rather than by wallet count, and what the sell
  side did. Pure arithmetic over event lists
- `cluster.ts` - launches to clusters, union-find over both the ticker and the
  token name, with the join method recorded per member
- `risk.ts` - holder concentration and the flags
- `potential.ts` - the 0-100 and its reasons
- `verdict.ts` - the labels, which only exist relative to the first born

`verdict.ts` runs two passes for a reason: `CONTESTED` is not a property of a
launch, it is a property of a launch *given* that the first born is bait. You
cannot assign it in the same loop that assesses each member alone.

### `src/store/`

The local index: append-only JSONL under `.novamp/`, one file per UTC day. It is
what makes `--since 30d` an honest offer rather than a marketing line, since no
public RPC will sweep a month of a 100 ms chain. Deliberately not a database, for
the reason below. See [INDEX.md](INDEX.md).

### `src/export/`

CSV, written by hand rather than pulled from npm, because RFC 4180 quoting is
fifteen lines and a dependency is a supply chain. The exports carry the reasons
and flags, not only the numbers.

### `src/alerts/`

The watchlist and one POST to Telegram. This is the only outbound call in novamp
that is not a chain read, and it is one-way by construction: no webhook, no
command handler, nothing that could ask novamp to act.

### `src/board/`

A `node:http` server on `127.0.0.1` and one HTML file with no build step and no
dependencies. Serves the page and one read-only JSON endpoint; the data is
rebuilt per request rather than cached, because the honest failure mode of a
board is showing a stale table without saying so.

### `src/smart/`

The registry is the only thing in novamp that carries an opinion from one run to
the next, so it lives in a file you can read and delete lines from rather than
inside the scoring. `convergence.ts` is a sliding window over matched buyers and
nothing else.

### `src/ui/` and `src/commands/`

`table.ts` is ANSI-aware column alignment. `render.ts` decides what goes on
screen: the answer first, the reason on the same line, the rest behind `--all`.
Commands are thin; they wire a source to a decision to a renderer.

## Why there is no database

State would have to be invalidated, migrated and explained. The chain already has
the state; a fixture file already has the demo. What novamp would gain from a
database is caching, and what it would cost is the property that any two people
running the same command over the same window get the same answer.

## Why the model is nowhere in this diagram

There isn't one. Every verdict comes out of a function you can open, and the same
inputs produce the same output every time. That is a requirement rather than a
preference: a clone resolver whose answers drift is not a clone resolver.

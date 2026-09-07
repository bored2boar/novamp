# The local index, and why `--since 30d` is honest

A block on Robinhood Chain seals about every 100 ms. Thirty days is therefore
roughly **26 million blocks**, and no public endpoint will serve `eth_getLogs`
over that range. Any tool offering a 30 day filter straight off an RPC is either
paying an indexer or lying to you.

novamp does neither. Every live run appends what it read to plain files under
`.novamp/`, and `--since` is answered from the accumulation. Day one gives you
hours. A month of running gives you a month.

```
.novamp/
├── launches/
│   ├── 2026-09-05.jsonl      one line per launch, append only
│   ├── 2026-09-06.jsonl
│   └── 2026-09-07.jsonl
└── watchlist.json            names you are watching, and what has been sent
```

## What it is not

- not a database: no schema, no migrations, no lock, nothing to explain to
  somebody who just cloned the repository
- not a cache of derived values: it stores what was read, never what was
  concluded, so changing a rule never invalidates it
- not shared: it never leaves your machine and nothing is sent anywhere

Deleting `.novamp/` is a supported operation. It costs you the history and
nothing else.

## The rules it follows

**Append only.** A crash mid-write costs one truncated line, not the index.

**Write once per token.** A launch already on disk is not appended again.

**A fresh read wins.** When the same token is in both the index and the current
read, the current read is used. The index remembers what a launch *was*; the
chain says what it *is*.

**A corrupt line is skipped, never fatal.** `novamp index` counts them so you can
see it happened.

**Demo runs never write.** Replaying fixtures into a real local history would
poison every window that came after it, so `--demo` is read only against the
index as well as against the chain.

## When the window is wider than the index

The command says so, in as many words, and answers with what exists:

```
! the local index only goes back 3d, 4d short of the 7d you asked for.
  Keep running novamp and the window fills in.
```

That warning is the reason the index exists in this shape. A filter that
silently returns three days when you asked for thirty is how a tool ends up
producing confident, wrong statistics, and `stats` and `farms` are exactly the
commands somebody would screenshot.

## Checking yours

```sh
novamp index
```

```
local index

directory             ~/novamp/.novamp
day files             4
launches              12841
on disk               31.4 MB
oldest launch         2026-09-04 08:11:02
newest launch         2026-09-07 19:44:50
window available      3d
```

## Filling it faster

The index grows by whatever your commands happen to read. To deepen it on
purpose, run something cheap on a schedule:

```sh
# a cron line: sweep the window every fifteen minutes and remember it
*/15 * * * * cd ~/novamp && npx novamp stats --quiet >/dev/null 2>&1
```

Each sweep costs one `eth_getLogs` pass over `INDEX_LOOKBACK_BLOCKS`, so keep
that setting modest if you are on a public RPC and let time do the rest.

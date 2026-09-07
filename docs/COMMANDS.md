# Commands

Every command takes `--demo` to read the bundled fixtures instead of the chain,
and `-q` to keep progress lines off stderr. None of them need a key, because
novamp has no key setting and no write path.

Most also take `--since <window>`: `6h`, `24h`, `7d`, `30d`, `2w`, or `all`. That
window is answered from the local index, which grows as you use the tool. Read
[INDEX.md](INDEX.md) before trusting a wide one, and run `novamp index` to see
how far back yours actually goes.

---

## `novamp doctor [--probe]`

Config, fixtures and registry. With `--probe` it also touches the network: chain
id, head block, and the live pons parameters from the factory.

Run this first, always. A wrong factory address produces empty output that looks
exactly like "nothing launched", and that confusion costs more time than every
real bug in a tool like this.

```
novamp doctor
novamp doctor --probe
```

---

## `novamp vamp <name> [--all] [--shallow] [--json]`

The command the tool exists for. Takes a ticker, a token name or a narrative
word, and resolves the fight over it.

```
novamp vamp PEANUT --demo
novamp vamp PEANUT --demo --all
novamp vamp "peanut the squirrel"
```

| Flag | Does |
|---|---|
| `--all` | full breakdown of every member, not just the headline |
| `--shallow` | skip holders, buyers and funding: seconds instead of minutes, and the score says which inputs were unread |
| `--json` | the whole `Cluster` object, for piping |

The table is sorted by usefulness rather than by birth order: `ORIGINAL` or
`CONTESTED` first, then score. The `#` column keeps the birth order visible.

Columns: rank, symbol, verdict, score, risk, lag behind the first born, top-10
concentration, dev share, proven wallets (a `★` means they converged), distinct
early buyers, token address.

---

## `novamp scan <token> [--json]`

One launch, in full, plus the cluster it belongs to whether or not you knew there
was one. Most of the value is in that last part: people scan a token they are
already holding and find out it is number six.

```
novamp scan 0xa0c54f... --demo
```

---

## `novamp watch`

The live feed, filtered for the only thing novamp cares about. A launch that
starts its own cluster gets one quiet grey line. A launch that lands inside an
existing cluster gets the loud one, with its rank and how far behind it is.

```
novamp watch --demo      # replays the fixtures in birth order
novamp watch             # polls the chain
```

---

## `novamp stats [--top n] [--json]`

Two numbers about the chain rather than about one token.

- **vamp ratio** - copies per distinct name in the window
- **vamp lag** - how long an original gets before the first copy lands

Both are interesting mostly as a series. A ratio of 8 means little on its own; a
ratio that went from 3 to 8 over a month means the farms found this chain.

```
novamp stats --demo
novamp stats --json > $(date +%F).json
```

---

## `novamp narrative [--limit n] [--json]`

Reads the RSS feeds in `NARRATIVE_FEEDS`, pulls the nouns out of the headlines,
and checks each one against the launch index.

This is not a news sniper, and the command says so in its own output. By the time
an RSS item is public, a farm has already deployed under that word several times.
What a feed is good for is telling novamp **which fight to look at**: the news
says a word is hot, novamp says which of the eleven tokens carrying it was first
and where the money went. That question is still open when the news breaks, and
it stays open for hours.

Free feeds only. novamp ships no API keys and asks for none.

---

## `novamp smart list [--all]` / `novamp smart build`

The proven-wallet registry: read it, or rebuild it from your own window.

`list` shows entries, graduations, hit rate, median entry lag and top-entry share
for each wallet, and marks which ones clear the bar. `--all` includes the ones
that do not.

`build` is slow and wants a good RPC: it reads early buyers for every launch in
the window. See [SMART-WALLETS.md](SMART-WALLETS.md) before trusting the output.

```
novamp smart list
novamp smart build --min-entries 6
```

---

## `novamp wallet <address> [--since w] [--json]`

How many of your own positions turned out to be copies.

```
0xdeadBEEF…dDeEfF  2 of your 4 position(s) are copies  · checked 11 launches · window 7d

YOU HOLD  VERDICT   RANK     LAG  SCORE  RISK   THE ONE YOU MEANT
PEANUТ    VAMP      #2/7    +41s      0  RED    → PEANUT 0xa0c54f…f6b5
PNUT      VAMP      #6/7  +7m 1s      0  RED    → PEANUT 0xa0c54f…f6b5
NOVA      TAINTED   #1/3   first      0  RED    -
KETTLE    ORIGINAL  #1/1   first     75  GREEN  -
```

Copies are listed first, because the reason to run this is the bad news.

There is no `eth_getTokenBalances` on a standard JSON-RPC, so positions are found
by balance-checking the launches novamp already knows about. That means the
answer is bounded by the index rather than by the wallet: a position in a launch
older than the window is invisible, and the command says so every time rather
than implying the list is complete.

It reads. It cannot sell anything for you.

---

## `novamp farms [--top n] [--min-copies n] [--csv path] [--json]`

Who is producing the copies. The index turned around: instead of one name and
its members, every deployer and how many times it showed up on the wrong side of
one.

```
DEPLOYER     COPIES  NAMES  ORIGINALS  GRADUATED  MEDIAN LAG  SIBLING WALLETS
0xd138…4953      41     29          0          0         38s    3 same funder
```

The columns are counts, not accusations. A deployer with forty copies and no
graduations speaks for itself; one with four might just like the same joke.
`sibling wallets` is how many *other* deployers in the window were funded from
the same address, which is the closest novamp gets to naming an operation rather
than a wallet.

---

## `novamp board [--port n] [--since w]`

The same engine behind a page on `127.0.0.1`, with filters, sorting and a
twenty second refresh.

A terminal is the wrong shape for fourteen near-identical tickers stacked on top
of each other; the whole point is comparing rows at a glance. Everything the CLI
prints is there, plus a search box and a "contested and farms only" filter.

Local only, and that is not a limitation to be lifted later: it binds
`127.0.0.1` rather than `0.0.0.0`, serves one HTML file and one read-only JSON
endpoint, and stores nothing.

---

## `novamp index [--json]`

What the local index remembers and how far back it goes. Run it before trusting a
wide `--since`. See [INDEX.md](INDEX.md).

---

## `novamp watchlist add|remove|list|run`

Names to be told about when somebody copies them.

```sh
novamp watchlist add PEANUT --note "holding this"
novamp watchlist run --every 60          # a loop
novamp watchlist run --once              # a cron line
```

Two things fire an alert:

- **a new live copy** landed under a name you are watching (a dead copy does not
  wake you)
- **the cluster flipped to CONTESTED**, meaning the first launch stopped looking
  like the original and the flow moved somewhere else

Alerts go to the terminal always, and to Telegram when `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID` are set. Deduplication is remembered on disk, so a poll loop
does not repeat itself.

The Telegram side is one POST with a text string. There is no webhook, no command
handler, and nothing on the other end that could ask novamp to do anything. When
your laptop is shut, nothing is watching: that is the honest trade for a tool
that holds nothing of yours.

---

## Exports

`vamp --csv <path>` writes the cluster with every reason and flag included.
`farms --csv <path>` writes the full operator ranking.

The reasons are in the file on purpose. The useful response to novamp's scoring
is not agreement, it is somebody re-running the same rows against their own
weights and telling me which of mine are wrong, and a row without its reasoning
is just a number again.

# `novamp swarm`

Catching a name in the minutes between "this does not exist" and "there are
eleven of these and one of them is real".

```sh
novamp swarm --demo                  # the whole flow, on the bundled fixtures
novamp swarm --watch                 # live, telling you when a name catches fire
novamp swarm --watch --min-score 85  # louder bar, fewer alerts
```

## The shape of the thing it is looking for

A clone war has a signature in time. For hours a name does not exist. Then in the
space of a few minutes, eight, twelve, forty launches appear carrying it, from
wallets that have never touched each other.

Nobody coordinates that. It is what a crowd looks like when it reads the same
sentence at the same time - and it is observable *before* anyone knows which of
the launches is going to be the one that runs. novamp cannot predict that, and
neither can anything else. What it can do is notice the burst inside a block or
two of it starting, and answer the question the burst actually raises, which is
not "will this pump" but **"eleven of these are copies, which one is not"**.

That question has an answer, it is answerable from public data, and it stays open
for hours after the news is public. It is the only question here worth building
around.

## The four steps

Printed in this order every time, so it can be checked line by line.

### 1. The burst

Launches are clustered by the existing engine - symbol and name, homoglyphs
folded, transitively - and a cluster counts as a swarm when it holds
**`--min-cluster` launches inside `--window` seconds from `--min-deployers`
distinct deployers**. Defaults: 5, 600, 3.

The deployer bar is the one doing the real work. A farm with ten wallets
launching the same ticker in four minutes is not news, it is one hand, and the
funding trace usually proves it. A crowd is unrelated hands. Without that bar
this command would spend all day reporting farms.

Two sets come out of this step and they are not the same:

- the **burst** is the evidence - the tight run of launches that says a crowd is
  reacting to something
- the **contenders** are the field - the burst *plus every member of the cluster
  that launched before it*

The launch the crowd is copying is very often a few minutes ahead of the burst
rather than inside it, because somebody has to go first before there is anything
to copy. Ranking the burst alone would systematically throw away the one launch
the command exists to find. (It did, for exactly one run, during development.)

### 2. The cause

novamp reads the headlines it can see and asks whether one of them carries a word
these launches are named after. A match requires three things:

1. the headline carries the word, exactly or within an edit or two
2. the headline has a **timestamp** - an undated item proves nothing about order
   and is dropped rather than assumed fresh
3. the headline landed **before** the first launch, inside `--news-lookback`
   (an hour by default)

Point three is the one every "news bot" skips. There is a small grace period on
the wrong side - a wire item stamped ninety seconds after the first launch is
still probably the cause, because the farms watch faster sources than an RSS poll
- and a match that needed the grace is printed as `AFTER the first launch` rather
than being quietly counted as clean.

No headline is not a failure. It prints as `no headline in the window carries
this name`, which is real information: it means this is a farm, or a meme whose
source novamp cannot see.

**A headline before a burst is a coincidence in time, not a cause.** novamp
checks the order, which is more than most tools do, and the order is still not
causation.

#### Where headlines come from

Two sources, both free, neither requiring a key:

```ini
# .env
NEWS_CHANNELS=somefeed,anotherfeed        # public Telegram channels
NARRATIVE_FEEDS=https://…/rss,https://…   # RSS or Atom
```

Every public Telegram channel has a web preview at `https://t.me/s/<name>`. It is
plain HTML carrying message text and timestamps. novamp reads that page. It does
not join the channel, does not use the bot API, holds no token or API id, reads
one page of recent messages with no history walk, and never follows a link out of
a message.

Aggregator channels are unattributed, occasionally wrong, and **first**. RSS is
correct, attributed, and twenty minutes late by the standards of a chain that
seals a block every 100 ms. For the one question novamp asks a news source, first
is the property that matters, so channels are read first. Use both.

### 3. The resolution

The existing engine, unchanged: cluster, verdict, risk, score. The full cluster
is judged for context - a copy that landed yesterday still counts against the
first born's taint check - and then the contenders are ranked.

The selection rule, in order:

1. **Anything the verdict layer called VAMP or DEAD is out.** Not ranked lower,
   out. A copy is not a worse version of the original, it is a different thing,
   and letting a high-scoring copy win on points is how a resolver turns into the
   exact mistake it exists to prevent.
2. Of what is left, highest score wins.
3. Ties break on converged proven wallets, then early buyers, then birth order.
   Birth order last, because being first is already worth points and counting it
   twice would just be counting it twice.

Then the gates, which are separate on purpose. Winning the cluster is a
comparison; clearing the bar is an absolute. The best token in a bad cluster is
still a bad token, and a resolver that cannot say **no pick** is not telling you
anything.

| gate | default | flag |
| --- | --- | --- |
| score at or above | 70 | `--min-score` |
| risk not RED, and measurable at all | on | `--allow-red` |
| the pick shares no funder with the rest of the cluster | on | `--allow-farm` |

That last one is narrower than it sounds, deliberately. It is **not** "refuse
anything in a FARM cluster": almost every burst worth looking at contains
farm-launched copies, because a farm is precisely what shows up to copy a hot
name. The question is whether the *pick* is one of them, which is a question
about one deployer's funding.

When nothing clears the bars, novamp prints `NO PICK`, the reasons, and the near
miss. That is a normal outcome and it is most of them.

### 4. The hand-off

The finding goes to your terminal, to Telegram when `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID` are set, and to your own program when you passed `--exec`.

novamp signs nothing at any point in this command or any file it imports, and the
`no-signer` CI job proves it on every commit. `--exec` runs a program you wrote
and hands it the finding on stdin; what it does is yours. See
[EXEC.md](EXEC.md), which is the file to read before wiring anything up.

## Every flag

| flag | default | what it does |
| --- | --- | --- |
| `--demo` | | fixtures, including synthetic headlines |
| `--since <window>` | index window | how far back to consider launches |
| `--watch` | off | keep watching instead of answering once |
| `--every <sec>` | 60 | poll interval when watching, minimum 30 |
| `--min-cluster <n>` | 5 | launches before it counts as a swarm |
| `--window <sec>` | 600 | how tight the burst has to be |
| `--min-deployers <n>` | 3 | distinct hands required |
| `--no-news` | | skip the headline check, report bursts alone |
| `--news-lookback <sec>` | 3600 | how far back a headline still counts |
| `--min-score <n>` | 70 | below this, no winner is named |
| `--allow-red` | off | do not refuse a RED-risk pick |
| `--allow-farm` | off | do not refuse a pick with a shared funder |
| `--top <n>` | 5 | swarms reported per pass |
| `--exec <path>` | | hand the finding to your program: see EXEC.md |
| `--exec-dry-run` | | print the payload, run nothing |
| `--exec-timeout <ms>` | 20000 | before your program is killed |
| `--json` | | machine readable |

All of the thresholds also have `.env` equivalents: `SWARM_MIN_MEMBERS`,
`SWARM_WINDOW_SEC`, `SWARM_MIN_DEPLOYERS`, `SWARM_MIN_SCORE`,
`SWARM_NEWS_LOOKBACK_SEC`.

## What it will not tell you

It will not tell you a token is going to go up. The score orders a cluster; it
does not predict a price, and a swarm with a headline behind it can go to zero in
four minutes like anything else here.

It will not see a burst wider than your local index. `--since` is bounded by what
`.novamp/` has accumulated - see [INDEX.md](INDEX.md) - so a swarm that started
before your first run of the day is a swarm novamp saw the tail of.

It will not catch the launch before the crowd. Nothing will. By the time an item
is public, the farms deployed under that word several seconds ago, and anyone
selling you "buy before the crowd hears" is selling you a race you lost before
you entered. What is still open when the news breaks - and stays open for hours -
is which of the eleven is real. That is the whole product.

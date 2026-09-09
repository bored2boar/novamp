# The hand-off

novamp decides. It does not execute.

That is not a feature that has not been built yet. It is the shape of the tool,
and the `no-signer` job in CI fails the build on every commit if a signing
primitive appears anywhere in `src/`, `bin/`, `scripts/` or `examples/`. There is
no key setting, no wallet, no transaction path, and no plan to add one.

`novamp swarm --exec` is how execution happens anyway, without any of that
changing: when a swarm clears the bars, novamp runs a program **you** wrote and
gives it the finding on stdin. What that program does is yours. It is your file,
on your disk, holding your key, outside this repository and outside every
guarantee this repository makes.

## Why it is split this way

A resolver you can read, audit and clone, and a program holding your private key,
are two things that should not be the same process.

Keeping them apart buys three specific things:

**The tool can be trusted by someone who will never trust it with money.** Every
claim novamp makes about itself is checkable by reading it, and none of those
claims are "and it will not spend your funds", because it has no way to.

**A bug in the decision cannot become a loss on its own.** The worst novamp can
do by itself is be wrong on your screen.

**Your rules stay yours.** Position size, daily caps, what you do when two
findings land four seconds apart, which chain and which router - those are
decisions about your money, and they belong in a file you wrote and can read in
one sitting, not in a flag on somebody else's tool.

## The contract

One JSON object on stdin. Nothing in argv, ever. Exit 0 means handled.

```json
{
  "schema": "novamp.swarm.v1",
  "at": "2026-09-05T14:12:00.000Z",
  "swarm": {
    "key": "peanut",
    "label": "PEANUT",
    "members": 6,
    "deployers": 6,
    "startedAt": 1788617520,
    "perMinute": 0.9
  },
  "news": {
    "headline": "Peanut the Squirrel seized by state wildlife officials",
    "source": "t.me/fastwire",
    "publishedAt": 1788615180,
    "leadSec": 2340
  },
  "pick": {
    "token": "0xa0c54ffbe2ea6f151468fd40d4281d807fc2f6b5",
    "symbol": "PEANUT",
    "name": "Peanut the Squirrel",
    "verdict": "ORIGINAL",
    "score": 96,
    "risk": "GREEN",
    "rank": 1,
    "clusterSize": 6,
    "reasons": ["+16 4 proven wallets, converging inside 24s", "..."]
  },
  "avoid": [
    { "token": "0x1c88…", "symbol": "PEANUТ", "verdict": "VAMP", "score": 0 }
  ]
}
```

`news` is `null` when no headline in the window carried the name. `leadSec` is
negative when the headline is stamped *after* the first launch, which means it
cannot be the cause of it; novamp keeps such a match but labels it, and your
executor should probably refuse it.

`schema` is versioned so an old executor can refuse a payload it does not
understand rather than misreading a field. Check it.

### The rules novamp enforces before your program runs

Your executor never sees a finding that failed any of these:

| gate | default | flag |
| --- | --- | --- |
| the pick is ORIGINAL or CONTESTED, never a copy | always | - |
| score at or above the bar | 70 | `--min-score` |
| risk is not RED, and is not unmeasurable | on | `--allow-red` |
| the pick's deployer shares no funder with the rest of the cluster | on | `--allow-farm` |
| the burst is real: enough launches, tight enough, from enough distinct hands | 5 / 10m / 3 | `--min-cluster`, `--window`, `--min-deployers` |

Your bars come on top of these. They do not replace them.

### How the process is run

- **stdin, never argv.** A token name is whatever its deployer typed, which makes
  it attacker-controlled input, and argv is exactly where a hostile string goes
  looking for a shell.
- **no shell.** `spawn` with `shell: false`. There is no interpreter between
  novamp and the file you named, so `; rm -rf ~` in a token name is a token name.
- **the file must already exist and be executable.** novamp will not create it,
  chmod it, or fall back to a shell. It checks this at startup, not at fire time,
  because the two minutes a burst is live is the worst moment to find out the
  path was wrong.
- **one process per finding, with a timeout**, 20 seconds by default
  (`--exec-timeout`), then SIGKILL.
- **no retries.** A non-zero exit is printed and dropped. A retry loop around
  something that spends money is how one bad minute becomes four.
- **no secrets are passed down.** Your executor inherits the environment it was
  started in and novamp adds nothing to it. It has no secret to give you and does
  not invent an interface for one.
- **findings are deduplicated** by swarm and pick within a run, so a `--watch`
  loop polling every sixty seconds does not fire on the same burst repeatedly.

## Try it without writing anything

```sh
novamp swarm --demo --exec-dry-run
```

prints the exact payload and runs nothing. Then:

```sh
chmod +x examples/executor-template.sh
novamp swarm --demo --exec examples/executor-template.sh
```

`examples/executor-template.sh` reads the payload, applies a couple of extra bars
of its own, and prints what it would do. It buys nothing, and it is scanned by
the same CI job as the rest of the tree, so it will stay that way.

## Before you wire up a real one

Read this part twice. It is the part that costs money.

**The live path has not been run against mainnet by the author.** See
[LIMITATIONS.md](LIMITATIONS.md), first section. `--demo` is proven end to end;
`--live` is written and typechecked. Automating on top of a reader that has never
met the chain it reads is a bad idea until you have watched it run without
`--exec` for long enough to believe its output.

**Exempt wallets read as zero on the live path.** That signal is one of the
strongest in the scoring and the live reader does not have it yet. Live scores are
therefore optimistic about bundles. Set `--min-score` higher than you think you
need to.

**A headline before a burst is a coincidence in time.** novamp checks the order,
which is more than most things that call themselves news bots do, and the order
is still not causation. Two unrelated stories in an hour is normal.

**The score orders a cluster. It does not predict a price.** A 96 means "this is
the one that is not a copy", not "this will go up". Nothing in novamp forecasts
anything, and if your executor's sizing logic reads the score as confidence about
returns, that is your logic doing it, not the tool.

Then, when you write the thing:

1. **Cap the size** - per trade and per day, enforced in a file the script reads
   and writes, not in your head.
2. **Log every call with its payload**, before the transaction, to a file you can
   read tomorrow morning.
3. **Use a hot wallet holding only what you are prepared to lose entirely.** It
   runs unattended.
4. **Test the failure cases first**: a token that does not exist, an RPC that
   times out, two findings four seconds apart. All three happen in the first week.

And the honest recommendation, which is the same one the README gives: run
`novamp swarm --watch` without `--exec` for a while first. Read the alerts. See
how often it is right before you let it act. The alert is the product; the pipe
is a convenience, and it is the half where the money is.

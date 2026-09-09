#!/usr/bin/env bash
#
# A template for the program `novamp swarm --exec` hands its finding to.
#
# This file does NOT buy anything. It reads the payload, applies its own bars,
# and prints what it would do. That is deliberate: the working version is the
# one you write, holding your key, on your machine, outside this repository -
# and you should read every line of it yourself before it is ever allowed to
# spend money.
#
#   chmod +x examples/executor-template.sh
#   novamp swarm --watch --exec examples/executor-template.sh
#
# The contract, in full:
#   - one JSON object arrives on stdin, schema "novamp.swarm.v1"
#   - nothing arrives in argv, because token names are attacker controlled
#   - exit 0 means handled. Anything else is printed by novamp and not retried
#   - you get 20 seconds by default, then SIGKILL
#
# novamp has already refused everything under its score bar, everything carrying
# RED risk and everything sharing a funder with the rest of the cluster. Your
# bars come on top of its bars; they do not replace them.

set -euo pipefail

payload="$(cat)"

# jq is the readable way to do this. If you would rather not add the dependency,
# python3 -c 'import json,sys; d=json.load(sys.stdin)' reads the same object.
token=$(printf '%s' "$payload" | jq -r '.pick.token')
symbol=$(printf '%s' "$payload" | jq -r '.pick.symbol')
score=$(printf '%s' "$payload" | jq -r '.pick.score')
risk=$(printf '%s' "$payload" | jq -r '.pick.risk')
verdict=$(printf '%s' "$payload" | jq -r '.pick.verdict')
headline=$(printf '%s' "$payload" | jq -r '.news.headline // "none"')
lead=$(printf '%s' "$payload" | jq -r '.news.leadSec // 0')

# --- your own bars, on top of novamp's -------------------------------------

# Only the first born. Drop this line if you want to act on CONTESTED too, and
# understand what you are dropping: CONTESTED means the first launch looked like
# bait and the money went somewhere else, which is a judgement call, not a fact.
if [ "$verdict" != "ORIGINAL" ]; then
  echo "skip $symbol: verdict is $verdict"
  exit 0
fi

if [ "$score" -lt 85 ]; then
  echo "skip $symbol: score $score under my own bar of 85"
  exit 0
fi

# A headline that landed after the launches is not the cause of them.
if [ "$lead" -lt 60 ]; then
  echo "skip $symbol: headline lead is ${lead}s, too close to call"
  exit 0
fi

# --- what a real executor would do here ------------------------------------
#
# Everything above this line is decision. Everything below it is execution, and
# execution is where the money is. Before you write it:
#
#   1. Cap the size. A per-trade cap and a daily cap, both enforced here, in a
#      file this script reads and writes. Not in your head.
#   2. Log every call with its payload, before the transaction, to a file you
#      can read tomorrow morning.
#   3. Use a hot wallet holding only what you are prepared to lose entirely.
#      This script runs unattended, on findings from a tool whose live path its
#      own author has not run against mainnet. See docs/LIMITATIONS.md.
#   4. Test the failure cases first: a token that does not exist, an RPC that
#      times out, two findings arriving four seconds apart. All three will
#      happen in the first week.
#
# There is no code here that signs, and there will not be. That is your half.

echo "WOULD BUY $symbol"
echo "  token    $token"
echo "  score    $score  risk $risk  verdict $verdict"
echo "  headline $headline (${lead}s before the first launch)"
echo "  nothing was bought: this is the template, not an executor"

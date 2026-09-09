import { strict as assert } from "node:assert";
import { test } from "node:test";
import { rankSwarm, topReasons, DEFAULT_RANK } from "../src/swarm/rank.js";
import type { Address, Assessment, Cluster, LaunchRecord, RiskLevel, TokenVerdict } from "../src/types.js";
import { launch, resetCounter } from "./helpers.js";

function member(
  overrides: {
    symbol?: string;
    verdict?: TokenVerdict;
    potential?: number;
    risk?: RiskLevel;
    rank?: number;
    converged?: boolean;
    smartWallets?: number;
    fundedBy?: string;
    earlyBuyers?: number;
  } = {},
): Assessment {
  const record: LaunchRecord = launch({
    symbol: overrides.symbol ?? "TOK",
    name: overrides.symbol ?? "TOK",
    uniqueEarlyBuyers: overrides.earlyBuyers ?? 10,
    deployerRecord: {
      priorLaunches: 1,
      graduated: 0,
      ...(overrides.fundedBy ? { fundedBy: overrides.fundedBy as Address } : {}),
    },
  });
  return {
    record,
    rank: overrides.rank ?? 1,
    lagSec: 0,
    verdict: overrides.verdict ?? "ORIGINAL",
    potential: overrides.potential ?? 80,
    reasons: [
      { points: 14, text: "first launch under this name" },
      { points: -3, text: "no socials" },
      { points: 16, text: "proven wallets converged" },
      { points: 4, text: "curve filling" },
    ],
    risk: overrides.risk ?? "GREEN",
    flags: [],
    smartWallets: overrides.smartWallets ?? 0,
    converged: overrides.converged ?? false,
  };
}

function cluster(members: Assessment[], verdict: Cluster["verdict"] = "CLEAN"): Cluster {
  return {
    key: "tok",
    label: members[0]?.record.symbol ?? "TOK",
    verdict,
    members,
    vampLagSec: members.length > 1 ? 30 : null,
    vampRatio: members.length - 1,
    notes: [],
  };
}

test("the original wins over a higher scoring copy", () => {
  resetCounter();
  // This is the rule the whole tool exists for. A copy that scores better is
  // still a copy, and letting it win on points would be novamp making the exact
  // mistake it was built to stop.
  const original = member({ symbol: "REAL", verdict: "ORIGINAL", potential: 74 });
  const copy = member({ symbol: "FAKE", verdict: "VAMP", potential: 99, rank: 2 });
  const ranked = rankSwarm(cluster([original, copy]));
  assert.equal(ranked.winner?.record.symbol, "REAL");
});

test("a contested launch is eligible, because the first born was the bait", () => {
  resetCounter();
  const bait = member({ symbol: "BAIT", verdict: "TAINTED", potential: 40 });
  const real = member({ symbol: "REAL", verdict: "CONTESTED", potential: 82, rank: 3 });
  const ranked = rankSwarm(cluster([bait, real], "CONTESTED"));
  assert.equal(ranked.winner?.record.symbol, "REAL");
});

test("a cluster of nothing but copies gets no pick at all", () => {
  resetCounter();
  const ranked = rankSwarm(
    cluster([
      member({ symbol: "A", verdict: "VAMP", potential: 90 }),
      member({ symbol: "B", verdict: "DEAD", potential: 10, rank: 2 }),
    ]),
  );
  assert.equal(ranked.winner, null);
  assert.equal(ranked.best, null);
  assert.match(ranked.refusals[0]!, /copy or dead/);
});

test("the score bar is absolute, not relative to the cluster", () => {
  resetCounter();
  // The best token in a bad cluster is still a bad token. A resolver that cannot
  // say "none of these" is not telling you anything.
  const ranked = rankSwarm(cluster([member({ symbol: "MEH", potential: 55 })]));
  assert.equal(ranked.winner, null);
  assert.equal(ranked.best?.record.symbol, "MEH", "the near miss is still reported");
  assert.match(ranked.refusals[0]!, /55.*under the 70 bar/);
});

test("RED risk is refused by default and allowed on request", () => {
  resetCounter();
  const hot = cluster([member({ symbol: "HOT", potential: 88, risk: "RED" })]);
  assert.equal(rankSwarm(hot).winner, null);
  assert.equal(rankSwarm(hot, { ...DEFAULT_RANK, refuseRisk: "none" }).winner?.record.symbol, "HOT");
});

test("risk that could not be measured is not treated as safe", () => {
  resetCounter();
  const ranked = rankSwarm(cluster([member({ symbol: "UNK", potential: 90, risk: "UNKNOWN" })]));
  assert.equal(ranked.winner, null);
  assert.match(ranked.refusals.join(" "), /could not be measured/);
});

test("a pick sharing a funder with another member of the cluster is refused", () => {
  resetCounter();
  const funder = "0x9f10ba3c2e7d4805ac61be39f0d27c4a8e5b106f";
  const ranked = rankSwarm(
    cluster([
      member({ symbol: "ONE", potential: 90, fundedBy: funder }),
      member({ symbol: "TWO", verdict: "VAMP", potential: 20, rank: 2, fundedBy: funder }),
    ]),
  );
  assert.equal(ranked.winner, null);
  assert.match(ranked.refusals.join(" "), /shares a funding wallet with 1/);
});

test("copies funded by one farm do not disqualify an unrelated original", () => {
  resetCounter();
  // Almost every hot name attracts a farm. Refusing the whole cluster on the
  // copies' account would mean never picking anything on the days that matter.
  const funder = "0x9f10ba3c2e7d4805ac61be39f0d27c4a8e5b106f";
  const ranked = rankSwarm(
    cluster(
      [
        member({ symbol: "REAL", potential: 90 }),
        member({ symbol: "C1", verdict: "VAMP", potential: 5, rank: 2, fundedBy: funder }),
        member({ symbol: "C2", verdict: "VAMP", potential: 4, rank: 3, fundedBy: funder }),
      ],
      "FARM",
    ),
  );
  assert.equal(ranked.winner?.record.symbol, "REAL");
});

test("ties break on convergence before birth order", () => {
  resetCounter();
  const early = member({ symbol: "EARLY", potential: 80, rank: 1, converged: false });
  const proven = member({ symbol: "PROVEN", verdict: "CONTESTED", potential: 80, rank: 4, converged: true });
  const ranked = rankSwarm(cluster([early, proven], "CONTESTED"));
  assert.equal(ranked.winner?.record.symbol, "PROVEN");
});

test("everything that is not the pick is listed to avoid, worst first", () => {
  resetCounter();
  const ranked = rankSwarm(
    cluster([
      member({ symbol: "REAL", potential: 90 }),
      member({ symbol: "MID", verdict: "VAMP", potential: 30, rank: 2 }),
      member({ symbol: "WORST", verdict: "VAMP", potential: 2, rank: 3 }),
    ]),
  );
  assert.deepEqual(
    ranked.avoid.map((a) => a.record.symbol),
    ["WORST", "MID"],
  );
});

test("topReasons returns the heaviest reasons in either direction, signed", () => {
  resetCounter();
  const lines = topReasons(member(), 2);
  assert.deepEqual(lines, ["+16 proven wallets converged", "+14 first launch under this name"]);
});

test("the summary says why there is no pick, in words", () => {
  resetCounter();
  const ranked = rankSwarm(cluster([member({ symbol: "MEH", potential: 20 })]));
  assert.match(ranked.summary, /^no pick:/);
});

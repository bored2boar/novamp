import { test } from "node:test";
import assert from "node:assert/strict";
import { assessRisk, concentration, isContractHolder } from "../src/vamp/risk.js";
import type { Address, HolderSnapshot } from "../src/types.js";
import { launch } from "./helpers.js";

function snapshot(slices: [string, number, HolderSnapshot["top"][number]["label"]?][]): HolderSnapshot {
  const top = slices.map(([wallet, pct, label]) => ({ wallet: wallet as Address, pct, label }));
  return {
    top,
    top10Pct: top.filter((s) => !isContractHolder(s.label)).slice(0, 10).reduce((a, s) => a + s.pct, 0),
    deployerPct: top.find((s) => s.label === "deployer")?.pct ?? 0,
    complete: true,
  };
}

test("the curve and the pool are excluded from concentration", () => {
  const snap = snapshot([
    ["0xcurve", 61.4, "curve"],
    ["0xpool", 20.0, "pool"],
    ["0xa", 5, undefined],
    ["0xb", 4, undefined],
  ]);
  assert.equal(concentration(snap), 9);
});

test("the deployer stays in the concentration number", () => {
  const snap = snapshot([
    ["0xcurve", 61.4, "curve"],
    ["0xdev", 12, "deployer"],
    ["0xa", 5, undefined],
  ]);
  assert.equal(concentration(snap), 17);
});

test("concentration crosses amber at 20 and red at 30", () => {
  const green = assessRisk(launch({ holders: snapshot([["0xa", 15]]) }));
  assert.equal(green.level, "GREEN");

  const amber = assessRisk(launch({ holders: snapshot([["0xa", 24]]) }));
  assert.equal(amber.level, "AMBER");

  const red = assessRisk(launch({ holders: snapshot([["0xa", 34]]) }));
  assert.equal(red.level, "RED");
});

test("an incomplete holder scan is UNKNOWN, never a comfortable number", () => {
  const record = launch({
    holders: { top: [], top10Pct: 0, deployerPct: 0, complete: false },
  });
  const result = assessRisk(record);
  assert.equal(result.level, "UNKNOWN");
  assert.ok(result.flags.some((f) => f.code === "holders-unread"));
});

test("four exempt wallets is a declared bundle and goes straight to red", () => {
  const result = assessRisk(launch({ exemptWallets: 4, holders: snapshot([["0xa", 5]]) }));
  assert.equal(result.level, "RED");
  assert.ok(result.flags.some((f) => f.code === "declared-bundle"));
});

test("a creator tax over 5% is red, between 2 and 5 is amber", () => {
  assert.equal(assessRisk(launch({ creatorTaxBps: 600, holders: snapshot([["0xa", 5]]) })).level, "RED");
  assert.equal(assessRisk(launch({ creatorTaxBps: 300, holders: snapshot([["0xa", 5]]) })).level, "AMBER");
  assert.equal(assessRisk(launch({ creatorTaxBps: 100, holders: snapshot([["0xa", 5]]) })).level, "GREEN");
});

test("fees routed away from the deployer are flagged, not judged", () => {
  const record = launch({
    creatorFeeRecipient: "0xfee00000000000000000000000000000000000ee" as Address,
    holders: snapshot([["0xa", 5]]),
  });
  const result = assessRisk(record);
  const flag = result.flags.find((f) => f.code === "fees-routed");
  assert.ok(flag);
  assert.match(flag.text, /not the deployer/);
});

test("a serial deployer with no graduation is red on its own", () => {
  const result = assessRisk(
    launch({ deployerRecord: { priorLaunches: 12, graduated: 0 }, holders: snapshot([["0xa", 5]]) }),
  );
  assert.equal(result.level, "RED");
  assert.ok(result.flags.some((f) => f.code === "serial-deployer"));
});

test("a deployer with graduations is not punished for having a history", () => {
  const result = assessRisk(
    launch({ deployerRecord: { priorLaunches: 12, graduated: 4 }, holders: snapshot([["0xa", 5]]) }),
  );
  assert.equal(result.level, "GREEN");
});

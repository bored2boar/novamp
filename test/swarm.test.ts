import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findSwarms, swarmTerms, isLive, DEFAULT_SWARM } from "../src/swarm/detect.js";
import { launch, resetCounter } from "./helpers.js";
import type { Address, LaunchRecord } from "../src/types.js";

const T0 = 1_700_000_000;

/** A launch under one name, at a given offset, from a given deployer. */
function member(
  symbol: string,
  offsetSec: number,
  deployerSeed: number,
  overrides: Partial<LaunchRecord> = {},
): LaunchRecord {
  return launch({
    symbol,
    name: symbol,
    launchedAt: T0 + offsetSec,
    block: 1_000_000 + offsetSec * 10,
    deployer: `0x${deployerSeed.toString(16).padStart(2, "0")}${"e".repeat(38)}` as Address,
    ...overrides,
  });
}

test("a burst of launches under one name is a swarm", () => {
  resetCounter();
  const records = [
    member("LAPTOP", 0, 1),
    member("LAPTOP", 30, 2),
    member("LAPTOP", 65, 3),
    member("LAPTOP", 90, 4),
    member("LAPTOP", 140, 5),
  ];
  const found = findSwarms(records);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.burst.length, 5);
  assert.equal(found[0]!.deployers, 5);
  assert.equal(found[0]!.startedAt, T0);
  assert.equal(found[0]!.priorMembers, 0);
});

test("one deployer with many wallets is not a swarm", () => {
  resetCounter();
  // Same hand, six launches. This is a farm spraying a ticker, and the whole
  // point of the deployer bar is that it does not read as news.
  const records = [
    member("SPRAY", 0, 9),
    member("SPRAY", 20, 9),
    member("SPRAY", 40, 9),
    member("SPRAY", 60, 9),
    member("SPRAY", 80, 9),
    member("SPRAY", 100, 9),
  ];
  assert.equal(findSwarms(records).length, 0);
});

test("launches spread across hours are not a burst", () => {
  resetCounter();
  const records = [
    member("SLOW", 0, 1),
    member("SLOW", 1800, 2),
    member("SLOW", 3600, 3),
    member("SLOW", 5400, 4),
    member("SLOW", 7200, 5),
  ];
  assert.equal(findSwarms(records).length, 0);
});

test("the launch the crowd copied stays a contender even when it precedes the burst", () => {
  resetCounter();
  // One launch, then a five minute gap, then the crowd. The original is outside
  // the densest window and must still be ranked, or the command throws away the
  // only launch it exists to find.
  const records = [
    member("NEWS", 0, 1),
    member("NEWS", 400, 2),
    member("NEWS", 420, 3),
    member("NEWS", 440, 4),
    member("NEWS", 460, 5),
    member("NEWS", 480, 6),
  ];
  const found = findSwarms(records, { ...DEFAULT_SWARM, windowSec: 120 });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.burst.length, 5, "the burst is the tight run");
  assert.equal(found[0]!.priorMembers, 1, "one launch came before it");
  assert.equal(found[0]!.contenders.length, 6, "the field includes the launch that came first");
  assert.equal(found[0]!.contenders[0]!.record.launchedAt, T0);
});

test("a tie between two windows goes to the earlier one", () => {
  resetCounter();
  // Six launches, evenly spaced, so windows [0..4] and [1..5] both hold five.
  // The earlier window keeps the first born inside the burst.
  const records = [0, 100, 200, 300, 400, 500].map((offset, i) =>
    member("TIE", offset, i + 1),
  );
  const found = findSwarms(records, { ...DEFAULT_SWARM, windowSec: 400 });
  assert.equal(found.length, 1);
  assert.equal(found[0]!.startedAt, T0);
});

test("clustering still applies, so lookalikes join the same swarm", () => {
  resetCounter();
  const records = [
    member("LAPTOP", 0, 1),
    member("LAPT0P", 20, 2),
    member("LAPTOPS", 40, 3),
    member("$LAPTOP", 60, 4),
    // Cyrillic О.
    member("LAPTОP", 80, 5),
  ];
  const found = findSwarms(records);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.burst.length, 5);
});

test("swarmTerms returns every name the crowd used, deduplicated", () => {
  resetCounter();
  const records = [
    member("LAPTOP", 0, 1, { name: "Recalled Laptop" }),
    member("LAPTOP", 20, 2, { name: "Recalled Laptop" }),
    member("BATTERY", 40, 3, { name: "Recalled Laptop" }),
    member("LAPTOP", 60, 4, { name: "laptop" }),
    member("LAPTOP", 80, 5, { name: "Recalled Laptop" }),
  ];
  const found = findSwarms(records);
  const terms = swarmTerms(found[0]!);
  assert.ok(terms.includes("LAPTOP"));
  assert.ok(terms.includes("BATTERY"));
  assert.ok(terms.includes("Recalled Laptop"));
  // "laptop" folds onto "LAPTOP" only by case, and the dedup is case insensitive.
  assert.equal(terms.filter((t) => t.toLowerCase() === "laptop").length, 1);
});

test("a swarm that stopped an hour ago is not live", () => {
  resetCounter();
  const records = [0, 20, 40, 60, 80].map((offset, i) => member("OLD", offset, i + 1));
  const found = findSwarms(records)[0]!;
  assert.equal(isLive(found, T0 + 100), true);
  assert.equal(isLive(found, T0 + 3600), false);
});

test("the rate is per minute across the burst, not across the cluster", () => {
  resetCounter();
  const records = [0, 15, 30, 45, 60].map((offset, i) => member("FAST", offset, i + 1));
  const found = findSwarms(records)[0]!;
  // Five launches in sixty seconds.
  assert.equal(Math.round(found.perMinute), 5);
});

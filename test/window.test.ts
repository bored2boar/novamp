import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coversWindow,
  describeWindow,
  parseWindow,
  windowToBlocks,
  WindowParseError,
} from "../src/util/window.js";

test("windows parse in every unit", () => {
  assert.equal(parseWindow("30s"), 30);
  assert.equal(parseWindow("15m"), 900);
  assert.equal(parseWindow("6h"), 21_600);
  assert.equal(parseWindow("7d"), 604_800);
  assert.equal(parseWindow("2w"), 1_209_600);
});

test("a bare number means hours", () => {
  assert.equal(parseWindow("24"), 86_400);
});

test("all and max mean no lower bound, which is not the same as zero", () => {
  assert.equal(parseWindow("all"), null);
  assert.equal(parseWindow("max"), null);
  assert.equal(parseWindow(""), null);
});

test("nonsense is refused with a message that says what to type", () => {
  assert.throws(() => parseWindow("last tuesday"), WindowParseError);
  assert.throws(() => parseWindow("7 years"), WindowParseError);
  assert.throws(() => parseWindow("0d"), WindowParseError);
  try {
    parseWindow("banana");
  } catch (err) {
    assert.match((err as Error).message, /6h, 24h, 7d, 30d, 2w, or all/);
  }
});

test("describeWindow is the inverse for round values", () => {
  for (const text of ["30s", "15m", "6h", "7d", "2w"]) {
    assert.equal(describeWindow(parseWindow(text)), text);
  }
  assert.equal(describeWindow(null), "everything indexed");
});

test("a month of a 100ms chain is 26 million blocks, which is the whole problem", () => {
  const blocks = windowToBlocks(parseWindow("30d")!, 100);
  assert.equal(blocks, 25_920_000);
  assert.ok(blocks > 1_000_000, "no public RPC serves eth_getLogs over this");
});

test("coverage reports how far short the index falls, rather than silently truncating", () => {
  const coverage = { oldest: 1000, newest: 1000 + 3 * 86_400, spanSec: 3 * 86_400 };
  assert.deepEqual(coversWindow(coverage, parseWindow("1d")), { covered: true, shortBySec: 0 });
  const short = coversWindow(coverage, parseWindow("7d"));
  assert.equal(short.covered, false);
  assert.equal(short.shortBySec, 4 * 86_400);
});

test("an unbounded window is always covered", () => {
  assert.deepEqual(coversWindow({ oldest: null, newest: null, spanSec: 0 }, null), {
    covered: true,
    shortBySec: 0,
  });
});

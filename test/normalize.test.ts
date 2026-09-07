import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collapseRepeats,
  editDistance,
  keysFor,
  looseKey,
  nearEnough,
  stripFiller,
  tightKey,
} from "../src/vamp/normalize.js";

test("a cyrillic lookalike folds onto the latin key", () => {
  // The last character is U+0422 CYRILLIC CAPITAL LETTER TE, not an ASCII T.
  const impostor = "PEANUТ";
  assert.notEqual(impostor, "PEANUT");
  assert.equal(tightKey(impostor).key, tightKey("PEANUT").key);
  assert.equal(tightKey(impostor).folded.length, 1);
});

test("a leading cyrillic er folds too", () => {
  const impostor = "РEANUT"; // Р + EANUT
  assert.equal(tightKey(impostor).key, "peanut");
});

test("zero width characters are stripped and reported", () => {
  const sneaky = "PEA​NUT";
  const keys = keysFor(sneaky);
  assert.equal(keys.tight, "peanut");
  assert.equal(keys.hasHiddenChars, true);
});

test("leetspeak only folds at the loose level", () => {
  assert.equal(tightKey("P3ANUT").key, "p3anut");
  assert.equal(looseKey("P3ANUT"), looseKey("PEANUT"));
});

test("a leet substitution that lands on a different vowel is caught by the fuzzy join", () => {
  // 0 folds to o, so PEAN0T becomes "peanot" rather than "peanut". One edit
  // apart is exactly what `nearEnough` exists for, and the table will say the
  // member joined loosely rather than pretending the strings were identical.
  assert.equal(looseKey("PEAN0T"), "peanot");
  assert.equal(nearEnough(looseKey("PEAN0T"), looseKey("PEANUT")), true);
});

test("the ticker marker is not part of the name", () => {
  assert.equal(tightKey("$PEANUT").key, "peanut");
  assert.equal(tightKey("PEANUT").key, "peanut");
});

test("accents fold, case folds, punctuation goes", () => {
  assert.equal(tightKey("Pëanut!!").key, "peanut");
  assert.equal(tightKey("p e a n u t").key, "peanut");
});

test("repeats collapse", () => {
  assert.equal(collapseRepeats("peeeanuuut"), "peanut");
  assert.equal(collapseRepeats(""), "");
});

test("collapsing never eats a short real ticker", () => {
  // AAA is a ticker somebody will use. Collapsing it to "a" would drop it below
  // the length bar and make every launch under it invisible.
  assert.equal(looseKey("AAA"), "aaa");
  assert.equal(looseKey("PEEEANUUUT"), "peanut");
});

test("filler words are removed from the ends, never past three characters", () => {
  assert.equal(stripFiller("peanutcoin"), "peanut");
  assert.equal(stripFiller("officialpeanut"), "peanut");
  // Not eaten down to nothing.
  assert.equal(stripFiller("coin"), "coin");
  assert.equal(stripFiller("inu"), "inu");
});

test("edit distance handles substitution, insertion and transposition", () => {
  assert.equal(editDistance("peanut", "peanut"), 0);
  assert.equal(editDistance("peanut", "peanuts"), 1);
  assert.equal(editDistance("peanut", "peanpt"), 1);
  assert.equal(editDistance("peanut", "peanut".split("").reverse().join("")), 4);
});

test("edit distance respects its cap instead of running the full matrix", () => {
  assert.equal(editDistance("a", "abcdefghij", 2), 3);
});

test("short names get no fuzzy slack", () => {
  // Three letter tickers are their own jokes, not variants of each other.
  assert.equal(nearEnough("pep", "pop"), false);
  assert.equal(nearEnough("peanut", "peanuts"), true);
});

test("long names get two edits of slack", () => {
  assert.equal(nearEnough("mooncatalyst", "mooncatalist"), true);
  assert.equal(nearEnough("mooncatalyst", "sunflowerpot"), false);
});

test("an unreadable name produces an empty key rather than throwing", () => {
  const keys = keysFor("🐿️🐿️🐿️");
  assert.equal(keys.tight, "");
  assert.equal(keys.loose, "");
});

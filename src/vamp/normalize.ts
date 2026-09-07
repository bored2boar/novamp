/**
 * Turning a launch name into a key that a vamp cannot escape.
 *
 * Every function here is pure and takes no network. This is the file to read
 * first if you want to argue with novamp, and the file to run `npm test`
 * against if you want to prove it wrong.
 *
 * Two keys come out of one name:
 *
 *   tight  - homoglyphs folded, invisibles stripped, case dropped. Two launches
 *            sharing a tight key are the same string to a human eye.
 *   loose  - tight, plus leetspeak folded, repeated letters collapsed and a
 *            small set of filler words dropped. Two launches sharing a loose
 *            key are the same *idea*.
 *
 * Clustering joins on `loose` and reports which members only matched loosely,
 * so a reader can always see why two rows ended up side by side.
 */

import { COMBINING_RE, CONFUSABLES, INVISIBLE_RE, LEET } from "./confusables.js";

/** Words launchers bolt onto a stolen name to get a distinct symbol. */
export const FILLER = new Set([
  "coin", "token", "inu", "the", "official", "real", "og", "v2", "v3", "x",
  "eth", "sol", "meme", "fi", "dao", "ai", "2", "3", "new", "classic", "reborn",
]);

export interface NameKeys {
  /** What the chain actually stores. */
  raw: string;
  /** Homoglyph folded, case dropped, punctuation stripped. */
  tight: string;
  /** Idea level key: leet folded, repeats collapsed, filler removed. */
  loose: string;
  /** True when the raw string contained something a human cannot see. */
  hasHiddenChars: boolean;
  /** Non ASCII characters that were folded, for the "why" column. */
  foldedChars: string[];
}

/** NFKD, strip invisibles and combining marks. Nothing lossy about meaning yet. */
function baseline(input: string): { text: string; hadHidden: boolean } {
  const hadHidden = INVISIBLE_RE.test(input);
  INVISIBLE_RE.lastIndex = 0;
  const text = input
    .replace(INVISIBLE_RE, "")
    .normalize("NFKD")
    .replace(COMBINING_RE, "");
  return { text, hadHidden };
}

/** Fold one character through the confusables table. Returns it unchanged if ASCII. */
function foldChar(ch: string): string {
  const mapped = CONFUSABLES[ch];
  if (mapped !== undefined) return mapped;
  return ch;
}

/**
 * The tight key. Lowercase ASCII letters and digits only, homoglyphs folded.
 * A leading `$` is dropped because it is a ticker marker, not part of the name.
 */
export function tightKey(input: string): { key: string; folded: string[] } {
  const { text } = baseline(input);
  const folded: string[] = [];
  let out = "";
  for (const ch of text.replace(/^\$+/, "")) {
    const mapped = foldChar(ch);
    if (mapped !== ch) folded.push(ch);
    const lower = mapped.toLowerCase();
    for (const c of lower) {
      if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9")) out += c;
    }
  }
  return { key: out, folded };
}

/** Collapse runs of the same character: `peeeanut` and `peanut` are one idea. */
export function collapseRepeats(input: string): string {
  let out = "";
  let prev = "";
  for (const ch of input) {
    if (ch !== prev) out += ch;
    prev = ch;
  }
  return out;
}

/** Drop filler words a vamp bolts on to get a free symbol. */
export function stripFiller(input: string): string {
  if (input.length <= 3) return input;
  let out = input;
  for (const word of FILLER) {
    if (out.length - word.length < 3) continue;
    if (out.endsWith(word)) out = out.slice(0, -word.length);
    if (out.startsWith(word) && out.length - word.length >= 3) out = out.slice(word.length);
  }
  return out;
}

/** The loose key. Everything the tight key does, plus leet, repeats and filler. */
export function looseKey(input: string): string {
  const { key } = tightKey(input);
  let out = "";
  for (const ch of key) out += LEET[ch] ?? ch;

  // Collapsing is skipped when it would eat the name. `AAA` is a real ticker and
  // collapsing it to `a` drops it below the length bar, which means novamp would
  // silently ignore every launch under it. A rule that erases its own input is
  // worse than one that occasionally fails to join.
  const collapsed = collapseRepeats(out);
  if (collapsed.length >= 3) out = collapsed;

  out = stripFiller(out);
  return out;
}

/** Both keys plus the evidence, in one pass, for one launch name. */
export function keysFor(input: string): NameKeys {
  const { hadHidden } = baseline(input);
  const { key: tight, folded } = tightKey(input);
  return {
    raw: input,
    tight,
    loose: looseKey(input),
    hasHiddenChars: hadHidden || folded.length > 0,
    foldedChars: folded,
  };
}

/**
 * Damerau-Levenshtein distance, capped.
 *
 * Capped because we only ever ask "is this within 1 or 2 edits", and an
 * unbounded matrix over a 64 member cluster is the kind of thing that quietly
 * costs you a second per query for no benefit.
 */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  const prev2: number[] = new Array(b.length + 1).fill(0);
  const prev: number[] = new Array(b.length + 1).fill(0);
  const cur: number[] = new Array(b.length + 1).fill(0);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      // transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) {
      prev2[j] = prev[j]!;
      prev[j] = cur[j]!;
    }
  }
  return Math.min(prev[b.length]!, cap + 1);
}

/**
 * Are two loose keys near enough to belong in one cluster?
 *
 * Short keys get no slack at all: `pep` and `pop` are two different jokes, but
 * `peanut` and `peanuts` are one. The threshold widens with length because a
 * one character edit in a twelve character name is noise, and in a three
 * character name it is the whole name.
 */
export function nearEnough(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.min(a.length, b.length);
  if (len < 4) return false;
  const allowed = len >= 9 ? 2 : 1;
  return editDistance(a, b, allowed) <= allowed;
}

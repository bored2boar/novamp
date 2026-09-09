/**
 * Did a headline cause this, and did it land first?
 *
 * The order of events is the whole point, and it is the part every "news bot"
 * gets wrong by not checking. A swarm with a headline behind it is a crowd
 * reacting to something real. A swarm with no headline behind it is either a
 * meme novamp cannot see the source of, or a farm, and those two want very
 * different reactions from you.
 *
 * So a match here requires three things, and says which one failed when it
 * fails:
 *
 *   1. the headline carries a word the launches are named after
 *   2. the headline has a timestamp - an undated item proves nothing about order
 *   3. the headline landed BEFORE the burst, inside the lookback
 *
 * Point three has a deliberate grace period on the wrong side. Feeds lag, and a
 * wire item stamped ninety seconds after the first launch is still almost
 * certainly the cause rather than the effect, because the launch farms are
 * watching faster sources than an RSS poll. That grace is capped tight, it is
 * named, and a match that needed it is labelled `lagging` in the output rather
 * than being quietly counted as clean.
 *
 * Nothing here is evidence of causation. It is evidence of coincidence in time,
 * which is all a tool reading public text can honestly claim.
 */

import type { FeedItem } from "../narrative/feeds.js";
import { looseKey, nearEnough } from "../vamp/normalize.js";

/**
 * A term has to be this long before it is checked as a substring of a whole
 * headline. Substring matching is far looser than word matching - "art" is
 * inside "particle" - so it is reserved for terms long enough that an accident
 * is implausible.
 */
const PHRASE_MIN = 10;

export interface NewsOptions {
  /** How far back before the burst a headline still counts. */
  lookbackSec: number;
  /** How long after the first launch a feed may still be publishing the cause. */
  graceSec: number;
  /** Terms shorter than this are too generic to match a headline on. */
  minTermLength: number;
}

export const DEFAULT_NEWS: NewsOptions = {
  lookbackSec: 3600,
  graceSec: 120,
  minTermLength: 4,
};

export type MatchKind =
  /** The headline contains the word the tokens are named after. */
  | "exact"
  /** Within an edit or two: a plural, a misspelling, a folded lookalike. */
  | "near";

export interface NewsMatch {
  item: FeedItem;
  /** The launch term that matched. */
  term: string;
  /** The headline word it matched against. */
  word: string;
  kind: MatchKind;
  /** Seconds from the headline to the first launch. Negative means it lagged. */
  leadSec: number;
  /** True when the headline is stamped after the burst started. */
  lagging: boolean;
}

/** Headline words, folded the same way a ticker is, so the two can be compared. */
function wordsOf(title: string): { word: string; key: string }[] {
  const out: { word: string; key: string }[] = [];
  for (const raw of title.split(/[^\p{L}\p{N}$]+/u)) {
    if (!raw) continue;
    const key = looseKey(raw);
    if (key) out.push({ word: raw.replace(/^\$/, ""), key });
  }
  return out;
}

/**
 * Match a swarm's names against a set of headlines.
 *
 * `burstStart` is the unix second of the first launch in the burst. Results are
 * ordered by how early the headline was, because the earliest credible headline
 * is the one worth showing: later items in the same story are echoes.
 */
export function matchNews(
  items: readonly FeedItem[],
  terms: readonly string[],
  burstStart: number,
  options: NewsOptions = DEFAULT_NEWS,
): NewsMatch[] {
  // A multi-word token name is checked whole as well as word by word, because
  // "Peanut the Squirrel" should match a headline containing that phrase even
  // though neither "the" nor a bare "squirrel" would be convincing alone.
  // One folding for both checks. Comparing a term folded one way against a
  // headline folded another is how a phrase match silently never fires: the
  // term keeps a filler word the headline dropped and the substring never lands.
  const keyed = terms
    .map((term) => ({ term, key: looseKey(term) }))
    .filter((entry) => entry.key.length >= options.minTermLength);
  if (!keyed.length) return [];

  const out: NewsMatch[] = [];

  for (const item of items) {
    // Rule 2: no timestamp, no claim about order. An undated headline is not
    // downgraded to a weak match, it is dropped, because "probably before" is
    // exactly the reasoning this file exists to refuse.
    if (item.publishedAt === undefined) continue;

    const leadSec = burstStart - item.publishedAt;
    if (leadSec > options.lookbackSec) continue;
    if (leadSec < -options.graceSec) continue;

    const words = wordsOf(item.title);
    const phraseKey = looseKey(item.title);
    let best: NewsMatch | null = null;

    for (const entry of keyed) {
      for (const { word, key } of words) {
        let kind: MatchKind | null = null;
        if (key === entry.key) kind = "exact";
        else if (nearEnough(key, entry.key)) kind = "near";
        if (!kind) continue;
        if (best && best.kind === "exact" && kind === "near") continue;
        best = { item, term: entry.term, word, kind, leadSec, lagging: leadSec < 0 };
        if (kind === "exact") break;
      }
      if (best?.kind === "exact") break;
      // The whole-phrase check, for names that are a sentence. "Peanut the
      // Squirrel" should match a headline containing that phrase even though no
      // single word in it - not "peanut", certainly not "the" - would be
      // convincing on its own.
      if (entry.key.length >= PHRASE_MIN && phraseKey.includes(entry.key)) {
        best = {
          item,
          term: entry.term,
          word: entry.term,
          kind: "exact",
          leadSec,
          lagging: leadSec < 0,
        };
        break;
      }
    }

    if (best) out.push(best);
  }

  out.sort((a, b) => b.leadSec - a.leadSec);
  return out;
}

/** The headline to put at the top of an alert: earliest credible, exact preferred. */
export function primaryMatch(matches: readonly NewsMatch[]): NewsMatch | null {
  const clean = matches.filter((m) => !m.lagging);
  const pool = clean.length ? clean : matches;
  const exact = pool.filter((m) => m.kind === "exact");
  return (exact.length ? exact : pool)[0] ?? null;
}

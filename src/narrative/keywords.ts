/**
 * Pulling the nouns out of a headline.
 *
 * Memecoins get named after the concrete noun in a story, not its verb and not
 * its adjective: the squirrel, the dog, the ship, the word somebody said on
 * stage. So the extractor keeps capitalised words and rare words, throws away
 * the machinery of English, and never returns anything under three characters.
 *
 * The output is a query for `novamp vamp`, not a signal.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "after",
  "says", "said", "new", "how", "why", "what", "when", "will", "has", "have",
  "was", "were", "are", "its", "his", "her", "their", "our", "you", "your",
  "not", "but", "all", "can", "may", "one", "two", "than", "then", "out",
  "about", "more", "most", "some", "just", "now", "amid", "as", "at", "by",
  "in", "of", "on", "to", "up", "off", "via", "per", "news", "report", "reports",
  "breaking", "live", "update", "updates", "watch", "video", "photos",
]);

export interface Keyword {
  word: string;
  /** Times it appeared across the headlines read. */
  count: number;
  /** Headlines it came from, capped, so the operator can see the story. */
  examples: string[];
}

export function extractKeywords(titles: readonly string[], limit = 20): Keyword[] {
  const counts = new Map<string, Keyword>();

  for (const title of titles) {
    const words = title.split(/[^\p{L}\p{N}$]+/u).filter(Boolean);
    for (const raw of words) {
      const word = raw.replace(/^\$/, "");
      if (word.length < 3 || word.length > 20) continue;
      const lower = word.toLowerCase();
      if (STOPWORDS.has(lower)) continue;
      if (/^\d+$/.test(lower)) continue;

      // A capitalised word inside a sentence is a name. A word in a title that
      // is capitalised because every word is is not, so title case is ignored.
      const looksLikeName = /^[A-Z]/.test(word) && !/^[A-Z]+$/.test(word);
      const entry = counts.get(lower) ?? { word: lower, count: 0, examples: [] };
      entry.count += looksLikeName ? 2 : 1;
      if (entry.examples.length < 3 && !entry.examples.includes(title)) entry.examples.push(title);
      counts.set(lower, entry);
    }
  }

  return [...counts.values()]
    .filter((k) => k.count >= 2)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

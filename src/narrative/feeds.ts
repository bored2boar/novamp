/**
 * Where a name comes from before it becomes a token.
 *
 * A word to be clear about what this is not. It is not a news sniper. By the
 * time an RSS item is public, a launch farm has already deployed under that
 * word, usually several times, and anyone selling you "buy before the crowd
 * hears" is selling you a race you lost before you entered.
 *
 * What a feed is good for is telling novamp which fight to go and look at. The
 * news says a word is hot; novamp says which of the eleven tokens carrying that
 * word was first and which one the money is on. That question is still open when
 * the news breaks, and it stays open for hours.
 *
 * Free feeds only. novamp ships no API keys and asks for none.
 */

const TAG_RE = /<(title|summary)[^>]*>([\s\S]*?)<\/\1>/gi;
const CDATA_RE = /^<!\[CDATA\[([\s\S]*)\]\]>$/;

export interface FeedItem {
  title: string;
  source: string;
}

function decode(text: string): string {
  const inner = CDATA_RE.exec(text.trim());
  const raw = inner ? inner[1]! : text;
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Minimal RSS/Atom title extraction.
 *
 * Deliberately not a parser. It reads titles and nothing else, because titles
 * are the only field that reliably carries the noun a memecoin gets named after,
 * and a dependency-free regex that fails visibly beats an XML library that
 * fails quietly.
 */
export function parseFeed(xml: string, source: string): FeedItem[] {
  const items: FeedItem[] = [];
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(xml)) !== null) {
    const text = decode(match[2] ?? "");
    if (text.length < 8) continue;
    items.push({ title: text, source });
  }
  // The first title in a feed is the channel's own name, not an item.
  return items.slice(1);
}

export async function fetchFeed(url: string, timeoutMs = 10_000): Promise<FeedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];
    return parseFeed(await response.text(), new URL(url).hostname);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

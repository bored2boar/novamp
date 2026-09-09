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

/** One `<item>` or `<entry>` block, whichever dialect the feed speaks. */
const ITEM_RE = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const DATE_RE = /<(pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/\1>/i;

export interface FeedItem {
  title: string;
  source: string;
  /**
   * Unix seconds, when the feed said so.
   *
   * Undefined is a real answer and it matters: a headline with no timestamp
   * cannot be placed relative to a launch, so the swarm layer treats it as
   * unusable rather than assuming it is fresh.
   */
  publishedAt?: number;
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

/** RFC 822 and ISO 8601 both parse here, and anything else returns undefined. */
export function parseDate(text: string): number | undefined {
  const ms = Date.parse(decode(text));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
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

/**
 * The same feed, read per item, so each headline keeps its own timestamp.
 *
 * `parseFeed` above flattens the document and is what `novamp narrative` wants,
 * because that command only asks which words are in the air. `swarm` asks a
 * harder question - did this headline land *before* these launches - and that
 * question is unanswerable without a per-item date, so it gets its own reader
 * rather than a timestamp bolted onto the flat one.
 *
 * Falls back to the flat parse when the document has no item boundaries at all,
 * which is the sane behaviour for a feed novamp has not seen the shape of.
 */
export function parseFeedItems(xml: string, source: string): FeedItem[] {
  const items: FeedItem[] = [];
  let match: RegExpExecArray | null;
  ITEM_RE.lastIndex = 0;
  while ((match = ITEM_RE.exec(xml)) !== null) {
    const body = match[2] ?? "";
    const title = decode(TITLE_RE.exec(body)?.[1] ?? "");
    if (title.length < 8) continue;
    const rawDate = DATE_RE.exec(body)?.[2];
    const publishedAt = rawDate ? parseDate(rawDate) : undefined;
    items.push(publishedAt === undefined ? { title, source } : { title, source, publishedAt });
  }
  return items.length ? items : parseFeed(xml, source);
}

async function get(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "novamp (+https://github.com/bored2boar/novamp)" },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFeed(url: string, timeoutMs = 10_000): Promise<FeedItem[]> {
  const body = await get(url, timeoutMs);
  if (body === null) return [];
  return parseFeed(body, new URL(url).hostname);
}

/** `fetchFeed`, but keeping the per-item timestamps. */
export async function fetchFeedItems(url: string, timeoutMs = 10_000): Promise<FeedItem[]> {
  const body = await get(url, timeoutMs);
  if (body === null) return [];
  return parseFeedItems(body, new URL(url).hostname);
}

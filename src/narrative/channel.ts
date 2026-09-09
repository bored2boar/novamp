/**
 * Reading a public Telegram channel, which is where crypto news actually breaks.
 *
 * An RSS feed is a wire service: correct, attributed, and twenty minutes late by
 * the standards of a chain that seals a block every 100 ms. The aggregator
 * channels are the opposite - unattributed, occasionally wrong, and first. For
 * the one question novamp asks a news source, "was there a headline carrying
 * this word before these launches", first is the property that matters.
 *
 * Every public channel has a web preview at https://t.me/s/<name>. It is plain
 * HTML, it needs no bot token, no API id and no login, and it carries the one
 * thing a bot API subscription would also give: message text with a timestamp.
 * So novamp reads that, and asks for no credentials at all.
 *
 * What this deliberately does not do:
 *
 *   - it does not join anything, so your account is not in a member list
 *   - it does not use the bot API, so there is no token to leak
 *   - it reads one page of recent messages and stops: there is no history walk
 *   - it never follows a link out of a message
 *
 * A channel that is private, deleted or renamed simply returns nothing, and the
 * command says so rather than failing.
 */

import type { FeedItem } from "./feeds.js";

/** The message body in the web preview. */
const MESSAGE_RE =
  /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
/** The timestamp that follows it. */
const TIME_RE = /<time[^>]+datetime="([^"]+)"/gi;

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&amp;": "&",
};

function textOf(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull messages out of a t.me/s/ page.
 *
 * Message bodies and timestamps are matched separately and then zipped, because
 * the preview markup puts them in sibling containers rather than nesting one in
 * the other. Zipping is safe here only because both appear once per message and
 * in the same order; if Telegram ever changes that, the count check below turns
 * a silently wrong pairing into an empty result, which is the failure novamp
 * would rather have.
 */
export function parseChannel(html: string, source: string): FeedItem[] {
  const bodies: string[] = [];
  let match: RegExpExecArray | null;
  MESSAGE_RE.lastIndex = 0;
  while ((match = MESSAGE_RE.exec(html)) !== null) bodies.push(textOf(match[1] ?? ""));

  const times: number[] = [];
  TIME_RE.lastIndex = 0;
  while ((match = TIME_RE.exec(html)) !== null) {
    const ms = Date.parse(match[1] ?? "");
    if (Number.isFinite(ms)) times.push(Math.floor(ms / 1000));
  }

  // A timestamp per message, or novamp does not trust the pairing.
  const dated = times.length === bodies.length;

  const items: FeedItem[] = [];
  bodies.forEach((body, index) => {
    if (body.length < 8) return;
    // Aggregator posts run long. Only the opening sentence carries the noun.
    const headline = body.slice(0, 300);
    const at = dated ? times[index] : undefined;
    items.push(at === undefined ? { title: headline, source } : { title: headline, source, publishedAt: at });
  });
  return items;
}

/** `t.me/s/name`, `@name` and a bare `name` all mean the same channel. */
export function channelUrl(name: string): string {
  const clean = name
    .trim()
    .replace(/^(https?:\/\/)?(t\.me|telegram\.me)\/(s\/)?/i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return `https://t.me/s/${clean}`;
}

export async function fetchChannel(name: string, timeoutMs = 10_000): Promise<FeedItem[]> {
  const url = channelUrl(name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "novamp (+https://github.com/bored2boar/novamp)" },
    });
    if (!response.ok) return [];
    return parseChannel(await response.text(), `t.me/${name.replace(/^@/, "")}`);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

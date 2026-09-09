import { strict as assert } from "node:assert";
import { test } from "node:test";
import { matchNews, primaryMatch, DEFAULT_NEWS } from "../src/swarm/news.js";
import { parseFeedItems, parseFeed } from "../src/narrative/feeds.js";
import { parseChannel, channelUrl } from "../src/narrative/channel.js";
import type { FeedItem } from "../src/narrative/feeds.js";

const BURST = 1_700_000_000;

function item(title: string, secondsBefore: number | null): FeedItem {
  return secondsBefore === null
    ? { title, source: "test" }
    : { title, source: "test", publishedAt: BURST - secondsBefore };
}

test("a headline carrying the name, published before the burst, matches", () => {
  const matches = matchNews(
    [item("Peanut the Squirrel seized by wildlife officials", 1800)],
    ["PEANUT"],
    BURST,
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.kind, "exact");
  assert.equal(matches[0]!.leadSec, 1800);
  assert.equal(matches[0]!.lagging, false);
});

test("an undated headline proves nothing about order and is dropped", () => {
  const matches = matchNews([item("Peanut the Squirrel seized", null)], ["PEANUT"], BURST);
  assert.equal(matches.length, 0);
});

test("a headline older than the lookback is out", () => {
  const matches = matchNews([item("Peanut the Squirrel seized", 7200)], ["PEANUT"], BURST);
  assert.equal(matches.length, 0);
});

test("a headline well after the first launch cannot be the cause", () => {
  const matches = matchNews([item("Peanut the Squirrel seized", -900)], ["PEANUT"], BURST);
  assert.equal(matches.length, 0);
});

test("a headline just after the first launch is kept, and labelled lagging", () => {
  const matches = matchNews([item("Peanut the Squirrel seized", -30)], ["PEANUT"], BURST);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.lagging, true);
});

test("a near match is found and labelled as one, not passed off as exact", () => {
  // A plural is one edit away. It is worth reporting and it is not the same
  // thing as the headline carrying the word, so the label says which it was.
  const matches = matchNews([item("Peanuts recalled across four states", 600)], ["PEANUT"], BURST);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.kind, "near");
  assert.equal(matches[0]!.word, "Peanuts");
});

test("an unrelated headline does not match", () => {
  const matches = matchNews(
    [item("Central bank holds rates steady through the quarter", 600)],
    ["PEANUT"],
    BURST,
  );
  assert.equal(matches.length, 0);
});

test("terms shorter than the bar are refused, because they match everything", () => {
  const matches = matchNews([item("The AI boom is not over, says analyst", 600)], ["AI"], BURST);
  assert.equal(matches.length, 0);
});

test("a multi-word token name matches the phrase in a headline", () => {
  const matches = matchNews(
    [item("Officials confirm the peanut the squirrel case is closed", 900)],
    ["Peanut the Squirrel"],
    BURST,
  );
  assert.equal(matches.length, 1);
});

test("primaryMatch prefers a clean early exact over a lagging one", () => {
  const matches = matchNews(
    [
      item("Peanut euthanised, department confirms", -30),
      item("Peanut the Squirrel seized by officials", 2000),
    ],
    ["PEANUT"],
    BURST,
  );
  const best = primaryMatch(matches);
  assert.ok(best);
  assert.equal(best!.lagging, false);
  assert.equal(best!.leadSec, 2000);
});

test("matches come back earliest first", () => {
  const matches = matchNews(
    [item("Peanut latest", 300), item("Peanut first report", 2400), item("Peanut update", 1200)],
    ["PEANUT"],
    BURST,
  );
  assert.deepEqual(
    matches.map((m) => m.leadSec),
    [2400, 1200, 300],
  );
});

test("a term matching two headlines still yields one match per headline", () => {
  const matches = matchNews(
    [item("Peanut seized in raid", 900), item("Peanut case reaches governor", 600)],
    ["PEANUT", "Peanut the Squirrel"],
    BURST,
  );
  assert.equal(matches.length, 2);
});

// --- feed parsing ------------------------------------------------------------

const RSS = `<?xml version="1.0"?>
<rss><channel>
<title>Wire Service</title>
<item>
  <title>Peanut the Squirrel seized by officials</title>
  <pubDate>Fri, 05 Sep 2026 13:33:00 GMT</pubDate>
</item>
<item>
  <title><![CDATA[Markets flat ahead of the print]]></title>
  <pubDate>Fri, 05 Sep 2026 13:10:00 GMT</pubDate>
</item>
</channel></rss>`;

test("parseFeedItems keeps a timestamp per item", () => {
  const items = parseFeedItems(RSS, "wire");
  assert.equal(items.length, 2);
  assert.equal(items[0]!.title, "Peanut the Squirrel seized by officials");
  assert.equal(items[0]!.publishedAt, Math.floor(Date.parse("2026-09-05T13:33:00Z") / 1000));
  assert.equal(items[1]!.title, "Markets flat ahead of the print");
});

test("parseFeed still flattens, and still drops the channel title", () => {
  const items = parseFeed(RSS, "wire");
  assert.equal(items.length, 2);
  assert.ok(!items.some((i) => i.title === "Wire Service"));
});

const ATOM = `<feed>
<title>Atom Wire</title>
<entry><title>Laptop batteries recalled worldwide</title><published>2026-09-05T13:00:00Z</published></entry>
</feed>`;

test("Atom entries parse the same way", () => {
  const items = parseFeedItems(ATOM, "atom");
  assert.equal(items.length, 1);
  assert.equal(items[0]!.publishedAt, Math.floor(Date.parse("2026-09-05T13:00:00Z") / 1000));
});

test("a document with no item boundaries falls back to the flat parse", () => {
  const items = parseFeedItems("<rss><title>Feed Name</title><title>A headline here</title></rss>", "x");
  assert.equal(items.length, 1);
  assert.equal(items[0]!.title, "A headline here");
  assert.equal(items[0]!.publishedAt, undefined);
});

// --- telegram channel preview ------------------------------------------------

const PREVIEW = `
<div class="tgme_widget_message">
  <div class="tgme_widget_message_text js-message_text">Peanut the Squirrel seized by state officials, owner confirms</div>
  <div class="tgme_widget_message_info"><time class="time" datetime="2026-09-05T13:33:00+00:00">13:33</time></div>
</div>
<div class="tgme_widget_message">
  <div class="tgme_widget_message_text js-message_text">Laptop maker <b>recalls</b> 400,000 units<br>over a battery fault</div>
  <div class="tgme_widget_message_info"><time class="time" datetime="2026-09-05T13:40:00+00:00">13:40</time></div>
</div>`;

test("a channel preview page yields messages with timestamps", () => {
  const items = parseChannel(PREVIEW, "t.me/wire");
  assert.equal(items.length, 2);
  assert.equal(items[0]!.publishedAt, Math.floor(Date.parse("2026-09-05T13:33:00Z") / 1000));
  assert.ok(items[1]!.title.includes("recalls 400,000 units over a battery fault"), items[1]!.title);
});

test("a preview whose timestamps do not line up yields undated messages, not wrong ones", () => {
  const broken = PREVIEW.replace(/<time[^>]+datetime="2026-09-05T13:40:00\+00:00">13:40<\/time>/, "");
  const items = parseChannel(broken, "t.me/wire");
  assert.equal(items.length, 2);
  assert.equal(items[0]!.publishedAt, undefined, "a mismatched count must not be zipped");
  // And an undated item is then dropped by the matcher, which is the point.
  assert.equal(matchNews(items, ["PEANUT"], BURST, DEFAULT_NEWS).length, 0);
});

test("channelUrl accepts every way somebody names a channel", () => {
  for (const input of ["wire", "@wire", "https://t.me/wire", "https://t.me/s/wire", "t.me/wire?x=1"]) {
    assert.equal(channelUrl(input), "https://t.me/s/wire", input);
  }
});

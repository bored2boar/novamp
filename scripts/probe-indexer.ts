/**
 * Check the indexer's field names against reality, before a snapshot job
 * depends on them.
 *
 *   BITQUERY_TOKEN=... npx tsx scripts/probe-indexer.ts
 *
 * Every GraphQL adapter is written against documentation and then meets an API
 * that names one field differently. The failure mode is quiet: the query
 * succeeds, a field comes back undefined, and the pipeline produces a snapshot
 * full of zero addresses that looks fine until somebody reads it.
 *
 * So this prints the raw shape of one event and one holder row, and then says
 * plainly which of the fields novamp needs were actually present. Run it once
 * after getting a key, and again any time the indexer is upgraded.
 */

import {
  argsToMap,
  bitqueryFromEnv,
  fetchLaunches,
  LAUNCHES_QUERY,
  PONS_FACTORY_LOWER,
  query,
} from "../src/indexer/bitquery.js";
import { blockscoutFromEnv, fetchTokenMeta } from "../src/indexer/blockscout.js";

const WANTED = ["token", "curve", "deployer", "pairToken"];

async function main(): Promise<void> {
  const cfg = bitqueryFromEnv();
  if (!cfg) {
    process.stderr.write("BITQUERY_TOKEN is not set.\n");
    process.exit(1);
  }
  process.stdout.write(`endpoint  ${cfg.url}\ndataset   ${cfg.dataset}\n\n`);

  process.stdout.write("--- raw: one TokenLaunched event -----------------------------\n");
  const raw = await query<{
    EVM: { Events: { Arguments: { Name: string; Type?: string }[] }[] };
  }>(cfg, LAUNCHES_QUERY, { factory: PONS_FACTORY_LOWER, limit: 1, hoursAgo: 24 });

  const first = raw.EVM?.Events?.[0];
  if (!first) {
    process.stdout.write(
      "no launches came back in the last 24h.\n" +
        "Either the factory address is wrong, the dataset does not cover this chain,\n" +
        "or the key has no access. Nothing below will be meaningful.\n",
    );
    process.exit(4);
  }
  process.stdout.write(JSON.stringify(first, null, 2) + "\n\n");

  const names = (first.Arguments ?? []).map((a) => a.Name);
  process.stdout.write("--- argument names present -----------------------------------\n");
  process.stdout.write(names.join(", ") + "\n\n");

  process.stdout.write("--- fields novamp needs --------------------------------------\n");
  const args = argsToMap(first.Arguments as never);
  let missing = 0;
  for (const field of WANTED) {
    const value = args.get(field);
    if (value) {
      process.stdout.write(`  ok      ${field.padEnd(12)} ${value}\n`);
    } else {
      missing++;
      process.stdout.write(`  MISSING ${field}\n`);
    }
  }
  const hasName = args.has("name") || args.has("symbol");
  process.stdout.write(
    hasName
      ? "  ok      name/symbol are in the event, no explorer lookup needed\n"
      : "  note    name/symbol are NOT in the event, they come from Blockscout\n",
  );

  process.stdout.write("\n--- parsed through the adapter -------------------------------\n");
  const parsed = await fetchLaunches(cfg, { hoursAgo: 24, limit: 3 });
  process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");

  if (parsed[0] && !hasName) {
    process.stdout.write("\n--- Blockscout metadata for that token -----------------------\n");
    const meta = await fetchTokenMeta(blockscoutFromEnv(), parsed[0].token);
    process.stdout.write(JSON.stringify(meta, null, 2) + "\n");
    if (!meta.ok) {
      process.stdout.write(
        "\nthe explorer did not answer. Check BLOCKSCOUT_API_KEY, or that the\n" +
          "token is indexed there yet - a launch seconds old may not be.\n",
      );
    }
  }

  process.stdout.write(
    missing
      ? `\n${missing} required field(s) missing. Send this output and the adapter gets fixed.\n`
      : "\nall required fields present. The snapshot job will work.\n",
  );
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});

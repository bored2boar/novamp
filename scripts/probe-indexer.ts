/**
 * Probe: does Bitquery return token name/symbol on the free realtime tier?
 *
 *   BITQUERY_TOKEN=... npx tsx scripts/probe-indexer.ts
 *
 * The TokenLaunched event carries only addresses. name/symbol have to come from
 * somewhere. Blockscout for this chain is behind a bot wall, so this checks
 * whether Bitquery itself can supply them via a token's transfers/currency.
 */

import { bitqueryFromEnv, fetchLaunches, query } from "../src/indexer/bitquery.js";

const CURRENCY_QUERY = `
query Meta($token: String!) {
  EVM(network: robinhood, dataset: realtime) {
    Transfers(
      limit: {count: 1}
      where: {Transfer: {Currency: {SmartContract: {is: $token}}}}
    ) {
      Transfer {
        Currency { Name Symbol Decimals SmartContract }
      }
    }
  }
}`;

interface CurrencyResponse {
  EVM?: {
    Transfers?: {
      Transfer?: {
        Currency?: { Name?: string; Symbol?: string; Decimals?: number; SmartContract?: string };
      };
    }[];
  };
}

async function main(): Promise<void> {
  const cfg = bitqueryFromEnv();
  if (!cfg) {
    process.stderr.write("BITQUERY_TOKEN is not set.\n");
    process.exit(1);
  }
  process.stdout.write(`endpoint  ${cfg.url}\n\n`);

  process.stdout.write("--- pulling a few launches ----------------------------------\n");
  const launches = await fetchLaunches(cfg, { hoursAgo: 24, limit: 5 });
  if (!launches.length) {
    process.stdout.write("no launches in window; cannot test metadata.\n");
    process.exit(4);
  }
  process.stdout.write(`got ${launches.length} launches. testing the first few tokens.\n\n`);

  let anyMeta = false;
  for (const launch of launches.slice(0, 4)) {
    const token = launch.token;
    process.stdout.write(`--- token ${token} -------------------------\n`);
    try {
      const raw = await query<CurrencyResponse>(cfg, CURRENCY_QUERY, { token });
      const cur = raw.EVM?.Transfers?.[0]?.Transfer?.Currency;
      if (cur && (cur.Name || cur.Symbol)) {
        anyMeta = true;
        process.stdout.write(`  name="${cur.Name ?? ""}"  symbol="${cur.Symbol ?? ""}"  decimals=${cur.Decimals ?? "?"}\n\n`);
      } else {
        process.stdout.write(`  empty (no transfers/currency for this token yet)\n`);
        process.stdout.write(`  raw: ${JSON.stringify(raw)}\n\n`);
      }
    } catch (err) {
      process.stdout.write(`  QUERY ERROR: ${(err as Error).message}\n`);
      process.stdout.write(`  (the query shape may be off for this network; send this and it gets fixed)\n\n`);
    }
  }

  process.stdout.write("--- verdict -------------------------------------------------\n");
  process.stdout.write(
    anyMeta
      ? "Bitquery HAS name/symbol. Option A works, I will wire it in.\n"
      : "Bitquery returned no name/symbol for these tokens. Option A likely will not\n" +
          "work as-is (tokens may be too fresh, or transfers/currency not on this tier).\n" +
          "Send this output either way.\n",
  );
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});

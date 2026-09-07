/**
 * Build the synthetic demo fixtures.
 *
 * These are NOT recordings of real launches. They are hand-shaped cases that
 * exercise every branch of the verdict logic, so `--demo` shows what the tool
 * does rather than what one lucky afternoon on the chain looked like. Every file
 * this writes carries `"origin": "synthetic"`, and the demo banner repeats it.
 *
 * To replace them with real chain captures, use `scripts/capture-fixtures.ts`.
 *
 *   npx tsx scripts/make-fixtures.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Address, Buyer, HolderSnapshot, LaunchRecord, Phase } from "../src/types.js";
import type { Registry, SmartWallet } from "../src/smart/registry.js";

/** Deterministic pseudo-random so regenerating the fixtures does not churn git. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const random = rng(4663);

function addr(prefix: string): Address {
  const body = Array.from({ length: 40 - prefix.length }, () =>
    "0123456789abcdef"[Math.floor(random() * 16)],
  ).join("");
  return `0x${prefix}${body}` as Address;
}

const SMART: Address[] = [
  "0x4f2a91Cc0d1B7ae3aF66E0cB2211d0a9f3E5b7C1",
  "0x8b31DdA5390fF4c1e2A70bE13aC9d84c6F2019Ea",
  "0xC0FFEE2a9B1d4E7f83aa5C6d0B1e93F4a7D2c518",
  "0x19Ab77E4d2c0F5138a6B9cE04dA71f8b3C6e2905",
  "0x6D4e0aC17bF3928d5a0Bc1E6f4903aA82b7dC331",
  "0xAe51b3C08D9f26a4E7c105B2fd83a690C41e7B2d",
].map((a) => a as Address);

const CROWD = Array.from({ length: 40 }, (_, i) => addr(`${(i + 16).toString(16)}c`));

/**
 * One wallet that keeps buying the copy.
 *
 * `novamp wallet` needs somebody to have made the mistake the command exists to
 * find, and a demo where every holder picked the original teaches nothing.
 */
const VICTIM = "0xdeadBEEF11223344556677889900aAbBcCdDeEfF" as Address;

interface Spec {
  symbol: string;
  name: string;
  offsetSec: number;
  devSharePct: number;
  exemptWallets: number;
  creatorTaxBps: number;
  socials: boolean;
  phase?: Phase;
  curveProgress: number;
  smartIndexes: number[];
  smartLagSec?: number[];
  crowdBuyers: number;
  botOnly?: boolean;
  /** Put the demo victim wallet in this launch's early buyers. */
  victim?: boolean;
  top10Pct: number;
  deployerPct: number;
  priorLaunches: number;
  graduated: number;
  fundedBy?: string;
  feesToThirdParty?: boolean;
}

function holders(top10Pct: number, deployerPct: number, curve: Address, deployer: Address): HolderSnapshot {
  const rest = Math.max(0, top10Pct - deployerPct);
  const slices = [
    { wallet: curve, pct: 61.4, label: "curve" as const },
    { wallet: deployer, pct: deployerPct, label: "deployer" as const },
    ...Array.from({ length: 9 }, (_, i) => ({
      wallet: addr(`${(i + 32).toString(16)}h`),
      pct: Number((rest / 9).toFixed(2)),
    })),
  ].sort((a, b) => b.pct - a.pct);
  return { top: slices, top10Pct, deployerPct, holderCount: 120 + Math.floor(random() * 400), complete: true };
}

function buyers(spec: Spec): Buyer[] {
  const out: Buyer[] = [];
  spec.smartIndexes.forEach((index, position) => {
    out.push({
      wallet: SMART[index]!,
      entryLagSec: spec.smartLagSec?.[position] ?? 4 + position * 9,
      quoteInWei: (BigInt(Math.floor(4 + random() * 40)) * 10n ** 16n).toString(),
      taxPaidBps: 19 + Math.floor(random() * 60),
    });
  });
  if (spec.victim) {
    out.push({
      wallet: VICTIM,
      entryLagSec: 12 + Math.floor(random() * 40),
      quoteInWei: (BigInt(Math.floor(3 + random() * 12)) * 10n ** 16n).toString(),
      taxPaidBps: 22 + Math.floor(random() * 80),
    });
  }
  for (let i = 0; i < spec.crowdBuyers; i++) {
    out.push({
      wallet: CROWD[i % CROWD.length]!,
      entryLagSec: 6 + Math.floor(random() * 110),
      quoteInWei: (BigInt(Math.floor(1 + random() * 20)) * 10n ** 16n).toString(),
      taxPaidBps: spec.botOnly ? 9900 : Math.floor(random() * 400),
    });
  }
  return out.sort((a, b) => a.entryLagSec - b.entryLagSec);
}

function launch(spec: Spec, baseBlock: number, baseTime: number, index: number): LaunchRecord {
  const token = addr(`${(index + 160).toString(16)}`);
  const curve = addr(`${(index + 192).toString(16)}`);
  const deployer = addr(`${(index + 208).toString(16)}`);
  const block = baseBlock + Math.round(spec.offsetSec * 10);
  const all = buyers(spec);
  return {
    token,
    curve,
    deployer,
    name: spec.name,
    symbol: spec.symbol,
    block,
    txIndex: 1 + Math.floor(random() * 6),
    logIndex: Math.floor(random() * 4),
    launchedAt: baseTime + spec.offsetSec,
    pairToken: "0x0000000000000000000000000000000000000000" as Address,
    pairSymbol: "ETH",
    phase: spec.phase ?? 0,
    creatorTaxBps: spec.creatorTaxBps,
    creatorFeeRecipient: spec.feesToThirdParty ? addr("fee") : deployer,
    devSharePct: spec.devSharePct,
    exemptWallets: spec.exemptWallets,
    socials: spec.socials
      ? {
          twitter: `https://x.com/${spec.symbol.toLowerCase()}_eth`,
          website: `https://${spec.symbol.toLowerCase()}.fun`,
          telegram: `https://t.me/${spec.symbol.toLowerCase()}`,
        }
      : {},
    quoteReserveWei: (BigInt(Math.round(spec.curveProgress * 4200)) * 10n ** 15n).toString(),
    curveProgress: spec.curveProgress,
    uniqueEarlyBuyers: all.filter((b) => b.entryLagSec <= 60).length,
    deployerRecord: {
      priorLaunches: spec.priorLaunches,
      graduated: spec.graduated,
      fundedBy: spec.fundedBy ? (spec.fundedBy as Address) : undefined,
    },
    buyers: all,
    holders: holders(spec.top10Pct, spec.deployerPct, curve, deployer),
  };
}

// --- cluster one: a clean original with a wall of copies ---------------------
const FARM_FUNDER = "0x9f10Ba3c2e7D4805aC61bE39f0d27C4a8e5B106f";

const peanut: Spec[] = [
  {
    symbol: "PEANUT", name: "Peanut the Squirrel", offsetSec: 0,
    devSharePct: 3.1, exemptWallets: 0, creatorTaxBps: 100, socials: true,
    curveProgress: 0.78, smartIndexes: [0, 1, 2, 3], smartLagSec: [7, 19, 31, 44],
    crowdBuyers: 31, top10Pct: 13.8, deployerPct: 3.1, priorLaunches: 1, graduated: 0,
  },
  {
    // Cyrillic Т at the end. Identical to the eye, a different string on chain.
    symbol: "PEANUТ", name: "Peanut the Squirrel", offsetSec: 41,
    devSharePct: 12.4, exemptWallets: 6, creatorTaxBps: 600, socials: false,
    curveProgress: 0.04, smartIndexes: [], crowdBuyers: 5, victim: true,
    top10Pct: 41.2, deployerPct: 12.4, priorLaunches: 9, graduated: 0,
    fundedBy: FARM_FUNDER, feesToThirdParty: true,
  },
  {
    symbol: "PEAN0T", name: "Peanut", offsetSec: 96,
    devSharePct: 8.8, exemptWallets: 3, creatorTaxBps: 300, socials: false,
    curveProgress: 0.02, smartIndexes: [], crowdBuyers: 3, botOnly: true,
    top10Pct: 33.9, deployerPct: 8.8, priorLaunches: 14, graduated: 0,
    fundedBy: FARM_FUNDER,
  },
  {
    symbol: "PEANUTCOIN", name: "Peanut Coin", offsetSec: 187,
    devSharePct: 2.2, exemptWallets: 0, creatorTaxBps: 200, socials: true,
    curveProgress: 0.11, smartIndexes: [4], crowdBuyers: 9,
    top10Pct: 18.6, deployerPct: 2.2, priorLaunches: 2, graduated: 0,
  },
  {
    symbol: "РEANUT", name: "PEANUT", offsetSec: 342,
    devSharePct: 0, exemptWallets: 0, creatorTaxBps: 0, socials: false,
    curveProgress: 0.0, smartIndexes: [], crowdBuyers: 0,
    top10Pct: 4.1, deployerPct: 0, priorLaunches: 31, graduated: 0,
  },
  {
    // Different ticker, same token name. A symbol-only matcher never sees this
    // one, and it is the shape a copy takes once the obvious ticker is gone.
    symbol: "PNUT", name: "Peanut the Squirrel", offsetSec: 421,
    devSharePct: 9.6, exemptWallets: 2, creatorTaxBps: 400, socials: true,
    curveProgress: 0.08, smartIndexes: [], crowdBuyers: 7, victim: true,
    top10Pct: 29.4, deployerPct: 9.6, priorLaunches: 6, graduated: 0,
  },
  {
    symbol: "PEANUTS", name: "peanuts", offsetSec: 610,
    devSharePct: 4.4, exemptWallets: 1, creatorTaxBps: 150, socials: true,
    curveProgress: 0.06, smartIndexes: [], crowdBuyers: 6,
    top10Pct: 21.7, deployerPct: 4.4, priorLaunches: 3, graduated: 1,
  },
];

// --- cluster two: the first born is the bait --------------------------------
const OPERATOR = "0x2C88fA107b4e59d0aE31Bc7f6d02593aE84c1b7D";

const nova: Spec[] = [
  {
    symbol: "NOVA", name: "Nova", offsetSec: 0,
    devSharePct: 14.9, exemptWallets: 7, creatorTaxBps: 700, socials: false,
    curveProgress: 0.09, smartIndexes: [], crowdBuyers: 4, victim: true,
    top10Pct: 47.5, deployerPct: 14.9, priorLaunches: 22, graduated: 0,
    fundedBy: OPERATOR, feesToThirdParty: true,
  },
  {
    symbol: "N0VA", name: "Nova", offsetSec: 63,
    devSharePct: 11.2, exemptWallets: 5, creatorTaxBps: 500, socials: false,
    curveProgress: 0.01, smartIndexes: [], crowdBuyers: 2, botOnly: true,
    top10Pct: 38.8, deployerPct: 11.2, priorLaunches: 18, graduated: 0,
    fundedBy: OPERATOR,
  },
  {
    symbol: "NOVA", name: "Nova Protocol", offsetSec: 148,
    devSharePct: 2.8, exemptWallets: 0, creatorTaxBps: 100, socials: true,
    phase: 2, curveProgress: 1, smartIndexes: [0, 2, 3, 5], smartLagSec: [11, 26, 38, 52],
    crowdBuyers: 27, top10Pct: 11.9, deployerPct: 2.8, priorLaunches: 4, graduated: 2,
  },
];

// --- cluster three: nobody copied it ----------------------------------------
const solo: Spec[] = [
  {
    symbol: "KETTLE", name: "Kettle", offsetSec: 0,
    devSharePct: 5.0, exemptWallets: 0, creatorTaxBps: 100, socials: true,
    curveProgress: 0.34, smartIndexes: [1], crowdBuyers: 14, victim: true,
    top10Pct: 16.2, deployerPct: 5.0, priorLaunches: 1, graduated: 0,
  },
];

const BASE_BLOCK = 41_882_000;
const BASE_TIME = Math.floor(Date.UTC(2026, 8, 5, 14, 12, 0) / 1000);

async function write(file: string, note: string, specs: Spec[], blockOffset: number, timeOffset: number) {
  const launches = specs.map((spec, index) =>
    launch(spec, BASE_BLOCK + blockOffset, BASE_TIME + timeOffset, index + blockOffset),
  );
  const body = {
    origin: "synthetic" as const,
    note,
    launches,
  };
  const dir = resolve(process.cwd(), "fixtures/clusters");
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, file), JSON.stringify(body, null, 2) + "\n", "utf8");
  process.stdout.write(`wrote fixtures/clusters/${file} (${launches.length} launches)\n`);
  return launches;
}

async function main() {
  const a = await write(
    "peanut.json",
    "A clean first born and five copies, two of them separated from the original only by a lookalike character. Shaped by hand, not captured from the chain.",
    peanut,
    0,
    0,
  );
  const b = await write(
    "nova.json",
    "The case that costs money: the first born is the operator's own bait, and the launch with the flow is number three. Shaped by hand, not captured from the chain.",
    nova,
    9_000,
    900,
  );
  await write(
    "kettle.json",
    "A launch nobody bothered to copy, so the tool has something quiet to print. Shaped by hand, not captured from the chain.",
    solo,
    18_000,
    1800,
  );

  // A registry that matches the buyers above, so convergence has something to find.
  const wallets: SmartWallet[] = SMART.map((address, index) => ({
    address,
    entries: 22 + index * 3,
    graduated: 4 + (index % 3),
    hitRate: Number(((4 + (index % 3)) / (22 + index * 3)).toFixed(4)),
    medianLagSec: 9 + index * 4,
    topEntryShare: Number((0.21 + index * 0.05).toFixed(2)),
    note: "synthetic fixture wallet",
  }));
  const registry: Registry = {
    source: "SYNTHETIC fixture registry, not built from chain history",
    builtAt: new Date(BASE_TIME * 1000).toISOString(),
    windowBlocks: 400_000,
    wallets,
  };
  await writeFile(
    resolve(process.cwd(), "fixtures/smart-wallets.json"),
    JSON.stringify(registry, null, 2) + "\n",
    "utf8",
  );
  process.stdout.write(`wrote fixtures/smart-wallets.json (${wallets.length} wallets)\n`);
  process.stdout.write(`total launches: ${a.length + b.length + solo.length}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});

/**
 * Size, and what came back out.
 *
 * Two things the rest of novamp was missing, both of them pure arithmetic over
 * event lists, both offline testable, neither of them touching the network.
 *
 * **Size, not count.** `uniqueEarlyBuyers` counts wallets, and wallets are the
 * cheapest thing in this market. Twenty five addresses spending a dollar each
 * and twenty five spending five hundred are the same number and a completely
 * different event. Everything in `summarizeFlow` is denominated in quote.
 *
 * **The sell side.** Everything on the buy side is arrangeable by the operator:
 * he chooses the dev buy, the exemptions, the socials, and he can fund twenty
 * wallets to walk in behind him. What he cannot stage is somebody taking money
 * back out. The first big sale, its size against the reserve, and whether the
 * deployer's own wallet moved are the only signals in this tool that describe
 * what a launch is doing rather than how it was set up.
 */

import type { Buyer, FlowStats, Sell, SellActivity } from "../types.js";

/** A sale bigger than this share of the reserve it hit counts as significant. */
export const BIG_SELL_SHARE = 0.08;

/** Buys later than this are not "early" for flow purposes. */
export const EARLY_WINDOW_SEC = 60;

function toWei(value: string): bigint {
  try {
    return BigInt(value || "0");
  } catch {
    return 0n;
  }
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/**
 * Ratio of two bigints as a plain number, without losing everything to integer
 * division. Four decimal places is far more precision than any of these signals
 * deserve, and it avoids `Number(bigint)` overflowing on large reserves.
 */
export function ratio(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Number((part * 10_000n) / whole) / 10_000;
}

export function medianWei(values: readonly bigint[]): bigint {
  if (!values.length) return 0n;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  // Even count: the lower of the two middles rather than their average. The
  // average of two wei values is not a ticket anybody actually paid, and this
  // number exists to describe a real ticket.
  return sorted.length % 2 ? sorted[mid]! : sorted[mid - 1]!;
}

export interface FlowOptions {
  earlyWindowSec: number;
  /** A buy paying more than this in bps was racing the block. */
  racedTaxBps: number;
  complete: boolean;
}

export const DEFAULT_FLOW_OPTIONS: FlowOptions = {
  earlyWindowSec: EARLY_WINDOW_SEC,
  racedTaxBps: 5000,
  complete: true,
};

/**
 * Turn a buyer list into the size of the flow behind it.
 *
 * `top3Share` is the one that does the work. A launch where three wallets are
 * 85 % of the money is one person with three wallets, however many other
 * addresses walked past afterwards.
 */
export function summarizeFlow(
  buyers: readonly Buyer[] | undefined,
  options: FlowOptions = DEFAULT_FLOW_OPTIONS,
): FlowStats {
  if (!buyers) {
    return {
      quoteInWei: "0",
      medianTicketWei: "0",
      top3Share: 0,
      uniqueBuyers: 0,
      racedShare: 0,
      complete: false,
    };
  }

  const early = buyers.filter((buyer) => buyer.entryLagSec <= options.earlyWindowSec);
  const tickets = early.map((buyer) => toWei(buyer.quoteInWei));
  const total = sum(tickets);
  const top3 = sum([...tickets].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0)).slice(0, 3));
  const raced = early.filter((buyer) => buyer.taxPaidBps > options.racedTaxBps).length;

  return {
    quoteInWei: total.toString(),
    medianTicketWei: medianWei(tickets).toString(),
    top3Share: ratio(top3, total),
    uniqueBuyers: early.length,
    racedShare: early.length ? raced / early.length : 0,
    complete: options.complete,
  };
}

export interface SellOptions {
  bigSellShare: number;
  complete: boolean;
}

export const DEFAULT_SELL_OPTIONS: SellOptions = {
  bigSellShare: BIG_SELL_SHARE,
  complete: true,
};

/**
 * Roll a sale list up into the four questions worth asking.
 *
 * Note what is deliberately absent: any claim about intent. A deployer taking
 * money out is reported, not interpreted. He may be paying for a marketing push
 * and he may be leaving. The number says what happened and how fast.
 */
export function summarizeSells(
  sells: readonly Sell[] | undefined,
  quoteInWei: string,
  options: SellOptions = DEFAULT_SELL_OPTIONS,
): SellActivity {
  if (!sells) {
    return {
      sells: [],
      firstBigSellSec: null,
      largestShare: 0,
      sellBuyRatio: 0,
      deployerSold: false,
      deployerSoldAtSec: null,
      complete: false,
    };
  }

  const ordered = [...sells].sort((a, b) => a.atSec - b.atSec);
  const firstBig = ordered.find((sale) => sale.shareOfReserve >= options.bigSellShare);
  const deployerSale = ordered.find((sale) => sale.isDeployer);
  const out = sum(ordered.map((sale) => toWei(sale.quoteOutWei)));

  return {
    sells: ordered,
    firstBigSellSec: firstBig ? firstBig.atSec : null,
    largestShare: ordered.reduce((max, sale) => Math.max(max, sale.shareOfReserve), 0),
    sellBuyRatio: ratio(out, toWei(quoteInWei)),
    deployerSold: Boolean(deployerSale),
    deployerSoldAtSec: deployerSale ? deployerSale.atSec : null,
    complete: options.complete,
  };
}

/** Wei to a rough number of ether, for threshold comparisons only. */
export function etherOf(wei: string | bigint): number {
  const value = typeof wei === "bigint" ? wei : toWei(wei);
  // Milli-ether as an integer first, so a 1000 ETH reserve does not lose the
  // small end of the range to floating point.
  return Number(value / 10n ** 15n) / 1000;
}

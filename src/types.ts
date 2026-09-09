/**
 * The shapes every layer of novamp agrees on.
 *
 * A `LaunchRecord` is everything novamp knows about one pons v2 launch. The
 * live reader and the demo fixture loader both produce this, which is why the
 * verdict, risk and potential layers never touch an RPC and can be tested
 * offline line by line.
 */

export type Address = `0x${string}`;

/** pons v2 lifecycle. 0 curve, 1 swept, 2 uniswap v4 pool, 3 rescued. */
export type Phase = 0 | 1 | 2 | 3;
export const PHASE_NAME = ["curve", "swept", "pool", "rescued"] as const;

export interface Socials {
  twitter?: string;
  telegram?: string;
  website?: string;
  discord?: string;
  farcaster?: string;
}

export interface DeployerRecord {
  /** Launches by this address inside the indexed window, this one included. */
  priorLaunches: number;
  /** How many of those reached phase 2. */
  graduated: number;
  /** First address that ever sent this deployer native value, when readable. */
  fundedBy?: Address;
  /** Unix seconds of the deployer's first seen activity. */
  firstSeenAt?: number;
}

export interface Buyer {
  wallet: Address;
  /** Seconds between the launch and this wallet's first buy. */
  entryLagSec: number;
  quoteInWei: string;
  /** Opening tax paid in basis points. 9900 means the wallet raced the block. */
  taxPaidBps: number;
}

/**
 * One sale off the curve.
 *
 * The sell side is the only place a launch tells you what it is going to do
 * rather than what it was set up to look like. Everything on the buy side is
 * arrangeable by the operator; the first person taking money back out is not.
 */
export interface Sell {
  wallet: Address;
  /** Seconds after the launch. */
  atSec: number;
  quoteOutWei: string;
  /**
   * This sale as a share of the curve's quote reserve just before it, 0..1.
   * A 0.2 means one wallet took a fifth of everything that had gone in.
   */
  shareOfReserve: number;
  isDeployer: boolean;
}

/**
 * What the sell side did in the observed window.
 *
 * `complete: false` means the reader gave up part way, so every count here is a
 * floor. The scoring treats an incomplete read as unread rather than as calm.
 */
export interface SellActivity {
  sells: Sell[];
  /** Seconds to the first sale over the significance threshold, or null. */
  firstBigSellSec: number | null;
  /** Largest single sale as a share of the reserve it hit. */
  largestShare: number;
  /** Quote taken out over quote put in, across the window. */
  sellBuyRatio: number;
  deployerSold: boolean;
  /** Seconds to the deployer's first sale, or null. */
  deployerSoldAtSec: number | null;
  complete: boolean;
}

/**
 * The size of the early flow, as opposed to the count of it.
 *
 * Twenty five wallets spending a dollar each and twenty five spending five
 * hundred are the same number and not the same event. Counting wallets is
 * exactly what a farm is optimised against, because wallets are free.
 */
export interface FlowStats {
  /** Total quote spent by early buyers. */
  quoteInWei: string;
  /** Median ticket, which is far more honest than the mean here. */
  medianTicketWei: string;
  /** Share of early quote volume coming from the three biggest wallets, 0..1. */
  top3Share: number;
  uniqueBuyers: number;
  /** Share of early buyers that paid the full opening tax, 0..1. */
  racedShare: number;
  complete: boolean;
}

export interface HolderSlice {
  wallet: Address;
  pct: number;
  /** Curve, pool, deployer and burn addresses are labelled, not silently dropped. */
  label?: "curve" | "pool" | "deployer" | "burn" | "escrow";
}

export interface HolderSnapshot {
  /** Top holders excluding curve and pool, largest first. */
  top: HolderSlice[];
  /** Sum of the top ten, excluding curve and pool. */
  top10Pct: number;
  deployerPct: number;
  /** Wallets with any balance, when the reader could count them. */
  holderCount?: number;
  /** False when the reader had to give up mid-count on a rate limited RPC. */
  complete: boolean;
}

export interface LaunchRecord {
  token: Address;
  curve: Address;
  deployer: Address;
  name: string;
  symbol: string;

  /** Ordering triple. This, not the timestamp, decides who was first. */
  block: number;
  txIndex: number;
  logIndex: number;
  launchedAt: number;

  pairToken: Address;
  pairSymbol: string;
  phase: Phase;

  creatorTaxBps: number;
  creatorFeeRecipient: Address;
  /** Share of supply the deployer bought in the launch transaction. */
  devSharePct: number;
  /** Addresses declared exempt from the opening tax at launch: the declared bundle. */
  exemptWallets: number;

  socials: Socials;
  /** Real quote reserve on the curve, or pool liquidity after graduation. */
  quoteReserveWei: string;
  /** Curve fill toward the graduation threshold, 0..1. */
  curveProgress: number;
  /** Distinct wallets that bought in the first minute, when readable. */
  uniqueEarlyBuyers?: number;

  deployerRecord?: DeployerRecord;
  buyers?: Buyer[];
  holders?: HolderSnapshot;
  /** Size of the early buy flow. Derived from `buyers`, cached on the record. */
  flow?: FlowStats;
  /** What came back out of the curve in the observed window. */
  sellActivity?: SellActivity;
}

export type TokenVerdict =
  /** First born and nothing against it. */
  | "ORIGINAL"
  /** First born, but it looks like the operator launched it to be the bait. */
  | "TAINTED"
  /** Not first, but the flow and the proven wallets are here anyway. */
  | "CONTESTED"
  /** Later copy with nothing of its own. */
  | "VAMP"
  /** Nothing is trading. */
  | "DEAD";

export type ClusterVerdict =
  /** One clear original, the rest are obvious copies. */
  | "CLEAN"
  /** The first born is dirty and the money is somewhere else in the cluster. */
  | "CONTESTED"
  /** Several members share a funder or a fingerprint: one operator, many wallets. */
  | "FARM"
  /** Only one launch carries this name. */
  | "SOLO";

export type RiskLevel = "GREEN" | "AMBER" | "RED" | "UNKNOWN";

export interface Reason {
  points: number;
  text: string;
}

export interface RiskFlag {
  level: RiskLevel;
  code: string;
  text: string;
}

export interface Assessment {
  record: LaunchRecord;
  /** Position in the cluster by birth order, 1 is first. */
  rank: number;
  /** Seconds after the first born. 0 for the first born itself. */
  lagSec: number;
  verdict: TokenVerdict;
  /** 0..100, every point traceable to one line in src/vamp/potential.ts. */
  potential: number;
  reasons: Reason[];
  risk: RiskLevel;
  flags: RiskFlag[];
  /** Proven wallets found in this launch's early buyers. */
  smartWallets: number;
  /** True when those wallets arrived inside the convergence window. */
  converged: boolean;
}

export interface Cluster {
  /** The normalised key every member collapses to. */
  key: string;
  /** What a human would call this cluster. Usually the first born's symbol. */
  label: string;
  verdict: ClusterVerdict;
  members: Assessment[];
  /** Seconds between the first born and the first copy. Null when solo. */
  vampLagSec: number | null;
  /** Copies per original in this cluster. */
  vampRatio: number;
  notes: string[];
}

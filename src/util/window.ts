/**
 * Time windows, and the awkward truth about them.
 *
 * A block on Robinhood Chain seals about every 100 ms. Thirty days is therefore
 * around 26 million blocks, and there is no public endpoint on earth that will
 * serve you `eth_getLogs` over that range. Any tool offering a 30 day filter
 * straight off an RPC is either lying or quietly paying an indexer.
 *
 * novamp does neither. `--since` filters whatever novamp has, and what novamp
 * has grows: every run appends what it read to a local index (`src/store/`), so
 * a window is short on day one and a month long a month later. Plain append-only
 * files, no database, nothing to migrate.
 *
 * When a requested window is wider than the index actually covers, the commands
 * say so out loud rather than returning a confident short answer.
 */

export const SECOND = 1;
export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86_400;

const UNITS: Record<string, number> = {
  s: SECOND,
  m: MINUTE,
  h: HOUR,
  d: DAY,
  w: 7 * DAY,
};

export class WindowParseError extends Error {}

/**
 * "24h" → 86400. Accepts s, m, h, d, w, a bare number of hours, and "all".
 *
 * Returns `null` for "all", which every caller treats as no lower bound. That is
 * a deliberate sentinel rather than `0`: a zero window and an unbounded one are
 * different intentions and reading `null` at the call site makes that obvious.
 */
export function parseWindow(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text || text === "all" || text === "max") return null;

  const match = /^(\d+(?:\.\d+)?)\s*([smhdw])?$/.exec(text);
  if (!match) {
    throw new WindowParseError(
      `cannot read "${input}" as a window. Try 6h, 24h, 7d, 30d, 2w, or all.`,
    );
  }
  const amount = Number(match[1]);
  const unit = UNITS[match[2] ?? "h"]!;
  const seconds = Math.round(amount * unit);
  if (seconds <= 0) throw new WindowParseError("a window has to be longer than nothing.");
  return seconds;
}

/** Seconds back to the shortest label a human reads without pausing. */
export function describeWindow(seconds: number | null): string {
  if (seconds === null) return "everything indexed";
  // Days win below a fortnight: people say "7d", not "1w", and a label that does
  // not match what they typed reads like the tool changed their mind.
  if (seconds >= 14 * DAY && seconds % (7 * DAY) === 0) return `${seconds / (7 * DAY)}w`;
  if (seconds >= DAY && seconds % DAY === 0) return `${seconds / DAY}d`;
  if (seconds >= HOUR && seconds % HOUR === 0) return `${seconds / HOUR}h`;
  if (seconds >= MINUTE && seconds % MINUTE === 0) return `${seconds / MINUTE}m`;
  return `${seconds}s`;
}

/** How many blocks a window is, at the chain's block time. */
export function windowToBlocks(seconds: number, blockMs = 100): number {
  return Math.ceil((seconds * 1000) / blockMs);
}

export interface Coverage {
  /** Oldest launch the index holds, unix seconds. */
  oldest: number | null;
  /** Newest launch the index holds. */
  newest: number | null;
  /** Seconds between them. */
  spanSec: number;
}

/**
 * Is the index deep enough to answer this question?
 *
 * Returning "no" here is the whole point of the function. A window filter that
 * silently returns three days of data when the user asked for thirty is how a
 * tool ends up producing confident, wrong statistics.
 */
export function coversWindow(
  coverage: Coverage,
  windowSec: number | null,
): { covered: boolean; shortBySec: number } {
  if (windowSec === null) return { covered: true, shortBySec: 0 };
  const short = windowSec - coverage.spanSec;
  return { covered: short <= 0, shortBySec: Math.max(0, short) };
}

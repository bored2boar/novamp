/**
 * One gate in front of the public RPC.
 *
 * The public Robinhood endpoint answers state reads generously and rate limits
 * `eth_getLogs` hard. Firing a cluster's worth of log reads at it in parallel
 * gets you a 429 and a half-built table, which is worse than a slow one. So
 * requests go through here: a small in-flight cap, a minimum spacing between
 * calls, and a wider spacing for log reads specifically.
 */

export interface GateOptions {
  inFlight: number;
  spacingMs: number;
  logSpacingMs: number;
}

export const DEFAULT_GATE: GateOptions = {
  inFlight: 3,
  spacingMs: 60,
  logSpacingMs: 400,
};

type Task<T> = () => Promise<T>;

export class RpcGate {
  private active = 0;
  private lastStart = 0;
  private lastLogStart = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly options: GateOptions = DEFAULT_GATE) {}

  /** Run `task`, waiting for a slot and for the spacing window. */
  async run<T>(task: Task<T>, kind: "state" | "logs" = "state"): Promise<T> {
    await this.acquire();
    try {
      const spacing = kind === "logs" ? this.options.logSpacingMs : this.options.spacingMs;
      const last = kind === "logs" ? this.lastLogStart : this.lastStart;
      const wait = last + spacing - Date.now();
      if (wait > 0) await sleep(wait);
      const now = Date.now();
      this.lastStart = now;
      if (kind === "logs") this.lastLogStart = now;
      return await task();
    } finally {
      this.release();
    }
  }

  /**
   * Run a task, retrying on the errors a public endpoint throws when it is busy.
   * Anything that is not a rate limit or a timeout is thrown straight through:
   * retrying a bad request just makes the failure slower.
   */
  async retry<T>(task: Task<T>, kind: "state" | "logs" = "state", attempts = 4): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.run(task, kind);
      } catch (err) {
        lastError = err;
        if (!isTransient(err)) throw err;
        await sleep(300 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  private async acquire(): Promise<void> {
    if (this.active < this.options.inFlight) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

export function isTransient(err: unknown): boolean {
  const text = String((err as Error)?.message ?? err).toLowerCase();
  return (
    text.includes("429") ||
    text.includes("rate limit") ||
    text.includes("too many requests") ||
    text.includes("timeout") ||
    text.includes("econnreset") ||
    text.includes("socket hang up") ||
    text.includes("503")
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

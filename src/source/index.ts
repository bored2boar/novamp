/**
 * Where launches come from.
 *
 * Two implementations answer this interface: `live` reads Robinhood Chain, and
 * `demo` replays a fixture file. Every layer above this one is identical in both
 * cases, which is why `--demo` is a real exercise of the tool and not a mock of
 * its output.
 */

import type { LaunchRecord } from "../types.js";

export interface LaunchSource {
  readonly kind: "live" | "demo";
  /** Human readable description for the header line. */
  readonly describe: string;
  /** Every launch in the window, unsorted. */
  recent(): Promise<LaunchRecord[]>;
  /** One launch by token address, or null. */
  byToken(token: string): Promise<LaunchRecord | null>;
}

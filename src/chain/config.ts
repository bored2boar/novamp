/** Network constants, kept away from the transport so they can be read at a glance. */

export const ROBINHOOD_CHAIN_ID = 4663;
export const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

/** pons v2 launch factory. Source: docs.ponsfamily.com/v2. */
export const DEFAULT_PONS_V2_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";

/** Blocks seal about every 100 ms, so a block count converts to time cheaply. */
export const BLOCK_MS = 100;

/** The only launch config live at the time of writing: 1B tokens, 18 decimals. */
export const DEFAULT_SUPPLY = 1_000_000_000n * 10n ** 18n;

export const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

export function blocksToMs(blocks: number): number {
  return blocks * BLOCK_MS;
}

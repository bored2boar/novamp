/** Formatting helpers. Nothing here reads config or the network. */

export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function bpsToPct(bps: number, digits = 2): string {
  return `${(bps / 100).toFixed(digits)}%`;
}

/** Seconds as the shortest thing a human reads without pausing. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "?";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}h${m ? ` ${m}m` : ""}`;
}

/** Wei to a human number of ether, without dragging in a big-decimal library. */
export function ether(wei: string | bigint, digits = 3): string {
  const value = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  const whole = value / 10n ** 18n;
  const frac = value % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, digits);
  return digits > 0 ? `${whole}.${fracStr}` : whole.toString();
}

/** Pad a string to a display width, ignoring ANSI escapes. */
export function padVisible(text: string, width: number): string {
  const visible = text.replace(/\[[0-9;]*m/g, "");
  const chars = [...visible].length;
  return chars >= width ? text : text + " ".repeat(width - chars);
}

export function visibleWidth(text: string): number {
  return [...text.replace(/\[[0-9;]*m/g, "")].length;
}

/** Cut a string to width, ignoring ANSI escapes, with an ellipsis if it was cut. */
export function truncate(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  const plain = text.replace(/\[[0-9;]*m/g, "");
  return [...plain].slice(0, Math.max(1, width - 1)).join("") + "…";
}

export function iso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

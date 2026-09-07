/** A small column-aligned table that survives ANSI colour. */

import { padVisible, truncate, visibleWidth } from "../util/fmt.js";
import { dim } from "./color.js";

export interface Column {
  header: string;
  width: number;
  align?: "left" | "right";
}

export function renderTable(columns: Column[], rows: string[][]): string {
  const widths = columns.map((column, index) => {
    const longest = rows.reduce(
      (max, row) => Math.max(max, visibleWidth(row[index] ?? "")),
      visibleWidth(column.header),
    );
    return Math.min(column.width, longest);
  });

  const line = (cells: string[]) =>
    cells
      .map((cell, index) => {
        const width = widths[index]!;
        const cut = truncate(cell, width);
        return columns[index]?.align === "right"
          ? " ".repeat(Math.max(0, width - visibleWidth(cut))) + cut
          : padVisible(cut, width);
      })
      .join("  ")
      .trimEnd();

  const out: string[] = [];
  out.push(dim(line(columns.map((c) => c.header.toUpperCase()))));
  out.push(dim(widths.map((w) => "─".repeat(w)).join("  ")));
  for (const row of rows) out.push(line(row));
  return out.join("\n");
}

/** A key/value block for single-record views. */
export function renderPairs(pairs: [string, string][], labelWidth = 22): string {
  return pairs
    .map(([key, value]) => `${dim(padVisible(key, labelWidth))}${value}`)
    .join("\n");
}

/** Logging. Warnings go to stderr so `--json` output stays pipeable. */

import { dim, red, yellow } from "../ui/color.js";

let quiet = false;

export function setQuiet(value: boolean): void {
  quiet = value;
}

export function info(message: string): void {
  if (!quiet) process.stderr.write(`${dim("·")} ${message}\n`);
}

export function warn(message: string): void {
  if (!quiet) process.stderr.write(`${yellow("!")} ${message}\n`);
}

export function fail(message: string): void {
  process.stderr.write(`${red("✕")} ${message}\n`);
}

#!/usr/bin/env node
// Thin launcher. Prefers the compiled build, falls back to the TypeScript
// sources through tsx so a fresh clone works before `npm run build`.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const built = resolve(here, "../dist/src/cli.js");

if (existsSync(built)) {
  await import(built);
} else {
  const { register } = await import("tsx/esm/api").catch(() => ({ register: null }));
  if (!register) {
    console.error(
      "novamp: no build found and tsx is not installed.\n" +
        "  run `npm install` then `npm run build`, or use `npm start -- <command>`.",
    );
    process.exit(1);
  }
  register();
  await import(resolve(here, "../src/cli.ts"));
}

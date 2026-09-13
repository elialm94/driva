process.env.DRIVA_TEST = "1";

import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * AGENTS.md består av två delar: blocket som `next dev` genererar mellan sina
 * markörer (som ska lämnas i fred, annars skrivs det bara tillbaka) och
 * projektreglerna UNDER slutmarkören. Vakten ser till att projektreglerna inte
 * försvinner och inte glider upp i det genererade blocket.
 */

const root = process.cwd();
const agents = readFileSync(path.join(root, "AGENTS.md"), "utf8");
const claude = readFileSync(path.join(root, "CLAUDE.md"), "utf8");

const BEGIN = "<!-- BEGIN:nextjs-agent-rules -->";
const END = "<!-- END:nextjs-agent-rules -->";

test("det genererade blocket ligger först och orört", () => {
  assert.ok(agents.startsWith(BEGIN), "BEGIN-markören ska vara filens första rad");
  const end = agents.indexOf(END);
  assert.ok(end > 0, "END-markören ska finnas kvar");
});

test("projektreglerna ligger under slutmarkören", () => {
  const below = agents.slice(agents.indexOf(END) + END.length);
  assert.match(below, /# Ferva - project rules for agents/);
  for (const needle of [
    "docs/agent/FEATURE_MAP.md",
    "GO_LIVE_CHECKLIST.md",
    "docs/ai.md",
    "src/lib/status-labels.ts",
    "src/lib/autopilot.ts",
    "src/lib/brand-scan.test.ts",
    "src/lib/accounting/engine.ts",
    "src/lib/services/",
    "npm run test:adapter",
  ]) {
    assert.ok(below.includes(needle), `AGENTS.md ska peka på ${needle}`);
  }
});

test("CLAUDE.md pekar på AGENTS.md", () => {
  assert.equal(claude.trim(), "@AGENTS.md");
});

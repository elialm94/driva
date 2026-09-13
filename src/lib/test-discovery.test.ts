process.env.DRIVA_TEST = "1";

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Vakt mot testfiler som aldrig körs.
 *
 * `test`-scriptet räknade tidigare upp katalogerna för hand, och
 * src/lib/services/ stod inte i listan: articles.test.ts och
 * automatic-reminders.test.ts kördes varken av `npm test` eller av CI.
 * Den här filen faller om någon testfil under src/ hamnar utanför
 * mönstren igen - oavsett om det beror på en ny katalog eller på att
 * scriptet skrivs om till en handskriven lista.
 */

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

/** Mönstren som `npm test` faktiskt skickar till testkörningen. */
function testPatterns(script: string): string[] {
  const marker = "--test";
  const at = script.indexOf(marker);
  assert.ok(at >= 0, "test-scriptet ska köra tsx --test");
  const args = script.slice(at + marker.length);
  return Array.from(args.matchAll(/"([^"]+)"|(\S+)/g))
    .map((m) => m[1] ?? m[2])
    .filter((token) => token.includes(".test."));
}

/** Minimal glob → RegExp: `**` = noll eller flera kataloger, `*` = inom ett segment. */
function globToRegExp(pattern: string): RegExp {
  let out = "^";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*") {
      if (pattern[i + 1] === "*" && pattern[i + 2] === "/") {
        out += "(?:[^/]+/)*";
        i += 3;
        continue;
      }
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }
    out += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  return new RegExp(`${out}$`);
}

function collectTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      collectTestFiles(rel, acc);
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      acc.push(rel);
    }
  }
  return acc;
}

const patterns = testPatterns(pkg.scripts?.test ?? "");
const matchers = patterns.map(globToRegExp);
const files = collectTestFiles("src").sort();

test("glob-omvandlingen i vakten fungerar", () => {
  const re = globToRegExp("src/**/*.test.ts");
  assert.equal(re.test("src/lib/format.test.ts"), true);
  assert.equal(re.test("src/lib/services/articles.test.ts"), true);
  assert.equal(re.test("src/lib/en/djup/katalog/x.test.ts"), true);
  assert.equal(re.test("src/format.test.ts"), true);
  assert.equal(re.test("src/lib/format.ts"), false);
  assert.equal(re.test("src/lib/format.test.tsx"), false);
  assert.equal(globToRegExp("src/lib/*.test.ts").test("src/lib/services/x.test.ts"), false);
});

test("npm test kör varje testfil under src/", () => {
  assert.ok(patterns.length > 0, "test-scriptet ska ange minst ett testmönster");
  assert.ok(files.length > 150, `orimligt få testfiler hittades (${files.length}) - gick vandringen fel?`);

  const missed = files.filter((file) => !matchers.some((re) => re.test(file)));
  assert.deepEqual(
    missed,
    [],
    `dessa testfiler körs inte av npm test: ${missed.join(", ")}. Lägg till dem i package.json → scripts.test.`
  );
});

test("src/lib/services-testerna ingår (de var tidigare tysta)", () => {
  for (const file of ["src/lib/services/articles.test.ts", "src/lib/services/automatic-reminders.test.ts"]) {
    assert.ok(files.includes(file), `${file} ska finnas kvar`);
    assert.ok(matchers.some((re) => re.test(file)), `${file} ska matchas av testmönstren`);
  }
});

test("en ny katalog under src/ fångas utan att scriptet ändras", () => {
  for (const future of [
    "src/lib/nyfunktion/nyfunktion.test.ts",
    "src/lib/services/nasta/x.test.ts",
    "src/components/knapp.test.tsx",
  ]) {
    assert.ok(
      matchers.some((re) => re.test(future)),
      `${future} skulle inte köras - mönstren måste vara rekursiva`
    );
  }
});

process.env.DRIVA_TEST = "1";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Tankstreckskanning: ett tankstreck (U+2014) får inte användas som
 * skiljetecken i löpande text. Husregeln är bindestreck, eller att meningen
 * skrivs om.
 *
 * Vad som flaggas: ett tankstreck med blanktecken på minst en sida, i en
 * stränglitteral eller i JSX-text.
 *
 * Vad som är tillåtet och måste fortsätta fungera: platshållaren "—" som är
 * HELA strängen. Den betyder "inget värde" i tabellerna och är korrekt
 * typografi.
 *
 * Kommentarer ligger utanför den här vakten. De är inte användarsynlig text,
 * och existerande kommentarer med tankstreck skrivs inte om på eget bevåg.
 */

const ROOT = process.cwd();
const EM_DASH = "\u2014";

type Context = "code" | "string" | "comment";

/**
 * Enkel lexer: räcker för att skilja stränglitteral och JSX-text från
 * kommentar. "code" täcker både JSX-text och vanlig kod - ett tankstreck i
 * ren kod utanför en sträng vore ändå ett syntaxfel.
 */
function contexts(source: string): Context[] {
  const out: Context[] = new Array(source.length);
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out[i] = "string";
      if (ch === "\\") {
        if (i + 1 < source.length) out[i + 1] = "string";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") out[i++] = "comment";
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) out[i++] = "comment";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out[i] = "string";
      i += 1;
      continue;
    }
    out[i] = "code";
    i += 1;
  }
  return out;
}

/** Är tankstrecket vid `at` hela innehållet i sin stränglitteral? */
function isStandalonePlaceholder(source: string, at: number): boolean {
  const before = source[at - 1];
  const after = source[at + 1];
  return (
    (before === '"' || before === "'" || before === "`") &&
    (after === '"' || after === "'" || after === "`")
  );
}

export interface DashHit {
  file: string;
  line: number;
  text: string;
}

/** Tankstreck som skiljetecken i text: blanktecken på minst en sida. */
export function findProseEmDashes(file: string, source: string): DashHit[] {
  const ctx = contexts(source);
  const hits: DashHit[] = [];
  for (let i = source.indexOf(EM_DASH); i !== -1; i = source.indexOf(EM_DASH, i + 1)) {
    if (ctx[i] !== "string" && ctx[i] !== "code") continue;
    if (isStandalonePlaceholder(source, i)) continue;
    const before = source[i - 1] ?? "";
    const after = source[i + 1] ?? "";
    if (!/\s/.test(before) && !/\s/.test(after)) continue;
    const line = source.slice(0, i).split("\n").length;
    hits.push({ file, line, text: source.split("\n")[line - 1].trim() });
  }
  return hits;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(rel, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(rel);
  }
  return acc;
}

test("inget tankstreck som skiljetecken i strängar eller JSX-text", () => {
  const hits = sourceFiles("src").flatMap((file) =>
    findProseEmDashes(file, readFileSync(path.join(ROOT, file), "utf8"))
  );
  assert.deepEqual(
    hits.map((h) => `${h.file}:${h.line}  ${h.text}`),
    [],
    "använd bindestreck eller skriv om meningen"
  );
});

test("vakten hittar tankstreck i text men lämnar platshållaren i fred", () => {
  const flagged = [
    `const t = "Allt klart ${EM_DASH} inget att göra.";`,
    `<p>Allt klart ${EM_DASH} inget att göra.</p>`,
    `const t = \`Klart ${EM_DASH} \${namn}\`;`,
    `const t = "Klart${EM_DASH} inget mer";`,
  ];
  for (const source of flagged) {
    assert.equal(findProseEmDashes("prov.tsx", source).length, 1, source);
  }

  const allowed = [
    // Platshållaren: hela strängen är ett tankstreck.
    `const tom = "${EM_DASH}";`,
    `const tom = '${EM_DASH}';`,
    `<td>{value ?? "${EM_DASH}"}</td>`,
    // Kommentarer är utanför vaktens område.
    `// Ett kommentarstreck ${EM_DASH} lämnas i fred`,
    `/* Block ${EM_DASH} också */`,
    // Bindestreck och tankstreck utan blanktecken runt är inte skiljetecken.
    `const t = "Allt klart - inget att göra.";`,
    `const t = "2026${EM_DASH}2027";`,
  ];
  for (const source of allowed) {
    assert.deepEqual(findProseEmDashes("prov.tsx", source), [], source);
  }
});

test("platshållaren finns kvar i produktionskoden", () => {
  // Om den försvann vore den första testet meningslöst att undanta.
  const placeholders = sourceFiles("src").filter((file) => {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    return source.includes(`"${EM_DASH}"`) || source.includes(`'${EM_DASH}'`);
  });
  assert.ok(placeholders.length > 0, "tabellernas platshållare ska fortsatt vara tillåten");
});

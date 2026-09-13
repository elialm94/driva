process.env.DRIVA_TEST = "1";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Tankstreckskanning: ett tankstreck får inte användas som skiljetecken i
 * löpande text. Husregeln är bindestreck, eller att meningen skrivs om.
 *
 * Vad som flaggas: ett tankstreck med blanktecken på minst en sida, i en
 * stränglitteral eller i JSX-text.
 *
 * Vad som är tillåtet och måste fortsätta fungera: platshållaren "—" som är
 * HELA strängen. Den betyder "inget värde" i tabellerna och är korrekt
 * typografi. Undantaget gäller "–" på exakt samma sätt.
 *
 * Två tankstreck, samma villkor: det långa (U+2014) och det korta (U+2013)
 * läses likadant i prosa och behandlas identiskt av lexern. Det långa vaktas
 * i hela src. Det korta vaktas i bokföringsytan (BOKFORING), som är städad.
 * Resten av src bär fortfarande korta tankstreck i prosa och städas separat
 * innan vakten kan gälla hela trädet - en vakt som är röd från start vaktar
 * ingenting.
 *
 * Kommentarer ligger utanför den här vakten. De är inte användarsynlig text,
 * och existerande kommentarer med tankstreck skrivs inte om på eget bevåg.
 */

const ROOT = process.cwd();
const EM_DASH = "\u2014";
const EN_DASH = "\u2013";
const DASHES = [EM_DASH, EN_DASH];

/** Bokföringsytan: här gäller vakten båda tankstrecken. */
const BOKFORING = [
  "src/lib/accounting/",
  "src/lib/bas.ts",
  "src/lib/ai/accounting-domain.ts",
];

/** Vilka tankstreck vaktas i den här filen? */
function dashesFor(file: string): string[] {
  return BOKFORING.some((p) => file === p || file.startsWith(p)) ? DASHES : [EM_DASH];
}

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
export function findProseDashes(
  file: string,
  source: string,
  dashes: string[] = DASHES
): DashHit[] {
  const ctx = contexts(source);
  const hits: DashHit[] = [];
  for (const dash of dashes) {
    for (let i = source.indexOf(dash); i !== -1; i = source.indexOf(dash, i + 1)) {
      if (ctx[i] !== "string" && ctx[i] !== "code") continue;
      if (isStandalonePlaceholder(source, i)) continue;
      const before = source[i - 1] ?? "";
      const after = source[i + 1] ?? "";
      if (!/\s/.test(before) && !/\s/.test(after)) continue;
      const line = source.slice(0, i).split("\n").length;
      hits.push({ file, line, text: source.split("\n")[line - 1].trim() });
    }
  }
  hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
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
    findProseDashes(file, readFileSync(path.join(ROOT, file), "utf8"), dashesFor(file))
  );
  assert.deepEqual(
    hits.map((h) => `${h.file}:${h.line}  ${h.text}`),
    [],
    "använd bindestreck eller skriv om meningen"
  );
});

test("vakten hittar tankstreck i text men lämnar platshållaren i fred", () => {
  // Båda tankstrecken prövas mot samma villkor: det långa och det korta.
  for (const dash of DASHES) {
    const flagged = [
      `const t = "Allt klart ${dash} inget att göra.";`,
      `<p>Allt klart ${dash} inget att göra.</p>`,
      `const t = \`Klart ${dash} \${namn}\`;`,
      `const t = "Klart${dash} inget mer";`,
    ];
    for (const source of flagged) {
      assert.equal(findProseDashes("prov.tsx", source).length, 1, source);
    }

    const allowed = [
      // Platshållaren: hela strängen är ett tankstreck.
      `const tom = "${dash}";`,
      `const tom = '${dash}';`,
      `<td>{value ?? "${dash}"}</td>`,
      // Kommentarer är utanför vaktens område.
      `// Ett kommentarstreck ${dash} lämnas i fred`,
      `/* Block ${dash} också */`,
      // Bindestreck och tankstreck utan blanktecken runt är inte skiljetecken.
      `const t = "Allt klart - inget att göra.";`,
      `const t = "2026${dash}2027";`,
    ];
    for (const source of allowed) {
      assert.deepEqual(findProseDashes("prov.tsx", source), [], source);
    }
  }

  // Ett långt och ett kort tankstreck i samma fil ger två träffar.
  assert.equal(
    findProseDashes(
      "prov.tsx",
      `const a = "Klart ${EM_DASH} inget mer";\nconst b = "Klart ${EN_DASH} inget mer";`
    ).length,
    2
  );
});

test("bokföringsytan vaktas mot båda tankstrecken, resten mot det långa", () => {
  const bokforing = "src/lib/accounting/year-end.ts";
  const ovrigt = "src/components/nav.tsx";
  const kort = `const t = "Bokslutet är klart ${EN_DASH} inget mer att göra.";`;
  const langt = `const t = "Bokslutet är klart ${EM_DASH} inget mer att göra.";`;

  assert.equal(findProseDashes(bokforing, kort, dashesFor(bokforing)).length, 1);
  assert.equal(findProseDashes(bokforing, langt, dashesFor(bokforing)).length, 1);
  assert.equal(findProseDashes(ovrigt, langt, dashesFor(ovrigt)).length, 1);
  assert.equal(findProseDashes(ovrigt, kort, dashesFor(ovrigt)).length, 0);
});

test("varje sökväg i bokföringsytan finns kvar", () => {
  // En felstavad sökväg skulle tyst stänga av vakten för det korta tankstrecket.
  const files = sourceFiles("src");
  for (const prefix of BOKFORING) {
    assert.ok(
      files.some((file) => file === prefix || file.startsWith(prefix)),
      `${prefix} finns inte längre - uppdatera BOKFORING`
    );
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

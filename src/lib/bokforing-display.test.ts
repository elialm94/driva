process.env.DRIVA_TEST = "1";

/**
 * Visningsfel på sidorna under /bokforing.
 *
 * Sidorna är serverkomponenter utan renderingsuppsättning i testerna, så varje
 * fynd pinnas på två sätt: beloppen/datumen räknas fram ur ett seedat demoföretag
 * med samma funktioner som sidan anropar, och sidans källa kontrolleras mot det
 * uttryck som orsakade felet (samma mönster som account-demo-copy.test.ts).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, replaceDb } from "./store";
import { buildSeed } from "./seed";
import { kr, datumKort } from "./format";
import { resultatrapport, huvudbok } from "./accounting/ledger";
import { postVerification } from "./accounting/engine";
import { todayDate } from "./accounting/fiscal";

const here = dirname(fileURLToPath(import.meta.url));
const page = (p: string) => readFileSync(join(here, "../app/(app)/bokforing", p), "utf8");
const component = (p: string) => readFileSync(join(here, "../components", p), "utf8");

const MINUS = "\u2212";

describe("Resultatrapporten: kostnader får ett minustecken, inte två", () => {
  /*
   * Kostnadsrader renderades som "−{kr(r.amount)}" – ett hårdkodat minustecken
   * framför ett belopp som redan bär sitt eget tecken. En krediterad
   * kostnadspost (retur, leverantörskredit) har negativt belopp och blev då
   * "−−4 000 kr".
   */
  it("en krediterad kostnadspost visar ett enda minustecken", () => {
    replaceDb(buildSeed());
    postVerification({
      date: todayDate(),
      description: "Retur av inköpt verktyg, kredit från leverantören",
      entries: [
        { account: 1930, debit: 4000, credit: 0 },
        { account: 5410, debit: 0, credit: 4000 },
      ],
      source: { type: "manuell" },
      confidence: "hog",
      createdBy: "anvandare",
      explanation:
        "Retur av ett inköpt verktyg. Leverantören krediterade beloppet, så kostnaden på 5410 minskar och pengarna kom tillbaka till företagskontot.",
    });

    const rad = resultatrapport().kostnader.find((r) => r.account === 5410);
    assert.ok(rad, "5410 ska finnas som kostnadsrad");
    assert.ok(rad.amount < 0, "en krediterad kostnadspost ska ha negativt belopp");

    // Så som sidan visar beloppet.
    const visat = kr(-rad.amount);
    assert.ok(!visat.includes(`${MINUS}${MINUS}`), `dubbelt minustecken: ${visat}`);
    assert.equal(visat, "4\u00a0000\u00a0kr");
  });

  it("en period utan kostnader visar 0 kr, inte minus noll", () => {
    replaceDb(buildSeed());
    const rr = resultatrapport({ from: "2026-01-01", to: "2026-01-31" });
    assert.equal(rr.kostnader.length, 0, "perioden ska sakna kostnadsrader");
    assert.equal(rr.kostnaderSumma, 0);
    assert.equal(kr(-rr.kostnaderSumma), "0\u00a0kr");
  });

  it("sidan hårdkodar inte ett minustecken framför kr()", () => {
    const src = page("resultat/page.tsx");
    assert.ok(
      !src.includes(`${MINUS}{kr(`),
      "resultat/page.tsx ska låta kr() sätta tecknet, inte sätta ett eget minustecken framför"
    );
    assert.match(src, /\{kr\(-rr\.kostnaderSumma\)\}/);
  });

  it("lönespecifikationen sätter inte heller ett eget minustecken", () => {
    const src = page("lon/[runId]/page.tsx");
    assert.ok(!src.includes(`${MINUS}{kr(`), "lon/[runId]/page.tsx ska låta kr() sätta tecknet");
    assert.match(src, /\{kr\(-run\.tax\)\}/);
  });
});

describe("Huvudboken: datumkolumnen följer appens datumformat", () => {
  /*
   * Datumkolumnen skrev ut r.date rått ("2026-04-15") medan varje annan
   * datumkolumn under /bokforing (skattekonto, lön, verifikationer) går genom
   * datumKort ("15 apr."). Sidan importerade inte ens en datumformaterare.
   */
  it("huvudbokens rader har datum som går att formatera", () => {
    replaceDb(buildSeed());
    const konton = huvudbok();
    const rader = konton.flatMap((k) => k.rows);
    assert.ok(rader.length > 0, "demoseedet ska ge huvudboksrader");
    for (const r of rader) {
      assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, `oväntat datumformat: ${r.date}`);
      assert.ok(datumKort(r.date).length > 0);
    }
    assert.equal(datumKort("2026-04-15"), "15 apr.");
  });

  it("sidan formaterar datumkolumnen med datumKort", () => {
    const src = page("huvudbok/page.tsx");
    assert.match(src, /import \{[^}]*datumKort[^}]*\} from "@\/lib\/format"/);
    assert.match(src, /\{datumKort\(r\.date\)\}/);
    assert.ok(
      !/>\{r\.date\}</.test(src),
      "datumkolumnen ska inte skriva ut ISO-datumet rått"
    );
  });

  it("de andra datumkolumnerna under /bokforing använder redan datumKort", () => {
    // Skattekontots tabell flyttade ut ur sidan och in i SkattekontoPanel när
    // bokföringsnavigeringen gjordes om (PR #137). Samma assertion, den läser
    // bara kolumnen där den bor nu.
    assert.match(component("skattekonto-panel.tsx"), /\{datumKort\(r\.date\)\}/);
    assert.match(page("lon/page.tsx"), /\{datumKort\(r\.payDate\)\}/);
  });
});

describe("Demoscenariot visar inga trasiga belopp under /bokforing", () => {
  it("inget belopp i rapporterna är NaN, oändligt eller minus noll", () => {
    replaceDb(buildSeed());
    const rr = resultatrapport();
    const belopp: number[] = [
      rr.omsattning,
      rr.kostnaderSumma,
      rr.resultatForeSkatt,
      rr.resultat,
      rr.skatt,
      ...rr.intakter.map((r) => r.amount),
      ...rr.kostnader.map((r) => r.amount),
      ...huvudbok().flatMap((k) => [k.ib, k.ub, ...k.rows.map((r) => r.balance)]),
    ];
    assert.ok(belopp.length > 0);
    for (const n of belopp) {
      assert.ok(Number.isFinite(n), `ogiltigt belopp: ${n}`);
      assert.ok(Number.isInteger(n), `belopp i ören: ${n}`);
      assert.ok(!Object.is(n, -0), "belopp är minus noll");
      assert.ok(!kr(n).includes("NaN"), `kr() gav NaN för ${n}`);
    }
    assert.ok(db().verifications.length > 0);
  });
});

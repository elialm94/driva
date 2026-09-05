process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb, testCustomer } from "../invoices/test-db";
import type { Expense, FiscalYear } from "../types";
import { postVerification } from "./engine";
import { getFiscalYear } from "./fiscal";
import { closeFiscalYear } from "./close";
import { createDepreciationEntry, registerAssetFromExpense } from "./assets";
import { computeTaxCalculation, ink2Rows, taxDepreciation } from "./tax";
import { bookYearEndSchedule, saveYearEndSchedule } from "./year-end";
import { PERIODISERINGSFOND } from "./year-end-model";

/**
 * INK2: skillnaden mellan bokföringens resultat och skattens.
 *
 * Testerna håller fast det som annars blir fel i tysthet, och som kostar riktiga
 * pengar när det gör det:
 *
 *   1. Varje justering hör till en ruta på blanketten. En justering utan ruta
 *      går inte att deklarera.
 *   2. Ej avdragsgilla kostnader läggs tillbaka, skattefria intäkter dras bort.
 *      Riktningen är lätt att kasta om och felet syns inte i bokföringen.
 *   3. Schablonintäkten på periodiseringsfonder räknas på fonderna vid årets
 *      INGÅNG och bokförs aldrig.
 *   4. Underskott från tidigare år rullar framåt och äts upp av senare vinster.
 *      Beloppet går inte att läsa ur bokföringen – eget kapital bär
 *      redovisningens förlust, inte skattens.
 *   5. Blankettens rader summerar till samma resultat som motorn räknat fram.
 *      Annars säger produkten en sak och deklarationen en annan.
 */

const REPRESENTATION = 6072;
const SKATTERANTA_KOSTNAD = 8423;
const SKATTEFRI_RANTA = 8314;
const BANK = 1930;
const FORSALJNING = 3001;
const INKOP = 5410;

function reset() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", name: "Kund AB" })] }));
  const data = db();
  data.settings.name = "Bygg & Co AB";
  for (const year of [2023, 2024, 2025]) {
    data.fiscalYears.push({
      id: `fy-${year}`,
      label: String(year),
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status: "oppet",
      openingBalances: {},
      openingSource: "migrering",
    });
  }
}

function year(id: string): FiscalYear {
  const fy = getFiscalYear(id);
  if (!fy) throw new Error(`Räkenskapsåret ${id} finns inte i fixturen.`);
  return fy;
}

function revenue(date: string, amount: number) {
  return postVerification({
    date,
    description: "Försäljning",
    entries: [
      { account: BANK, debit: amount },
      { account: FORSALJNING, credit: amount },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

function cost(date: string, amount: number, account = INKOP) {
  return postVerification({
    date,
    description: "Kostnad",
    entries: [
      { account, debit: amount },
      { account: BANK, credit: amount },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

function income(date: string, amount: number, account: number) {
  return postVerification({
    date,
    description: "Intäkt",
    entries: [
      { account: BANK, debit: amount },
      { account, credit: amount },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

/**
 * Avsättning till periodiseringsfond via bokslutsbilagan, inte som ett löst
 * verifikat: avstämningen kräver att saldot på 2110 har ett underlag.
 */
function allocateFund(fiscalYearId: string, amount: number) {
  const schedule = saveYearEndSchedule(
    fiscalYearId,
    "periodiseringsfond",
    { fundAllocation: amount, fundReversals: [] },
    "anvandare"
  );
  return bookYearEndSchedule(schedule.id, "anvandare");
}

describe("INK2 – ej avdragsgilla kostnader och skattefria intäkter", () => {
  beforeEach(reset);

  it("representation läggs tillbaka och hamnar i ruta 4.3c", () => {
    revenue("2025-06-15", 500_000);
    cost("2025-06-20", 8_000, REPRESENTATION);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.redovisningsresultat, 492_000);
    const rep = calc.adjustments.find((a) => a.key === `konto-${REPRESENTATION}`)!;
    assert.equal(rep.amount, 8_000);
    assert.equal(rep.field, "4.3c");
    assert.equal(calc.skattemassigtResultat, 500_000, "kostnaden ger ingen skattelindring");
  });

  it("kostnadsränta på skattekontot är inte avdragsgill", () => {
    revenue("2025-06-15", 300_000);
    cost("2025-12-20", 1_200, SKATTERANTA_KOSTNAD);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.redovisningsresultat, 298_800);
    assert.equal(calc.skattemassigtResultat, 300_000);
  });

  it("skattefri ränteintäkt dras BORT – riktningen är lätt att kasta om", () => {
    revenue("2025-06-15", 300_000);
    income("2025-12-20", 900, SKATTEFRI_RANTA);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.redovisningsresultat, 300_900);
    const fri = calc.adjustments.find((a) => a.key === `konto-${SKATTEFRI_RANTA}`)!;
    assert.equal(fri.amount, -900, "en skattefri intäkt är en minuspost");
    assert.equal(fri.field, "4.5c");
    assert.equal(calc.skattemassigtResultat, 300_000);
  });

  it("ett avdragsgillt konto rör inte skatteberäkningen", () => {
    revenue("2025-06-15", 300_000);
    cost("2025-06-20", 50_000);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.adjustments.length, 0);
    assert.equal(calc.skattemassigtResultat, 250_000);
  });
});

describe("INK2 – schablonintäkt på periodiseringsfond", () => {
  beforeEach(reset);

  it("årets egen avsättning räntebeläggs inte – bara fonder vid årets ingång", () => {
    revenue("2025-06-15", 500_000);
    allocateFund("fy-2025", 100_000);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(
      calc.adjustments.find((a) => a.key === "schablonintakt-periodiseringsfond"),
      undefined,
      "fonden fanns inte vid ingången av 2025"
    );
    assert.equal(calc.redovisningsresultat, 400_000, "avsättningen sänker det bokförda resultatet");
    assert.equal(calc.skattemassigtResultat, 400_000);
  });

  it("en fond från förra året ger en schablonintäkt som inte finns i bokföringen", () => {
    revenue("2024-06-15", 500_000);
    allocateFund("fy-2024", 100_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue("2025-06-15", 300_000);

    const calc = computeTaxCalculation(year("fy-2025"));
    const schablon = calc.adjustments.find((a) => a.key === "schablonintakt-periodiseringsfond")!;
    // 100 000 kr × 1,96 % (statslåneräntan 30 november 2024).
    assert.equal(schablon.amount, 1_960);
    assert.equal(schablon.field, "4.6a");
    assert.equal(calc.redovisningsresultat, 300_000, "schablonintäkten är inte bokförd");
    assert.equal(calc.skattemassigtResultat, 301_960, "men den beskattas");
  });

  it("statslåneräntan för ett okänt år stoppar beräkningen i stället för att gissa", () => {
    db().fiscalYears.push({
      id: "fy-2040",
      label: "2040",
      startDate: "2040-01-01",
      endDate: "2040-12-31",
      status: "oppet",
      openingBalances: { [PERIODISERINGSFOND]: -100_000 },
      openingSource: "manuell",
    });
    revenue("2040-06-15", 300_000);

    const calc = computeTaxCalculation(year("fy-2040"));
    assert.equal(calc.adjustments.find((a) => a.key === "schablonintakt-periodiseringsfond"), undefined);
    assert.equal(
      calc.manualReviewNotes.some((n) => n.includes("Statslåneräntan") && n.includes("4.6a")),
      true,
      "den som deklarerar måste få veta att posten saknas"
    );
  });
});

describe("INK2 – underskott från tidigare år", () => {
  beforeEach(reset);

  it("förra årets förlust dras av mot årets vinst och syns i ruta 4.14a", () => {
    cost("2024-06-15", 200_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue("2025-06-15", 500_000);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.resultatForeUnderskott, 500_000);
    assert.equal(calc.utnyttjatUnderskott, 200_000);
    assert.equal(calc.skattemassigtResultat, 300_000);
    assert.equal(calc.kvarvarandeUnderskott, 0);
    assert.equal(calc.beraknadSkatt, Math.floor(300_000 * 0.206));

    const row = ink2Rows(calc).find((r) => r.field === "4.14a")!;
    assert.equal(row.amount, -200_000, "underskottsavdraget är en minuspost");
  });

  it("underskottet rullar vidare när årets vinst inte räcker till", () => {
    cost("2024-06-15", 500_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue("2025-06-15", 200_000);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.utnyttjatUnderskott, 200_000);
    assert.equal(calc.skattemassigtResultat, 0);
    assert.equal(calc.beraknadSkatt, 0, "ingen skatt när hela vinsten går mot underskottet");
    assert.equal(calc.kvarvarandeUnderskott, 300_000, "resten sparas till nästa år");
  });

  it("underskott från flera år läggs samman", () => {
    cost("2023-06-15", 100_000);
    closeFiscalYear("fy-2023", "anvandare");
    cost("2024-06-15", 150_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue("2025-06-15", 400_000);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.utnyttjatUnderskott, 250_000);
    assert.equal(calc.skattemassigtResultat, 150_000);
  });

  it("ett år som gick med vinst lämnar inget underskott vidare", () => {
    revenue("2024-06-15", 300_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue("2025-06-15", 400_000);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.utnyttjatUnderskott, 0);
    assert.equal(calc.skattemassigtResultat, 400_000);
  });

  it("en förlust som redan ätits upp dras inte av två gånger", () => {
    cost("2023-06-15", 100_000);
    closeFiscalYear("fy-2023", "anvandare");
    revenue("2024-06-15", 300_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue("2025-06-15", 400_000);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.utnyttjatUnderskott, 0, "underskottet användes redan 2024");
    assert.equal(calc.skattemassigtResultat, 400_000);
  });

  it("årets egen förlust sparas och rapporteras i ruta 4.16", () => {
    cost("2025-06-15", 120_000);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.skattemassigtResultat, -120_000);
    assert.equal(calc.beraknadSkatt, 0);
    assert.equal(calc.kvarvarandeUnderskott, 120_000);
    assert.equal(ink2Rows(calc).find((r) => r.field === "4.16")!.amount, 120_000);
  });
});

describe("INK2 – skattemässiga avskrivningar", () => {
  beforeEach(reset);

  function buyAsset(date: string, amount: number, usefulLifeYears: number) {
    const expense: Expense = {
      id: `exp-${date}-${amount}`,
      supplier: "Maskinbolaget",
      date,
      amount,
      vatAmount: 0,
      category: "inventarier",
      status: "behover_svar",
      createdAt: `${date}T10:00:00Z`,
    };
    db().expenses.push(expense);
    return registerAssetFromExpense(expense.id, { usefulLifeYears, by: "anvandare" });
  }

  it("planen under taket är inget fel – men det outnyttjade avdraget ska synas", () => {
    revenue("2025-06-15", 500_000);
    const asset = buyAsset("2025-01-15", 100_000, 10);
    createDepreciationEntry(asset.id, "fy-2025", "anvandare");

    const check = taxDepreciation(year("fy-2025"))!;
    // 10 års plan ger 10 000 kr; skattemässigt får 30 % av 100 000 dras av.
    assert.equal(check.bookedDepreciation, 10_000);
    assert.equal(check.limits.maxDepreciation, 30_000);
    assert.equal(check.unusedHeadroom, 20_000);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(
      calc.adjustments.find((a) => a.field === "4.9"),
      undefined,
      "en plan under taket är tillåten och justeras inte"
    );
    assert.equal(
      calc.manualReviewNotes.some((n) => n.includes("20000") || n.includes("överavskrivning")),
      true,
      "valet att skjuta upp skatt är bolagets, men det ska vara känt"
    );
  });

  it("en plan över taket läggs tillbaka i ruta 4.9", () => {
    revenue("2025-06-15", 500_000);
    const asset = buyAsset("2025-01-15", 100_000, 2);
    createDepreciationEntry(asset.id, "fy-2025", "anvandare");

    const check = taxDepreciation(year("fy-2025"))!;
    // 2 års plan skriver av ~50 000 kr; skatten tillåter 30 000 kr.
    assert.equal(check.limits.maxDepreciation, 30_000);
    assert.ok(check.bookedDepreciation > 30_000, "planen skriver av mer än taket");

    const calc = computeTaxCalculation(year("fy-2025"));
    const adj = calc.adjustments.find((a) => a.field === "4.9")!;
    assert.equal(adj.amount, check.bookedDepreciation - 30_000);
    assert.equal(
      calc.skattemassigtResultat,
      calc.redovisningsresultat + adj.amount,
      "överskjutande avskrivning ger inget avdrag i år"
    );
  });

  it("en bokförd överavskrivning räknas med i det skattemässiga avdraget", () => {
    revenue("2025-06-15", 500_000);
    const asset = buyAsset("2025-01-15", 100_000, 10);
    createDepreciationEntry(asset.id, "fy-2025", "anvandare");
    postVerification({
      date: "2025-12-31",
      description: "Överavskrivning inventarier",
      entries: [
        { account: 8850, debit: 20_000 },
        { account: 2150, credit: 20_000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });

    const check = taxDepreciation(year("fy-2025"))!;
    assert.equal(check.bookedOverDepreciation, 20_000);
    assert.equal(check.unusedHeadroom, 0, "planen plus överavskrivningen når taket");

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.equal(calc.adjustments.find((a) => a.field === "4.9"), undefined);
  });

  it("utan inventarier finns ingen avskrivningskontroll att göra", () => {
    revenue("2025-06-15", 500_000);
    assert.equal(taxDepreciation(year("fy-2025")), undefined);
  });
});

describe("INK2 – blanketten stämmer med beräkningen", () => {
  beforeEach(reset);

  it("raderna börjar i årets resultat efter skatt och summerar till samma resultat", () => {
    revenue("2024-06-15", 400_000);
    allocateFund("fy-2024", 50_000);
    closeFiscalYear("fy-2024", "anvandare");

    revenue("2025-06-15", 600_000);
    cost("2025-06-20", 10_000, REPRESENTATION);
    income("2025-12-20", 500, SKATTEFRI_RANTA);
    closeFiscalYear("fy-2025", "anvandare");

    const calc = computeTaxCalculation(year("fy-2025"));
    const rows = ink2Rows(calc);

    // 4.1 är resultatet EFTER skatt; 4.3a lägger tillbaka skatten.
    assert.equal(rows[0].field, "4.1");
    assert.equal(rows[0].amount, calc.aretsResultat);
    assert.equal(rows.find((r) => r.field === "4.3a")!.amount, calc.bokfordSkatt);

    // Summan av alla rader utom slutraden är slutraden.
    const result = rows.find((r) => r.field === "4.15" || r.field === "4.16")!;
    const parts = rows.filter((r) => r !== result);
    const sum = parts.reduce((s, r) => s + (r.field === "4.2" ? -r.amount : r.amount), 0);
    assert.equal(result.field, "4.15");
    assert.equal(sum, result.amount);
    assert.equal(result.amount, calc.skattemassigtResultat);
  });

  it("varje justering bär en ruta – en post utan ruta går inte att deklarera", () => {
    revenue("2024-06-15", 400_000);
    allocateFund("fy-2024", 50_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue("2025-06-15", 600_000);
    cost("2025-06-20", 10_000, REPRESENTATION);

    const calc = computeTaxCalculation(year("fy-2025"));
    assert.ok(calc.adjustments.length >= 2);
    for (const adjustment of calc.adjustments) {
      assert.match(adjustment.field, /^4\./, `${adjustment.key} saknar ruta`);
      assert.notEqual(adjustment.explanation, "", `${adjustment.key} saknar förklaring`);
    }
  });

  it("en förlust rapporteras i 4.2 och räknas som en minuspost", () => {
    cost("2025-06-15", 80_000);

    const rows = ink2Rows(computeTaxCalculation(year("fy-2025")));
    const forlust = rows.find((r) => r.field === "4.2")!;
    assert.equal(forlust.amount, 80_000, "beloppet skrivs positivt i förlustrutan");
    assert.equal(rows.find((r) => r.field === "4.16")!.amount, 80_000);
  });
});

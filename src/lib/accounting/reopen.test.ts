process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb, testCustomer } from "../invoices/test-db";
import { postVerification } from "./engine";
import { closeFiscalYear, reopenBlockers, reopenFiscalYear } from "./close";
import {
  annualReportFor,
  annualReportHistory,
  generateAnnualReport,
  resolveAnnualReport,
  updateAnnualReport,
} from "./annual-report";
import { bokforingsdatum, getFiscalYear, isDateLocked, lockPeriod, lockedThrough } from "./fiscal";
import { accountBalance } from "./ledger";
import { bookAccrual, planAccrual } from "./accruals";
import { auditTrail } from "./audit";
import type { AnnualReport } from "../types";

/**
 * Återöppning av ett stängt räkenskapsår.
 *
 * Ett bokslut är en slutsats, och slutsatser kan vara fel: fakturan som kom i
 * mars visade sig gälla december. Testerna håller fast att omtaget går att göra
 * och att det blir RÄTT, inte bara tillåtet:
 *
 *   1. Året blir öppet OCH möjligt att bokföra i – ett öppet men låst år är
 *      ingen återöppning.
 *   2. Bokslutsverifikationerna återförs, så nästa stängning räknar om årets
 *      resultat från grunden i stället för att lägga en ny bokning ovanpå den
 *      gamla. Det här är hela poängen: utan återföringen blir det andra
 *      bokslutet noll, för resultaträkningen är redan nollad mot eget kapital.
 *   3. Originalen står kvar. Bokföring skrivs aldrig om, inte ens i ett omtag.
 *   4. En upprättad årsredovisning markeras som ersatt och går inte att ändra,
 *      men den finns kvar som historik.
 *   5. Ett skäl krävs, och åren öppnas i omvänd ordning.
 */

const BANK = 1930;
const FORSALJNING = 3001;
const INKOP = 5410;
const ARETS_RESULTAT = 2099;
const BALANSERAT = 2091;
const SKATTESKULD = 2512;
const RESULTATRAKNINGENS_SLUTKONTO = 8999;

function reset() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", name: "Kund AB" })] }));
  const data = db();
  data.settings.name = "Bygg & Co AB";
  data.settings.orgNumber = "556677-8899";
  data.settings.sate = "Göteborg";
  for (const year of [2024, 2025]) {
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

function cost(date: string, amount: number) {
  return postVerification({
    date,
    description: "Inköp",
    entries: [
      { account: INKOP, debit: amount },
      { account: BANK, credit: amount },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

describe("återöppning – året blir faktiskt öppet", () => {
  beforeEach(reset);

  it("året blir öppet, låset flyttas bakom årets början och en rättelse går att bokföra", () => {
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");

    assert.equal(getFiscalYear("fy-2025")!.status, "stangt");
    assert.equal(lockedThrough(), "2025-12-31");
    assert.equal(isDateLocked("2025-06-15"), true);

    const result = reopenFiscalYear("fy-2025", "Fakturan från Elbolaget avsåg december, inte mars.", "anvandare");

    assert.equal(result.fiscalYear.status, "oppet");
    assert.equal(lockedThrough(), "2024-12-31", "låset måste flyttas bakom årets början, annars går året inte att rätta");
    assert.equal(isDateLocked("2025-06-15"), false);

    // Och det viktiga: en rättelse går att bokföra i året.
    const rattelse = cost("2025-12-20", 40_000);
    assert.equal(
      bokforingsdatum(rattelse.date),
      "2025-12-20",
      "rättelsen ska hamna i det öppnade året, inte flyttas fram till öppen period"
    );
  });

  it("låset flyttas inte fram om det redan låg tidigare än årets början", () => {
    revenue("2025-06-15", 100_000);
    closeFiscalYear("fy-2025", "anvandare");
    // Ett äldre lås ska inte "hoppa fram" till årsskiftet av en återöppning.
    db().accounting.lockedThrough = "2024-06-30";
    reopenFiscalYear("fy-2025", "Rättar en felkonterad kostnad.", "anvandare");
    assert.equal(lockedThrough(), "2024-06-30");
  });

  it("kräver ett skäl som går att läsa i efterhand", () => {
    revenue("2025-06-15", 100_000);
    closeFiscalYear("fy-2025", "anvandare");
    assert.throws(() => reopenFiscalYear("fy-2025", "", "anvandare"), /Skriv varför/);
    assert.throws(() => reopenFiscalYear("fy-2025", "  fel ", "anvandare"), /Skriv varför/);
    assert.equal(getFiscalYear("fy-2025")!.status, "stangt", "året ska inte öppnas när skälet saknas");
  });

  it("ett öppet år kan inte öppnas igen", () => {
    assert.deepEqual(
      reopenBlockers("fy-2025").map((b) => b.key),
      ["inte_stangt"]
    );
    assert.throws(() => reopenFiscalYear("fy-2025", "Vill bara öppna igen.", "anvandare"), /redan öppet/);
  });

  it("åren öppnas i omvänd ordning – 2024 kan inte öppnas medan 2025 är stängt", () => {
    revenue("2024-06-15", 200_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue("2025-06-15", 300_000);
    closeFiscalYear("fy-2025", "anvandare");

    const blockers = reopenBlockers("fy-2024");
    assert.deepEqual(blockers.map((b) => b.key), ["senare_ar_stangt"]);
    assert.match(blockers[0].detail, /Öppna 2025 först/);
    assert.throws(() => reopenFiscalYear("fy-2024", "Glömd faktura i 2024.", "anvandare"), /Öppna 2025 först/);

    // I rätt ordning går det.
    reopenFiscalYear("fy-2025", "Glömd faktura hör till 2024.", "anvandare");
    assert.deepEqual(reopenBlockers("fy-2024"), []);
    reopenFiscalYear("fy-2024", "Glömd faktura i 2024.", "anvandare");
    assert.equal(getFiscalYear("fy-2024")!.status, "oppet");
  });
});

describe("återöppning – bokslutet återförs så att omtaget räknas om", () => {
  beforeEach(reset);

  it("skatt, årets resultat och nollningen av resultaträkningen återförs", () => {
    revenue("2025-06-15", 500_000);
    cost("2025-07-10", 100_000);
    closeFiscalYear("fy-2025", "anvandare");

    // Efter stängningen: resultatet står på eget kapital och skatten som skuld.
    assert.equal(-accountBalance(ARETS_RESULTAT, "2025-12-31"), 317_600);
    assert.equal(-accountBalance(SKATTESKULD, "2025-12-31"), 82_400);
    assert.equal(accountBalance(RESULTATRAKNINGENS_SLUTKONTO, "2025-12-31"), 317_600);

    reopenFiscalYear("fy-2025", "Ett inköp på 100 000 kr saknades i bokslutet.", "anvandare");

    assert.equal(accountBalance(ARETS_RESULTAT, "2025-12-31"), 0, "årets resultat ska vara återfört");
    assert.equal(accountBalance(SKATTESKULD, "2025-12-31"), 0, "skatteskulden ska vara återförd");
    assert.equal(
      accountBalance(RESULTATRAKNINGENS_SLUTKONTO, "2025-12-31"),
      0,
      "nollningen av resultaträkningen ska vara återförd"
    );
    // Rörelsen ligger kvar: det var bokslutet som togs tillbaka, inte året.
    assert.equal(-accountBalance(FORSALJNING, "2025-12-31"), 500_000);
    assert.equal(accountBalance(INKOP, "2025-12-31"), 100_000);
  });

  it("originalverifikationerna står kvar och pekar på sin återföring", () => {
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    const closingIds = [...getFiscalYear("fy-2025")!.closingVerificationIds!];
    assert.ok(closingIds.length >= 2);

    const result = reopenFiscalYear("fy-2025", "Bokslutet gjordes på fel underlag.", "anvandare");

    for (const id of closingIds) {
      const original = db().verifications.find((v) => v.id === id);
      assert.ok(original, "bokslutsverifikationen ska finnas kvar – bokföring raderas aldrig");
      assert.ok(original.correctedByVerificationId, "originalet ska peka på sin återföring");
      const reversal = db().verifications.find((v) => v.id === original.correctedByVerificationId);
      assert.equal(reversal?.correctsVerificationId, id);
      assert.match(reversal!.explanation ?? "", /öppnades igen/);
    }
    assert.equal(result.reversals.length, closingIds.length);
    assert.deepEqual(result.reversals.map((v) => v.id).sort(), [...result.fiscalYear.reopenings![0].reversalVerificationIds].sort());
  });

  it("omtaget ger det nya, rätta resultatet – inte noll och inte det gamla", () => {
    revenue("2025-06-15", 500_000);
    const first = closeFiscalYear("fy-2025", "anvandare");
    assert.equal(first.aretsResultat, 397_000); // 500 000 − 20,6 % skatt

    reopenFiscalYear("fy-2025", "Ett inköp på 100 000 kr hörde till 2025.", "anvandare");
    cost("2025-12-20", 100_000);
    const second = closeFiscalYear("fy-2025", "anvandare");

    assert.equal(second.resultatForeSkatt, 400_000);
    assert.equal(second.skatt, 82_400);
    assert.equal(second.aretsResultat, 317_600, "det andra bokslutet ska räkna om resultatet, inte lägga ovanpå det första");
    assert.equal(-accountBalance(ARETS_RESULTAT, "2025-12-31"), 317_600);
    assert.equal(-accountBalance(SKATTESKULD, "2025-12-31"), 82_400);
  });

  it("nästa års ingående balanser räknas om vid omtaget", () => {
    const nextYear = () => db().fiscalYears.find((f) => f.label === "2026")!;
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    assert.equal(nextYear().openingBalances[String(BANK)], 500_000);

    reopenFiscalYear("fy-2025", "Ett inköp på 100 000 kr hörde till 2025.", "anvandare");
    cost("2025-12-20", 100_000);
    closeFiscalYear("fy-2025", "anvandare");

    assert.equal(nextYear().openingBalances[String(BANK)], 400_000);
    assert.equal(nextYear().openingBalances[String(ARETS_RESULTAT)], -317_600);
  });

  it("två års omtag i rad håller isär årets resultat och balanserat resultat", () => {
    revenue("2024-06-15", 200_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");

    reopenFiscalYear("fy-2025", "Rättar 2025 med ett glömt inköp.", "anvandare");
    cost("2025-12-20", 100_000);
    closeFiscalYear("fy-2025", "anvandare");

    // 2024 gav 158 800 kr efter skatt och ska ligga kvar som balanserat resultat.
    assert.equal(-accountBalance(BALANSERAT, "2025-12-31"), 158_800);
    assert.equal(-accountBalance(ARETS_RESULTAT, "2025-12-31"), 317_600);
  });

  it("periodiseringar som stängningen återförde in i nästa år tas tillbaka", () => {
    revenue("2025-06-15", 500_000);
    const accrual = planAccrual({
      kind: "upplupen_kostnad",
      description: "Revisorn för 2025, faktureras i mars",
      totalAmount: 20_000,
      counterAccount: 6420,
      fromDate: "2025-12-01",
      toDate: "2025-12-31",
      fiscalYearId: "fy-2025",
      by: "anvandare",
    });
    bookAccrual(accrual.id, "anvandare");
    closeFiscalYear("fy-2025", "anvandare");

    assert.equal(db().accruals.find((a) => a.id === accrual.id)!.status, "aterford");
    // Återföringen ligger i 2026 och nollar skulden där.
    assert.equal(accountBalance(2990, "2026-01-01"), 0);

    const result = reopenFiscalYear("fy-2025", "Periodiseringen var för låg.", "anvandare");

    assert.equal(result.restoredAccruals, 1);
    const restored = db().accruals.find((a) => a.id === accrual.id)!;
    assert.equal(restored.status, "bokford", "periodiseringen ska vara bokförd igen i det öppnade året");
    assert.equal(restored.reverseVerificationId, undefined);
    // Skulden står kvar i 2025 och är inte återförd i 2026 längre.
    assert.equal(-accountBalance(2990, "2025-12-31"), 20_000);
    assert.equal(-accountBalance(2990, "2026-01-01"), 20_000);

    // Och vid nästa stängning återförs den EN gång, inte två.
    closeFiscalYear("fy-2025", "anvandare");
    assert.equal(accountBalance(2990, "2026-01-01"), 0);
  });

  it("ett senare periodlås återställs när året stängs igen", () => {
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    // Momsen för första kvartalet 2026 deklareras och låser perioden.
    lockPeriod("2026-03-31", "anvandare");

    reopenFiscalYear("fy-2025", "Glömt inköp i december.", "anvandare");
    assert.equal(lockedThrough(), "2024-12-31");

    closeFiscalYear("fy-2025", "anvandare");
    assert.equal(
      lockedThrough(),
      "2026-03-31",
      "den deklarerade momsperioden i 2026 ska vara låst igen efter omtaget"
    );
  });
});

describe("återöppning – årsredovisningen", () => {
  beforeEach(reset);

  it("en upprättad årsredovisning markeras som ersatt men finns kvar", () => {
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    const report = generateAnnualReport("fy-2025", "anvandare");
    assert.equal(annualReportFor("fy-2025")?.id, report.id);

    const result = reopenFiscalYear("fy-2025", "Ett inköp på 100 000 kr hörde till 2025.", "anvandare");

    assert.equal(result.supersededReports, 1);
    assert.equal(annualReportFor("fy-2025"), undefined, "den ersatta rapporten ska inte gälla längre");
    const stored = db().annualReports.find((r) => r.id === report.id)!;
    assert.ok(stored.supersededAt, "rapporten ska finnas kvar, markerad som ersatt");
    assert.match(stored.supersededReason ?? "", /100 000/);
    assert.equal(annualReportHistory("fy-2025").length, 1);
  });

  it("en ersatt årsredovisning går inte att ändra", () => {
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    const report = generateAnnualReport("fy-2025", "anvandare");
    reopenFiscalYear("fy-2025", "Ett inköp hörde till 2025.", "anvandare");

    assert.throws(() => updateAnnualReport(report.id, { verksamhet: "Ny text" }, "anvandare"), /ersatt/);
  });

  it("nästa bokslut ger en ny årsredovisning med de nya siffrorna", () => {
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    const first = generateAnnualReport("fy-2025", "anvandare");
    const firstResult = first.content.resultatrakning.find((r) => r.label === "Årets resultat")!.amount;
    assert.equal(firstResult, 397_000);

    reopenFiscalYear("fy-2025", "Ett inköp på 100 000 kr hörde till 2025.", "anvandare");
    cost("2025-12-20", 100_000);
    closeFiscalYear("fy-2025", "anvandare");

    const second = generateAnnualReport("fy-2025", "anvandare");
    assert.notEqual(second.id, first.id, "en ny rapport ska upprättas, inte den ersatta lämnas tillbaka");
    assert.equal(second.content.resultatrakning.find((r) => r.label === "Årets resultat")!.amount, 317_600);
    assert.equal(annualReportHistory("fy-2025").length, 2);
  });

  /*
   * Den ersatta rapporten kan vara den styrelsen skrev under och lämnade in.
   * Att den finns i databasen räcker inte – den måste gå att peka ut, annars är
   * handlingen borta ur gränssnittet så snart nästa rapport är upprättad.
   */
  it("den ersatta rapporten går att peka ut även när en ny gäller", () => {
    closeFiscalYear("fy-2024", "anvandare");
    const otherYear = generateAnnualReport("fy-2024", "anvandare");
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    const first = generateAnnualReport("fy-2025", "anvandare");
    reopenFiscalYear("fy-2025", "Ett inköp på 100 000 kr hörde till 2025.", "anvandare");
    cost("2025-12-20", 100_000);
    closeFiscalYear("fy-2025", "anvandare");
    const second = generateAnnualReport("fy-2025", "anvandare");

    assert.equal(resolveAnnualReport("fy-2025")?.id, second.id, "utan utpekad rapport visas den gällande");
    assert.equal(resolveAnnualReport("fy-2025", first.id)?.id, first.id, "den ersatta ska gå att öppna");
    assert.equal(
      resolveAnnualReport("fy-2025", "rapport-som-inte-finns"),
      undefined,
      "en okänd rapport ska ge ingenting – inte tysta fram en annan årsredovisning"
    );
    assert.equal(
      resolveAnnualReport("fy-2025", otherYear.id),
      undefined,
      "en rapport för ett annat år hör inte till det här året"
    );
  });

  /*
   * Rapporten är en handling, inte en vy mot böckerna. Läste den ersatta
   * rapporten sina siffror ur bokföringen skulle den ändra sig när året stängs
   * om – och då vore den inte längre den handling som undertecknades.
   */
  it("den ersatta rapporten behåller sina egna siffror när året stängs om", () => {
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    const first = generateAnnualReport("fy-2025", "anvandare");
    const arets = (r: AnnualReport) => r.content.resultatrakning.find((x) => x.label === "Årets resultat")!.amount;
    assert.equal(arets(first), 397_000);

    reopenFiscalYear("fy-2025", "Ett inköp på 100 000 kr hörde till 2025.", "anvandare");
    cost("2025-12-20", 100_000);
    closeFiscalYear("fy-2025", "anvandare");
    const second = generateAnnualReport("fy-2025", "anvandare");

    assert.equal(arets(second), 317_600, "den nya rapporten ska visa de omräknade siffrorna");
    assert.equal(
      arets(resolveAnnualReport("fy-2025", first.id)!),
      397_000,
      "den ersatta rapporten ska visa vad den visade när den upprättades"
    );
  });

  it("även en signerad och inlämnad årsredovisning kan ersättas – felet är inte permanent", () => {
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    const report = generateAnnualReport("fy-2025", "anvandare");
    updateAnnualReport(
      report.id,
      {
        underskrifter: [{ name: "Anna Andersson", role: "Styrelseledamot" }],
        fastallelseintyg: {
          stammaDate: "2026-05-20",
          certifiedByName: "Anna Andersson",
          certifiedByRole: "Styrelseledamot",
        },
      },
      "anvandare"
    );

    reopenFiscalYear("fy-2025", "Bolagsverket påpekade ett fel i siffrorna.", "anvandare");

    const stored = db().annualReports.find((r) => r.id === report.id)!;
    assert.ok(stored.supersededAt);
    assert.deepEqual(stored.content.underskrifter?.map((s) => s.name), ["Anna Andersson"], "handlingen står kvar orörd");
  });
});

describe("återöppning – spåret", () => {
  beforeEach(reset);

  it("varje återöppning sparas på året med skäl och verifikationer", () => {
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    reopenFiscalYear("fy-2025", "Första omtaget: glömt inköp.", "anvandare");
    closeFiscalYear("fy-2025", "anvandare");
    reopenFiscalYear("fy-2025", "Andra omtaget: fel konto på inköpet.", "anvandare");

    const reopenings = getFiscalYear("fy-2025")!.reopenings!;
    assert.equal(reopenings.length, 2, "historiken ska ackumulera, inte skrivas över");
    assert.equal(reopenings[0].reason, "Första omtaget: glömt inköp.");
    assert.equal(reopenings[1].reason, "Andra omtaget: fel konto på inköpet.");
    assert.equal(reopenings[0].by, "anvandare");
    assert.ok(reopenings[1].reversedVerificationIds.length > 0);
    // Andra omtaget rör det andra bokslutets verifikationer, inte det första.
    assert.equal(
      reopenings[0].reversedVerificationIds.some((id) => reopenings[1].reversedVerificationIds.includes(id)),
      false
    );
  });

  it("audit-loggen berättar vad som hände och varför", () => {
    revenue("2025-06-15", 500_000);
    closeFiscalYear("fy-2025", "anvandare");
    generateAnnualReport("fy-2025", "anvandare");
    reopenFiscalYear("fy-2025", "Kvitto för december kom i mars.", "anvandare");

    const events = auditTrail();
    const opened = events.find((e) => e.action === "rakenskapsar_oppnat");
    assert.ok(opened, "återöppningen ska auditloggas");
    assert.match(opened.details, /Kvitto för december kom i mars/);
    assert.match(opened.details, /återfördes/);
    assert.equal(opened.targetId, "fy-2025");

    assert.ok(
      events.some((e) => e.action === "period_upplast" && /2024-12-31/.test(e.details)),
      "att låset flyttades bakåt ska framgå av loggen"
    );
    assert.ok(
      events.some((e) => e.action === "arsredovisning_status" && /ersatt/.test(e.details)),
      "att årsredovisningen ersattes ska framgå av loggen"
    );
  });
});

process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb, testCustomer } from "../invoices/test-db";
import { postVerification } from "./engine";
import { closeFiscalYear } from "./close";
import { runPayroll, saveEmployee } from "./payroll";
import { saveYearEndSchedule, bookYearEndSchedule, yearEndScheduleFor } from "./year-end";
import {
  advanceAnnualReportStatus,
  annualReportBlockers,
  averageEmployees,
  generateAnnualReport,
  multiYearOverview,
  updateAnnualReport,
} from "./annual-report";
import { getFiscalYear } from "./fiscal";
import type { ReportRow } from "../types";

/**
 * Årsredovisningen är ett dokument utomstående läser och litar på. Testerna
 * håller fast det som gör den läsbar och sann:
 *
 *   1. Rörelseresultat, resultat efter finansiella poster och resultat före
 *      skatt är TRE OLIKA tal när bolaget har ränta och periodiseringsfond.
 *      Att de var samma tal var en bugg som gjorde räntan osynlig.
 *   2. Varje uppställning summerar till det motorn räknat, och balansräkningen
 *      balanserar.
 *   3. Jämförelsetalen kommer ur föregående års egen bokföring.
 *   4. Medelantalet anställda räknas ur lönekörningarna.
 *   5. Det som är bolagets påstående går att redigera – siffrorna gör det inte.
 *   6. En osignerad årsredovisning kan inte signeras utan underskrifter, och
 *      inte markeras som inlämnad utan fastställelseintyg.
 */

const RANTEINTAKT = 8310;
const RANTEKOSTNAD = 8410;
const BANK = 1930;
const LAN = 2350;

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

/** Intäkt utan faktura – testet handlar om uppställningen, inte om fakturan. */
function revenue(year: number, amount: number) {
  postVerification({
    date: `${year}-06-15`,
    description: "Försäljning",
    entries: [
      { account: BANK, debit: amount },
      { account: 3001, credit: amount },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

function cost(year: number, amount: number) {
  postVerification({
    date: `${year}-07-10`,
    description: "Inköp",
    entries: [
      { account: 5410, debit: amount },
      { account: BANK, credit: amount },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

function interest(year: number, income: number, expense: number) {
  if (income > 0) {
    postVerification({
      date: `${year}-12-30`,
      description: "Ränteintäkt",
      entries: [
        { account: BANK, debit: income },
        { account: RANTEINTAKT, credit: income },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
  }
  if (expense > 0) {
    postVerification({
      date: `${year}-12-30`,
      description: "Räntekostnad på lån",
      entries: [
        { account: RANTEKOSTNAD, debit: expense },
        { account: LAN, credit: expense },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
  }
}

function sum(rows: ReportRow[], label: string): number {
  const row = rows.find((r) => r.label === label);
  assert.ok(row, `raden "${label}" saknas`);
  return row.amount;
}

function has(rows: ReportRow[], label: string): boolean {
  return rows.some((r) => r.label === label);
}

describe("årsredovisning – resultaträkningens nivåer", () => {
  beforeEach(reset);

  it("rörelseresultat, resultat efter finansiella poster och resultat före skatt är olika tal", () => {
    revenue(2025, 500_000);
    cost(2025, 100_000);
    interest(2025, 2_000, 12_000);

    // Periodiseringsfond ger en bokslutsdisposition mellan de två sista nivåerna.
    saveYearEndSchedule("fy-2025", "periodiseringsfond", { fundAllocation: 50_000 }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy-2025", "periodiseringsfond")!.id, "anvandare");

    closeFiscalYear("fy-2025", "anvandare");
    const rows = generateAnnualReport("fy-2025", "anvandare").content.resultatrakning;

    const rorelse = sum(rows, "Rörelseresultat");
    const efterFinansiella = sum(rows, "Resultat efter finansiella poster");
    const foreSkatt = sum(rows, "Resultat före skatt");

    assert.equal(rorelse, 400_000, "rörelseresultatet ska vara intäkt minus rörelsekostnad");
    // Räntan syns: nettot av 2 000 in och 12 000 ut är −10 000.
    assert.equal(efterFinansiella, rorelse - 10_000, "de finansiella posterna slår inte igenom");
    assert.notEqual(rorelse, efterFinansiella, "rörelseresultatet och resultatet efter finansiella poster är samma tal");
    // Avsättningen sänker resultatet före skatt utan att röra rörelseresultatet.
    assert.equal(foreSkatt, efterFinansiella - 50_000, "bokslutsdispositionen slår inte igenom");
    assert.notEqual(efterFinansiella, foreSkatt, "resultat efter finansiella poster och före skatt är samma tal");

    // Och räntan står som egna poster, inte gömd i externa kostnader.
    assert.equal(sum(rows, "Ränteintäkter och liknande resultatposter"), 2_000);
    assert.equal(sum(rows, "Räntekostnader och liknande resultatposter"), -12_000);
    assert.equal(sum(rows, "Bokslutsdispositioner"), -50_000);
  });

  it("utan finansiella poster står nivåerna kvar men är lika – de är inte hopblandade", () => {
    revenue(2025, 200_000);
    cost(2025, 50_000);
    closeFiscalYear("fy-2025", "anvandare");
    const rows = generateAnnualReport("fy-2025", "anvandare").content.resultatrakning;

    assert.equal(sum(rows, "Rörelseresultat"), 150_000);
    assert.equal(sum(rows, "Resultat efter finansiella poster"), 150_000);
    // Tomma finansiella rader skräpar bara ner uppställningen.
    assert.ok(!has(rows, "Ränteintäkter och liknande resultatposter"));
    assert.ok(!has(rows, "Bokslutsdispositioner"));
  });

  it("resultaträkningen summerar till motorns årsresultat", () => {
    revenue(2025, 300_000);
    cost(2025, 80_000);
    interest(2025, 0, 5_000);
    closeFiscalYear("fy-2025", "anvandare");
    const rows = generateAnnualReport("fy-2025", "anvandare").content.resultatrakning;

    const skatt = -sum(rows, "Skatt på årets resultat");
    assert.equal(sum(rows, "Årets resultat"), sum(rows, "Resultat före skatt") - skatt);
    assert.ok(skatt > 0, "bolagsskatt ska ha bokförts vid stängningen");
  });
});

describe("årsredovisning – balansräkning och jämförelsetal", () => {
  beforeEach(reset);

  it("balansräkningen balanserar och obeskattade reserver står för sig", () => {
    revenue(2025, 400_000);
    saveYearEndSchedule("fy-2025", "periodiseringsfond", { fundAllocation: 40_000 }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy-2025", "periodiseringsfond")!.id, "anvandare");
    closeFiscalYear("fy-2025", "anvandare");
    const content = generateAnnualReport("fy-2025", "anvandare").content;

    assert.equal(
      sum(content.balansrakningTillgangar, "Summa tillgångar"),
      sum(content.balansrakningEgetKapitalSkulder, "Summa eget kapital och skulder"),
      "balansräkningen balanserar inte"
    );
    // Periodiseringsfonden är en obeskattad reserv, inte en kortfristig skuld.
    assert.equal(sum(content.balansrakningEgetKapitalSkulder, "Obeskattade reserver"), 40_000);
    assert.ok(content.noter.some((n) => n.title.includes("Obeskattade reserver")));
  });

  /*
   * "Årets resultat" i balansräkningen ska vara ETT års resultat.
   *
   * Utan omföringen av föregående års resultat ackumuleras kontot: summa eget
   * kapital blir ändå rätt, vilket är precis varför felet är lätt att missa,
   * men balansräkningen påstår då att hela historiken är årets resultat och att
   * bolaget aldrig balanserat något. Det är fördelningen läsaren tittar på.
   */
  it("årets resultat är årets, inte summan av alla år", () => {
    revenue(2024, 500_000);
    closeFiscalYear("fy-2024", "anvandare");
    const forra = generateAnnualReport("fy-2024", "anvandare").content;
    const forraResultat = sum(forra.resultatrakning, "Årets resultat");

    revenue(2025, 900_000);
    closeFiscalYear("fy-2025", "anvandare");
    const content = generateAnnualReport("fy-2025", "anvandare").content;

    const aretsResultatIResultatrakningen = sum(content.resultatrakning, "Årets resultat");
    const rows = content.balansrakningEgetKapitalSkulder;
    assert.equal(
      sum(rows, "Årets resultat"),
      aretsResultatIResultatrakningen,
      "balansräkningens årets resultat stämmer inte med resultaträkningens"
    );
    assert.equal(sum(rows, "Balanserat resultat"), forraResultat, "föregående års resultat balanserades inte");

    // Fördelningen ändrades, inte summan.
    assert.equal(sum(rows, "Summa eget kapital"), forraResultat + aretsResultatIResultatrakningen);
    assert.equal(sum(content.balansrakningTillgangar, "Summa tillgångar"), sum(rows, "Summa eget kapital och skulder"));

    // Och det stämman har att disponera är båda åren tillsammans.
    assert.equal(
      content.forvaltningsberattelse.resultatdisposition.tillForfogande,
      forraResultat + aretsResultatIResultatrakningen
    );
  });

  it("jämförelsetalen kommer ur föregående års bokföring", () => {
    revenue(2024, 100_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue(2025, 250_000);
    closeFiscalYear("fy-2025", "anvandare");

    const rows = generateAnnualReport("fy-2025", "anvandare").content.resultatrakning;
    const netto = rows.find((r) => r.label === "Nettoomsättning")!;
    assert.equal(netto.amount, 250_000);
    assert.equal(netto.prior, 100_000, "jämförelsetalet är inte förra årets omsättning");
  });

  it("första året saknar jämförelsetal i stället för att låtsas om nollor", () => {
    revenue(2024, 100_000);
    closeFiscalYear("fy-2024", "anvandare");
    const rows = generateAnnualReport("fy-2024", "anvandare").content.resultatrakning;
    assert.equal(rows.find((r) => r.label === "Nettoomsättning")!.prior, undefined);
  });

  it("flerårsöversikten räknar varje år ur sitt eget år", () => {
    revenue(2024, 100_000);
    closeFiscalYear("fy-2024", "anvandare");
    revenue(2025, 250_000);
    closeFiscalYear("fy-2025", "anvandare");

    const overview = multiYearOverview(getFiscalYear("fy-2025")!);
    assert.equal(overview.length, 2);
    assert.equal(overview[0]?.label, "2025");
    assert.equal(overview[0]?.nettoomsattning, 250_000);
    assert.equal(overview[1]?.label, "2024");
    assert.equal(overview[1]?.nettoomsattning, 100_000);
  });
});

describe("årsredovisning – noter", () => {
  beforeEach(reset);

  it("medelantalet anställda räknas ur lönekörningarna", () => {
    saveEmployee(
      {
        name: "Anna Ägare",
        personnummer: "19850612-1234",
        role: "foretagsledare",
        monthlySalary: 30_000,
        taxBasis: { kind: "procent", percent: 30 },
        startDate: "2025-07-01",
      },
      "anvandare"
    );
    // Lön i sex av tolv månader är ett halvt årsarbete.
    for (const month of ["07", "08", "09", "10", "11", "12"]) {
      runPayroll({ month: `2025-${month}` }, "anvandare");
    }
    assert.equal(averageEmployees(getFiscalYear("fy-2025")!), 0.5);

    revenue(2025, 500_000);
    saveYearEndSchedule("fy-2025", "semesterloneskuld", { savedVacationDays: 0 }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy-2025", "semesterloneskuld")!.id, "anvandare");
    closeFiscalYear("fy-2025", "anvandare");
    const noter = generateAnnualReport("fy-2025", "anvandare").content.noter;
    const not = noter.find((n) => n.title.includes("Medelantal anställda"));
    assert.ok(not, "noten om medelantal anställda saknas");
    assert.match(not.body, /0,5/);
  });

  it("utan anställda säger noten det, i stället för att utelämnas", () => {
    revenue(2025, 100_000);
    closeFiscalYear("fy-2025", "anvandare");
    const not = generateAnnualReport("fy-2025", "anvandare").content.noter.find((n) =>
      n.title.includes("Medelantal anställda")
    );
    assert.ok(not);
    assert.match(not.body, /inte haft några anställda/);
  });

  /*
   * Notnumret är en hänvisning: en upphöjd 4 i balansräkningen är ett löfte om
   * att not 4 finns och handlar om just den posten. Noterna är villkorliga –
   * ett bolag utan inventarier har ingen inventarienot – så numren får inte
   * vara hårdkodade vid raderna. Då pekar de på hål.
   */
  it("noterna numreras löpande utan hål, även när en not utelämnas", () => {
    revenue(2025, 400_000);
    // Ingen inventarienot: bolaget har inga anläggningstillgångar. Men en
    // periodiseringsfond, så noten om obeskattade reserver finns.
    saveYearEndSchedule("fy-2025", "periodiseringsfond", { fundAllocation: 40_000 }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy-2025", "periodiseringsfond")!.id, "anvandare");
    closeFiscalYear("fy-2025", "anvandare");
    const content = generateAnnualReport("fy-2025", "anvandare").content;

    assert.ok(
      !content.noter.some((n) => n.title.includes("Inventarier")),
      "utan inventarier ska inventarienoten inte finnas"
    );
    assert.deepEqual(
      content.noter.map((n) => n.number),
      content.noter.map((_, i) => i + 1),
      "notnumren har hål"
    );

    // Varje hänvisning i uppställningarna pekar på en not som finns.
    const numbers = new Set(content.noter.map((n) => n.number));
    const referenced = [
      ...content.resultatrakning,
      ...content.balansrakningTillgangar,
      ...content.balansrakningEgetKapitalSkulder,
    ]
      .map((r) => r.note)
      .filter((n): n is number => n !== undefined);
    assert.ok(referenced.length > 0, "inga nothänvisningar alls är misstänkt");
    for (const ref of referenced) {
      assert.ok(numbers.has(ref), `raden hänvisar till not ${ref} som inte finns`);
    }

    // Och hänvisningen pekar på RÄTT not, inte bara på någon not.
    const obeskattadeRow = content.balansrakningEgetKapitalSkulder.find((r) => r.label === "Obeskattade reserver");
    const obeskattadeNote = content.noter.find((n) => n.title.includes("Obeskattade reserver"));
    assert.equal(obeskattadeRow?.note, obeskattadeNote?.number);

    // Titeln bär inte sitt eget nummer – då skulle det tryckas två gånger.
    for (const n of content.noter) assert.ok(!/^Not\s/.test(n.title), `notrubriken dubblerar numret: ${n.title}`);
  });
});

describe("årsredovisning – redigering, underskrifter och fastställelseintyg", () => {
  beforeEach(reset);

  function report() {
    revenue(2025, 300_000);
    closeFiscalYear("fy-2025", "anvandare");
    return generateAnnualReport("fy-2025", "anvandare");
  }

  /** En rapport som är redo att signeras: underskrifterna är ifyllda. */
  function signable() {
    const r = report();
    updateAnnualReport(r.id, { underskrifter: [{ name: "Anna Ägare", role: "Styrelseledamot" }] }, "anvandare");
    return r;
  }

  it("förvaltningsberättelsen går att skriva om", () => {
    const r = report();
    const updated = updateAnnualReport(
      r.id,
      { verksamhet: "Bolaget utför badrumsrenoveringar i Göteborg.", vasentligaHandelser: "Bolaget tog ett banklån." },
      "anvandare"
    );
    assert.equal(updated.content.forvaltningsberattelse.verksamhet, "Bolaget utför badrumsrenoveringar i Göteborg.");
    assert.equal(updated.content.forvaltningsberattelse.vasentligaHandelser, "Bolaget tog ett banklån.");
  });

  it("utdelning kan inte överstiga det som står till stämmans förfogande", () => {
    const r = report();
    const tillForfogande = r.content.forvaltningsberattelse.resultatdisposition.tillForfogande;
    assert.throws(() => updateAnnualReport(r.id, { utdelning: tillForfogande + 1 }, "anvandare"), /förfogande/);

    const updated = updateAnnualReport(r.id, { utdelning: 10_000 }, "anvandare");
    const disp = updated.content.forvaltningsberattelse.resultatdisposition;
    assert.equal(disp.utdelning, 10_000);
    assert.equal(disp.balanserasINyRakning, tillForfogande - 10_000, "resten balanseras inte i ny räkning");
  });

  it("den kan inte signeras utan att någon skriver under", () => {
    const r = report();
    updateAnnualReport(r.id, { underskrifter: [{ name: "Anna Ägare", role: "Styrelseledamot" }] }, "anvandare");
    advanceAnnualReportStatus(r.id, "granskad", "anvandare");

    // Tom underskriftslista går inte att spara – förslaget måste fyllas i.
    assert.throws(() => updateAnnualReport(r.id, { underskrifter: [{ name: "  ", role: "" }] }, "anvandare"), /minst en/);

    const signed = advanceAnnualReportStatus(r.id, "signerad", "anvandare");
    // Underskriftsdatumet hör till dokumentet, inte bara till loggen.
    assert.ok(signed.content.underskrifter?.[0]?.signedAt, "underskriftsdatumet sparades inte i dokumentet");
    assert.equal(signed.content.underskrifter?.[0]?.place, "Göteborg");
  });

  it("den signerade årsredovisningen går inte längre att ändra", () => {
    const r = signable();
    advanceAnnualReportStatus(r.id, "granskad", "anvandare");
    advanceAnnualReportStatus(r.id, "signerad", "anvandare");
    assert.throws(() => updateAnnualReport(r.id, { verksamhet: "Ändrad text" }, "anvandare"), /signerad/);
  });

  it("den kan inte markeras som inlämnad utan fastställelseintyg", () => {
    const r = signable();
    advanceAnnualReportStatus(r.id, "granskad", "anvandare");
    advanceAnnualReportStatus(r.id, "signerad", "anvandare");

    const blockers = annualReportBlockers(r, "inlamnad_markerad");
    assert.equal(blockers.length, 2, "både stämmodatum och bestyrkande ska krävas");
    assert.throws(() => advanceAnnualReportStatus(r.id, "inlamnad_markerad", "anvandare"), /årsstämman/);
  });

  it("fastställelseintyget kan fyllas i medan rapporten är osignerad", () => {
    const r = signable();
    const updated = updateAnnualReport(
      r.id,
      {
        fastallelseintyg: {
          stammaDate: "2027-05-20",
          certifiedByName: "Anna Ägare",
          certifiedByRole: "Styrelseledamot",
        },
      },
      "anvandare"
    );
    assert.equal(annualReportBlockers(updated, "inlamnad_markerad").length, 0);

    advanceAnnualReportStatus(r.id, "granskad", "anvandare");
    advanceAnnualReportStatus(r.id, "signerad", "anvandare");
    const filed = advanceAnnualReportStatus(r.id, "inlamnad_markerad", "anvandare");
    assert.ok(filed.markedFiledAt);
  });

  it("stegen tas i ordning", () => {
    const r = report();
    assert.throws(() => advanceAnnualReportStatus(r.id, "signerad", "anvandare"), /i ordning/);
  });
});

describe("årsredovisning – när den inte får upprättas", () => {
  beforeEach(reset);

  it("ett öppet räkenskapsår har inga fastställda siffror", () => {
    revenue(2025, 100_000);
    assert.throws(() => generateAnnualReport("fy-2025", "anvandare"), /inte stängt/);
  });

  it("enskild firma upprättar ingen årsredovisning", () => {
    db().settings.companyForm = "enskild";
    revenue(2025, 100_000);
    assert.throws(() => generateAnnualReport("fy-2025", "anvandare"), /Enskild firma/);
  });

  it("samma år ger samma årsredovisning – den skapas inte om", () => {
    revenue(2025, 100_000);
    closeFiscalYear("fy-2025", "anvandare");
    const first = generateAnnualReport("fy-2025", "anvandare");
    assert.equal(generateAnnualReport("fy-2025", "anvandare").id, first.id);
  });
});

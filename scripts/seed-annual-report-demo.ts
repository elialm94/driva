/**
 * Seedar ett stängt räkenskapsår med lön, ränta och periodiseringsfond och
 * upprättar årsredovisningen, så att sidan och A4-vyn går att titta på i
 * utvecklingsläge. Skriptet är ett verktyg för manuell granskning, inte en del
 * av produkten.
 */
import fs from "node:fs";
import path from "node:path";
import { db, save } from "../src/lib/store";
import { postVerification } from "../src/lib/accounting/engine";
import { closeFiscalYear } from "../src/lib/accounting/close";
import { saveEmployee, runPayroll } from "../src/lib/accounting/payroll";
import { saveYearEndSchedule, bookYearEndSchedule, yearEndScheduleFor } from "../src/lib/accounting/year-end";
import { generateAnnualReport, updateAnnualReport } from "../src/lib/accounting/annual-report";

const YEAR = 2025;
const PRIOR = 2024;

function ensureYear(year: number) {
  const data = db();
  const id = `fy-${year}`;
  if (!data.fiscalYears.some((f) => f.id === id)) {
    data.fiscalYears.push({
      id,
      label: String(year),
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status: "oppet",
      openingBalances: {},
      openingSource: "migrering",
    });
  }
  return id;
}

function revenue(year: number, amount: number, month = "06") {
  postVerification({
    date: `${year}-${month}-15`,
    description: "Fakturerad entreprenad",
    entries: [
      { account: 1930, debit: amount },
      { account: 3001, credit: amount },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

function cost(year: number, amount: number) {
  postVerification({
    date: `${year}-07-10`,
    description: "Material",
    entries: [
      { account: 4010, debit: amount },
      { account: 1930, credit: amount },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

function main() {
  const data = db();
  data.settings.name = "Bygg & Co AB";
  data.settings.orgNumber = "556677-8899";
  data.settings.sate = "Göteborg";
  data.settings.companyForm = "ab";

  ensureYear(PRIOR);
  ensureYear(YEAR);

  // Föregående år ger jämförelsetal och en rad i flerårsöversikten.
  revenue(PRIOR, 640_000);
  cost(PRIOR, 210_000);
  closeFiscalYear(`fy-${PRIOR}`, "anvandare");

  // Rapportåret: omsättning, kostnader, lån med ränta och en lön.
  revenue(YEAR, 980_000, "03");
  revenue(YEAR, 720_000, "09");
  cost(YEAR, 430_000);
  postVerification({
    date: `${YEAR}-02-01`,
    description: "Banklån utbetalt",
    entries: [
      { account: 1930, debit: 300_000 },
      { account: 2350, credit: 300_000 },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
  postVerification({
    date: `${YEAR}-12-30`,
    description: "Ränta på banklån",
    entries: [
      { account: 8410, debit: 14_500 },
      { account: 1930, credit: 14_500 },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
  postVerification({
    date: `${YEAR}-12-30`,
    description: "Ränta på företagskonto",
    entries: [
      { account: 1930, debit: 2_300 },
      { account: 8310, credit: 2_300 },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });

  saveEmployee(
    {
      name: "Anna Ägare",
      personnummer: "19850612-1234",
      role: "foretagsledare",
      monthlySalary: 42_000,
      taxBasis: { kind: "procent", percent: 30 },
      startDate: `${YEAR}-01-01`,
    },
    "anvandare"
  );
  for (let m = 1; m <= 12; m++) runPayroll({ month: `${YEAR}-${String(m).padStart(2, "0")}` }, "anvandare");

  saveYearEndSchedule(`fy-${YEAR}`, "semesterloneskuld", { savedVacationDays: 8 }, "anvandare");
  bookYearEndSchedule(yearEndScheduleFor(`fy-${YEAR}`, "semesterloneskuld")!.id, "anvandare");
  saveYearEndSchedule(`fy-${YEAR}`, "periodiseringsfond", { fundAllocation: 60_000 }, "anvandare");
  bookYearEndSchedule(yearEndScheduleFor(`fy-${YEAR}`, "periodiseringsfond")!.id, "anvandare");

  closeFiscalYear(`fy-${YEAR}`, "anvandare");
  const report = generateAnnualReport(`fy-${YEAR}`, "anvandare");
  updateAnnualReport(
    report.id,
    {
      verksamhet:
        "Bolaget utför badrums- och kökrenoveringar åt privatpersoner i Göteborg med omnejd. Verksamheten bedrivs från bolagets lokal i Majorna.",
      vasentligaHandelser:
        "Bolaget tog under året upp ett banklån om 300 000 kr för att finansiera en ny servicebil. Omsättningen ökade jämfört med föregående år.",
      utdelning: 50_000,
      underskrifter: [
        { name: "Anna Ägare", role: "Styrelseledamot" },
        { name: "Björn Ägare", role: "Styrelsesuppleant" },
      ],
      fastallelseintyg: {
        stammaDate: `${YEAR + 1}-05-20`,
        certifiedByName: "Anna Ägare",
        certifiedByRole: "Styrelseledamot",
      },
    },
    "anvandare"
  );

  save();
  const file = path.join(process.cwd(), ".data", "db.json");
  console.log(`Årsredovisning ${YEAR} upprättad. Tillstånd: ${file} (${fs.statSync(file).size} byte)`);
  console.log(`Sida: /bokforing/bokslut/arsredovisning/fy-${YEAR}`);
}

main();

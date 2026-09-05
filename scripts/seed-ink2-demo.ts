/**
 * Seedar ett bolag som har alla fyra skattemässiga justeringarna samtidigt:
 * ett underskott från ett tidigare år, en periodiseringsfond som räntebeläggs,
 * ej avdragsgill representation, en skattefri ränteintäkt och en inventarie
 * vars avskrivningsplan är längre än vad skattereglerna kräver.
 *
 * Skriptet finns för att INK2-sidan ska gå att granska med ögonen i
 * utvecklingsläge. Det är ett verktyg, inte en del av produkten.
 */
import fs from "node:fs";
import path from "node:path";
import { db, save } from "../src/lib/store";
import { postVerification } from "../src/lib/accounting/engine";
import { closeFiscalYear } from "../src/lib/accounting/close";
import { registerAssetFromExpense, createDepreciationEntry } from "../src/lib/accounting/assets";
import { saveYearEndSchedule, bookYearEndSchedule, yearEndScheduleFor } from "../src/lib/accounting/year-end";
import { computeTaxCalculation, ink2Rows } from "../src/lib/accounting/tax";
import { getFiscalYear } from "../src/lib/accounting/fiscal";

const FUND_YEAR = 2022;
const LOSS_YEAR = 2023;
const MIDDLE_YEAR = 2024;
const YEAR = 2025;

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

function post(date: string, description: string, entries: { account: number; debit?: number; credit?: number }[]) {
  postVerification({ date, description, entries, source: { type: "manuell" }, createdBy: "anvandare" });
}

function main() {
  const data = db();
  data.settings.name = "Bygg & Co AB";
  data.settings.orgNumber = "556677-8899";
  data.settings.companyForm = "ab";
  // Ingen bankkoppling i det här scenariot: avstämningen av 1930 blir manuell
  // och skattesidan är det som ska granskas.
  data.bankAccounts = [];

  for (const year of [FUND_YEAR, LOSS_YEAR, MIDDLE_YEAR, YEAR]) ensureYear(year);

  // Ett vinstår med avsättning till periodiseringsfond. Fonden ligger kvar och
  // räntebeläggs varje år tills den återförs.
  post(`${FUND_YEAR}-06-15`, "Fakturerad entreprenad", [
    { account: 1930, debit: 900_000 },
    { account: 3001, credit: 900_000 },
  ]);
  post(`${FUND_YEAR}-07-10`, "Material", [
    { account: 4010, debit: 300_000 },
    { account: 1930, credit: 300_000 },
  ]);
  saveYearEndSchedule(`fy-${FUND_YEAR}`, "periodiseringsfond", { fundAllocation: 120_000 }, "anvandare");
  bookYearEndSchedule(yearEndScheduleFor(`fy-${FUND_YEAR}`, "periodiseringsfond")!.id, "anvandare");
  closeFiscalYear(`fy-${FUND_YEAR}`, "anvandare");

  // Ett förlustår: underskottet sparas och dras av mot senare vinster.
  post(`${LOSS_YEAR}-06-15`, "Fakturerad entreprenad", [
    { account: 1930, debit: 300_000 },
    { account: 3001, credit: 300_000 },
  ]);
  post(`${LOSS_YEAR}-07-10`, "Material och underentreprenad", [
    { account: 4010, debit: 550_000 },
    { account: 1930, credit: 550_000 },
  ]);
  closeFiscalYear(`fy-${LOSS_YEAR}`, "anvandare");

  // Ett mellanår som går plus minus noll, så underskottet lever kvar orört.
  post(`${MIDDLE_YEAR}-06-15`, "Fakturerad entreprenad", [
    { account: 1930, debit: 400_000 },
    { account: 3001, credit: 400_000 },
  ]);
  post(`${MIDDLE_YEAR}-07-10`, "Material", [
    { account: 4010, debit: 400_000 },
    { account: 1930, credit: 400_000 },
  ]);
  closeFiscalYear(`fy-${MIDDLE_YEAR}`, "anvandare");

  // Deklarationsåret: ej avdragsgill representation, skattefri ränta och en
  // inventarie som skrivs av på tio år fast skatten tillåter 30 % direkt.
  post(`${YEAR}-06-15`, "Fakturerad entreprenad", [
    { account: 1930, debit: 850_000 },
    { account: 3001, credit: 850_000 },
  ]);
  post(`${YEAR}-07-10`, "Material", [
    { account: 4010, debit: 240_000 },
    { account: 1930, credit: 240_000 },
  ]);
  post(`${YEAR}-09-04`, "Restaurangbesök med kund", [
    { account: 6072, debit: 4_800 },
    { account: 1930, credit: 4_800 },
  ]);
  post(`${YEAR}-12-20`, "Kostnadsränta skattekonto", [
    { account: 8423, debit: 1_450 },
    { account: 1930, credit: 1_450 },
  ]);
  post(`${YEAR}-12-20`, "Intäktsränta skattekonto", [
    { account: 1930, debit: 620 },
    { account: 8314, credit: 620 },
  ]);

  data.expenses.push({
    id: "exp-ink2-slipmaskin",
    supplier: "Maskinbolaget",
    description: "Golvslipmaskin",
    date: `${YEAR}-03-12`,
    amount: 250_000,
    vatAmount: 50_000,
    category: "inventarier",
    status: "saknar_kvitto",
    createdAt: `${YEAR}-03-12T09:00:00Z`,
  });
  const asset = registerAssetFromExpense("exp-ink2-slipmaskin", { usefulLifeYears: 10, by: "anvandare" });
  createDepreciationEntry(asset.id, `fy-${YEAR}`, "anvandare");

  save();

  const fy = getFiscalYear(`fy-${YEAR}`)!;
  const tax = computeTaxCalculation(fy);
  const file = path.join(process.cwd(), ".data", "db.json");
  console.log(`Tillstånd: ${file} (${fs.statSync(file).size} byte)`);
  console.log(`Sida: /bokforing/bokslut/ink2/fy-${YEAR}`);
  for (const row of ink2Rows(tax)) console.log(`  ${row.field.padEnd(6)} ${row.label.padEnd(52)} ${row.amount}`);
  for (const note of tax.manualReviewNotes) console.log(`  ⚠ ${note}`);
}

main();

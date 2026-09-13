/**
 * npm run scenario -- <scenario> [mapp]
 *
 * Skriver en färsk JSON-lagring för ett namngivet scenario. Filen har samma
 * format och namn som utvecklingslagret läser (`<mapp>/db.json`, se
 * src/lib/store.ts), och byggs genom samma `normalize()` som lagret kör vid
 * första läsningen - det som skrivs är alltså redan hydrerat.
 *
 *   npm run scenario -- demo               → .data/db.json (demoföretaget)
 *   npm run scenario -- nystart            → .data/db.json (nystartat AB)
 *   npm run scenario -- nystart /tmp/kors  → /tmp/kors/db.json
 *
 * Scenariot är resettbart: filen skrivs om från noll varje gång (tmp + rename,
 * precis som lagrets egen persist), så en körning är samma sak som en
 * återställning.
 *
 * Scenarier:
 *
 *   demo     - återanvänder src/lib/seed.ts oförändrat (Södermalms Snickeri AB
 *              med kunder, offerter, fakturor och bokförd historik).
 *   nystart  - ett aktiebolag startat 1 september 2026: bankkoppling med tolv
 *              månaders historik, helårsmoms och INGEN bokföring alls. Inga
 *              verifikationer skrivs här - bokföring sker bara genom
 *              postVerification i appen.
 */
import fs from "node:fs";
import path from "node:path";

import { makeFiscalYear } from "../src/lib/accounting/dates";
import { slugFromCompanyName } from "../src/lib/inbox/inbound-slug";
import { buildSeed } from "../src/lib/seed";
import { STANDARD_TERMS } from "../src/lib/standard-quote-terms";
import { normalize } from "../src/lib/store";
import type { BankTransaction, DB } from "../src/lib/types";

export const SCENARIOS = ["demo", "nystart"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

/** Filnamnet JSON-lagret läser i en datamapp. */
export const STORE_FILENAME = "db.json";

/** Standardmapp: samma som lagret läser lokalt (`.data/db.json`). */
export const DEFAULT_STORE_DIR = ".data";

export function isScenarioName(value: string): value is ScenarioName {
  return (SCENARIOS as readonly string[]).includes(value);
}

/* ---------------------------- Scenario: nystart ---------------------------- */

/** Bolagets första dag. Första räkenskapsåret blir brutet (sep-aug). */
const NYSTART_START_DATE = "2026-09-01";
const NYSTART_FISCAL_END = "2027-08-31";

/**
 * Bankhistoriken är tolv hela månader som SLUTAR med bolagets startmånad
 * (2025-10 t.o.m. 2026-09). Historik är bakåt i tiden och ett bankmedgivande
 * levererar kontots senaste tolv månader, så elva av månaderna ligger före
 * bolagets startdatum - det är kontohistoriken som följde med in i den nya
 * kopplingen. Ingenting av den är bokfört (scenariot har noll verifikationer),
 * så ingen verifikation hamnar före bolagets första dag.
 */
const NYSTART_HISTORY_MONTHS = 12;

const NYSTART_ACCOUNT_ID = "acc-nystart";
const NYSTART_COMPANY_NAME = "Nystart Bygg AB";

/** Hyran: 6 500 kr den 3:e varje månad. */
const HYRA_KR = 6_500;
const HYRA_DAY = 3;
const HYRA_COUNTERPART = "Fastighets AB Söderport";

/** Den återkommande inbetalningen: 18 870 kr den 2:a varje månad. */
const INBETALNING_KR = 18_870;
const INBETALNING_DAY = 2;
const INBETALNING_COUNTERPART = "Brf Kvarnen";

const MONTH_SHORT = ["JAN", "FEB", "MAR", "APR", "MAJ", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEC"];

const MERCHANTS = {
  bauhaus: { counterpart: "Bauhaus", description: "Kortköp BAUHAUS SICKLA" },
  beijer: { counterpart: "Beijer Bygg", description: "Kortköp BEIJER BYGG 108" },
  circlek: { counterpart: "Circle K", description: "Kortköp CIRCLE K RINGVÄGEN" },
} as const;

type MerchantKey = keyof typeof MERCHANTS;

/** Tio blandade köp per månad hos Bauhaus, Beijer och Circle K. */
const MONTHLY_PURCHASES: { day: number; hour: number; merchant: MerchantKey; base: number }[] = [
  { day: 4, hour: 8, merchant: "bauhaus", base: 890 },
  { day: 6, hour: 7, merchant: "circlek", base: 745 },
  { day: 8, hour: 9, merchant: "beijer", base: 1_180 },
  { day: 10, hour: 16, merchant: "bauhaus", base: 420 },
  { day: 12, hour: 7, merchant: "circlek", base: 680 },
  { day: 15, hour: 10, merchant: "beijer", base: 1_450 },
  { day: 18, hour: 13, merchant: "bauhaus", base: 310 },
  { day: 21, hour: 6, merchant: "circlek", base: 820 },
  { day: 24, hour: 11, merchant: "beijer", base: 950 },
  { day: 27, hour: 15, merchant: "bauhaus", base: 455 },
];

/**
 * Beloppsvariation i hela kronor så att två månader aldrig ser identiska ut.
 * Deterministisk (ingen slump) - samma scenario ger samma fil varje körning.
 */
const AMOUNT_VARIATION = [0, 115, -60, 240, 35, -95, 180, 70, -30, 150, 95, -120];

/** Månadsnycklar (YYYY-MM) för de `count` månader som slutar med `lastMonth`. */
function monthsEndingWith(lastMonth: string, count: number): string[] {
  const lastIndex = Number(lastMonth.slice(0, 4)) * 12 + (Number(lastMonth.slice(5, 7)) - 1);
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const index = lastIndex - back;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    months.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  return months;
}

function at(month: string, day: number, hour: number): string {
  return `${month}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

/** Ny, ohanterad transaktion. externalId gör en återimport idempotent. */
function newTx(input: Omit<BankTransaction, "status" | "externalId">): BankTransaction {
  return { ...input, externalId: `mock-${input.id}`, status: "ny" };
}

function nystartBankTransactions(): BankTransaction[] {
  const months = monthsEndingWith(NYSTART_START_DATE.slice(0, 7), NYSTART_HISTORY_MONTHS);
  const transactions: BankTransaction[] = [];

  months.forEach((month, monthIndex) => {
    const monthLabel = MONTH_SHORT[Number(month.slice(5, 7)) - 1];

    transactions.push(
      newTx({
        id: `tx-nystart-${month}-inbetalning`,
        accountId: NYSTART_ACCOUNT_ID,
        date: at(month, INBETALNING_DAY, 9),
        amount: INBETALNING_KR,
        counterpart: INBETALNING_COUNTERPART,
        description: "Inbetalning bankgiro",
      })
    );
    transactions.push(
      newTx({
        id: `tx-nystart-${month}-hyra`,
        accountId: NYSTART_ACCOUNT_ID,
        date: at(month, HYRA_DAY, 6),
        amount: -HYRA_KR,
        counterpart: HYRA_COUNTERPART,
        description: `Bankgiro HYRA ${monthLabel}`,
      })
    );

    MONTHLY_PURCHASES.forEach((purchase, i) => {
      const merchant = MERCHANTS[purchase.merchant];
      const variation = AMOUNT_VARIATION[(monthIndex * 7 + i) % AMOUNT_VARIATION.length];
      transactions.push(
        newTx({
          id: `tx-nystart-${month}-kop-${i + 1}`,
          accountId: NYSTART_ACCOUNT_ID,
          date: at(month, purchase.day, purchase.hour),
          amount: -(purchase.base + variation),
          counterpart: merchant.counterpart,
          description: merchant.description,
        })
      );
    });
  });

  return transactions.sort((a, b) => b.date.localeCompare(a.date));
}

function buildNystart(): DB {
  const bankTransactions = nystartBankTransactions();
  // Saldot är exakt de pengar kontot fått in och ut. Ingenting är bokfört, så
  // bankavstämningen förklaras i sin helhet av de ohanterade transaktionerna.
  const balance = bankTransactions.reduce((sum, tx) => sum + tx.amount, 0);
  const connectedAt = `${NYSTART_START_DATE}T08:00:00.000Z`;
  const lastSyncAt = bankTransactions[0]?.date ?? connectedAt;

  return {
    settings: {
      name: NYSTART_COMPANY_NAME,
      companyForm: "ab",
      orgNumber: "559988-1122",
      vatNumber: "SE559988112201",
      email: "info@nystartbygg.se",
      phone: "08-410 22 30",
      address: "Hornsgatan 148",
      postalCode: "117 28",
      city: "Stockholm",
      sate: "Stockholm",
      country: "Sverige",
      bankgiro: "5010-1234",
      logoInitials: "NB",
      // Helårsmoms: beskattningsunderlaget ligger under 1 mkr och bolaget är
      // registrerat för momsredovisning en gång per år.
      vatPeriodicity: "helar",
      fSkattPerMonth: 0,
      payrollReservePerMonth: 0,
      paymentTermsDays: 30,
      lateInterestRate: 10,
      quoteValidityDays: 30,
      defaultVatRate: 25,
      defaultQuoteTerms: STANDARD_TERMS,
      inboundMailSlug: slugFromCompanyName(NYSTART_COMPANY_NAME),
    },
    sequences: { quote: 1, invoice: 1, verification: 1 },
    customers: [],
    quotes: [],
    quoteVersions: [],
    signatures: [],
    bankidOrders: [],
    jobs: [],
    jobWorkEntries: [],
    invoices: [],
    payments: [],
    bankAccounts: [
      {
        id: NYSTART_ACCOUNT_ID,
        provider: "mock",
        name: "Företagskonto",
        accountNumber: "SEB ···· 4512",
        balance,
        connectedAt,
        externalId: "mock-account-nystart",
      },
    ],
    bankTransactions,
    bankConnections: [
      {
        id: "bankconn-nystart",
        provider: "mock",
        status: "connected",
        bankName: "SEB",
        maskedAccount: "···· 4512",
        connectedAt,
        lastSyncAt,
        createdAt: connectedAt,
        updatedAt: lastSyncAt,
      },
    ],
    expenses: [],
    receipts: [],
    supplierInvoices: [],
    supplierPayments: [],
    paymentFiles: [],
    // Ingen bokföring: bolaget har precis startat och allt i banken väntar på
    // att bokföras i appen.
    verifications: [],
    chartAccounts: [],
    fiscalYears: [makeFiscalYear(NYSTART_START_DATE, NYSTART_FISCAL_END)],
    accounting: {},
    vatReports: [],
    employees: [],
    payrollRuns: [],
    employerDeclarations: [],
    assets: [],
    accruals: [],
    yearEndSchedules: [],
    auditTrail: [],
    annualReports: [],
    filingSubmissions: [],
    activity: [],
    website: null,
    domains: [],
    domainAudit: [],
    assistantMessages: [],
    pendingActions: [],
    assistantAudit: [],
    reminders: [],
    attentionStates: [],
    inboxItems: [],
    collaborationInvitations: [],
    clientInformationRequests: [],
    wholesalerConnections: [],
    wholesalerPriceImports: [],
    purchaseOrders: [],
    purchaseOrderLines: [],
    purchaseOrderConfirmations: [],
    onboarding: null,
    dataImports: [],
    suppliers: [],
    meta: { seededAt: new Date().toISOString() },
  };
}

/* --------------------------------- Skrivning ------------------------------- */

/** Scenariots tillstånd, hydrerat precis som lagret hydrerar en laddad fil. */
export function buildScenario(name: ScenarioName): DB {
  const data = name === "demo" ? buildSeed() : buildNystart();
  // persistIfDirty: false - byggandet får aldrig röra en befintlig .data/db.json.
  return normalize(data, { persistIfDirty: false });
}

/** Skriv tillståndet till `<dir>/db.json`. Överskriver atomärt. */
export function writeStore(data: DB, dir: string): string {
  const file = path.join(dir, STORE_FILENAME);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
  fs.renameSync(tmp, file);
  return file;
}

export function writeScenario(name: ScenarioName, dir: string): string {
  return writeStore(buildScenario(name), dir);
}

function main(argv: string[]): void {
  const [nameArg, dirArg] = argv;
  if (!nameArg || !isScenarioName(nameArg)) {
    console.error(`Ange ett scenario: ${SCENARIOS.join(" eller ")}.`);
    console.error(`Exempel: npm run scenario -- nystart [mapp, standard ${DEFAULT_STORE_DIR}]`);
    process.exitCode = 1;
    return;
  }
  const dir = path.resolve(dirArg ?? DEFAULT_STORE_DIR);
  const data = buildScenario(nameArg);
  const file = writeStore(data, dir);
  console.log(`Scenariot "${nameArg}" skrevs till ${file}.`);
  console.log(
    `${data.customers.length} kunder, ${data.invoices.length} fakturor, ` +
      `${data.bankTransactions.length} banktransaktioner, ${data.verifications.length} verifikationer.`
  );
}

// Körs bara som kommando. Testet importerar samma funktioner direkt.
if (path.basename(process.argv[1] ?? "") === "scenario.ts") {
  main(process.argv.slice(2));
}

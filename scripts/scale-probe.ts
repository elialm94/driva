process.env.DRIVA_TEST = "1";

/**
 * Skalprov utan server: bygger den syntetiska stordatabasen i minnet
 * (~5 000 kunder, ~10 000 fakturor, ~26 000 huvudboksrader) och mäter
 * läsmodellerna och aggregeringarna som sidorna Hem, Kunder, Uppdrag,
 * Ekonomi och Bokföring bygger på.
 *
 *   npx tsx scripts/scale-probe.ts
 */

import { buildScaleData } from "../src/lib/dev/scale-data";
import { listCustomersForTable, listInquiriesInbox } from "../src/lib/services/customers";
import { customerBundle } from "../src/lib/services/data";
import { listJobsForTable } from "../src/lib/services/job-list";
import { getBusinessActions } from "../src/lib/services/actions";
import { listInvoicesForTable, listQuotesForTable } from "../src/lib/services/economy-list";
import { businessStats } from "../src/lib/services/finance";
import { huvudbok, saldobalans, resultatrapport, ledgerIntegrity } from "../src/lib/accounting/ledger";
import { bankReconciliation } from "../src/lib/accounting/reconciliation";
import { db } from "../src/lib/store";

function time(label: string, fn: () => unknown, iterations = 5): void {
  fn(); // värm upp
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const ms = (performance.now() - start) / iterations;
  console.log(`${ms.toFixed(1).padStart(8)} ms  ${label}`);
}

const stats = buildScaleData();
console.log("Dataset:", JSON.stringify(stats));
console.log("");

time("Kunder: listCustomersForTable sida 1", () => listCustomersForTable({}));
time("Kunder: sökning 'Andersson 42'", () => listCustomersForTable({ q: "Andersson 42" }));
time("Kunder: filter obetalt + sortering belopp", () => listCustomersForTable({ payment: "obetalt", sort: "attBetala" }));
time("Förfrågningar: listInquiriesInbox", () => listInquiriesInbox({}));
time("Uppdrag: listJobsForTable sida 1", () => listJobsForTable({}));
time("Hem: getBusinessActions", () => getBusinessActions());
time("Ekonomi: listInvoicesForTable sida 1", () => listInvoicesForTable({}));
time("Ekonomi: listQuotesForTable sökning", () => listQuotesForTable({ q: "Andersson" }));
time("Ekonomi: businessStats", () => businessStats());
time("Kundkort: customerBundle (1 kund)", () => customerBundle("scale-cust-42"));
time("Bokföring: saldobalans", () => saldobalans());
time("Bokföring: resultatrapport", () => resultatrapport());
time("Bokföring: huvudbok (alla konton)", () => huvudbok());
time("Bokföring: bankReconciliation", () => bankReconciliation());
time("Bokföring: ledgerIntegrity", () => ledgerIntegrity());

const t0 = performance.now();
const json = JSON.stringify(db());
console.log(`${(performance.now() - t0).toFixed(1).padStart(8)} ms  save(): JSON.stringify hela databasen (${(json.length / 1024 / 1024).toFixed(1)} MB)`);

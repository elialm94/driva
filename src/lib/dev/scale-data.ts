import { db, replaceDb, resetToEmptyCompany, save } from "../store";
import { ocrForInvoice, publicToken, uid } from "../ids";
import type { Customer, DocLine, Invoice, Job, Verification } from "../types";

/**
 * Syntetisk stordatabas för skalprov (dev-verktyg, aldrig i produktion):
 * ~5 000 kunder, ~2 000 uppdrag, ~10 000 fakturor, ~20 000+ huvudboksrader.
 * Deterministisk (seedad PRNG) så att mätningar går att jämföra.
 */

function mulberry32(seedInit: number) {
  let seed = seedInit;
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Anna", "Johan", "Karin", "Erik", "Maria", "Lars", "Sara", "Per", "Eva", "Nils"];
const LAST = ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson"];
const WORK = ["Altanbygge", "Köksrenovering", "Fönsterbyte", "Golvläggning", "Badrum", "Målning", "Garderob", "Trappa"];

export function buildScaleData(): {
  customers: number;
  jobs: number;
  invoices: number;
  verifications: number;
  ledgerRows: number;
} {
  resetToEmptyCompany();
  const rnd = mulberry32(42);
  const data = db();
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();

  const customers: Customer[] = [];
  for (let i = 0; i < 5_000; i++) {
    const name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]} ${i}`;
    customers.push({
      id: `scale-cust-${i}`,
      kind: rnd() < 0.85 ? "privat" : "foretag",
      name,
      email: `kund${i}@example.com`,
      phone: `070-${String(1000000 + i).slice(0, 7)}`,
      address: `Testgatan ${1 + (i % 200)}`,
      postalCode: "116 30",
      city: "Stockholm",
      notes: "",
      createdAt: iso(720 * rnd()),
    });
  }

  const jobs: Job[] = [];
  for (let i = 0; i < 2_000; i++) {
    jobs.push({
      id: `scale-job-${i}`,
      customerId: `scale-cust-${i % 5_000}`,
      title: `${WORK[Math.floor(rnd() * WORK.length)]} ${i}`,
      description: "Syntetiskt uppdrag för skalprov.",
      status: rnd() < 0.5 ? "klart" : rnd() < 0.7 ? "pagar" : "kommande",
      checklist: [],
      notes: "",
      createdAt: iso(500 * rnd()),
    } as unknown as Job);
  }

  const invoices: Invoice[] = [];
  const verifications: Verification[] = [];
  let verNumber = 1;
  for (let i = 0; i < 10_000; i++) {
    const price = 5_000 + Math.floor(rnd() * 40) * 500;
    const line: DocLine = {
      id: uid(),
      kind: "arbete",
      description: "Snickeriarbete",
      qty: 1,
      unit: "st",
      unitPrice: price,
      vatRate: 25,
    };
    const vat = Math.round(price * 0.25);
    const total = price + vat;
    const r = rnd();
    const status: Invoice["status"] = r < 0.6 ? "betald" : r < 0.9 ? "skickad" : "utkast";
    const issued = status !== "utkast";
    const number = issued ? i + 1 : null;
    const createdAt = iso(400 * rnd());
    const inv = {
      id: `scale-inv-${i}`,
      number,
      customerId: `scale-cust-${i % 5_000}`,
      jobId: i % 5 === 0 ? `scale-job-${i % 2_000}` : undefined,
      type: "faktura",
      status,
      lines: [line],
      rot: null,
      issueDate: createdAt,
      dueDate: iso(400 * rnd() - 30),
      paymentTermsDays: 30,
      issuedAt: issued ? createdAt : undefined,
      sentAt: issued ? createdAt : undefined,
      paidAt: status === "betald" ? createdAt : undefined,
      reminders: [],
      token: publicToken(),
      ocr: number != null ? ocrForInvoice(number) : "",
      createdAt,
    } as Invoice;
    invoices.push(inv);

    if (issued) {
      verifications.push({
        id: uid(),
        series: "A",
        number: verNumber++,
        date: createdAt.slice(0, 10),
        description: `Faktura #${number}`,
        entries: [
          { account: 1510, debit: total, credit: 0 },
          { account: 3001, debit: 0, credit: price },
          { account: 2611, debit: 0, credit: vat },
        ],
        source: { type: "kundfaktura", id: inv.id },
        confidence: "hog",
        createdBy: "auto",
        createdAt,
      } as unknown as Verification);
    }
    if (status === "betald") {
      verifications.push({
        id: uid(),
        series: "A",
        number: verNumber++,
        date: createdAt.slice(0, 10),
        description: `Betalning faktura #${number}`,
        entries: [
          { account: 1930, debit: total, credit: 0 },
          { account: 1510, debit: 0, credit: total },
        ],
        source: { type: "betalning", id: inv.id },
        confidence: "hog",
        createdBy: "auto",
        createdAt,
      } as unknown as Verification);
    }
  }

  data.customers = customers;
  data.jobs = jobs;
  data.invoices = invoices;
  data.verifications = verifications;
  data.sequences = { quote: 1, invoice: 10_001, verification: verNumber };
  replaceDb(data);
  save();
  return {
    customers: customers.length,
    jobs: jobs.length,
    invoices: invoices.length,
    verifications: verifications.length,
    ledgerRows: verifications.reduce((s, v) => s + v.entries.length, 0),
  };
}

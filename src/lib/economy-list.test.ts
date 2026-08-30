process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote, quoteDefaults } from "./services/quotes";
import { createInvoice } from "./services/invoices";
import {
  listBankForTable,
  listExpensesForTable,
  listInvoicesForTable,
  listQuotesForTable,
} from "./services/economy-list";
import {
  compareEconomyRows,
  ekonomiRegisterHref,
  economyMobileSortOptions,
  nextEconomySort,
  parseEconomySort,
  type EconomySortable,
} from "./economy-sort";
import { datumKort, kr } from "./format";
import type { Expense, BankTransaction } from "./types";

function defaults() {
  return quoteDefaults();
}

function addQuote(input: {
  customerId: string;
  title: string;
  unitPrice: number;
  createdAt?: string;
  sentAt?: string;
  number?: number;
}) {
  const d = defaults();
  const quote = createQuote({
    customerId: input.customerId,
    title: input.title,
    intro: "",
    lines: [labor({ unitPrice: input.unitPrice })],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: d.paymentTermsDays,
    validUntil: d.validUntil,
    terms: d.terms,
  });
  if (input.createdAt) quote.createdAt = input.createdAt;
  if (input.sentAt) quote.sentAt = input.sentAt;
  if (input.number != null) quote.number = input.number;
  return quote;
}

function addInvoice(input: {
  customerId: string;
  unitPrice: number;
  dueDate: string;
  number?: number | null;
  status?: "utkast" | "skickad" | "betald";
  createdAt?: string;
  ocr?: string;
}) {
  const inv = createInvoice({
    customerId: input.customerId,
    type: "faktura",
    lines: [labor({ unitPrice: input.unitPrice })],
    rot: null,
  });
  inv.dueDate = input.dueDate;
  if (input.number === null) {
    inv.number = null;
    inv.status = "utkast";
  } else if (input.number != null) {
    inv.number = input.number;
    inv.status = input.status ?? "skickad";
  } else if (input.status) {
    inv.status = input.status;
  }
  if (input.createdAt) inv.createdAt = input.createdAt;
  if (input.ocr) inv.ocr = input.ocr;
  return inv;
}

function seedPeople() {
  replaceDb(
    emptyTestDb({
      customers: [
        testCustomer({ id: "c-andersson", name: "Andersson AB" }),
        testCustomer({ id: "c-akesson", name: "Åkesson" }),
        testCustomer({ id: "c-oberg", name: "Öberg Bygg" }),
      ],
    })
  );
}

describe("parseEconomySort", () => {
  it("läser sort + direction och ignorerar ogiltiga värden", () => {
    assert.deepEqual(parseEconomySort("amount", "desc"), { key: "amount", direction: "desc" });
    assert.deepEqual(parseEconomySort("customer", "asc"), { key: "customer", direction: "asc" });
    assert.equal(parseEconomySort("status", "asc"), null);
    assert.equal(parseEconomySort("amount", "up"), null);
    assert.deepEqual(parseEconomySort("date", undefined), { key: "date", direction: "asc" });
    assert.equal(parseEconomySort(undefined, "desc"), null);
  });

  it("första klicket är stigande, andra fallande", () => {
    const first = nextEconomySort("customer", null);
    assert.deepEqual(first, { key: "customer", direction: "asc" });
    assert.deepEqual(nextEconomySort("customer", first), { key: "customer", direction: "desc" });
    assert.deepEqual(nextEconomySort("amount", first), { key: "amount", direction: "asc" });
  });

  it("bygger URL med befintliga ekonomi-parametrar", () => {
    assert.equal(ekonomiRegisterHref("offerter", { page: 1 }), "/ekonomi?flik=offerter");
    assert.equal(
      ekonomiRegisterHref("fakturor", {
        q: "anna",
        status: "obetald",
        sort: { key: "amount", direction: "desc" },
        page: 2,
      }),
      "/ekonomi?flik=fakturor&q=anna&status=obetald&sort=amount&direction=desc&sida=2"
    );
  });

  it("mobilval har Senaste, Äldsta, kund och belopp", () => {
    const labels = economyMobileSortOptions("Kund").map((o) => o.label);
    assert.deepEqual(labels, ["Senaste", "Äldsta", "Kund A–Ö", "Kund Ö–A", "Högst belopp", "Lägst belopp"]);
  });
});

describe("compareEconomyRows", () => {
  const row = (over: Partial<EconomySortable>): EconomySortable => ({
    documentNumber: 1,
    documentLabel: "A",
    customerName: "Anna",
    date: "2026-01-01",
    amount: 1000,
    ...over,
  });

  it("sorterar belopp numeriskt, inte som visningstext", () => {
    const low = row({ amount: 9000, documentLabel: "låg" });
    const high = row({ amount: 23000, documentLabel: "hög" });
    assert.ok(kr(high.amount).includes("23"));
    assert.ok(kr(low.amount).includes("9"));
    assert.ok(compareEconomyRows(low, high, { key: "amount", direction: "asc" }) < 0);
    assert.ok(compareEconomyRows(low, high, { key: "amount", direction: "desc" }) > 0);
  });

  it("sorterar datum som datum, inte som '30 aug.'", () => {
    const jan = row({ date: "2026-01-02", documentLabel: "jan" });
    const dec = row({ date: "2026-12-01", documentLabel: "dec" });
    assert.equal(datumKort(jan.date).includes("jan"), true);
    assert.ok(compareEconomyRows(jan, dec, { key: "date", direction: "asc" }) < 0);
    assert.ok(compareEconomyRows(jan, dec, { key: "date", direction: "desc" }) > 0);
  });

  it("sorterar svenska namn A–Ö", () => {
    const andersson = row({ customerName: "Andersson AB" });
    const akesson = row({ customerName: "Åkesson" });
    const oberg = row({ customerName: "Öberg Bygg" });
    assert.ok(compareEconomyRows(andersson, akesson, { key: "customer", direction: "asc" }) < 0);
    assert.ok(compareEconomyRows(akesson, oberg, { key: "customer", direction: "asc" }) < 0);
    assert.ok(compareEconomyRows(oberg, andersson, { key: "customer", direction: "desc" }) < 0);
  });
});

describe("listQuotesForTable sort", () => {
  it("standard är nyast först utan aktiv sort", () => {
    seedPeople();
    addQuote({ customerId: "c-andersson", title: "Gammal", unitPrice: 1000, createdAt: "2026-01-01T10:00:00.000Z", number: 1 });
    addQuote({ customerId: "c-akesson", title: "Ny", unitPrice: 2000, createdAt: "2026-08-01T10:00:00.000Z", number: 2 });
    const page = listQuotesForTable();
    assert.deepEqual(
      page.rows.map((r) => r.title),
      ["Ny", "Gammal"]
    );
  });

  it("sorterar kund, datum, belopp och offertnummer", () => {
    seedPeople();
    addQuote({
      customerId: "c-oberg",
      title: "Tak",
      unitPrice: 18400,
      createdAt: "2026-01-02T10:00:00.000Z",
      number: 30,
    });
    addQuote({
      customerId: "c-andersson",
      title: "Altan",
      unitPrice: 7200,
      createdAt: "2026-12-01T10:00:00.000Z",
      number: 10,
    });
    addQuote({
      customerId: "c-akesson",
      title: "Kök",
      unitPrice: 12000,
      createdAt: "2026-06-01T10:00:00.000Z",
      number: 20,
    });

    assert.deepEqual(
      listQuotesForTable({ sort: { key: "customer", direction: "asc" } }).rows.map((r) => r.customerName),
      ["Andersson AB", "Åkesson", "Öberg Bygg"]
    );
    assert.deepEqual(
      listQuotesForTable({ sort: { key: "customer", direction: "desc" } }).rows.map((r) => r.customerName),
      ["Öberg Bygg", "Åkesson", "Andersson AB"]
    );
    assert.deepEqual(
      listQuotesForTable({ sort: { key: "amount", direction: "asc" } }).rows.map((r) => r.title),
      ["Altan", "Kök", "Tak"]
    );
    assert.deepEqual(
      listQuotesForTable({ sort: { key: "amount", direction: "desc" } }).rows.map((r) => r.title),
      ["Tak", "Kök", "Altan"]
    );
    assert.deepEqual(
      listQuotesForTable({ sort: { key: "date", direction: "asc" } }).rows.map((r) => r.title),
      ["Tak", "Kök", "Altan"]
    );
    assert.deepEqual(
      listQuotesForTable({ sort: { key: "document", direction: "asc" } }).rows.map((r) => r.number),
      [10, 20, 30]
    );
  });

  it("sorterar bara den filtrerade/sökta listan", () => {
    seedPeople();
    addQuote({ customerId: "c-andersson", title: "Altan liten", unitPrice: 1000, createdAt: "2026-01-01T10:00:00.000Z" });
    addQuote({ customerId: "c-andersson", title: "Altan stor", unitPrice: 8000, createdAt: "2026-02-01T10:00:00.000Z" });
    addQuote({ customerId: "c-oberg", title: "Tak", unitPrice: 5000, createdAt: "2026-03-01T10:00:00.000Z" });

    const page = listQuotesForTable({
      q: "altan",
      status: "utkast",
      sort: { key: "amount", direction: "desc" },
    });
    assert.deepEqual(
      page.rows.map((r) => r.title),
      ["Altan stor", "Altan liten"]
    );
    assert.equal(page.total, 2);
  });
});

describe("listInvoicesForTable sort", () => {
  it("standard lägger utkast överst, sedan fallande nummer", () => {
    seedPeople();
    addInvoice({ customerId: "c-andersson", unitPrice: 1000, dueDate: "2026-01-01", number: 1040, createdAt: "2026-01-01T10:00:00.000Z" });
    addInvoice({ customerId: "c-akesson", unitPrice: 1000, dueDate: "2026-02-01", number: 1042, createdAt: "2026-02-01T10:00:00.000Z" });
    addInvoice({
      customerId: "c-oberg",
      unitPrice: 1000,
      dueDate: "2026-03-01",
      number: null,
      createdAt: "2026-03-01T10:00:00.000Z",
    });

    const labels = listInvoicesForTable().rows.map((r) => r.label);
    assert.equal(labels[0], "Utkast");
    assert.deepEqual(labels.slice(1), ["#1042", "#1040"]);
  });

  it("sorterar kund, förfallodatum, belopp och fakturanummer", () => {
    seedPeople();
    addInvoice({
      customerId: "c-oberg",
      unitPrice: 18400,
      dueDate: "2026-01-02",
      number: 30,
    });
    addInvoice({
      customerId: "c-andersson",
      unitPrice: 7200,
      dueDate: "2026-12-01",
      number: 10,
    });
    addInvoice({
      customerId: "c-akesson",
      unitPrice: 12000,
      dueDate: "2026-06-01",
      number: 20,
    });

    assert.deepEqual(
      listInvoicesForTable({ sort: { key: "customer", direction: "asc" } }).rows.map((r) => r.customerName),
      ["Andersson AB", "Åkesson", "Öberg Bygg"]
    );
    assert.deepEqual(
      listInvoicesForTable({ sort: { key: "date", direction: "asc" } }).rows.map((r) => r.label),
      ["#30", "#20", "#10"]
    );
    assert.deepEqual(
      listInvoicesForTable({ sort: { key: "amount", direction: "asc" } }).rows.map((r) => r.label),
      ["#10", "#20", "#30"]
    );
    assert.deepEqual(
      listInvoicesForTable({ sort: { key: "document", direction: "desc" } }).rows.map((r) => r.label),
      ["#30", "#20", "#10"]
    );
  });

  it("sök + statusfilter + sort gäller samma resultatlista", () => {
    seedPeople();
    const unpaidLow = addInvoice({
      customerId: "c-andersson",
      unitPrice: 1000,
      dueDate: "2026-01-01",
      number: 11,
    });
    unpaidLow.ocr = "111111";
    const unpaidHigh = addInvoice({
      customerId: "c-andersson",
      unitPrice: 8000,
      dueDate: "2026-02-01",
      number: 12,
    });
    unpaidHigh.ocr = "222222";
    addInvoice({
      customerId: "c-andersson",
      unitPrice: 5000,
      dueDate: "2026-03-01",
      number: 13,
      status: "betald",
    });

    const page = listInvoicesForTable({
      q: "andersson",
      status: "obetald",
      sort: { key: "amount", direction: "desc" },
    });
    assert.deepEqual(
      page.rows.map((r) => r.label),
      ["#12", "#11"]
    );
  });
});

describe("listExpensesForTable / listBankForTable sort", () => {
  it("sorterar utgifter på leverantör, datum och belopp", () => {
    replaceDb(
      emptyTestDb({
        expenses: [
          expense({ id: "e1", supplier: "Öberg Färg", date: "2026-01-02", amount: 23000 }),
          expense({ id: "e2", supplier: "Andersson Bygg", date: "2026-12-01", amount: 9000 }),
          expense({ id: "e3", supplier: "Åkesson", date: "2026-06-01", amount: 15000 }),
        ],
      })
    );

    assert.deepEqual(
      listExpensesForTable({ sort: { key: "customer", direction: "asc" } }).rows.map((r) => r.supplier),
      ["Andersson Bygg", "Åkesson", "Öberg Färg"]
    );
    assert.deepEqual(
      listExpensesForTable({ sort: { key: "amount", direction: "desc" } }).rows.map((r) => r.amount),
      [23000, 15000, 9000]
    );
    assert.deepEqual(
      listExpensesForTable({ sort: { key: "date", direction: "asc" } }).rows.map((r) => r.id),
      ["e1", "e3", "e2"]
    );
  });

  it("sorterar bank på motpart, datum och belopp", () => {
    replaceDb(
      emptyTestDb({
        bankTransactions: [
          tx({ id: "t1", counterpart: "Öberg", date: "2026-01-02", amount: -23000 }),
          tx({ id: "t2", counterpart: "Andersson", date: "2026-12-01", amount: 9000 }),
          tx({ id: "t3", counterpart: "Åkesson", date: "2026-06-01", amount: -15000 }),
        ],
      })
    );

    assert.deepEqual(
      listBankForTable({ sort: { key: "customer", direction: "asc" } }).rows.map((r) => r.counterpart),
      ["Andersson", "Åkesson", "Öberg"]
    );
    assert.deepEqual(
      listBankForTable({ sort: { key: "amount", direction: "asc" } }).rows.map((r) => r.amount),
      [-23000, -15000, 9000]
    );
  });
});

function expense(over: Partial<Expense> & Pick<Expense, "id" | "supplier" | "date" | "amount">): Expense {
  return {
    vatAmount: Math.round(over.amount * 0.2),
    status: "bokford",
    createdAt: `${over.date}T10:00:00.000Z`,
    category: "material",
    ...over,
  };
}

function tx(
  over: Partial<BankTransaction> & Pick<BankTransaction, "id" | "counterpart" | "date" | "amount">
): BankTransaction {
  return {
    accountId: "acc-1",
    description: "Test",
    status: "bokford",
    ...over,
  };
}

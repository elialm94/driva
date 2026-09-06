process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, testCompany, testCustomer } from "./invoices/test-db";
import { activateOptionalFeature, deactivateOptionalFeature, resolveOptionalFeatures, wholesalersEnabled } from "./features";
import { settingsTabsFor } from "./settings-routes";
import { OPTIONAL_FEATURE_COPY, OPTIONAL_FEATURE_HREF } from "./optional-features";
import { setMailTransportForTests, type MailMessage } from "./mail";
import {
  createWholesalerConnection,
  connectionOverview,
  importPriceFile,
  previewPriceFile,
  searchWholesalerProducts,
  setWholesalerConnectionActive,
  wholesalerConnections,
  type ImportRunner,
} from "./services/wholesalers";
import {
  addCatalogProductToCart,
  addFreeTextLineToCart,
  cartTotals,
  draftCartsForJob,
  ensureCart,
  getPurchaseOrder,
  previewPurchaseOrderMail,
  purchaseOrderLines,
  sendPurchaseOrder,
  setLineCustomerPrice,
  updateCartLine,
  __resetOrderSendRateLimitForTests,
} from "./services/purchase-orders";
import {
  confirmationsForOrder,
  linkInboxItemToOrder,
  orderReview,
  syncAfterCustomerPrice,
} from "./services/purchase-order-confirmations";
import { ingestInboundMail } from "./services/inbox";
import { jobWholesalerContext, jobPurchaseOrderRows } from "./services/job-wholesalers";
import { parsePriceFile } from "./wholesalers/import-engine";
import { __resetCatalogCacheForTests } from "./wholesalers/catalog-store";
import { parseDecimal, parseOre, formatOre } from "./wholesalers/money";
import { customerPriceForProduct } from "./wholesalers/pricing";
import { looksLikeOrderConfirmation, parseConfirmationDeterministic } from "./wholesalers/confirmation-parse";
import { PURCHASE_ORDER_STATUS } from "./status-labels";
import {
  CSV_DISCOUNT_LETTER,
  CSV_SEMICOLON,
  TXT_TAB_LIST_ONLY,
  XLSX_ROWS,
  XML_PRICE_FILE,
  buildXlsx,
  buildZip,
  csvAsWindows1252,
} from "./__fixtures__/wholesalers/build";
import type { Job, WholesalerProduct } from "./types";

const run: ImportRunner = async (fn) => fn();
const INBOX_SLUG = "testbolag";
const INBOX_TO = `${INBOX_SLUG}@in.ferva.se`;

function job(over: Partial<Job> = {}): Job {
  return {
    id: over.id ?? "job-1",
    customerId: over.customerId ?? "cust-1",
    title: over.title ?? "Elinstallation villa Ekvägen",
    description: "",
    status: over.status ?? "pagar",
    checklist: [],
    notes: "",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function freshDb() {
  __resetCatalogCacheForTests();
  replaceDb(
    emptyTestDb({
      settings: { ...testCompany(), name: "Ekvägens El AB", orgNumber: "556677-8899", email: "info@ekvagenel.se", inboundMailSlug: INBOX_SLUG },
      customers: [testCustomer({ id: "cust-1" })],
      jobs: [job(), job({ id: "job-2", title: "Badrum Storgatan 3" })],
    }),
  );
}

function connection(over: Record<string, unknown> = {}) {
  return createWholesalerConnection({
    wholesaler: "ahlsell",
    customerNumber: "123456",
    orderEmail: "order@ahlsell-test.se",
    defaultDeliveryMode: "pickup",
    defaultStore: "Ahlsell Västberga",
    contactPerson: "Kalle",
    phone: "070-111 22 33",
    customerPriceRule: { kind: "markup", percent: 30 },
    ...over,
  });
}

async function importCsv(connectionId: string, text = CSV_SEMICOLON, filename = "prislista.csv") {
  const outcome = await importPriceFile({ connectionId, filename, bytes: Buffer.from(text, "utf8") }, run);
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
  return outcome;
}

async function productByArticle(connectionId: string, articleNumber: string): Promise<WholesalerProduct> {
  const result = await searchWholesalerProducts({ connectionId, query: articleNumber });
  const row = result.rows.find((r) => r.articleNumber === articleNumber);
  assert.ok(row, `artikel ${articleNumber} saknas i sökresultatet`);
  return { id: row.productId } as WholesalerProduct;
}

/** Bygg en skickad order på job-1 med två katalograder (kabel 50 m, uttag 4 st). */
async function sentOrder(sent: MailMessage[]) {
  activateOptionalFeature("wholesalers");
  const c = connection();
  await importCsv(c.id);
  const kabel = await productByArticle(c.id, "100200");
  const uttag = await productByArticle(c.id, "300400");
  await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: kabel.id, qty: 50 });
  await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: uttag.id, qty: 4 });
  const cart = draftCartsForJob("job-1")[0];
  const outcome = await sendPurchaseOrder(cart.id, "sendkey-0001");
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
  assert.equal(sent.length, 1);
  return { connection: c, order: getPurchaseOrder(cart.id)!, lines: purchaseOrderLines(cart.id) };
}

let sent: MailMessage[] = [];
let failNext = false;

beforeEach(() => {
  sent = [];
  failNext = false;
  __resetOrderSendRateLimitForTests();
  setMailTransportForTests(async (msg) => {
    if (failNext) {
      failNext = false;
      throw new Error("Resend 500: temporary failure");
    }
    sent.push(msg);
    return { messageId: `po_${sent.length}` };
  });
  freshDb();
});

afterEach(() => {
  setMailTransportForTests(undefined);
});

/* --------------------------- valfri funktion ------------------------------- */

describe("grossistbeställningar: valfri funktion", () => {
  it("är avstängd som standard och lämnar inställningar och materialytan oförändrade", () => {
    const features = resolveOptionalFeatures();
    assert.equal(features.wholesalers, false);
    assert.equal(wholesalersEnabled(db()), false);
    assert.deepEqual(
      settingsTabsFor(features).map((t) => t.key),
      ["foretag", "fakturering", "funktioner", "konto"],
    );
    const ctx = jobWholesalerContext("job-1");
    assert.equal(ctx.enabled, false);
    assert.deepEqual(ctx.connections, []);
    assert.deepEqual(jobPurchaseOrderRows("job-1"), []);
  });

  it("har svenskt namn, beskrivning och landar i grossistinställningarna", () => {
    assert.equal(OPTIONAL_FEATURE_COPY.wholesalers.title, "Grossistbeställningar");
    assert.equal(OPTIONAL_FEATURE_COPY.wholesalers.description, "Sök material med dina priser och skicka beställningar till grossisten.");
    assert.equal(OPTIONAL_FEATURE_HREF.wholesalers, "/installningar?flik=grossister");
  });

  it("aktivering visar fliken Grossister; avstängning raderar inget", async () => {
    activateOptionalFeature("wholesalers");
    assert.equal(resolveOptionalFeatures().wholesalers, true);
    assert.ok(settingsTabsFor(resolveOptionalFeatures()).some((t) => t.key === "grossister"));

    const c = connection();
    await importCsv(c.id);
    const before = { connections: (db().wholesalerConnections ?? []).length, imports: (db().wholesalerPriceImports ?? []).length };
    const found = await searchWholesalerProducts({ connectionId: c.id, query: "kabel" });
    assert.equal(found.total, 2);

    deactivateOptionalFeature("wholesalers");
    assert.equal(resolveOptionalFeatures().wholesalers, false);
    assert.equal(wholesalersEnabled(db()), false);
    assert.equal((db().wholesalerConnections ?? []).length, before.connections);
    assert.equal((db().wholesalerPriceImports ?? []).length, before.imports);
    assert.equal((await searchWholesalerProducts({ connectionId: c.id, query: "kabel" })).total, 2);
    assert.equal(jobWholesalerContext("job-1").enabled, false);
    assert.ok(!settingsTabsFor(resolveOptionalFeatures()).some((t) => t.key === "grossister"));
  });

  it("inaktiverad anslutning behålls men syns inte som beställningsbar", async () => {
    activateOptionalFeature("wholesalers");
    const c = connection();
    setWholesalerConnectionActive(c.id, false);
    assert.equal(wholesalerConnections().length, 1);
    assert.deepEqual(jobWholesalerContext("job-1").connections, []);
  });

  it("servern validerar anslutningen", () => {
    assert.throws(() => connection({ orderEmail: "inte-en-adress" }), /ordermejl|e-post/i);
    assert.throws(() => connection({ customerNumber: "" }), /kundnummer/i);
    assert.throws(() => connection({ customerPriceRule: { kind: "markup", percent: 900 } }), /påslag/i);
  });
});

/* ------------------------------- import ------------------------------------ */

describe("prisfilsimport", () => {
  it("CSV med semikolon och svenska decimaler", async () => {
    const c = connection();
    const preview = previewPriceFile({ connectionId: c.id, filename: "prislista.csv", bytes: Buffer.from(CSV_SEMICOLON) });
    assert.equal(preview.mapping.articleNumber, "Artikelnr");
    assert.equal(preview.mapping.netPrice, "Nettopris");
    assert.equal(preview.mapping.eNumber, "E-nummer");
    assert.equal(preview.mapping.rskNumber, "RSK");
    assert.deepEqual(preview.problems, []);

    const outcome = await importCsv(c.id);
    assert.equal(outcome.ok && outcome.productCount, 4);
    const kabel = (await searchWholesalerProducts({ connectionId: c.id, query: "100200" })).rows[0];
    assert.equal(kabel.name, "Kabel EKK 3G1,5 vit");
    assert.equal(kabel.netPriceOre, 1250);
    assert.equal(kabel.listPriceOre, 1890);
    assert.equal(kabel.unit, "m");
    assert.equal(kabel.packSize, 100);
    assert.equal(kabel.customerPrice.ore, 1600); // 12,50 × 1,30 = 16,25 → hela kronor
    assert.equal(formatOre(kabel.netPriceOre!), "12,50 kr");
    const overview = connectionOverview(wholesalerConnections()[0]);
    assert.equal(overview.priceList?.productCount, 4);
    assert.equal(overview.priceList?.stale, false);
  });

  it("Windows-1252-kodad fil läses med å/ä/ö", async () => {
    const c = connection();
    await importPriceFile({ connectionId: c.id, filename: "prislista.csv", bytes: csvAsWindows1252(CSV_SEMICOLON) }, run);
    const rows = (await searchWholesalerProducts({ connectionId: c.id, query: "vägguttag" })).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Vägguttag 2-vägs jordat infällt");
  });

  it("TXT med tabb + rabattbrev: nettopris räknas från listpris och rabattgrupp", async () => {
    const c = connection();
    const letter = await importPriceFile(
      { connectionId: c.id, filename: "rabattbrev.csv", bytes: Buffer.from(CSV_DISCOUNT_LETTER) },
      run,
    );
    assert.equal(letter.ok, true);
    assert.equal(letter.ok && letter.discountLetter, true);
    // Bara rabatter – inget artikelregister ännu.
    const overviewBefore = connectionOverview(wholesalerConnections()[0]);
    assert.equal(overviewBefore.priceList, null);
    assert.equal(overviewBefore.discountsWithoutRegister, true);

    const outcome = await importPriceFile({ connectionId: c.id, filename: "artiklar.txt", bytes: Buffer.from(TXT_TAB_LIST_ONLY) }, run);
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
    const kabel = (await searchWholesalerProducts({ connectionId: c.id, query: "100200" })).rows[0];
    assert.equal(kabel.netPriceOre, 1229); // 18,90 × (1 − 0,35) = 12,285 → 12,29
    const uttag = (await searchWholesalerProducts({ connectionId: c.id, query: "300400" })).rows[0];
    assert.equal(uttag.netPriceOre, 6364); // 89,00 × 0,715 = 63,635 → 63,64
    const utan = (await searchWholesalerProducts({ connectionId: c.id, query: "999999" })).rows[0];
    assert.equal(utan.netPriceOre, undefined);
    assert.equal(utan.customerPrice.ore, undefined);
  });

  it("uttryckligt nettopris vinner över beräknat", async () => {
    const c = connection();
    await importPriceFile({ connectionId: c.id, filename: "rabattbrev.csv", bytes: Buffer.from(CSV_DISCOUNT_LETTER) }, run);
    await importCsv(c.id);
    const kabel = (await searchWholesalerProducts({ connectionId: c.id, query: "100200" })).rows[0];
    assert.equal(kabel.netPriceOre, 1250);
    // Raden utan nettopris i samma fil räknas från listpris + rabattgrupp K10 (35 %).
    const kabel25 = (await searchWholesalerProducts({ connectionId: c.id, query: "100201" })).rows[0];
    assert.equal(kabel25.netPriceOre, Math.round(2950 * 0.65));
  });

  it("XLSX, XML och ZIP importeras utan att användaren väljer format", async () => {
    const c = connection();
    const xlsx = await importPriceFile({ connectionId: c.id, filename: "prislista.xlsx", bytes: buildXlsx(XLSX_ROWS) }, run);
    assert.equal(xlsx.ok, true, xlsx.ok ? "" : xlsx.error);
    assert.equal(xlsx.ok && xlsx.productCount, 2);
    assert.equal((await searchWholesalerProducts({ connectionId: c.id, query: "100200" })).rows[0].netPriceOre, 1250);

    const xml = await importPriceFile({ connectionId: c.id, filename: "prislista.xml", bytes: Buffer.from(XML_PRICE_FILE) }, run);
    assert.equal(xml.ok, true, xml.ok ? "" : xml.error);
    assert.equal(xml.ok && xml.productCount, 2);
    const ror = (await searchWholesalerProducts({ connectionId: c.id, query: "8103567" })).rows[0];
    assert.equal(ror.name, "Rörkoppling 15 mm");
    assert.equal(ror.netPriceOre, 3000);

    const zip = buildZip([{ name: "export/prislista.csv", data: CSV_SEMICOLON }]);
    const zipped = await importPriceFile({ connectionId: c.id, filename: "prislista.zip", bytes: zip }, run);
    assert.equal(zipped.ok, true, zipped.ok ? "" : zipped.error);
    assert.equal(zipped.ok && zipped.productCount, 4);
    // Bara den senaste importen är aktiv.
    assert.equal((db().wholesalerPriceImports ?? []).filter((i) => i.status === "active").length, 1);
  });

  it("misslyckad import lämnar tidigare prislista aktiv", async () => {
    const c = connection();
    const first = await importCsv(c.id);
    const activeBefore = (db().wholesalerPriceImports ?? []).find((i) => i.status === "active")!;
    assert.equal(activeBefore.id, first.ok && first.importId);

    const broken = await importPriceFile(
      { connectionId: c.id, filename: "trasig.csv", bytes: Buffer.from("Kolumn A;Kolumn B\n1;2\n3;4") },
      run,
    );
    assert.equal(broken.ok, false);
    assert.match(broken.ok ? "" : broken.error, /artikelnummer|kolumn/i);
    const activeAfter = (db().wholesalerPriceImports ?? []).find((i) => i.status === "active")!;
    assert.equal(activeAfter.id, activeBefore.id);
    assert.equal((await searchWholesalerProducts({ connectionId: c.id, query: "kabel" })).total, 2);
  });

  it("radfel rapporteras med radnummer och orsak, resten importeras", async () => {
    const c = connection();
    const text = ["Artikelnr;Benämning;Enhet;Nettopris", "1;Bra artikel;st;10,00", ";Saknar artikelnummer;st;5,00", "3;Konstigt pris;st;abc"].join("\n");
    const outcome = await importPriceFile({ connectionId: c.id, filename: "fel.csv", bytes: Buffer.from(text) }, run);
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
    const imp = (db().wholesalerPriceImports ?? []).find((i) => i.status === "active")!;
    assert.ok(imp.errors.some((e) => e.row === 3 && /artikelnummer/i.test(e.message)));
    assert.ok(imp.errors.some((e) => e.row === 4 && /pris/i.test(e.message)));
    assert.equal(imp.skippedCount, 1);
    assert.equal(imp.productCount, 2);
  });

  it("formelinjektion neutraliseras och ZIP-bomber avvisas", async () => {
    const c = connection();
    const text = "Artikelnr;Benämning;Nettopris\n=1+1;=HYPERLINK(\"http://x\");10,00";
    await importPriceFile({ connectionId: c.id, filename: "inj.csv", bytes: Buffer.from(text) }, run);
    const row = (await searchWholesalerProducts({ connectionId: c.id, query: "1+1" })).rows[0];
    assert.ok(row);
    assert.ok(!row.name.startsWith("="));
    assert.ok(!row.articleNumber.startsWith("="));

    const nested = buildZip([{ name: "inner.zip", data: buildZip([{ name: "a.csv", data: CSV_SEMICOLON }]) }]);
    const outcome = await importPriceFile({ connectionId: c.id, filename: "nested.zip", bytes: nested }, run);
    assert.equal(outcome.ok, false);
  });

  it("kommer ihåg kolumnmappningen för nästa fil", async () => {
    const c = connection();
    const custom = "Kod;Text;Pris\n100200;Kabel;12,50";
    const preview = previewPriceFile({ connectionId: c.id, filename: "egen.csv", bytes: Buffer.from(custom) });
    assert.ok(preview.problems.length > 0 || !preview.mapping.articleNumber || !preview.mapping.name);
    const outcome = await importPriceFile(
      {
        connectionId: c.id,
        filename: "egen.csv",
        bytes: Buffer.from(custom),
        mapping: { articleNumber: "Kod", name: "Text", netPrice: "Pris" },
      },
      run,
    );
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
    assert.equal(wholesalerConnections()[0].columnMapping?.articleNumber, "Kod");
    const again = previewPriceFile({ connectionId: c.id, filename: "egen2.csv", bytes: Buffer.from(custom) });
    assert.equal(again.mapping.articleNumber, "Kod");
    assert.equal(again.mapping.netPrice, "Pris");
    assert.deepEqual(again.problems, []);
  });

  it("pengar: svenska decimaler och tusentalsavgränsare tolkas till heltalsören", () => {
    assert.equal(parseOre("1 234,50"), 123450);
    assert.equal(parseOre("1.234,50"), 123450);
    assert.equal(parseOre("12.5"), 1250);
    assert.equal(parseOre("18,90 kr"), 1890);
    assert.equal(parseDecimal("0,5"), 0.5);
    assert.equal(parseOre("abc"), null);
    assert.equal(customerPriceForProduct({ netPriceOre: 1250 }, { kind: "markup", percent: 30 }).ore, 1600);
    assert.equal(customerPriceForProduct({ netPriceOre: 1250, salesPriceOre: 2490 }, { kind: "file_sales_price" }).ore, 2500);
    assert.equal(customerPriceForProduct({ netPriceOre: 1250 }, { kind: "later" }).ore, undefined);
    assert.equal(customerPriceForProduct({ netPriceOre: 1250 }, { kind: "later" }).source, "missing");
  });

  it("parsePriceFile känner igen filtyp via innehåll, inte bara filändelse", () => {
    assert.equal(parsePriceFile(Buffer.from(CSV_SEMICOLON), "prislista").detected.kind, "csv");
    assert.equal(parsePriceFile(Buffer.from(TXT_TAB_LIST_ONLY), "prislista.tsv").detected.kind, "txt");
    assert.equal(parsePriceFile(buildXlsx(XLSX_ROWS), "fil.zip").detected.kind, "xlsx");
    assert.equal(parsePriceFile(Buffer.from(XML_PRICE_FILE), "fil").detected.kind, "xml");
    assert.throws(() => parsePriceFile(Buffer.from(CSV_SEMICOLON), "prislista.exe"), /stöds inte/);
  });
});

/* --------------------------------- sök -------------------------------------- */

describe("server-side sökning", () => {
  it("hittar på namn, artikelnummer, E-nummer och RSK-nummer med paginering", async () => {
    const c = connection();
    await importCsv(c.id);
    assert.equal((await searchWholesalerProducts({ connectionId: c.id, query: "kabel ekk" })).total, 2);
    assert.equal((await searchWholesalerProducts({ connectionId: c.id, query: "300400" })).rows[0].name, "Vägguttag 2-vägs jordat infällt");
    assert.equal((await searchWholesalerProducts({ connectionId: c.id, query: "E1780235" })).rows[0].articleNumber, "300400");
    assert.equal((await searchWholesalerProducts({ connectionId: c.id, query: "RSK 8103567" })).rows[0].articleNumber, "500600");
    assert.equal((await searchWholesalerProducts({ connectionId: c.id, query: "00 10 012" })).rows[0].articleNumber, "100200");
    const page = await searchWholesalerProducts({ connectionId: c.id, query: "kabel", page: 2 });
    assert.equal(page.total, 2);
    assert.equal(page.rows.length, 0);
    assert.equal(page.page, 2);
    assert.ok(page.pageSize >= 10);
    assert.ok(page.priceDate);
  });

  it("utan aktiv prislista är resultatet tomt och prisdatum saknas", async () => {
    const c = connection();
    const empty = await searchWholesalerProducts({ connectionId: c.id, query: "kabel" });
    assert.equal(empty.total, 0);
    assert.equal(empty.priceDate, null);
    await importCsv(c.id);
    assert.equal((await searchWholesalerProducts({ connectionId: c.id, query: "finnsinte" })).total, 0);
  });
});

/* -------------------------------- varukorg ---------------------------------- */

describe("varukorg", () => {
  it("skapar separata varukorgar per grossist på samma uppdrag", async () => {
    activateOptionalFeature("wholesalers");
    const a = connection();
    const d = connection({ wholesaler: "dahl", customerNumber: "778899", orderEmail: "order@dahl-test.se" });
    await importCsv(a.id);
    await importCsv(d.id);
    const kabel = await productByArticle(a.id, "100200");
    const ror = await productByArticle(d.id, "500600");
    await addCatalogProductToCart({ jobId: "job-1", connectionId: a.id, productId: kabel.id, qty: 25 });
    await addCatalogProductToCart({ jobId: "job-1", connectionId: d.id, productId: ror.id, qty: 6 });
    const carts = draftCartsForJob("job-1");
    assert.equal(carts.length, 2);
    assert.notEqual(carts[0].connectionId, carts[1].connectionId);
    assert.equal(ensureCart("job-1", a.id).id, carts.find((c) => c.connectionId === a.id)!.id);
    const ctx = jobWholesalerContext("job-1");
    assert.equal(ctx.enabled, true);
    assert.equal(ctx.carts.length, 2);
    assert.equal(ctx.connections.length, 2);
  });

  it("samma artikel igen ökar antalet; totaler skiljer inköp och kundpris", async () => {
    activateOptionalFeature("wholesalers");
    const c = connection();
    await importCsv(c.id);
    const kabel = await productByArticle(c.id, "100200");
    await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: kabel.id, qty: 10 });
    await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: kabel.id, qty: 5 });
    const cart = draftCartsForJob("job-1")[0];
    const lines = purchaseOrderLines(cart.id);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].qty, 15);
    assert.equal(lines[0].unitCostOre, 1250);
    assert.equal(lines[0].customerUnitPriceOre, 1600);
    assert.equal(lines[0].customerPriceSource, "markup");
    const totals = cartTotals(lines);
    assert.equal(totals.expectedCostOre, 15 * 1250);
    assert.equal(totals.customerTotalOre, 15 * 1600);

    updateCartLine(lines[0].id, { customerUnitPriceKr: 19 });
    assert.equal(purchaseOrderLines(cart.id)[0].customerUnitPriceOre, 1900);
    assert.equal(purchaseOrderLines(cart.id)[0].customerPriceSource, "explicit");

    addFreeTextLineToCart({ jobId: "job-1", connectionId: c.id, name: "Kabelskydd svart 25 mm", qty: 2, unit: "st" });
    const withFree = purchaseOrderLines(cart.id);
    assert.equal(withFree.length, 2);
    const t2 = cartTotals(withFree);
    assert.equal(t2.expectedCostOre, undefined);
    assert.equal(t2.missingCostCount, 1);
    assert.equal(t2.customerTotalOre, undefined);
    assert.equal(t2.missingCustomerPriceCount, 1);
  });

  it("artiklar i varukorgen blir inte materialrader på uppdraget", async () => {
    activateOptionalFeature("wholesalers");
    const c = connection();
    await importCsv(c.id);
    const kabel = await productByArticle(c.id, "100200");
    await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: kabel.id, qty: 10 });
    assert.equal(db().jobWorkEntries.length, 0);
  });
});

/* -------------------------------- utskick ----------------------------------- */

describe("utskick av beställning", () => {
  it("mejlet går till ordermejlen med kundnummer, referens, uppdrag och Reply-To till inboxen", async () => {
    const { order } = await sentOrder(sent);
    const msg = sent[0];
    assert.equal(msg.to, "order@ahlsell-test.se");
    assert.equal(msg.replyTo, INBOX_TO);
    assert.match(msg.from ?? "", /^Ekvägens El AB via Ferva </);
    assert.match(msg.subject, /Beställning FV-1001/);
    assert.match(msg.subject, /kundnr 123456/);
    assert.match(msg.text, /556677-8899/);
    assert.match(msg.text, /Elinstallation villa Ekvägen/);
    assert.match(msg.text, /100200/);
    assert.match(msg.text, /Kabel EKK 3G1,5 vit/);
    assert.match(msg.text, /50 m/);
    assert.match(msg.text, /Ahlsell Västberga/);
    assert.match(msg.text, /orderbekräftelse/i);
    assert.match(msg.html, /<table/);
    assert.ok(!/1[26][,.]\d0 kr/.test(msg.text), "inköps-/kundpriser ska inte stå i beställningsmejlet");
    assert.deepEqual(
      (msg.attachments ?? []).map((a) => a.filename).sort(),
      ["bestallning-FV-1001.csv", "bestallning-FV-1001.pdf"],
    );

    assert.equal(order.status, "sent");
    assert.equal(PURCHASE_ORDER_STATUS[order.status].label, "Skickad – inväntar bekräftelse");
    assert.equal(order.reference, "FV-1001");
    assert.equal(order.lastEmail?.messageId, "po_1");
    assert.equal(order.sentSnapshot?.lines.length, 2);
    assert.equal(order.sentSnapshot?.transport, "live");
    assert.equal(order.sentSnapshot?.to, "order@ahlsell-test.se");
  });

  it("förhandsgranskningen visar mottagare och hinder innan utskick", async () => {
    activateOptionalFeature("wholesalers");
    const c = connection();
    const cart = ensureCart("job-1", c.id);
    const preview = previewPurchaseOrderMail(cart.id);
    assert.equal(preview.to, "order@ahlsell-test.se");
    assert.equal(preview.replyTo, INBOX_TO);
    assert.ok(preview.blockers.some((b) => /minst en artikel/i.test(b)));
  });

  it("providerfel lämnar ordern som utkast utan snapshot", async () => {
    activateOptionalFeature("wholesalers");
    const c = connection();
    await importCsv(c.id);
    const kabel = await productByArticle(c.id, "100200");
    await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: kabel.id, qty: 10 });
    const cart = draftCartsForJob("job-1")[0];
    failNext = true;
    const outcome = await sendPurchaseOrder(cart.id, "sendkey-0002");
    assert.equal(outcome.ok, false);
    const order = getPurchaseOrder(cart.id)!;
    assert.equal(order.status, "draft");
    assert.equal(order.sentAt, undefined);
    assert.equal(order.sentSnapshot, undefined);
    assert.ok(order.lastSendAttemptAt);
    // Nytt försök med ny nyckel lyckas.
    const retry = await sendPurchaseOrder(cart.id, "sendkey-0003");
    assert.equal(retry.ok, true);
    assert.equal(sent.length, 1);
  });

  it("dubbelklick/retry med samma nyckel skickar bara ett mejl", async () => {
    activateOptionalFeature("wholesalers");
    const c = connection();
    await importCsv(c.id);
    const kabel = await productByArticle(c.id, "100200");
    await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: kabel.id, qty: 10 });
    const cart = draftCartsForJob("job-1")[0];
    const [a, b] = await Promise.all([sendPurchaseOrder(cart.id, "sendkey-dbl"), sendPurchaseOrder(cart.id, "sendkey-dbl")]);
    assert.equal(a.ok && b.ok, true);
    const again = await sendPurchaseOrder(cart.id, "sendkey-dbl");
    assert.equal(again.ok && again.alreadySent, true);
    const other = await sendPurchaseOrder(cart.id, "sendkey-annan");
    assert.equal(other.ok, false);
    assert.equal(sent.length, 1);
    assert.equal((db().purchaseOrders ?? []).filter((o) => o.status !== "draft").length, 1);
  });

  it("den skickade snapshoten är låst – senare ändringar avvisas", async () => {
    const { order, lines } = await sentOrder(sent);
    assert.throws(() => updateCartLine(lines[0].id, { qty: 99 }), /skickad|låst|ändras/i);
    assert.equal(getPurchaseOrder(order.id)!.sentSnapshot!.lines[0].qty, 50);
    // Kundpris får dock sättas i efterhand (påverkar bara fakturaunderlaget).
    setLineCustomerPrice(lines[0].id, 20);
    assert.equal(purchaseOrderLines(order.id)[0].customerUnitPriceOre, 2000);
  });

  it("publik demo skickar aldrig till en extern mottagare", async () => {
    replaceDb({ ...db(), meta: { ...db().meta, demo: true } });
    activateOptionalFeature("wholesalers");
    const c = connection({ orderEmail: "order@riktig-grossist.se" });
    await importCsv(c.id);
    const kabel = await productByArticle(c.id, "100200");
    await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: kabel.id, qty: 10 });
    const cart = draftCartsForJob("job-1")[0];
    const outcome = await sendPurchaseOrder(cart.id, "sendkey-demo");
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok && outcome.simulated, true);
    assert.equal(sent.length, 0);
    const order = getPurchaseOrder(cart.id)!;
    assert.equal(order.status, "sent");
    assert.equal(order.sentSnapshot?.transport, "simulated");
    assert.equal(order.lastEmail, undefined);
  });

  it("mockläge (ingen mejlleverantör) är ärligt: simulerat, inte levererat", async () => {
    setMailTransportForTests(undefined);
    delete process.env.RESEND_API_KEY;
    activateOptionalFeature("wholesalers");
    const c = connection();
    await importCsv(c.id);
    const kabel = await productByArticle(c.id, "100200");
    await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: kabel.id, qty: 10 });
    const cart = draftCartsForJob("job-1")[0];
    const outcome = await sendPurchaseOrder(cart.id, "sendkey-mock");
    assert.equal(outcome.ok && outcome.simulated, true);
    assert.equal(getPurchaseOrder(cart.id)!.sentSnapshot?.transport, "simulated");
  });

  it("sektionen Materialbeställningar visas först när det finns något", async () => {
    activateOptionalFeature("wholesalers");
    assert.deepEqual(jobPurchaseOrderRows("job-1"), []);
    await sentOrder(sent);
    const rows = jobPurchaseOrderRows("job-1");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lineCount, 2);
    assert.match(rows[0].review.headline, /inväntar/i);
    // Historiken syns även efter avstängning.
    deactivateOptionalFeature("wholesalers");
    assert.equal(jobPurchaseOrderRows("job-1").length, 1);
  });
});

/* ------------------------------ bekräftelser -------------------------------- */

function confirmationMail(over: { subject?: string; text?: string; html?: string; externalId?: string; from?: string; attachments?: { filename: string; contentType: string; contentBase64: string }[] }) {
  return ingestInboundMail({
    externalId: over.externalId ?? "conf-1",
    to: INBOX_TO,
    from: over.from ?? "order@ahlsell-test.se",
    subject: over.subject ?? "Orderbekräftelse FV-1001",
    text: over.text ?? "",
    ...(over.html ? { html: over.html } : {}),
    ...(over.attachments ? { attachments: over.attachments.map((a) => ({ ...a, size: Buffer.from(a.contentBase64, "base64").length })) } : {}),
  });
}

describe("orderbekräftelse via inboxen", () => {
  it("känner igen bekräftelser men inte fakturor", () => {
    assert.equal(looksLikeOrderConfirmation({ subject: "Orderbekräftelse 88112", text: "Tack för er beställning" }), true);
    assert.equal(looksLikeOrderConfirmation({ subject: "Re: Beställning FV-1001", text: "Vi har tagit emot er beställning." }), true);
    assert.equal(looksLikeOrderConfirmation({ subject: "Faktura 12345", text: "Att betala 1 200 kr. FV-1001" }), false);
  });

  it("exakt Ferva-referens matchar rätt order och stämmer av raderna", async () => {
    const { order } = await sentOrder(sent);
    const result = confirmationMail({
      subject: "Orderbekräftelse 4471123 – er ref FV-1001",
      text: [
        "Hej! Vi har tagit emot er beställning FV-1001.",
        "Ordernummer: 4471123",
        "100200 Kabel EKK 3G1,5 vit 50 m à 12,50",
        "300400 Vägguttag 2-vägs jordat infällt 4 st à 61,20",
        "Leverans: 8 september 2026",
      ].join("\n"),
    });
    assert.equal(result.ok && result.created, true);
    if (!result.ok) return;
    assert.equal(result.item.documentType, "orderbekraftelse");
    assert.equal(result.item.purchaseOrderId, order.id);
    assert.equal(result.autoBooked, false);
    assert.equal(db().supplierInvoices.length, 0);

    const stored = getPurchaseOrder(order.id)!;
    assert.equal(stored.status, "confirmed");
    assert.equal(stored.wholesalerOrderNumber, "4471123");
    const confs = confirmationsForOrder(order.id);
    assert.equal(confs.length, 1);
    assert.equal(confs[0].status, "applied");
    assert.equal(confs[0].matchMethod, "reference");
    assert.equal(confs[0].deliveryDate, "2026-09-08");
    assert.deepEqual(confs[0].deviations, []);

    // Bekräftade rader blir materialrader med kundpris (påslag 30 %) och proveniens.
    const entries = db().jobWorkEntries;
    assert.equal(entries.length, 2);
    const kabel = entries.find((e) => /100200/.test(e.description))!;
    assert.equal(kabel.source, "wholesaler");
    assert.equal(kabel.role, "actual");
    assert.equal(kabel.qty, 50);
    assert.equal(kabel.unit, "m");
    assert.equal(kabel.unitPrice, 16);
    assert.equal(kabel.wholesaler?.purchaseOrderId, order.id);
    assert.equal(kabel.wholesaler?.unitCostOre, 1250);
    assert.equal(kabel.wholesaler?.articleNumber, "100200");
    const review = orderReview(order.id);
    assert.match(review.headline, /bekräftat alla 2 artiklar/i);
  });

  it("osäker matchning kopplas inte automatiskt – användaren väljer", async () => {
    const { connection: c } = await sentOrder(sent);
    // En andra skickad order till samma grossist gör referenslös match tvetydig.
    const ror = await productByArticle(c.id, "500600");
    await addCatalogProductToCart({ jobId: "job-2", connectionId: c.id, productId: ror.id, qty: 3 });
    const second = draftCartsForJob("job-2")[0];
    assert.equal((await sendPurchaseOrder(second.id, "sendkey-0009")).ok, true);

    const result = confirmationMail({ subject: "Orderbekräftelse 555", text: "Tack för din beställning. Kundnummer 123456." });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.item.documentType, "orderbekraftelse");
    assert.equal(result.item.purchaseOrderId, undefined);
    assert.equal(result.item.purchaseOrderCandidateIds?.length, 2);
    assert.equal((db().purchaseOrderConfirmations ?? []).length, 0);
    assert.equal(result.item.status, "ny");

    linkInboxItemToOrder(result.item.id, second.id);
    const item = db().inboxItems.find((i) => i.id === result.item.id)!;
    assert.equal(item.purchaseOrderId, second.id);
    assert.equal(item.purchaseOrderCandidateIds, undefined);
    assert.equal(confirmationsForOrder(second.id)[0].matchMethod, "manual");
  });

  it("kundnummer + uppdrag + grossistens domän räcker när referensen saknas", async () => {
    const { order } = await sentOrder(sent);
    const result = confirmationMail({
      subject: "Orderbekräftelse 9001",
      text: "Kund 123456. Märkning: Elinstallation villa Ekvägen. Tack för er beställning.",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.item.purchaseOrderId, order.id);
    assert.equal(confirmationsForOrder(order.id)[0].matchMethod, "customer_job");
  });

  it("avvikelser (antal, pris, restnotering) kräver kontroll och skapar inga materialrader förrän de godkänts", async () => {
    const { order } = await sentOrder(sent);
    const result = confirmationMail({
      text: [
        "Orderbekräftelse FV-1001",
        "100200 Kabel EKK 3G1,5 vit 40 m à 13,90",
        "300400 Vägguttag 2-vägs jordat infällt 4 st restnoterad, levereras 12 september 2026",
      ].join("\n"),
    });
    assert.equal(result.ok, true);
    const stored = getPurchaseOrder(order.id)!;
    assert.equal(stored.status, "needs_review");
    assert.equal(PURCHASE_ORDER_STATUS[stored.status].label, "Avvikelse kräver kontroll");
    const conf = confirmationsForOrder(order.id)[0];
    assert.equal(conf.status, "needs_review");
    assert.ok(conf.deviations.includes("qty"));
    assert.ok(conf.deviations.includes("price"));
    assert.ok(conf.deviations.includes("backorder"));
    const review = orderReview(order.id);
    assert.ok(review.bullets.some((b) => /restnoterad/i.test(b)), JSON.stringify(review));
    assert.ok(review.bullets.some((b) => /kr högre/i.test(b)), JSON.stringify(review));
    assert.equal(db().jobWorkEntries.length, 0);
  });

  it("delbekräftelser kompletterar varandra; återlevererat mejl ger inga dubbletter", async () => {
    const { order } = await sentOrder(sent);
    const first = confirmationMail({
      externalId: "part-1",
      text: "Orderbekräftelse FV-1001\n100200 Kabel EKK 3G1,5 vit 50 m à 12,50\n300400 Vägguttag 2-vägs jordat infällt 4 st restnoterad",
    });
    assert.equal(first.ok, true);
    let stored = getPurchaseOrder(order.id)!;
    // Restnoterad rad utan ändrat antal är en avvikelse men den kan hanteras automatiskt.
    assert.ok(stored.status === "partially_confirmed" || stored.status === "needs_review");
    const entriesAfterFirst = db().jobWorkEntries.length;

    const redelivered = confirmationMail({ externalId: "part-1", text: "samma mejl igen" });
    assert.equal(redelivered.ok && !redelivered.created, true);
    assert.equal(confirmationsForOrder(order.id).length, 1);
    assert.equal(db().jobWorkEntries.length, entriesAfterFirst);

    const second = confirmationMail({
      externalId: "part-2",
      subject: "Leveransbesked FV-1001",
      text: "Restorder FV-1001 levereras nu.\n300400 Vägguttag 2-vägs jordat infällt 4 st à 61,20",
    });
    assert.equal(second.ok && second.created, true);
    assert.equal(confirmationsForOrder(order.id).length, 2);
    stored = getPurchaseOrder(order.id)!;
    // Två bekräftelser för samma rad ger fortfarande exakt en materialrad per orderrad.
    const entries = db().jobWorkEntries.filter((e) => e.wholesaler?.purchaseOrderId === order.id);
    const perLine = new Map<string, number>();
    for (const e of entries) perLine.set(e.wholesaler!.purchaseOrderLineId, (perLine.get(e.wholesaler!.purchaseOrderLineId) ?? 0) + 1);
    assert.ok([...perLine.values()].every((n) => n === 1));
    assert.ok(entries.length <= 2);
  });

  it("material utan kundpris blir bekräftat men inte fakturerbart till 0 kr", async () => {
    activateOptionalFeature("wholesalers");
    const c = connection({ customerPriceRule: { kind: "later" } });
    await importCsv(c.id);
    const kabel = await productByArticle(c.id, "100200");
    await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: kabel.id, qty: 10 });
    const cart = draftCartsForJob("job-1")[0];
    assert.equal((await sendPurchaseOrder(cart.id, "sendkey-later")).ok, true);
    const result = confirmationMail({ text: "Orderbekräftelse FV-1001\n100200 Kabel EKK 3G1,5 vit 10 m à 12,50" });
    assert.equal(result.ok, true);
    assert.equal(getPurchaseOrder(cart.id)!.status, "confirmed");
    assert.equal(db().jobWorkEntries.length, 0, "ingen materialrad utan kundpris");
    const review = orderReview(cart.id);
    assert.equal(review.missingCustomerPriceLineIds.length, 1);
    assert.ok(review.bullets.some((b) => /kundpris/i.test(b)));

    const line = purchaseOrderLines(cart.id)[0];
    setLineCustomerPrice(line.id, 17);
    const sync = syncAfterCustomerPrice(line.id);
    assert.equal(sync.created.length, 1);
    assert.equal(db().jobWorkEntries[0].unitPrice, 17);
    assert.equal(db().jobWorkEntries[0].qty, 10);
    // Igen: ingen dubblett.
    assert.equal(syncAfterCustomerPrice(line.id).created.length, 0);
    assert.equal(db().jobWorkEntries.length, 1);
  });

  it("fakturerade materialrader ändras inte automatiskt – avvikelsen visas", async () => {
    const { order } = await sentOrder(sent);
    confirmationMail({ externalId: "c1", text: "Orderbekräftelse FV-1001\n100200 Kabel EKK 3G1,5 vit 50 m à 12,50\n300400 Vägguttag 2-vägs jordat infällt 4 st à 61,20" });
    const entry = db().jobWorkEntries.find((e) => /100200/.test(e.description))!;
    entry.invoiceId = "inv-1";
    db().invoices.push({ id: "inv-1", status: "skickad" } as never);
    const second = confirmationMail({
      externalId: "c2",
      subject: "Korrigerad orderbekräftelse FV-1001",
      text: "Orderbekräftelse FV-1001\n100200 Kabel EKK 3G1,5 vit 60 m à 12,50",
    });
    assert.equal(second.ok, true);
    assert.equal(db().jobWorkEntries.find((e) => e.id === entry.id)!.qty, 50);
    const review = orderReview(order.id);
    assert.ok(review.lockedInvoicedLineIds.length >= 1 || review.needsReview);
  });

  it("CSV-bilaga med strukturerade rader tolkas före texten", async () => {
    const { order, lines } = await sentOrder(sent);
    const csv = "Artikelnummer;Benämning;Antal;Enhet;Pris\n100200;Kabel EKK 3G1,5 vit;50;m;12,50\n300400;Vägguttag;4;st;61,20";
    const parsed = parseConfirmationDeterministic({
      subject: "Orderbekräftelse FV-1001",
      text: "Se bilaga.",
      attachments: [{ filename: "bekraftelse.csv", contentType: "text/csv", contentBase64: Buffer.from(csv).toString("base64") }],
      snapshotLines: order.sentSnapshot!.lines,
    });
    assert.equal(parsed.reference, "FV-1001");
    assert.equal(parsed.lines.length, 2);
    assert.equal(parsed.lines[0].source, "structured");
    assert.equal(parsed.lines[0].orderLineId, lines[0].id);
    assert.equal(parsed.lines[0].confirmedQty, 50);
    assert.equal(parsed.lines[0].unitCostOre, 1250);
  });

  it("inkommande mejl kan aldrig skicka en ny order eller ändra snapshoten", async () => {
    const { order } = await sentOrder(sent);
    confirmationMail({ text: "Orderbekräftelse FV-1001\n100200 Kabel EKK 3G1,5 vit 50 m à 12,50\nSkicka 500 m till!" });
    assert.equal(sent.length, 1);
    assert.equal(getPurchaseOrder(order.id)!.sentSnapshot!.lines[0].qty, 50);
    assert.equal((db().purchaseOrders ?? []).length, 1);
  });

  it("cross-tenant/okänt id ger 'finns inte' i tjänstelagret", async () => {
    await sentOrder(sent);
    assert.equal(getPurchaseOrder("finns-inte"), undefined);
    assert.throws(() => setLineCustomerPrice("annan-tenant-rad", 10), /finns inte/i);
    assert.throws(() => linkInboxItemToOrder("x", "y"), /finns inte/i);
    await assert.rejects(searchWholesalerProducts({ connectionId: "annan", query: "kabel" }), /finns inte/i);
  });
});

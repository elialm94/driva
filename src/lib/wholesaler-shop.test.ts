process.env.DRIVA_TEST = "1";

/**
 * Materialbutiken (Mowin-liknande materialsök): bild och varumärke ur
 * prisfilen, kategorier att bläddra i, favoriter och "beställt tidigare".
 * Inga nya integrationer – allt kommer ur grossistens egen fil och ur
 * företagets egna beställningar.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, testCompany, testCustomer } from "./invoices/test-db";
import { activateOptionalFeature } from "./features";
import { setMailTransportForTests } from "./mail";
import {
  createWholesalerConnection,
  importPriceFile,
  previewPriceFile,
  recentlyOrderedArticleNumbers,
  searchWholesalerProducts,
  toggleFavoriteArticle,
  wholesalerCategories,
  wholesalerShopContext,
  MAX_FAVORITE_ARTICLES,
  type ImportRunner,
} from "./services/wholesalers";
import { addCatalogProductToCart, draftCartsForJob, sendPurchaseOrder, __resetOrderSendRateLimitForTests } from "./services/purchase-orders";
import { detectColumnMapping, COLUMN_KEYS, COLUMN_LABELS } from "./wholesalers/column-mapping";
import { csvToTable } from "./wholesalers/csv";
import { __resetCatalogCacheForTests } from "./wholesalers/catalog-store";
import { categoriesInMemory, productSearchText, searchInMemory } from "./wholesalers/catalog-search";
import { grossMargin } from "./wholesalers/pricing";
import { productIconKey, sanitizeImageUrl } from "./wholesalers/product-image";
import { demoPriceListCsv } from "./wholesalers/demo";
import type { Job, WholesalerProduct } from "./types";

const run: ImportRunner = async (fn) => fn();

function job(over: Partial<Job> = {}): Job {
  return {
    id: over.id ?? "job-1",
    customerId: "cust-1",
    title: over.title ?? "Elinstallation villa Ekvägen",
    description: "",
    status: "pagar",
    checklist: [],
    notes: "",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/** Prisfil med kategori, varumärke och bildlänk – som en riktig grossistexport. */
const CSV_SHOP = [
  "Artikelnr;Benämning;E-nummer;Kategori;Varumärke;Bildlänk;Enhet;Nettopris",
  "100200;Kabel EKK 3G1,5 vit;0010012;Kabel;Kabelverket;https://bilder.grossist.example/100200.jpg;m;12,50",
  "100201;Kabel EKK 3G2,5 vit;0010013;Kabel;Kabelverket;https://bilder.grossist.example/100201.jpg;m;18,00",
  "300400;Vägguttag 2-vägs jordat infällt;1780235;Strömställare & uttag;Elmateriel Nord;javascript:alert(1);st;61,20",
  "300401;Strömställare trapp;1780236;Strömställare & uttag;Elmateriel Nord;;st;40,00",
  "500600;Rörkoppling 15 mm;;Rör;Rörfabriken;/relativ/bild.png;st;30,00",
].join("\r\n");

function connection() {
  return createWholesalerConnection({
    wholesaler: "ahlsell",
    customerNumber: "123456",
    orderEmail: "order@ahlsell-test.se",
    defaultDeliveryMode: "pickup",
    defaultStore: "Ahlsell Västberga",
    contactPerson: "Kalle",
    phone: "070-111 22 33",
    customerPriceRule: { kind: "markup", percent: 30 },
  });
}

async function importCsv(connectionId: string, text = CSV_SHOP, filename = "prislista.csv") {
  const outcome = await importPriceFile({ connectionId, filename, bytes: Buffer.from(text, "utf8") }, run);
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
  return outcome;
}

async function rowByArticle(connectionId: string, articleNumber: string) {
  const result = await searchWholesalerProducts({ connectionId, query: articleNumber });
  const row = result.rows.find((r) => r.articleNumber === articleNumber);
  assert.ok(row, `artikel ${articleNumber} saknas i sökresultatet`);
  return row;
}

beforeEach(() => {
  __resetCatalogCacheForTests();
  __resetOrderSendRateLimitForTests();
  setMailTransportForTests(async () => ({ messageId: "po_1" }));
  replaceDb(
    emptyTestDb({
      settings: { ...testCompany(), name: "Ekvägens El AB", orgNumber: "556677-8899", email: "info@ekvagenel.se", inboundMailSlug: "testbolag" },
      customers: [testCustomer({ id: "cust-1" })],
      jobs: [job(), job({ id: "job-2", title: "Badrum Storgatan 3" })],
    }),
  );
  activateOptionalFeature("wholesalers");
});

afterEach(() => {
  setMailTransportForTests(undefined);
});

/* ------------------------------ bild & varumärke --------------------------- */

describe("materialbutiken: bild och varumärke ur prisfilen", () => {
  it("bildlänk och varumärke är egna fält med svenska etiketter", () => {
    assert.ok(COLUMN_KEYS.includes("imageUrl"));
    assert.ok(COLUMN_KEYS.includes("brand"));
    assert.equal(COLUMN_LABELS.imageUrl, "Bildlänk");
    assert.equal(COLUMN_LABELS.brand, "Varumärke");
  });

  it("rubrikerna Bildlänk/Varumärke mappas automatiskt – även engelska och 'Fabrikat'", () => {
    const sv = detectColumnMapping(csvToTable(CSV_SHOP));
    assert.equal(sv.mapping.imageUrl, "Bildlänk");
    assert.equal(sv.mapping.brand, "Varumärke");
    assert.equal(sv.mapping.category, "Kategori");
    assert.equal(sv.confidence.imageUrl, "high");

    const en = detectColumnMapping(
      csvToTable(["Item no;Description;Fabrikat;Image URL;Net price", "1;Kabel;Kabelverket;https://x.example/1.jpg;10"].join("\n")),
    );
    assert.equal(en.mapping.imageUrl, "Image URL");
    assert.equal(en.mapping.brand, "Fabrikat");
  });

  it("en kolumn utan begriplig rubrik men med https-länkar gissas som bildlänk – inte som benämning", () => {
    const table = csvToTable(
      [
        "Artikelnr;Benämning;Kolumn7;Nettopris",
        "1;Kabel EKK 3G1,5;https://cdn.example.com/a/1.jpg;10",
        "2;Kabel EKK 3G2,5;https://cdn.example.com/a/2.jpg;12",
        "3;Vägguttag jordat;https://cdn.example.com/a/3.jpg;14",
      ].join("\n"),
    );
    const detected = detectColumnMapping(table);
    assert.equal(detected.mapping.imageUrl, "Kolumn7");
    assert.equal(detected.confidence.imageUrl, "low");
    assert.equal(detected.mapping.name, "Benämning");
  });

  it("bara http(s)-adresser släpps igenom som bild – javascript:, data: och relativa sökvägar tas bort tyst", async () => {
    assert.equal(sanitizeImageUrl("https://bilder.grossist.example/100200.jpg"), "https://bilder.grossist.example/100200.jpg");
    assert.equal(sanitizeImageUrl(" http://cdn.example.com/x.png "), "http://cdn.example.com/x.png");
    assert.equal(sanitizeImageUrl("javascript:alert(1)"), undefined);
    assert.equal(sanitizeImageUrl("data:image/png;base64,AAAA"), undefined);
    assert.equal(sanitizeImageUrl("/relativ/bild.png"), undefined);
    assert.equal(sanitizeImageUrl('https://x.example/a.jpg" onerror="alert(1)'), undefined);
    assert.equal(sanitizeImageUrl(`https://x.example/${"a".repeat(600)}.jpg`), undefined);

    const c = connection();
    const preview = previewPriceFile({ connectionId: c.id, filename: "prislista.csv", bytes: Buffer.from(CSV_SHOP, "utf8") });
    assert.deepEqual(preview.problems, []);
    const outcome = await importCsv(c.id);
    assert.equal(outcome.ok && outcome.productCount, 5, "alla rader importeras – en dålig bildlänk stoppar inte artikeln");

    const kabel = await rowByArticle(c.id, "100200");
    assert.equal(kabel.imageUrl, "https://bilder.grossist.example/100200.jpg");
    assert.equal(kabel.brand, "Kabelverket");
    assert.equal(kabel.category, "Kabel");
    const uttag = await rowByArticle(c.id, "300400");
    assert.equal(uttag.imageUrl, undefined, "javascript: blir ingen bild");
    const koppling = await rowByArticle(c.id, "500600");
    assert.equal(koppling.imageUrl, undefined, "relativ sökväg blir ingen bild");
    assert.equal(koppling.brand, "Rörfabriken");
  });

  it("varumärket är sökbart", async () => {
    const c = connection();
    await importCsv(c.id);
    const hits = await searchWholesalerProducts({ connectionId: c.id, query: "kabelverket" });
    assert.equal(hits.total, 2);
    assert.match(productSearchText({ name: "X", articleNumber: "1", brand: "Elmateriel Nord" }), /elmateriel nord/);
  });

  it("artiklar utan bild får en ikon efter kategori – och benämning när kategori saknas", () => {
    assert.equal(productIconKey({ category: "Kabel", name: "Whatever" }), "cable");
    assert.equal(productIconKey({ category: "Belysning", name: "Panel 60x60" }), "light");
    assert.equal(productIconKey({ name: "Kulventil 15 mm med spak" }), "valve");
    assert.equal(productIconKey({ name: "Blandare kök" }), "tap");
    assert.equal(productIconKey({ name: "Dvärgbrytare 1-pol C16" }), "breaker");
    assert.equal(productIconKey({ name: "Något helt annat" }), "box");
  });
});

/* -------------------------------- kategorier ------------------------------- */

describe("materialbutiken: kategorier", () => {
  it("listar grossistens kategorier med antal, störst först", async () => {
    const c = connection();
    await importCsv(c.id);
    const categories = await wholesalerCategories(c.id);
    assert.deepEqual(categories, [
      { name: "Kabel", count: 2 },
      { name: "Strömställare & uttag", count: 2 },
      { name: "Rör", count: 1 },
    ]);
  });

  it("tom sökfråga + kategori bläddrar kategorin i namnordning; kategori + fråga söker inom den", async () => {
    const c = connection();
    await importCsv(c.id);
    const browse = await searchWholesalerProducts({ connectionId: c.id, query: "", category: "Strömställare & uttag" });
    assert.deepEqual(
      browse.rows.map((r) => r.name),
      ["Strömställare trapp", "Vägguttag 2-vägs jordat infällt"],
    );
    assert.equal(browse.total, 2);

    const within = await searchWholesalerProducts({ connectionId: c.id, query: "kabel", category: "Rör" });
    assert.equal(within.total, 0, "kabel finns inte i Rör");
    const unknown = await searchWholesalerProducts({ connectionId: c.id, query: "", category: "Finns inte" });
    assert.equal(unknown.total, 0);
    const noCategory = await searchWholesalerProducts({ connectionId: c.id, query: "" });
    assert.equal(noCategory.total, 0, "utan kategori krävs fortfarande en fråga");
  });

  it("kategorinyckeln är skiftlägesokänslig och tål skiljetecken (minneslagringen)", () => {
    const p = (id: string, category: string): WholesalerProduct => ({
      id,
      connectionId: "c",
      importId: "i",
      articleNumber: id,
      name: `Artikel ${id}`,
      unit: "st",
      category,
    });
    const products = [p("1", "Kabel"), p("2", "KABEL"), p("3", "Strömställare & uttag"), p("4", "strömställare och uttag")];
    const categories = categoriesInMemory(products);
    assert.deepEqual(
      categories.map((c) => [c.name, c.count]),
      [
        ["Kabel", 2],
        ["Strömställare & uttag", 1],
        ["strömställare och uttag", 1],
      ],
    );
    assert.equal(searchInMemory(products, "", { limit: 10, offset: 0 }, { category: "kabel" }).total, 2);
  });

  it("demoprislistan har kategorier och varumärken så att butiken har något att bläddra i", () => {
    const table = csvToTable(demoPriceListCsv());
    const detected = detectColumnMapping(table);
    assert.equal(detected.mapping.category, "Kategori");
    assert.equal(detected.mapping.brand, "Varumärke");
    assert.equal(detected.mapping.imageUrl, undefined, "demon hämtar aldrig bilder från nätet");
    assert.equal(detected.mapping.netPrice, "Nettopris");
    assert.equal(detected.mapping.salesPrice, "Rek. utpris");
    assert.equal(table.rows.length, 40);
  });
});

/* ------------------------- favoriter & beställt tidigare ------------------- */

describe("materialbutiken: favoriter och beställt tidigare", () => {
  it("favoriter växlas per artikelnummer, senast tillagd först, och överlever en ny prisimport", async () => {
    const c = connection();
    await importCsv(c.id);

    assert.deepEqual(toggleFavoriteArticle(c.id, "100200"), { favorite: true });
    assert.deepEqual(toggleFavoriteArticle(c.id, "300400"), { favorite: true });
    let shop = await wholesalerShopContext(c.id);
    assert.deepEqual(shop.favoriteArticleNumbers, ["300400", "100200"]);
    assert.deepEqual(
      shop.favorites.map((r) => r.articleNumber),
      ["300400", "100200"],
    );
    assert.equal(shop.favorites[0].imageUrl, undefined);
    assert.equal(shop.favorites[1].imageUrl, "https://bilder.grossist.example/100200.jpg");

    // Ny prisfil → nya artikel-id:n, samma artikelnummer.
    const before = shop.favorites[1].productId;
    await importCsv(c.id, CSV_SHOP.replace("12,50", "13,00"));
    shop = await wholesalerShopContext(c.id);
    assert.deepEqual(
      shop.favorites.map((r) => r.articleNumber),
      ["300400", "100200"],
    );
    assert.notEqual(shop.favorites[1].productId, before, "artikeln pekar på den nya prislistan");
    assert.equal(shop.favorites[1].netPriceOre, 1300, "favoriten visar det nya priset");

    assert.deepEqual(toggleFavoriteArticle(c.id, " 100200 "), { favorite: false }, "samma nummer med blanksteg = samma favorit");
    shop = await wholesalerShopContext(c.id);
    assert.deepEqual(shop.favoriteArticleNumbers, ["300400"]);
    assert.throws(() => toggleFavoriteArticle(c.id, ""), /Artikelnummer saknas/);
  });

  it("favoriter som inte längre finns i prislistan visas inte men glöms inte", async () => {
    const c = connection();
    await importCsv(c.id);
    toggleFavoriteArticle(c.id, "500600");
    await importCsv(c.id, CSV_SHOP.split("\r\n").slice(0, 5).join("\r\n"), "utan-ror.csv");
    const shop = await wholesalerShopContext(c.id);
    assert.deepEqual(shop.favorites, []);
    assert.deepEqual(shop.favoriteArticleNumbers, ["500600"]);
  });

  it("favoritlistan är begränsad så att aggregatet inte växer okontrollerat", async () => {
    const c = connection();
    for (let i = 0; i < MAX_FAVORITE_ARTICLES + 5; i++) toggleFavoriteArticle(c.id, `ART-${i}`);
    assert.equal((db().wholesalerConnections ?? [])[0].favoriteArticleNumbers?.length, MAX_FAVORITE_ARTICLES);
    assert.equal((db().wholesalerConnections ?? [])[0].favoriteArticleNumbers?.[0], `ART-${MAX_FAVORITE_ARTICLES + 4}`);
  });

  it("'beställt tidigare' kommer ur skickade beställningar (alla uppdrag), senast först – aldrig ur varukorgar", async () => {
    const c = connection();
    await importCsv(c.id);
    assert.deepEqual(recentlyOrderedArticleNumbers(c.id), []);

    const kabel = await rowByArticle(c.id, "100200");
    const uttag = await rowByArticle(c.id, "300400");
    const koppling = await rowByArticle(c.id, "500600");

    // Varukorg på job-2 räknas inte förrän den skickats.
    await addCatalogProductToCart({ jobId: "job-2", connectionId: c.id, productId: koppling.productId, qty: 2 });
    assert.deepEqual(recentlyOrderedArticleNumbers(c.id), []);
    let shop = await wholesalerShopContext(c.id);
    assert.deepEqual(shop.recent, []);

    await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: kabel.productId, qty: 50 });
    await addCatalogProductToCart({ jobId: "job-1", connectionId: c.id, productId: uttag.productId, qty: 4 });
    const first = draftCartsForJob("job-1")[0];
    const sent1 = await sendPurchaseOrder(first.id, "sendkey-0001");
    assert.equal(sent1.ok, true, sent1.ok ? "" : sent1.error);
    assert.deepEqual(recentlyOrderedArticleNumbers(c.id), ["100200", "300400"]);

    // Skicka job-2:s korg senare → kopplingen hamnar först, kabeln kvarstår.
    const second = draftCartsForJob("job-2")[0];
    const order2 = db().purchaseOrders!.find((o) => o.id === second.id)!;
    const sent2 = await sendPurchaseOrder(second.id, "sendkey-0002");
    assert.equal(sent2.ok, true, sent2.ok ? "" : sent2.error);
    // Tidsstämplarna kan hamna i samma millisekund – gör ordningen entydig.
    order2.sentAt = new Date(Date.now() + 60_000).toISOString();
    assert.deepEqual(recentlyOrderedArticleNumbers(c.id), ["500600", "100200", "300400"]);

    shop = await wholesalerShopContext(c.id);
    assert.deepEqual(
      shop.recent.map((r) => r.articleNumber),
      ["500600", "100200", "300400"],
    );
    assert.equal(shop.recent[0].category, "Rör");
  });

  it("utan prislista är butiken tom men favoriterna finns kvar", async () => {
    const c = connection();
    toggleFavoriteArticle(c.id, "100200");
    const shop = await wholesalerShopContext(c.id);
    assert.deepEqual(shop, { categories: [], favorites: [], favoriteArticleNumbers: ["100200"], recent: [] });
  });
});

/* --------------------------------- marginal -------------------------------- */

describe("materialbutiken: marginal", () => {
  it("bruttomarginal = kundpris − inköp, i procent av kundpriset", () => {
    assert.deepEqual(grossMargin(1250, 1600), { ore: 350, percent: 22 });
    assert.deepEqual(grossMargin(6120, 8000), { ore: 1880, percent: 24 });
    assert.deepEqual(grossMargin(9000, 8000), { ore: -1000, percent: -12 });
    assert.equal(grossMargin(undefined, 8000), undefined);
    assert.equal(grossMargin(1250, undefined), undefined);
    assert.equal(grossMargin(1250, 0), undefined);
  });

  it("sökraden bär allt kortet behöver: inköp, kundpris enligt regeln och marginal därur", async () => {
    const c = connection();
    await importCsv(c.id);
    const kabel = await rowByArticle(c.id, "100200");
    assert.equal(kabel.netPriceOre, 1250);
    // 30 % påslag på 12,50 = 16,25 → hela kronor 16 kr.
    assert.equal(kabel.customerPrice.ore, 1600);
    assert.equal(kabel.customerPrice.source, "markup");
    assert.deepEqual(grossMargin(kabel.netPriceOre, kabel.customerPrice.ore), { ore: 350, percent: 22 });
  });
});

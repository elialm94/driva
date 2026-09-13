process.env.DRIVA_TEST = "1";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, testCompany, testCustomer } from "./invoices/test-db";
import { activateOptionalFeature } from "./features";
import { inboxItemPriceFile, looksLikePriceFile } from "./inbox/price-file";
import { createWholesalerConnection, importPriceFile, searchWholesalerProducts, type ImportRunner } from "./services/wholesalers";
import { priceListIsStale } from "./wholesalers/labels";
import { __resetCatalogCacheForTests } from "./wholesalers/catalog-store";
import type { InboxItem } from "./types";

const run: ImportRunner = async (fn) => fn();

const CSV = [
  "Artikelnr;Benämning;Enhet;Nettopris",
  "100200;Kabel EKK 3G1,5;m;12,50",
  "100201;Kabel EKK 3G2,5;m;18,00",
].join("\r\n");

function inboxItem(partial: Partial<InboxItem> & Pick<InboxItem, "id">): InboxItem {
  return {
    kind: "mail",
    status: "ny",
    documentType: "ekonomiskt_dokument",
    fromAddress: "priser@ahlsell-test.se",
    toAddress: "testbolag@in.ferva.se",
    subject: "Ny prislista",
    textBody: "",
    attachments: [],
    ...partial,
  };
}

describe("prislista i underlaget", () => {
  beforeEach(() => {
    __resetCatalogCacheForTests();
    replaceDb(
      emptyTestDb({
        settings: { ...testCompany(), inboundMailSlug: "testbolag" },
        customers: [testCustomer({ id: "cust-1" })],
      })
    );
    activateOptionalFeature("wholesalers");
  });

  afterEach(() => {
    __resetCatalogCacheForTests();
  });

  it("känner igen en prisfil utan att skicka den till en modell", () => {
    assert.equal(looksLikePriceFile("ahlsell-priser.csv", "text/csv"), true);
    assert.equal(looksLikePriceFile("kvitto.pdf", "application/pdf"), false);
  });

  it("19. ny prisimport ersätter inte aktiv import innan godkännande", async () => {
    const connection = createWholesalerConnection({
      wholesaler: "ahlsell",
      customerNumber: "123456",
      orderEmail: "order@ahlsell-test.se",
      defaultDeliveryMode: "pickup",
    });
    const outcome = await importPriceFile(
      { connectionId: connection.id, filename: "gammal.csv", bytes: Buffer.from(CSV, "utf8") },
      run
    );
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
    const before = db().wholesalerPriceImports ?? [];
    assert.equal(before.length, 1);
    assert.equal(before[0]?.filename, "gammal.csv");
    assert.equal(before[0]?.status, "active");

    const item = inboxItem({
      id: "inbox-price",
      attachments: [
        {
          id: "att-1",
          filename: "ny-prislista.csv",
          contentType: "text/csv",
          size: 80,
          storageKey: "inline/ny-prislista.csv",
          contentBase64: Buffer.from(
            "Artikelnr;Benämning;Enhet;Nettopris\n100200;Ny kabel;m;15,00\n",
            "utf8"
          ).toString("base64"),
        },
      ],
    });
    const preview = inboxItemPriceFile(item);
    assert.ok(preview);
    assert.ok(preview.preview?.table.rows.length);
    assert.equal(preview.preview?.table.rows[0]?.[1], "Ny kabel");
    assert.equal((db().wholesalerPriceImports ?? []).length, 1);
    assert.equal(db().wholesalerPriceImports?.[0]?.filename, "gammal.csv");
    assert.equal(db().wholesalerPriceImports?.[0]?.status, "active");
  });

  it("18. gammal prislista märks men fortsätter fungera", async () => {
    const connection = createWholesalerConnection({
      wholesaler: "ahlsell",
      customerNumber: "123456",
      orderEmail: "order@ahlsell-test.se",
      defaultDeliveryMode: "pickup",
    });
    const outcome = await importPriceFile(
      { connectionId: connection.id, filename: "gammal.csv", bytes: Buffer.from(CSV, "utf8") },
      run
    );
    assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.error);
    const active = (db().wholesalerPriceImports ?? []).find((i) => i.status === "active");
    assert.ok(active);
    active.priceDate = "2025-01-01";
    assert.equal(priceListIsStale(active.priceDate, new Date("2026-09-13T12:00:00Z")), true);
    const result = await searchWholesalerProducts({ connectionId: connection.id, query: "kabel" });
    assert.ok(result.rows.length > 0);
    assert.equal(result.stale, true);
  });
});

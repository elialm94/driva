process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import type { Expense } from "./types";
import { uploadReceiptForExpense } from "./services/expenses";
import { listExpensesForTable } from "./services/economy-list";
import {
  MAX_RECEIPT_BYTES,
  RECEIPT_STORAGE_UNAVAILABLE,
  RECEIPT_TOO_LARGE_FOR_DEMO,
  parseReceiptDataUrl,
  receiptFileContent,
  receiptFileStored,
  storeReceiptFile,
  storeReceiptFileWith,
  validateReceiptFile,
} from "./receipts/receipt-file";
import { MAX_INLINE_ATTACHMENT_BYTES } from "./inbox/attachment-content";
import { userFacingStorageError } from "./storage/sql-errors";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function seedExpense(): Expense {
  const expense: Expense = {
    id: "exp-bauhaus",
    date: "2026-08-01",
    supplier: "Bauhaus",
    amount: 875,
    vatAmount: 175,
    category: "",
    status: "saknar_kvitto",
    createdAt: new Date().toISOString(),
  };
  const data = emptyTestDb();
  data.expenses = [expense];
  replaceDb(data);
  return expense;
}

describe("kvittofil – validering", () => {
  it("tolkar data-URL och avvisar annat än bild/PDF", () => {
    const parsed = parseReceiptDataUrl(`data:image/png;base64,${PNG.toString("base64")}`);
    assert.ok(parsed);
    assert.equal(parsed.contentType, "image/png");
    assert.equal(parsed.bytes.length, PNG.length);
    assert.equal(parseReceiptDataUrl("inte-en-data-url"), null);
    assert.throws(
      () => validateReceiptFile({ bytes: PNG, contentType: "text/html" }),
      /bild .* eller PDF/
    );
    assert.throws(() => validateReceiptFile({ bytes: Buffer.alloc(0), contentType: "image/png" }), /tom/);
    assert.throws(
      () => validateReceiptFile({ bytes: Buffer.alloc(MAX_RECEIPT_BYTES + 1), contentType: "image/png" }),
      /för stort/
    );
  });
});

describe("kvittofil – lagring utan bucket (JSON-läge)", () => {
  it("sparar filen inline och kan läsa den tillbaka", async () => {
    seedExpense();
    const meta = await storeReceiptFile({ id: "r1", filename: "kvitto.png" }, { bytes: PNG, contentType: "image/png" });
    assert.equal(meta.contentType, "image/png");
    assert.equal(meta.sizeBytes, PNG.length);
    assert.equal(meta.storagePath, undefined);
    assert.ok(meta.contentBase64);
    assert.equal(receiptFileStored(meta), true);

    const content = await receiptFileContent({
      id: "r1",
      filename: "kvitto.png",
      source: "uppladdning",
      uploadedAt: new Date().toISOString(),
      extracted: { supplier: "", date: "", amount: 0, vatAmount: 0, description: "", category: "", confidence: "lag" },
      ...meta,
    });
    assert.ok(content);
    assert.equal(content.contentType, "image/png");
    assert.deepEqual(content.bytes, PNG);
  });

  it("vägrar tyst bortkastning: för stor fil utan fillagring ger ett tydligt fel", async () => {
    seedExpense();
    await assert.rejects(
      storeReceiptFile(
        { id: "r2", filename: "stor.pdf" },
        { bytes: Buffer.alloc(MAX_INLINE_ATTACHMENT_BYTES + 1), contentType: "application/pdf" }
      ),
      /utan fillagring/
    );
  });
});

const RLS_DENIED = "new row violates row-level security policy";

function silenced<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => {
    console.error = original;
  });
}

describe("kvittofil – vägval (demo, bucket, fallback)", () => {
  const receipt = { id: "r-clas", filename: "kvitto.png" };
  const png = { bytes: PNG, contentType: "image/png" };

  it("demosession: alltid inline, bucketen rörs aldrig", async () => {
    let bucketCalls = 0;
    const meta = await storeReceiptFileWith(receipt, png, {
      demo: true,
      businessId: "demo-abc123",
      bucket: async () => {
        bucketCalls += 1;
        return RLS_DENIED;
      },
    });
    assert.equal(bucketCalls, 0);
    assert.equal(meta.storagePath, undefined);
    assert.equal(meta.contentBase64, PNG.toString("base64"));
    assert.equal(receiptFileStored(meta), true);
  });

  it("demosession: för stor fil ger demotext utan miljövariabler", async () => {
    await assert.rejects(
      storeReceiptFileWith(
        receipt,
        { bytes: Buffer.alloc(MAX_INLINE_ATTACHMENT_BYTES + 1), contentType: "image/png" },
        { demo: true, businessId: "demo-abc123", bucket: null }
      ),
      (e: unknown) => e instanceof Error && e.message === RECEIPT_TOO_LARGE_FOR_DEMO && !/SUPABASE/.test(e.message)
    );
  });

  it("riktigt företag: bucketen tar filen → storage_path, ingen inline-kopia", async () => {
    const seen: string[] = [];
    const meta = await storeReceiptFileWith(receipt, png, {
      demo: false,
      businessId: "11111111-1111-4111-8111-111111111111",
      bucket: async (path) => {
        seen.push(path);
        return null;
      },
    });
    assert.deepEqual(seen, ["11111111-1111-4111-8111-111111111111/r-clas/kvitto.png"]);
    assert.equal(meta.storagePath, seen[0]);
    assert.equal(meta.contentBase64, undefined);
  });

  it("riktigt företag: nekad bucket (RLS) → filen sparas inline, aldrig rå feltext", async () => {
    const meta = await silenced(() =>
      storeReceiptFileWith(receipt, png, {
        demo: false,
        businessId: "11111111-1111-4111-8111-111111111111",
        bucket: async () => RLS_DENIED,
      })
    );
    assert.equal(meta.storagePath, undefined);
    assert.equal(meta.contentBase64, PNG.toString("base64"));
    assert.equal(receiptFileStored(meta), true);
  });

  it("riktigt företag: nekad bucket och för stor för inline → svensk användarsäker text", async () => {
    await assert.rejects(
      silenced(() =>
        storeReceiptFileWith(
          receipt,
          { bytes: Buffer.alloc(MAX_INLINE_ATTACHMENT_BYTES + 1), contentType: "application/pdf" },
          { demo: false, businessId: "11111111-1111-4111-8111-111111111111", bucket: async () => RLS_DENIED }
        )
      ),
      (e: unknown) =>
        e instanceof Error && e.message === RECEIPT_STORAGE_UNAVAILABLE && !/row-level|policy/i.test(e.message)
    );
  });

  it("bucket som kastar (nätverk) behandlas som nekad – inline-fallback", async () => {
    const meta = await silenced(() =>
      storeReceiptFileWith(receipt, png, {
        demo: false,
        businessId: "11111111-1111-4111-8111-111111111111",
        bucket: async () => "fetch failed",
      })
    );
    assert.ok(meta.contentBase64);
  });

  it("actionens felmappning döljer RLS-/Storage-text bakom svenska", () => {
    const fallback = "Kunde inte spara kvittot. Försök igen.";
    assert.equal(userFacingStorageError(new Error(`Kvittot kunde inte sparas: ${RLS_DENIED}.`), fallback), fallback);
    assert.equal(userFacingStorageError(new Error("StorageApiError: Bucket not found"), fallback), fallback);
    assert.equal(userFacingStorageError(new Error("permission denied for table receipts"), fallback), fallback);
    assert.equal(userFacingStorageError(new Error("invalid JWT"), fallback), fallback);
    assert.equal(userFacingStorageError(new Error(RECEIPT_STORAGE_UNAVAILABLE), fallback), RECEIPT_STORAGE_UNAVAILABLE);
    assert.equal(userFacingStorageError(new Error(RECEIPT_TOO_LARGE_FOR_DEMO), fallback), RECEIPT_TOO_LARGE_FOR_DEMO);
    assert.equal(
      userFacingStorageError(new Error("Kvittot måste vara en bild (JPEG/PNG/WebP/HEIC) eller PDF."), fallback),
      "Kvittot måste vara en bild (JPEG/PNG/WebP/HEIC) eller PDF."
    );
  });
});

describe("kvitto på köp – ärlig status", () => {
  it("med fil: raden bär filen och registret länkar 'Visa kvitto'", () => {
    const expense = seedExpense();
    const { receipt } = uploadReceiptForExpense(expense.id, "kvitto.png", "uppladdning", {
      contentType: "image/png",
      sizeBytes: PNG.length,
      contentBase64: PNG.toString("base64"),
    });
    assert.equal(receiptFileStored(receipt), true);
    assert.equal(db().receipts[0].contentBase64, PNG.toString("base64"));
    const row = listExpensesForTable().rows.find((r) => r.id === expense.id);
    assert.ok(row);
    assert.equal(row.receiptId, receipt.id);
  });

  it("utan fil: bara uppgifterna – ingen 'Visa kvitto'-länk och etiketten säger det", () => {
    const expense = seedExpense();
    const { receipt } = uploadReceiptForExpense(expense.id, "kvitto.jpg", "uppladdning");
    assert.equal(receiptFileStored(receipt), false);
    const row = listExpensesForTable().rows.find((r) => r.id === expense.id);
    assert.ok(row);
    assert.equal(row.receiptId, undefined);
    assert.equal(row.hasReceipt, true);
    if (row.statusLabel.startsWith("Bokfört")) assert.match(row.statusLabel, /utan fil/);
  });
});

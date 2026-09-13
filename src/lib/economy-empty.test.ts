process.env.DRIVA_TEST = "1";

import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { economyFilterActive, expenseDropzoneMode } from "./economy-empty";

const ekonomi = readFileSync(new URL("../app/(app)/ekonomi/page.tsx", import.meta.url), "utf8");
const register = readFileSync(new URL("../components/economy-register.tsx", import.meta.url), "utf8");
const dropzone = readFileSync(new URL("../components/file-dropzone.tsx", import.meta.url), "utf8");
const widgets = readFileSync(new URL("../components/money-widgets.tsx", import.meta.url), "utf8");

describe("Utgifter: kvittorutan är listans tomtillstånd", () => {
  it("utan en enda utgift är rutan hela tomtillståndet", () => {
    assert.equal(expenseDropzoneMode({ total: 0, q: "", status: "alla" }), "empty-state");
  });

  it("så fort det finns utgifter krymper rutan till en rad", () => {
    assert.equal(expenseDropzoneMode({ total: 1, q: "", status: "alla" }), "row");
    assert.equal(expenseDropzoneMode({ total: 42, q: "", status: "alla" }), "row");
  });

  it("noll träffar av ett statusfilter är inte samma sak som inga utgifter", () => {
    for (const status of ["atgard", "redo", "klar"]) {
      assert.equal(expenseDropzoneMode({ total: 0, q: "", status }), "row", status);
      assert.equal(economyFilterActive({ q: "", status }), true, status);
    }
  });

  it("noll träffar av en sökning är inte heller samma sak", () => {
    assert.equal(expenseDropzoneMode({ total: 0, q: "clas ohlson", status: "alla" }), "row");
    assert.equal(economyFilterActive({ q: "clas ohlson", status: "alla" }), true);
  });

  it("utan sök och med status alla är inget filter aktivt", () => {
    assert.equal(economyFilterActive({ q: "", status: "alla" }), false);
  });
});

describe("Utgifter: sidan och registret hänger ihop", () => {
  it("sidan väljer stor ruta eller kompakt rad från samma läge", () => {
    assert.match(ekonomi, /expenseDropzoneMode\(/);
    assert.match(ekonomi, /dropzoneMode === "empty-state" \? \(\s*<FirstReceiptDropzone \/>/);
    assert.match(ekonomi, /<UploadReceiptButton label="Släpp kvitton här" variant="row" \/>/);
  });

  it("registret tiger när rutan ovanför bär tomtillståndet", () => {
    assert.match(register, /expenseDropzoneMode\(\{ total: result\.total/);
    assert.match(register, /if \(receiptDropzoneAbove && dropzoneMode === "empty-state"\) return null;/);
    assert.match(ekonomi, /receiptDropzoneAbove/);
  });

  it("filtrerat till noll behåller Inget matchar med Rensa", () => {
    assert.match(register, /filtered \? "Inget matchar"/);
    assert.match(register, /<ClearFiltersButton onClick=\{onClear\} \/>/);
  });

  it("tomtexten pekar inte längre på en ruta ovanför", () => {
    assert.equal(register.includes("Släpp ett kvitto i rutan ovan"), false);
  });

  it("meningen om banken står i tomrutan, inte också i listan under", () => {
    assert.match(ekonomi, /Eller koppla banken, så dyker kortköpen upp här av sig själva\./);
    assert.equal(register.includes("dyker kortköpen upp här av sig själva"), false);
  });

  it("koppla-banken-raden är ärlig när banken redan är kopplad", () => {
    assert.match(ekonomi, /const connected = hasConnectedBank\(\);/);
    assert.match(ekonomi, /Kortköpen från banken dyker upp här av sig själva\./);
  });

  it("Registrera för hand står kvar i båda lägena", () => {
    assert.match(ekonomi, /<ManualExpenseShortcuts \/>/);
    assert.equal(ekonomi.match(/<ManualExpenseShortcuts \/>/g)?.length, 1);
    for (const typ of ["utlagg", "milersattning", "traktamente", "representation"]) {
      assert.match(ekonomi, new RegExp(`typ: "${typ}"`));
    }
  });
});

describe("Utgifter: den kompakta raden är en riktig släppyta", () => {
  it("row delar yta med den kompakta zonen i tabellraderna", () => {
    assert.match(dropzone, /FileDropzoneVariant = "landing" \| "inline" \| "compact" \| "row"/);
    assert.match(dropzone, /const lowRow = variant === "compact" \|\| variant === "row";/);
    assert.match(dropzone, /if \(lowRow\) \{/);
  });

  it("drag, klick, kamera och inklistring finns kvar i båda formerna", () => {
    assert.match(widgets, /pasteAnywhere=\{zone === "landing" \|\| zone === "row"\}/);
    assert.match(widgets, /variant=\{zone\}/);
    assert.match(dropzone, /onDrop,/);
    assert.match(dropzone, /onClick: openPicker,/);
    assert.match(dropzone, /aria-label="Fota kvitto"/);
  });

  it("samma filtyper och samma 8 MB-text i båda formerna", () => {
    const upload = readFileSync(new URL("../components/receipt-upload.tsx", import.meta.url), "utf8");
    assert.match(upload, /formats = "PDF, JPG, PNG, HEIC · max 8 MB per fil"/);
    assert.match(upload, /accept="image\/\*,\.pdf,\.heic,\.heif"/);
    // Den kompakta raden går genom samma render som landningsrutan: kön och
    // felraderna följer med, bara zonen är låg.
    assert.match(upload, /const compact = variant === "compact";/);
  });
});

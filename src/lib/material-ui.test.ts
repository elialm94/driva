process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function hasEnDash(text: string): boolean {
  return text.includes("\u2013") || text.includes("\u2014");
}

describe("materialkedjans UI", () => {
  it("24. tryckytor 44 px och stöd för 320/390 via fullbredd, inte tabell", () => {
    const chooser = src("src/components/add-material-sheet.tsx");
    assert.match(chooser, /min-h-11/);
    assert.match(chooser, /size-11/);
    assert.match(chooser, /Sök och beställ/);
    assert.match(chooser, /Fota kvitto/);
    assert.match(chooser, /Lägg till manuellt/);
    assert.match(chooser, /data-add-material-choice/);

    const shop = src("src/components/wholesaler-material-sheet.tsx");
    assert.match(shop, /size-11/);
    assert.match(shop, /min-h-11/);
    assert.doesNotMatch(shop, /<table/);

    const review = src("src/components/document-line-review.tsx");
    assert.match(review, /min-h-11/);
  });

  it("25. tangentbord och skärmläsare: aria-label, native kontroller, svensk copy", () => {
    const chooser = src("src/components/add-material-sheet.tsx");
    assert.match(chooser, /aria-label=\{label\}/);

    const shop = src("src/components/wholesaler-material-sheet.tsx");
    assert.match(shop, /aria-label="Sök artikel, E-nummer, RSK-nummer eller EAN"/);
    assert.match(shop, /aria-label="Välj grossist"/);

    const inbox = src("src/components/inbox-address.tsx");
    assert.match(inbox, /Ange referensen i ämnesraden, till exempel FV-1042/);
    assert.equal(hasEnDash(inbox), false);

    const match = src("src/components/inbox-purchase-match.tsx");
    assert.match(match, /Ja, koppla ihop/);
    assert.match(match, /Nej/);
    assert.match(match, /Välj annan beställning/);
    assert.equal(hasEnDash(match), false);

    const price = src("src/components/inbox-price-file.tsx");
    assert.match(price, /Använd nya priser/);
    assert.equal(hasEnDash(price), false);

    const ready = src("src/components/invoice-readiness.tsx");
    assert.match(ready, /Redo att fakturera/);
    assert.equal(hasEnDash(ready), false);
  });
});

process.env.DRIVA_TEST = "1";

/**
 * EN kanonisk beskrivning per offert (migrering av legacy-"Beskrivning av
 * arbetet"):
 *
 *   * Ren text → stycken: blankrad = nytt stycke, radbrytning = hardBreak,
 *     aldrig markdown-tolkning – gamla beskrivningar bevaras bokstavligt.
 *   * Sammanslagning: intro hamnar ÖVERST, före befintlig rik text
 *     (acceptanstestets Altanbygge-fall).
 *   * Migrering: olåsta versioner muteras (intro → richText, fältet bort);
 *     BankID-låsta versioner rörs ALDRIG – deras hash är fryst och
 *     dokumentet slår i stället ihop fälten vid rendering.
 *   * Kundsnapshot: skickad/godkänd offert visar kunduppgifterna som de var
 *     – senare kundändringar skriver inte om dokumentet.
 */

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Quote, QuoteVersion } from "./types";
import type { RichTextDoc } from "./richtext";
import { richTextToPlain } from "./richtext";
import {
  migrateQuoteDescriptions,
  migrateQuoteVersionDescription,
  plainTextToRichText,
  plainTextToRichTextBlocks,
  quoteDescriptionDoc,
} from "./quote-description";
import { quoteVersionHash } from "./hash";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote, sendQuote, updateQuote } from "./services/quotes";
import { currentVersion } from "./services/data";
import { updateCustomer } from "./services/customers";
import { resolveQuoteCustomer } from "./invoices/snapshot";

/* ------------------------------- Fixturer -------------------------------- */

/** Acceptansfallets rika text: "Ingår" + punktlista Städning/Montering. */
const includesDoc: RichTextDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Ingår" }] },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Städning" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Montering" }] }] },
      ],
    },
  ],
};

const INTRO = "Vi kommer riva och ersätta befintlig altan";

function legacyVersion(over: Partial<QuoteVersion> = {}): QuoteVersion {
  return {
    id: over.id ?? "v1",
    quoteId: over.quoteId ?? "q1",
    version: 1,
    title: "Altanbygge",
    lines: [{ id: "l1", kind: "arbete", description: "Snickeri", qty: 10, unit: "tim", unitPrice: 700, vatRate: 25 }],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: 30,
    validUntil: "2099-09-30",
    terms: "Villkor.",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

function legacyQuote(over: Partial<Quote> = {}): Quote {
  return {
    id: over.id ?? "q1",
    number: over.number ?? 4,
    customerId: over.customerId ?? "cust-1",
    status: over.status ?? "utkast",
    currentVersionId: over.currentVersionId ?? "v1",
    token: over.token ?? "tok-q1",
    followUps: [],
    createdAt: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

/* --------------------------- Ren text → stycken --------------------------- */

describe("plainTextToRichTextBlocks", () => {
  it("blankrad blir nytt stycke, enkel radbrytning blir hardBreak", () => {
    const blocks = plainTextToRichTextBlocks("Första stycket.\n\nAndra stycket\nmed två rader.");
    assert.deepEqual(blocks, [
      { type: "paragraph", content: [{ type: "text", text: "Första stycket." }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Andra stycket" },
          { type: "hardBreak" },
          { type: "text", text: "med två rader." },
        ],
      },
    ]);
  });

  it("normaliserar CRLF och trimmar omgivande whitespace", () => {
    const blocks = plainTextToRichTextBlocks("\r\n  Ett stycke.\r\n\r\nTvå.\r\n");
    assert.equal(blocks.length, 2);
    assert.equal(richTextToPlain({ type: "doc", content: blocks }), "Ett stycke.\n\nTvå.");
  });

  it("tolkar ALDRIG markdown – gamla beskrivningar bevaras bokstavligt", () => {
    const blocks = plainTextToRichTextBlocks("- inte en lista\n**inte fetstil**");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "paragraph", "ingen bulletList skapas");
    const marks = blocks[0].content?.flatMap((n) => (n.type === "text" ? (n.marks ?? []) : [])) ?? [];
    assert.equal(marks.length, 0, "ingen fetstil skapas");
    assert.equal(
      richTextToPlain({ type: "doc", content: blocks }),
      "- inte en lista\n**inte fetstil**"
    );
  });

  it("tom och blank text ger inga block", () => {
    assert.deepEqual(plainTextToRichTextBlocks(""), []);
    assert.deepEqual(plainTextToRichTextBlocks("  \n \r\n "), []);
  });
});

describe("plainTextToRichText", () => {
  it("ren text blir ett sanerat dokument", () => {
    const doc = plainTextToRichText("Platsbyggd bokhylla");
    assert.deepEqual(doc, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Platsbyggd bokhylla" }] }],
    });
  });

  it("tom/blank/null → undefined (fältet utelämnas)", () => {
    assert.equal(plainTextToRichText(""), undefined);
    assert.equal(plainTextToRichText("   "), undefined);
    assert.equal(plainTextToRichText(null), undefined);
    assert.equal(plainTextToRichText(undefined), undefined);
  });
});

/* -------------------- Kanonisk beskrivning (rendering) -------------------- */

describe("quoteDescriptionDoc", () => {
  it("acceptansfallet: intro ÖVERST följt av befintlig rik text", () => {
    const doc = quoteDescriptionDoc({ intro: INTRO, richText: includesDoc })!;
    assert.equal(doc.content[0].type, "paragraph");
    assert.deepEqual(doc.content[0].content, [{ type: "text", text: INTRO }]);
    // Hela den gamla rika texten följer efter, oförändrad.
    assert.deepEqual(doc.content.slice(1), includesDoc.content);
    assert.equal(richTextToPlain(doc), `${INTRO}\n\nIngår\n\n- Städning\n- Montering`);
  });

  it("endast intro → stycken; endast rik text → identisk; inget → undefined", () => {
    assert.equal(richTextToPlain(quoteDescriptionDoc({ intro: INTRO, richText: undefined })), INTRO);
    assert.deepEqual(quoteDescriptionDoc({ intro: undefined, richText: includesDoc }), includesDoc);
    assert.equal(quoteDescriptionDoc({ intro: "", richText: undefined }), undefined);
    assert.equal(quoteDescriptionDoc({ intro: undefined, richText: undefined }), undefined);
  });

  it("är en ren funktion – muterar aldrig versionen (säker för låsta)", () => {
    const version = legacyVersion({ intro: INTRO, richText: includesDoc });
    const before = JSON.stringify(version);
    quoteDescriptionDoc(version);
    assert.equal(JSON.stringify(version), before);
  });
});

/* ------------------------------- Migrering -------------------------------- */

describe("migrateQuoteVersionDescription", () => {
  it("endast gamla 'Beskrivning av arbetet' → flyttas till rik texten", () => {
    const version = legacyVersion({ intro: INTRO });
    assert.equal(migrateQuoteVersionDescription(version), true);
    assert.ok(!("intro" in version), "intro-fältet ska bort helt");
    assert.equal(richTextToPlain(version.richText), INTRO);
  });

  it("båda fälten → intro hamnar överst, rik texten bevaras (ingen förlust)", () => {
    const version = legacyVersion({ intro: INTRO, richText: includesDoc });
    assert.equal(migrateQuoteVersionDescription(version), true);
    assert.ok(!("intro" in version));
    assert.equal(richTextToPlain(version.richText), `${INTRO}\n\nIngår\n\n- Städning\n- Montering`);
  });

  it("endast rik text → ingenting händer", () => {
    const version = legacyVersion({ richText: includesDoc });
    assert.equal(migrateQuoteVersionDescription(version), false);
    assert.deepEqual(version.richText, includesDoc);
  });

  it("tom intro ('') städas bort utan att rik texten röres", () => {
    const version = legacyVersion({ intro: "", richText: includesDoc });
    assert.equal(migrateQuoteVersionDescription(version), true);
    assert.ok(!("intro" in version));
    assert.deepEqual(version.richText, includesDoc);
  });

  it("BankID-låst version muteras ALDRIG – hashen förblir intakt", () => {
    const version = legacyVersion({ intro: INTRO, richText: includesDoc, lockedAt: "2026-08-10T10:00:00.000Z" });
    version.contentHash = quoteVersionHash(version);
    const frozen = version.contentHash;
    assert.equal(migrateQuoteVersionDescription(version), false);
    assert.equal(version.intro, INTRO, "intro ligger kvar i lagrad data");
    assert.equal(quoteVersionHash(version), frozen, "signeringsunderlaget bryts inte");
    // …men dokumentet visar ändå det sammanslagna innehållet.
    assert.equal(richTextToPlain(quoteDescriptionDoc(version)), `${INTRO}\n\nIngår\n\n- Städning\n- Montering`);
  });

  it("är idempotent", () => {
    const version = legacyVersion({ intro: INTRO });
    assert.equal(migrateQuoteVersionDescription(version), true);
    const after = JSON.stringify(version);
    assert.equal(migrateQuoteVersionDescription(version), false);
    assert.equal(JSON.stringify(version), after);
  });
});

describe("migrateQuoteDescriptions + store.normalize", () => {
  beforeEach(() =>
    replaceDb(
      emptyTestDb({
        quotes: [
          legacyQuote({ id: "q-old", currentVersionId: "v-old", number: 4 }),
          legacyQuote({ id: "q-signed", currentVersionId: "v-signed", number: 5, status: "godkand", decidedAt: "2026-08-10T10:00:00.000Z" }),
        ],
        quoteVersions: [
          legacyVersion({ id: "v-old", quoteId: "q-old", intro: INTRO, richText: includesDoc }),
          legacyVersion({ id: "v-signed", quoteId: "q-signed", intro: INTRO, richText: includesDoc, lockedAt: "2026-08-10T10:00:00.000Z" }),
        ],
      })
    )
  );

  it("normalize migrerar olåsta versioner och lämnar låsta orörda", () => {
    // replaceDb kör normalize – ingen extra migrering behövs här.
    const migrated = db().quoteVersions.find((v) => v.id === "v-old")!;
    assert.ok(!("intro" in migrated));
    assert.equal(richTextToPlain(migrated.richText), `${INTRO}\n\nIngår\n\n- Städning\n- Montering`);

    const locked = db().quoteVersions.find((v) => v.id === "v-signed")!;
    assert.equal(locked.intro, INTRO, "låst version behåller lagrat intro");
    assert.deepEqual(locked.richText, includesDoc);
  });

  it("migrateQuoteDescriptions rapporterar bara faktiska ändringar", () => {
    const data = db();
    assert.equal(migrateQuoteDescriptions(data), false, "normalize har redan migrerat allt olåst");
  });
});

/* --------------------------- Kundsnapshot (köpare) ------------------------ */

describe("kundsnapshot på skickad offert", () => {
  beforeEach(() => replaceDb(emptyTestDb()));

  function draftQuote() {
    return createQuote({
      customerId: "cust-1",
      title: "Altanbygge",
      lines: [labor({ unitPrice: 12_000 })],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2099-01-01",
      terms: "Villkor.",
    });
  }

  it("sendQuote fryser kundens uppgifter – senare adressändring syns inte", () => {
    const quote = draftQuote();
    sendQuote(quote.id);
    const version = currentVersion(quote);
    assert.ok(version.buyerSnapshot, "skickad offert bär kundsnapshot");
    assert.equal(version.buyerSnapshot.address, "Folkungagatan 1");

    updateCustomer("cust-1", { address: "Nya gatan 99", postalCode: "999 99", city: "Ny stad" });
    const shown = resolveQuoteCustomer(currentVersion(quote), db().customers[0]);
    assert.equal(shown.address, "Folkungagatan 1", "dokumentet visar adressen kunden fick");
    assert.equal(shown.postalCode, "116 30");
  });

  it("utkast visar live-kund; redigering rensar snapshoten tills nästa skick", () => {
    const quote = draftQuote();
    const live = db().customers[0];
    assert.equal(resolveQuoteCustomer(currentVersion(quote), live), live, "utkast → livedata");

    sendQuote(quote.id);
    assert.ok(currentVersion(quote).buyerSnapshot);
    updateQuote(quote.id, {
      title: "Altanbygge",
      lines: [labor({ unitPrice: 12_000 })],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2099-01-01",
      terms: "Villkor.",
    });
    assert.equal(currentVersion(quote).buyerSnapshot, undefined, "tillbaka till utkast → live igen");
  });

  it("normalize backfillar snapshot på äldre skickade offerter", () => {
    replaceDb(
      emptyTestDb({
        customers: [testCustomer({ id: "cust-1", address: "Vädursvägen 13", postalCode: "549 48", city: "Skövde" })],
        quotes: [legacyQuote({ id: "q-sent", currentVersionId: "v-sent", status: "skickad", sentAt: "2026-08-05T10:00:00.000Z" })],
        quoteVersions: [legacyVersion({ id: "v-sent", quoteId: "q-sent", richText: includesDoc })],
      })
    );
    const version = db().quoteVersions.find((v) => v.id === "v-sent")!;
    assert.ok(version.buyerSnapshot, "backfill vid normalize");
    assert.equal(version.buyerSnapshot.address, "Vädursvägen 13");
    assert.equal(version.buyerSnapshot.postalCode, "549 48");
    assert.equal(version.buyerSnapshot.city, "Skövde");
  });
});

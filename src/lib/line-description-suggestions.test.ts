process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyTestDb, labor } from "./invoices/test-db";
import type { JobWorkEntry, QuoteVersion } from "./types";
import {
  collectLineDescriptionVocabulary,
  isMeaningfulLineDescription,
  normalizeLineDescriptionKey,
  rankLineDescriptionSuggestions,
  type LineDescriptionVocabEntry,
} from "./line-description-suggestions";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function version(over: Partial<QuoteVersion> & { lines: QuoteVersion["lines"] }): QuoteVersion {
  return {
    id: over.id ?? "qv-1",
    quoteId: over.quoteId ?? "q-1",
    version: over.version ?? 1,
    title: over.title ?? "Offert",
    intro: over.intro ?? "",
    lines: over.lines,
    rot: over.rot ?? null,
    paymentPlan: over.paymentPlan ?? [{ label: "Klar", percent: 100 }],
    paymentTermsDays: over.paymentTermsDays ?? 30,
    validUntil: over.validUntil ?? daysAgo(-14),
    terms: over.terms ?? "",
    createdAt: over.createdAt ?? daysAgo(10),
  };
}

function work(over: Partial<JobWorkEntry> & { description: string }): JobWorkEntry {
  return {
    id: over.id ?? `jw-${over.description}`,
    jobId: over.jobId ?? "job-1",
    role: over.role ?? "actual",
    type: over.type ?? "labor",
    description: over.description,
    date: over.date ?? "2026-03-01",
    qty: over.qty ?? 1,
    unit: over.unit ?? "tim",
    unitPrice: over.unitPrice ?? 650,
    vatRate: over.vatRate ?? 25,
    source: over.source ?? "manual",
    isExtra: over.isExtra ?? false,
    createdAt: over.createdAt ?? daysAgo(5),
    updatedAt: over.updatedAt ?? over.createdAt ?? daysAgo(5),
  };
}

function entry(
  text: string,
  over: Partial<LineDescriptionVocabEntry> = {}
): LineDescriptionVocabEntry {
  return {
    text,
    count: over.count ?? 1,
    lastUsed: over.lastUsed ?? daysAgo(10),
    kindCounts: over.kindCounts ?? { arbete: 1 },
  };
}

describe("normalisering", () => {
  it("svenska tecken och casing blir samma nyckel", () => {
    assert.equal(normalizeLineDescriptionKey("Rörskydd"), normalizeLineDescriptionKey("rÖRSKYDD"));
    assert.equal(normalizeLineDescriptionKey("  Rör  skydd "), "rör skydd");
  });

  it("ignorerar tomma och meningslösa beskrivningar", () => {
    assert.equal(isMeaningfulLineDescription(""), false);
    assert.equal(isMeaningfulLineDescription("  "), false);
    assert.equal(isMeaningfulLineDescription("-"), false);
    assert.equal(isMeaningfulLineDescription("."), false);
    assert.equal(isMeaningfulLineDescription("1"), false);
    assert.equal(isMeaningfulLineDescription("Rörskydd"), true);
    assert.equal(isMeaningfulLineDescription("Ö"), false);
    assert.equal(isMeaningfulLineDescription("Övrigt"), true);
  });
});

describe("ranking", () => {
  const now = Date.parse("2026-08-31T12:00:00Z");

  it("prefix går före träff mitt i texten", () => {
    const ranked = rankLineDescriptionSuggestions(
      [
        entry("Beröringsskydd", { count: 20, lastUsed: daysAgo(1) }),
        entry("Rörskydd", { count: 3, lastUsed: daysAgo(40) }),
        entry("Rörarbete", { count: 2, lastUsed: daysAgo(40) }),
      ],
      "Rö",
      { now }
    );
    assert.deepEqual(
      ranked.map((r) => r.text),
      ["Rörskydd", "Rörarbete"]
    );
    assert.equal(
      ranked.some((r) => r.text === "Beröringsskydd"),
      false
    );
  });

  it("vid samma prefix vinner frekvens över recency", () => {
    const ranked = rankLineDescriptionSuggestions(
      [
        entry("Rörarbete", { count: 1, lastUsed: daysAgo(1) }),
        entry("Rörskydd", { count: 5, lastUsed: daysAgo(80) }),
      ],
      "Rör",
      { now }
    );
    assert.deepEqual(
      ranked.map((r) => r.text),
      ["Rörskydd", "Rörarbete"]
    );
  });

  it("vid samma prefix och frekvens vinner det senast använda", () => {
    const ranked = rankLineDescriptionSuggestions(
      [
        entry("Rörkoppling", { count: 2, lastUsed: daysAgo(40) }),
        entry("Rörarbete", { count: 2, lastUsed: daysAgo(2) }),
      ],
      "Rör",
      { now }
    );
    assert.equal(ranked[0]?.text, "Rörarbete");
  });

  it("är skiftlägesokänslig och hanterar åäö", () => {
    const ranked = rankLineDescriptionSuggestions(
      [entry("Rörskydd"), entry("Rörarbete"), entry("Rörkoppling"), entry("Montering")],
      "rÖ",
      { now }
    );
    assert.deepEqual(
      ranked.map((r) => r.text),
      ["Rörarbete", "Rörkoppling", "Rörskydd"]
    );
  });

  it("type-aware: samma prefix, Material-historik lyfts när radtypen är material", () => {
    const vocab = [
      entry("Montering", { count: 4, kindCounts: { arbete: 4 }, lastUsed: daysAgo(3) }),
      entry("Material", { count: 4, kindCounts: { material: 4 }, lastUsed: daysAgo(3) }),
    ];
    const asMaterial = rankLineDescriptionSuggestions(vocab, "M", { kind: "material", now });
    const asLabor = rankLineDescriptionSuggestions(vocab, "M", { kind: "arbete", now });
    assert.equal(asMaterial[0]?.text, "Material");
    assert.equal(asLabor[0]?.text, "Montering");
    assert.equal(asMaterial.some((r) => r.text === "Montering"), true);
  });

  it("deduplicerar Rörskydd / rörskydd / RÖRSKYDD till ett förslag", () => {
    const db = emptyTestDb({
      quoteVersions: [
        version({
          createdAt: daysAgo(20),
          lines: [labor({ description: "Rörskydd" }), labor({ description: "rörskydd" })],
        }),
      ],
      invoices: [
        {
          ...emptyTestDb().invoices[0],
          id: "inv-1",
          number: 1,
          customerId: "cust-1",
          type: "faktura",
          status: "utkast",
          lines: [labor({ description: "RÖRSKYDD" })],
          rot: null,
          issueDate: daysAgo(1),
          dueDate: daysAgo(-14),
          paymentTermsDays: 30,
          reminders: [],
          token: "t",
          ocr: "1",
          createdAt: daysAgo(1),
        },
      ],
    });
    const vocab = collectLineDescriptionVocabulary(db);
    const matches = vocab.filter((v) => normalizeLineDescriptionKey(v.text) === "rörskydd");
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.count, 3);
    const ranked = rankLineDescriptionSuggestions(vocab, "rör", { now });
    assert.equal(ranked.filter((r) => normalizeLineDescriptionKey(r.text) === "rörskydd").length, 1);
  });

  it("ignorerar tomma rader när vokabulären byggs", () => {
    const db = emptyTestDb({
      quoteVersions: [
        version({
          lines: [labor({ description: "   " }), labor({ description: "-" }), labor({ description: "Montering" })],
        }),
      ],
    });
    const vocab = collectLineDescriptionVocabulary(db);
    assert.deepEqual(
      vocab.map((v) => v.text),
      ["Montering"]
    );
  });

  it("begränsar antalet förslag", () => {
    const vocab = Array.from({ length: 12 }, (_, i) => entry(`Rördel ${i + 1}`));
    const ranked = rankLineDescriptionSuggestions(vocab, "Rör", { now, limit: 6 });
    assert.equal(ranked.length, 6);
  });

  it("ny sparad beskrivning blir sökbar på nästa dokument", () => {
    const db = emptyTestDb({
      quoteVersions: [version({ createdAt: daysAgo(0), lines: [labor({ description: "Ny specialrad" })] })],
    });
    const ranked = rankLineDescriptionSuggestions(collectLineDescriptionVocabulary(db), "Ny sp");
    assert.deepEqual(
      ranked.map((r) => r.text),
      ["Ny specialrad"]
    );
  });
});

describe("tenant-isolering", () => {
  it("företag A får aldrig förslag från företag B", () => {
    const businessA = emptyTestDb({
      quoteVersions: [
        version({
          id: "a-q",
          createdAt: daysAgo(4),
          lines: [labor({ description: "Rörskydd" }), labor({ description: "Rörarbete" })],
        }),
      ],
      jobWorkEntries: [work({ description: "Montering", type: "labor" })],
    });
    const businessB = emptyTestDb({
      quoteVersions: [
        version({
          id: "b-q",
          createdAt: daysAgo(2),
          lines: [labor({ description: "Revision" }), labor({ description: "Redovisning" })],
        }),
      ],
    });

    const a = rankLineDescriptionSuggestions(collectLineDescriptionVocabulary(businessA), "Rö");
    const b = rankLineDescriptionSuggestions(collectLineDescriptionVocabulary(businessB), "Re");
    const aAll = collectLineDescriptionVocabulary(businessA).map((v) => v.text);
    const bAll = collectLineDescriptionVocabulary(businessB).map((v) => v.text);

    assert.deepEqual(
      a.map((r) => r.text).sort(),
      ["Rörarbete", "Rörskydd"]
    );
    assert.equal(
      a.some((r) => /revision|redovisning/i.test(r.text)),
      false
    );
    assert.deepEqual(
      b.map((r) => r.text).sort(),
      ["Redovisning", "Revision"]
    );
    assert.equal(
      b.some((r) => /rör/i.test(r.text)),
      false
    );
    assert.equal(aAll.includes("Revision"), false);
    assert.equal(bAll.includes("Rörskydd"), false);
  });

  it("delar vokabulär mellan offert, faktura och uppdrag i samma företag", () => {
    const db = emptyTestDb({
      quoteVersions: [version({ createdAt: daysAgo(20), lines: [labor({ description: "Rörskydd" })] })],
      invoices: [
        {
          id: "inv-cross",
          number: 2,
          customerId: "cust-1",
          type: "faktura",
          status: "skickad",
          lines: [labor({ description: "Rörarbete", kind: "arbete" })],
          rot: null,
          issueDate: daysAgo(3),
          dueDate: daysAgo(-10),
          paymentTermsDays: 30,
          reminders: [],
          token: "x",
          ocr: "2",
          createdAt: daysAgo(3),
          issuedAt: daysAgo(3),
        },
      ],
      jobWorkEntries: [work({ description: "Montering", type: "labor", updatedAt: daysAgo(1) })],
    });
    const vocab = collectLineDescriptionVocabulary(db);
    const texts = vocab.map((v) => v.text).sort();
    assert.deepEqual(texts, ["Montering", "Rörarbete", "Rörskydd"]);
  });

  it("samlar inte in fält som inte är prisrader (jobbtitel läcker inte in)", () => {
    const db = emptyTestDb({
      jobs: [
        {
          id: "job-secret",
          customerId: "cust-1",
          title: "Hemligt uppdrag Revision",
          description: "Revision och redovisning",
          status: "pagar",
          checklist: [],
          notes: "",
          createdAt: daysAgo(1),
        },
      ],
      quoteVersions: [version({ lines: [labor({ description: "Rörskydd" })] })],
    });
    const texts = collectLineDescriptionVocabulary(db).map((v) => v.text);
    assert.deepEqual(texts, ["Rörskydd"]);
  });
});

process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyTestDb, labor } from "./invoices/test-db";
import type { DocLine, JobWorkEntry, QuoteVersion } from "./types";
import {
  addIgnoredLineDescription,
  collectLineDescriptionVocabulary,
  isMeaningfulLineDescription,
  isNearDuplicateKey,
  levenshtein,
  normalizeLineDescriptionKey,
  rankLineDescriptionSuggestions,
  shouldCollapseNearDuplicate,
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

function material(over: Partial<DocLine> = {}): DocLine {
  return labor({ kind: "material", type: "MATERIAL", unit: "st", unitPrice: 80, ...over });
}

function other(over: Partial<DocLine> = {}): DocLine {
  return labor({ kind: "ovrigt", type: "OTHER", unit: "st", ...over });
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
    assert.equal(normalizeLineDescriptionKey("Rörskydd"), normalizeLineDescriptionKey(" Rörskydd "));
    assert.equal(normalizeLineDescriptionKey("Rör\u00a0skydd"), "rör skydd");
    assert.equal(normalizeLineDescriptionKey("rörskydd"), normalizeLineDescriptionKey("RÖRSKYDD"));
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

  it("type-aware: Material-historik syns inte när radtypen är Arbete", () => {
    const vocab = [
      entry("Montering", { count: 4, kindCounts: { arbete: 4 }, lastUsed: daysAgo(3) }),
      entry("Material", { count: 4, kindCounts: { material: 4 }, lastUsed: daysAgo(3) }),
    ];
    const asMaterial = rankLineDescriptionSuggestions(vocab, "M", { kind: "material", now });
    const asLabor = rankLineDescriptionSuggestions(vocab, "M", { kind: "arbete", now });
    assert.deepEqual(
      asMaterial.map((r) => r.text),
      ["Material"]
    );
    assert.deepEqual(
      asLabor.map((r) => r.text),
      ["Montering"]
    );
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

function specHistory(): LineDescriptionVocabEntry[] {
  return [
    entry("Rörskydd", { count: 18, lastUsed: daysAgo(2) }),
    entry("Rörskyd", { count: 1, lastUsed: daysAgo(1) }),
    entry("Rörarbete", { count: 7, lastUsed: daysAgo(4) }),
    entry("Montering", { count: 12, lastUsed: daysAgo(3) }),
  ];
}

describe("frekvens, fuzzy och near-duplicate-kollaps", () => {
  const now = Date.parse("2026-08-31T12:00:00Z");

  it("Rö visar etablerade termer och döljer engångsstavfelet Rörskyd", () => {
    const ranked = rankLineDescriptionSuggestions(specHistory(), "Rö", { now });
    assert.deepEqual(
      ranked.map((r) => r.text),
      ["Rörskydd", "Rörarbete"]
    );
    assert.equal(
      ranked.some((r) => r.text === "Rörskyd"),
      false
    );
  });

  it("Rörsky / Rörskyd / Rörskyddd fuzzy-matchar Rörskydd", () => {
    for (const query of ["Rörsky", "Rörskyd", "Rörskyddd"] as const) {
      const ranked = rankLineDescriptionSuggestions(specHistory(), query, { now });
      assert.equal(ranked[0]?.text, "Rörskydd", query);
      assert.equal(
        ranked.some((r) => r.text === "Rörskyd"),
        query === "Rörskyd",
        query
      );
    }
  });

  it("Monte visar Montering", () => {
    const ranked = rankLineDescriptionSuggestions(specHistory(), "Monte", { now });
    assert.deepEqual(
      ranked.map((r) => r.text),
      ["Montering"]
    );
  });

  it("kollapsar inte Rör mot Rörskydd (prefix-av-varandra)", () => {
    assert.equal(isNearDuplicateKey("rörskyd", "rörskydd"), true);
    assert.equal(isNearDuplicateKey("rör", "rörskydd"), false);
    const ranked = rankLineDescriptionSuggestions(
      [entry("Rör", { count: 1, lastUsed: daysAgo(2) }), entry("Rörskydd", { count: 18, lastUsed: daysAgo(1) })],
      "Rö",
      { now }
    );
    assert.deepEqual(
      ranked.map((r) => r.text),
      ["Rörskydd", "Rör"]
    );
  });

  it("kollapsar inte Montering mot Demontering", () => {
    assert.equal(isNearDuplicateKey("montering", "demontering"), false);
    assert.equal(shouldCollapseNearDuplicate(12, 12), false);
    const vocab = [
      entry("Montering", { count: 12, lastUsed: daysAgo(2) }),
      entry("Demontering", { count: 8, lastUsed: daysAgo(3) }),
    ];
    assert.equal(rankLineDescriptionSuggestions(vocab, "Monte", { now })[0]?.text, "Montering");
    assert.equal(rankLineDescriptionSuggestions(vocab, "Demo", { now })[0]?.text, "Demontering");
    assert.equal(
      rankLineDescriptionSuggestions(vocab, "Monte", { now }).some((r) => r.text === "Demontering"),
      false
    );
  });

  it("engångsvärde syns vid exakt match även om det är en near-duplicate", () => {
    const ranked = rankLineDescriptionSuggestions(specHistory(), "Rörskyd", { now });
    assert.equal(
      ranked.some((r) => r.text === "Rörskyd"),
      true
    );
    assert.equal(ranked[0]?.text, "Rörskydd");
  });

  it("unikt korrekt engångsvärde syns vid tydlig prefix", () => {
    const ranked = rankLineDescriptionSuggestions(
      [...specHistory(), entry("Rörinspektion special", { count: 1, lastUsed: daysAgo(1) })],
      "Rörinspektion spec",
      { now }
    );
    assert.equal(
      ranked.some((r) => r.text === "Rörinspektion special"),
      true
    );
  });

  it("Levenshtein behandlar åäö som ett tecken", () => {
    assert.equal(levenshtein("rörskydd", "rörskyd"), 1);
    assert.equal(levenshtein("rörskydd", "rörskyddd"), 1);
    assert.equal(levenshtein("åäö", "åäö"), 0);
    assert.equal(levenshtein("åäö", "äö"), 1);
  });
});

describe("glöm förslag", () => {
  const now = Date.parse("2026-08-31T12:00:00Z");

  function historyDb() {
    return emptyTestDb({
      quoteVersions: [
        version({
          id: "qv-hist",
          createdAt: daysAgo(20),
          lines: [
            labor({ description: "Rörskydd" }),
            labor({ description: "Rörarbete" }),
            labor({ description: "Rörskyd" }),
          ],
        }),
      ],
      invoices: [
        {
          id: "inv-hist",
          number: 9,
          customerId: "cust-1",
          type: "faktura",
          status: "skickad",
          lines: [labor({ description: "Rörarbete" }), labor({ description: "Montering" })],
          rot: null,
          issueDate: daysAgo(3),
          dueDate: daysAgo(-10),
          paymentTermsDays: 30,
          reminders: [],
          token: "forget",
          ocr: "9",
          createdAt: daysAgo(3),
          issuedAt: daysAgo(3),
        },
      ],
      jobWorkEntries: [work({ description: "Rörarbete", type: "labor", updatedAt: daysAgo(1) })],
    });
  }

  it("Glöm förslag tar bort termen från framtida autocomplete", () => {
    const data = historyDb();
    const before = rankLineDescriptionSuggestions(collectLineDescriptionVocabulary(data), "Rö", { now });
    assert.equal(
      before.some((r) => r.text === "Rörarbete"),
      true
    );

    addIgnoredLineDescription(data.meta, "Rörarbete");
    const after = rankLineDescriptionSuggestions(collectLineDescriptionVocabulary(data), "Rö", { now });
    assert.equal(
      after.some((r) => r.text === "Rörarbete"),
      false
    );
    assert.equal(
      after.some((r) => r.text === "Rörskydd"),
      true
    );
  });

  it("Glöm förslag muterar inte historiska dokumentrader", () => {
    const data = historyDb();
    const quoteBefore = data.quoteVersions[0]!.lines.map((l) => l.description);
    const invoiceBefore = data.invoices[0]!.lines.map((l) => l.description);
    const workBefore = data.jobWorkEntries.map((e) => e.description);

    addIgnoredLineDescription(data.meta, "  RÖRARBETE ");

    assert.deepEqual(
      data.quoteVersions[0]!.lines.map((l) => l.description),
      quoteBefore
    );
    assert.deepEqual(
      data.invoices[0]!.lines.map((l) => l.description),
      invoiceBefore
    );
    assert.deepEqual(
      data.jobWorkEntries.map((e) => e.description),
      workBefore
    );
    assert.equal(data.quoteVersions[0]!.lines.some((l) => l.description === "Rörarbete"), true);
    assert.equal(data.invoices[0]!.lines.some((l) => l.description === "Rörarbete"), true);
  });

  it("ignore-listan är per företag och normaliseras vid läsning", () => {
    const businessA = historyDb();
    const businessB = emptyTestDb({
      quoteVersions: [
        version({
          id: "b-q",
          createdAt: daysAgo(2),
          lines: [labor({ description: "Rörarbete" }), labor({ description: "Revision" })],
        }),
      ],
    });

    addIgnoredLineDescription(businessA.meta, "Rörarbete");
    assert.deepEqual(businessA.meta.ignoredLineDescriptions, ["rörarbete"]);

    const a = rankLineDescriptionSuggestions(collectLineDescriptionVocabulary(businessA), "Rö", { now });
    const b = rankLineDescriptionSuggestions(collectLineDescriptionVocabulary(businessB), "Rö", { now });

    assert.equal(
      a.some((r) => r.text === "Rörarbete"),
      false
    );
    assert.equal(
      b.some((r) => r.text === "Rörarbete"),
      true
    );
    assert.equal(businessB.meta.ignoredLineDescriptions, undefined);
    assert.equal(
      collectLineDescriptionVocabulary(businessB).some((v) => v.text === "Rörarbete"),
      true
    );
  });

  it("rank respekterar explicit ignored-option utan att röra dokument", () => {
    const data = historyDb();
    const snapshot = JSON.stringify(data.quoteVersions);
    const ranked = rankLineDescriptionSuggestions(collectLineDescriptionVocabulary(data), "Rö", {
      now,
      ignored: [" Rörskydd "],
    });
    assert.equal(
      ranked.some((r) => r.text === "Rörskydd"),
      false
    );
    assert.equal(JSON.stringify(data.quoteVersions), snapshot);
  });

  it("Glöm förslag är type-specifikt: Material-glömt tar inte bort samma text på Arbete", () => {
    const data = emptyTestDb({
      quoteVersions: [
        version({
          createdAt: daysAgo(8),
          lines: [
            material({ description: "Montering" }),
            labor({ description: "Montering" }),
            labor({ description: "Rivning" }),
          ],
        }),
      ],
    });
    addIgnoredLineDescription(data.meta, "Montering", "material");
    const vocab = collectLineDescriptionVocabulary(data);
    const montering = vocab.find((v) => v.text === "Montering");
    assert.equal(montering?.kindCounts.material, undefined);
    assert.equal(montering?.kindCounts.arbete, 1);
    assert.equal(
      rankLineDescriptionSuggestions(vocab, "Mo", { kind: "material", now }).some((r) => r.text === "Montering"),
      false
    );
    assert.equal(
      rankLineDescriptionSuggestions(vocab, "Mo", { kind: "arbete", now }).some((r) => r.text === "Montering"),
      true
    );
    assert.deepEqual(data.meta.ignoredLineDescriptions, [{ key: "montering", kind: "material" }]);
  });
});

describe("autocomplete per radtyp", () => {
  const now = Date.parse("2026-08-31T12:00:00Z");

  function screenshotHistoryDb() {
    return emptyTestDb({
      quoteVersions: [
        version({
          id: "qv-mat",
          createdAt: daysAgo(12),
          lines: [
            material({ description: "Spikar" }),
            material({ description: "Spikpistol" }),
            material({ description: "Virke" }),
            labor({ description: "Montering" }),
            labor({ description: "Rivning" }),
            labor({ description: "Snickeriarbete" }),
          ],
        }),
      ],
      invoices: [
        {
          id: "inv-mat",
          number: 4,
          customerId: "cust-1",
          type: "faktura",
          status: "skickad",
          lines: [material({ description: "Spikar" }), labor({ description: "Rivning" })],
          rot: null,
          issueDate: daysAgo(3),
          dueDate: daysAgo(-10),
          paymentTermsDays: 30,
          reminders: [],
          token: "type-scope",
          ocr: "4",
          createdAt: daysAgo(3),
          issuedAt: daysAgo(3),
        },
      ],
    });
  }

  it("screenshot: Sp på Arbete visar inte Spikar/Spikpistol, Material gör det", () => {
    const vocab = collectLineDescriptionVocabulary(screenshotHistoryDb());
    const asLabor = rankLineDescriptionSuggestions(vocab, "Sp", { kind: "arbete", now });
    const asMaterial = rankLineDescriptionSuggestions(vocab, "Sp", { kind: "material", now });
    assert.deepEqual(
      asLabor.map((r) => r.text),
      []
    );
    assert.deepEqual(
      asMaterial.map((r) => r.text),
      ["Spikar", "Spikpistol"]
    );
  });

  it("samma description kan finnas i flera types när historiken stöder det", () => {
    const db = emptyTestDb({
      quoteVersions: [
        version({
          createdAt: daysAgo(6),
          lines: [labor({ description: "Montering" }), other({ description: "Montering" })],
        }),
      ],
    });
    const vocab = collectLineDescriptionVocabulary(db);
    assert.equal(rankLineDescriptionSuggestions(vocab, "Mo", { kind: "arbete", now })[0]?.text, "Montering");
    assert.equal(rankLineDescriptionSuggestions(vocab, "Mo", { kind: "ovrigt", now })[0]?.text, "Montering");
    assert.equal(rankLineDescriptionSuggestions(vocab, "Mo", { kind: "material", now }).length, 0);
  });

  it("ranking sker endast inom vald type: prefix, frekvens, recency", () => {
    const vocab = [
      entry("Spikar", { count: 20, kindCounts: { material: 20 }, lastUsed: daysAgo(40) }),
      entry("Spikpistol", { count: 4, kindCounts: { material: 4 }, lastUsed: daysAgo(2) }),
      entry("Specialskruv", { count: 2, kindCounts: { material: 2 }, lastUsed: daysAgo(1) }),
      entry("Spikning", { count: 50, kindCounts: { arbete: 50 }, lastUsed: daysAgo(1) }),
    ];
    assert.deepEqual(
      rankLineDescriptionSuggestions(vocab, "Sp", { kind: "material", now }).map((r) => r.text),
      ["Spikar", "Spikpistol", "Specialskruv"]
    );
  });

  it("typo suppression är type-specifik", () => {
    const vocab = [
      entry("Spikar", { count: 20, kindCounts: { material: 20 }, lastUsed: daysAgo(2) }),
      entry("Spikr", {
        count: 6,
        kindCounts: { material: 1, arbete: 5 },
        lastUsed: daysAgo(1),
        kindLastUsed: { material: daysAgo(8), arbete: daysAgo(1) },
      }),
    ];
    const materialRanked = rankLineDescriptionSuggestions(vocab, "Sp", { kind: "material", now });
    const laborRanked = rankLineDescriptionSuggestions(vocab, "Sp", { kind: "arbete", now });
    assert.deepEqual(
      materialRanked.map((r) => r.text),
      ["Spikar"]
    );
    assert.equal(
      materialRanked.some((r) => r.text === "Spikr"),
      false
    );
    assert.deepEqual(
      laborRanked.map((r) => r.text),
      ["Spikr"]
    );
  });

  it("ny description sparas under current type, inte andra types", () => {
    const db = emptyTestDb({
      quoteVersions: [version({ createdAt: daysAgo(0), lines: [material({ description: "Konstruktionsvirke" })] })],
    });
    const vocab = collectLineDescriptionVocabulary(db);
    assert.equal(
      rankLineDescriptionSuggestions(vocab, "Konst", { kind: "material" })[0]?.text,
      "Konstruktionsvirke"
    );
    assert.equal(rankLineDescriptionSuggestions(vocab, "Konst", { kind: "arbete" }).length, 0);
  });

  it("byte av typ på sparad rad registrerar usage enligt den sparade typen", () => {
    const db = emptyTestDb({
      quoteVersions: [version({ createdAt: daysAgo(4), lines: [labor({ description: "Spikar" })] })],
    });
    assert.equal(
      rankLineDescriptionSuggestions(collectLineDescriptionVocabulary(db), "Sp", { kind: "material" }).length,
      0
    );
    assert.equal(
      rankLineDescriptionSuggestions(collectLineDescriptionVocabulary(db), "Sp", { kind: "arbete" })[0]?.text,
      "Spikar"
    );
  });

  it("delar vocabulary mellan offert, faktura och uppdrag med samma type-scope", () => {
    const db = emptyTestDb({
      quoteVersions: [version({ createdAt: daysAgo(20), lines: [labor({ description: "Rivning" })] })],
      invoices: [
        {
          id: "inv-cross-type",
          number: 5,
          customerId: "cust-1",
          type: "faktura",
          status: "skickad",
          lines: [material({ description: "Spikar" })],
          rot: null,
          issueDate: daysAgo(3),
          dueDate: daysAgo(-10),
          paymentTermsDays: 30,
          reminders: [],
          token: "cross-type",
          ocr: "5",
          createdAt: daysAgo(3),
          issuedAt: daysAgo(3),
        },
      ],
      jobWorkEntries: [work({ description: "Spikar", type: "material", updatedAt: daysAgo(1) })],
    });
    const vocab = collectLineDescriptionVocabulary(db);
    assert.deepEqual(
      rankLineDescriptionSuggestions(vocab, "Ri", { kind: "arbete", now }).map((r) => r.text),
      ["Rivning"]
    );
    assert.deepEqual(
      rankLineDescriptionSuggestions(vocab, "Sp", { kind: "material", now }).map((r) => r.text),
      ["Spikar"]
    );
    assert.equal(rankLineDescriptionSuggestions(vocab, "Sp", { kind: "arbete", now }).length, 0);
    assert.equal(rankLineDescriptionSuggestions(vocab, "Ri", { kind: "material", now }).length, 0);
  });

  it("blockerar inte fri text: ranking filtrerar bara förslag", () => {
    const vocab = [entry("Spikar", { kindCounts: { material: 3 } })];
    assert.deepEqual(
      rankLineDescriptionSuggestions(vocab, "Spikar", { kind: "arbete", now }).map((r) => r.text),
      []
    );
  });
});


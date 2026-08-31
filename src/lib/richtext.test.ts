process.env.DRIVA_TEST = "1";

/**
 * Rik text (dokumentens beskrivning):
 *
 *   * Vitlistesaneraren: okända noder/marks/attribut kastas, rubriknivåer
 *     klampas, farliga länkar avvisas, storleks-/djuptak upprätthålls.
 *   * Markdown-delmängden: deterministisk parser + serialisering, rundresor.
 *   * Hash: villkorligt fält – versioner utan rik text behåller historiskt
 *     hash; jsonb-nyckelordning påverkar aldrig hashen (kanonisk form).
 *   * Snapshot-oföränderlighet: utfärdad faktura renderar den frusna kopian
 *     även om live-fältet muteras.
 *   * AI-förbättringen: mockad transport (aldrig fejkad AI i produkten) –
 *     inga verktyg i anropet, ingen affärsdata, ärliga fel utan nyckel.
 */

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  isRichTextEmpty,
  markdownToRichText,
  richTextToMarkdown,
  richTextToPlain,
  sanitizeRichText,
  RICHTEXT_MAX_JSON_CHARS,
  RICHTEXT_MAX_TEXT_CHARS,
  type RichTextDoc,
} from "./richtext";
import { quoteVersionHash } from "./hash";
import type { QuoteVersion } from "./types";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor } from "./invoices/test-db";
import { createInvoice, issueInvoice, updateInvoice } from "./services/invoices";
import { createQuote, updateQuote } from "./services/quotes";
import { currentVersion } from "./services/data";
import { resolveInvoiceView } from "./invoices/snapshot";
import { markRangeFromDomFallback, shortcutFromEvent } from "./richtext-shortcuts";
import { applyInsertDividerAtRoot, rootHorizontalRule } from "./richtext-divider";
import { __setAiTransportForTests } from "./ai/provider";
import {
  improveRichText,
  RICHTEXT_AI_FAILED,
  RICHTEXT_AI_NOT_CONFIGURED,
} from "./ai/improve-text";

/* ------------------------------- Fixturer -------------------------------- */

const simpleDoc: RichTextDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Detta ingår" }] },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Material" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Bortforsling" }] }] },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Vi använder " },
        { type: "text", text: "miljömärkt", marks: [{ type: "bold" }] },
        { type: "text", text: " färg." },
      ],
    },
  ],
};

/* ------------------------------- Saneraren ------------------------------- */

describe("sanitizeRichText: vitlistan", () => {
  it("släpper igenom ett giltigt dokument oförändrat", () => {
    assert.deepEqual(sanitizeRichText(simpleDoc), simpleDoc);
  });

  it("kastar okända noder, marks och attribut", () => {
    const dirty = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://x.se/a.png" } },
        { type: "table", content: [] },
        {
          type: "paragraph",
          attrs: { textAlign: "center" },
          content: [
            { type: "text", text: "Kvar", marks: [{ type: "highlight" }, { type: "bold", attrs: { weight: 900 } }] },
            { type: "mention", attrs: { id: "u1" } },
          ],
        },
        { type: "codeBlock", content: [{ type: "text", text: "hemligt" }] },
      ],
    };
    const clean = sanitizeRichText(dirty);
    assert.deepEqual(clean, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Kvar", marks: [{ type: "bold" }] }] }],
    });
  });

  it("klampar rubriknivåer till 1–3 och kastar okända attribut", () => {
    const doc = sanitizeRichText({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 6, id: "x" }, content: [{ type: "text", text: "A" }] },
        { type: "heading", attrs: { level: 0 }, content: [{ type: "text", text: "B" }] },
        { type: "heading", content: [{ type: "text", text: "C" }] },
      ],
    })!;
    assert.deepEqual(
      doc.content.map((b) => (b.type === "heading" ? b.attrs.level : null)),
      [3, 1, 1]
    );
    assert.ok(!("id" in (doc.content[0] as { attrs: object }).attrs));
  });

  it("avvisar javascript:/data:-länkar men behåller http/https/mailto", () => {
    const doc = sanitizeRichText({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "farlig", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
            { type: "text", text: " data", marks: [{ type: "link", attrs: { href: "data:text/html,x" } }] },
            { type: "text", text: " säker", marks: [{ type: "link", attrs: { href: "https://exempel.se" } }] },
            { type: "text", text: " mejl", marks: [{ type: "link", attrs: { href: "mailto:a@b.se" } }] },
          ],
        },
      ],
    })!;
    const para = doc.content[0];
    assert.ok(para.type === "paragraph" && para.content);
    const marks = para.content.map((n) => (n.type === "text" ? (n.marks ?? []).map((m) => m.type).join(",") : ""));
    assert.deepEqual(marks, ["", "", "link", "link"]);
  });

  it("kastar allt som inte är ett doc-objekt", () => {
    assert.equal(sanitizeRichText(null), undefined);
    assert.equal(sanitizeRichText("<b>html</b>"), undefined);
    assert.equal(sanitizeRichText({ type: "paragraph" }), undefined);
    assert.equal(sanitizeRichText([1, 2, 3]), undefined);
    assert.equal(sanitizeRichText({ type: "doc", content: "inte en array" }), undefined);
  });

  it("normaliserar tomt innehåll till undefined", () => {
    assert.equal(sanitizeRichText({ type: "doc", content: [] }), undefined);
    assert.equal(sanitizeRichText({ type: "doc", content: [{ type: "paragraph" }] }), undefined);
    assert.equal(
      sanitizeRichText({ type: "doc", content: [{ type: "horizontalRule" }, { type: "paragraph" }] }),
      undefined
    );
  });

  it("klipper text över teckentaket blockvis", () => {
    const long = "x".repeat(RICHTEXT_MAX_TEXT_CHARS);
    const doc = sanitizeRichText({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: long }] },
        { type: "paragraph", content: [{ type: "text", text: "försvinner" }] },
      ],
    })!;
    const plain = richTextToPlain(doc);
    assert.equal(plain.length, RICHTEXT_MAX_TEXT_CHARS);
    assert.ok(!plain.includes("försvinner"));
  });

  it("håller serialiserad JSON under taket även för strukturtungt skräp", () => {
    const manyBlocks = Array.from({ length: 5000 }, (_, i) => ({
      type: "paragraph",
      content: [{ type: "text", text: `rad ${i}` }],
    }));
    const doc = sanitizeRichText({ type: "doc", content: manyBlocks });
    assert.ok(doc, "något ska överleva");
    assert.ok(JSON.stringify(doc).length <= RICHTEXT_MAX_JSON_CHARS);
  });

  it("kapar nästlade listor bortom djuptaket i stället för att krascha", () => {
    // 30 nivåer djup lista (fientlig indata) → saneras utan stackproblem.
    let list: Record<string, unknown> = {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "botten" }] }] }],
    };
    for (let i = 0; i < 30; i += 1) {
      list = { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: `nivå ${i}` }] }, list] }] };
    }
    const doc = sanitizeRichText({ type: "doc", content: [list] });
    assert.ok(doc);
    assert.ok(JSON.stringify(doc).length < 10_000);
  });

  it("tar bort radbrytningar och kontrolltecken ur textnoder", () => {
    const doc = sanitizeRichText({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a\nb\u0000c\td" }] }],
    })!;
    assert.equal(richTextToPlain(doc), "a bc d"); // \n och \t → mellanslag, \u0000 bort
  });
});

describe("isRichTextEmpty + richTextToPlain", () => {
  it("tomt: undefined, null och dokument utan läsbar text", () => {
    assert.equal(isRichTextEmpty(undefined), true);
    assert.equal(isRichTextEmpty(null), true);
    assert.equal(isRichTextEmpty({ type: "doc", content: [{ type: "paragraph" }] }), true);
    assert.equal(isRichTextEmpty(simpleDoc), false);
  });

  it("ren text: rubriker, listor och marker utan syntax", () => {
    assert.equal(richTextToPlain(simpleDoc), "Detta ingår\n\n- Material\n- Bortforsling\n\nVi använder miljömärkt färg.");
  });
});

/* ------------------------------- Markdown -------------------------------- */

describe("markdownToRichText: deterministisk parser", () => {
  it("rubriker med klampning, stycken, hr", () => {
    const doc = markdownToRichText("# Rubrik 1\n\ntext\n\n#### För djup\n\n---")!;
    assert.deepEqual(doc.content[0], { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Rubrik 1" }] });
    assert.deepEqual(doc.content[1], { type: "paragraph", content: [{ type: "text", text: "text" }] });
    assert.deepEqual(doc.content[2], { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "För djup" }] });
    assert.deepEqual(doc.content[3], { type: "horizontalRule" });
  });

  it("punktlistor och numrerade listor, inklusive nästling", () => {
    const doc = markdownToRichText("- ett\n- två\n  - under\n\n1. första\n2. andra")!;
    const [ul, ol] = doc.content;
    assert.equal(ul.type, "bulletList");
    assert.equal(ol.type, "orderedList");
    if (ul.type !== "bulletList" || ol.type !== "orderedList") return;
    assert.equal(ul.content.length, 2);
    const second = ul.content[1];
    assert.equal(second.content.length, 2); // paragraph + nästlad lista
    assert.equal(second.content[1].type, "bulletList");
    assert.equal(ol.content.length, 2);
  });

  it("fet, kursiv, understruken, nästlade marker och länkar", () => {
    const doc = markdownToRichText("**fet** och *kursiv* och _kursiv2_ och ++under++ och **fet med *kursiv i*** och [länk](https://x.se)")!;
    const para = doc.content[0];
    assert.ok(para.type === "paragraph" && para.content);
    const byText = new Map(para.content.map((n) => (n.type === "text" ? [n.text, (n.marks ?? []).map((m) => m.type).sort()] : ["", []])));
    assert.deepEqual(byText.get("fet"), ["bold"]);
    assert.deepEqual(byText.get("kursiv"), ["italic"]);
    assert.deepEqual(byText.get("kursiv2"), ["italic"]);
    assert.deepEqual(byText.get("under"), ["underline"]);
    assert.deepEqual(byText.get("kursiv i"), ["bold", "italic"]);
    assert.deepEqual(byText.get("länk"), ["link"]);
  });

  it("underline-mark överlever sanering och markdown-rundresa", () => {
    const doc = sanitizeRichText({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "viktigt", marks: [{ type: "underline" }, { type: "unknown" }] }],
        },
      ],
    })!;
    assert.deepEqual(doc.content[0], {
      type: "paragraph",
      content: [{ type: "text", text: "viktigt", marks: [{ type: "underline" }] }],
    });
    const md = richTextToMarkdown(doc);
    assert.equal(md, "++viktigt++");
    assert.deepEqual(sanitizeRichText(markdownToRichText(md)), doc);
  });

  it("farliga länk-scheman blir bokstavlig text (ingen länkmark)", () => {
    const doc = markdownToRichText("[klick](javascript:alert(1))")!;
    const para = doc.content[0];
    assert.ok(para.type === "paragraph" && para.content);
    assert.ok(para.content.every((n) => n.type !== "text" || !(n.marks ?? []).some((m) => m.type === "link")));
  });

  it("HTML tolkas aldrig – taggar blir bokstavlig text", () => {
    const doc = markdownToRichText("<script>alert(1)</script> och <b>fet</b>")!;
    assert.equal(richTextToPlain(doc), "<script>alert(1)</script> och <b>fet</b>");
    const clean = sanitizeRichText(doc)!;
    assert.equal(richTextToPlain(clean), "<script>alert(1)</script> och <b>fet</b>");
  });

  it("enkel radbrytning i ett stycke blir hardBreak", () => {
    const doc = markdownToRichText("rad ett\nrad två")!;
    const para = doc.content[0];
    assert.ok(para.type === "paragraph" && para.content);
    assert.deepEqual(para.content[1], { type: "hardBreak" });
  });

  it("oavslutade markörer förblir bokstavlig text", () => {
    const doc = markdownToRichText("2 * 3 = 6 och a_b")!;
    assert.equal(richTextToPlain(doc), "2 * 3 = 6 och a_b");
  });

  it("tom sträng → undefined", () => {
    assert.equal(markdownToRichText(""), undefined);
  });
});

describe("markdown-rundresor", () => {
  it("doc → markdown → doc är identitet för sanerade dokument", () => {
    const md = richTextToMarkdown(simpleDoc);
    const back = sanitizeRichText(markdownToRichText(md));
    assert.deepEqual(back, simpleDoc);
  });

  it("markdown → doc → markdown är stabil (kanonisk form)", () => {
    const md = "## Detta ingår\n\n- Material\n- Bortforsling\n\nVi använder **miljömärkt** färg och [guide](https://exempel.se).";
    const doc = sanitizeRichText(markdownToRichText(md))!;
    const md2 = richTextToMarkdown(doc);
    assert.equal(md2, md);
    assert.deepEqual(sanitizeRichText(markdownToRichText(md2)), doc);
  });

  it("markdown → doc → ren text", () => {
    const doc = markdownToRichText("# Info\n\n- punkt ett\n\n1. steg ett")!;
    assert.equal(richTextToPlain(doc), "Info\n\n- punkt ett\n\n1. steg ett");
  });

  it("escapade specialtecken överlever rundresan", () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "pris: 2 * 3 [kr] _netto_" }] }],
    };
    const md = richTextToMarkdown(doc); // * [ ] _ escapas
    const back = sanitizeRichText(markdownToRichText(md));
    assert.deepEqual(back, doc);
  });
});

/* --------------------------------- Hash ---------------------------------- */

function baseVersion(): QuoteVersion {
  return {
    id: "v1",
    quoteId: "q1",
    version: 1,
    title: "Altan",
    intro: "Bygge av altan",
    lines: [{ id: "l1", kind: "arbete", description: "Snickeri", qty: 10, unit: "tim", unitPrice: 700, vatRate: 25 }],
    rot: null,
    paymentPlan: [{ label: "Allt vid klart", percent: 100 }],
    paymentTermsDays: 30,
    validUntil: "2026-09-30",
    terms: "Villkor.",
    createdAt: "2026-08-01T10:00:00.000Z",
  };
}

/** Vänd nyckelordningen rekursivt – simulerar jsonb-rundresa (Postgres sorterar om). */
function reorderKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeysDeep);
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort().reverse()) out[key] = reorderKeysDeep(rec[key]);
    return out;
  }
  return value;
}

describe("quoteVersionHash med rik text", () => {
  it("version UTAN rik text behåller sitt historiska hash", () => {
    const v = baseVersion();
    const historical = quoteVersionHash(v);
    // richText: undefined är exakt samma hashyta som att fältet inte finns.
    assert.equal(quoteVersionHash({ ...v, richText: undefined }), historical);
  });

  it("version MED rik text får ett annat hash", () => {
    const v = baseVersion();
    assert.notEqual(quoteVersionHash({ ...v, richText: simpleDoc }), quoteVersionHash(v));
  });

  it("hashen är oberoende av jsonb-nyckelordning (kanonisk form)", () => {
    const withDoc = { ...baseVersion(), richText: simpleDoc };
    const reordered = { ...baseVersion(), richText: reorderKeysDeep(simpleDoc) as RichTextDoc };
    assert.equal(quoteVersionHash(withDoc), quoteVersionHash(reordered));
  });
});

/* ------------------------- Domänflöden + snapshot ------------------------- */

describe("offert: rik text genom tjänstelagret", () => {
  beforeEach(() => replaceDb(emptyTestDb()));

  it("createQuote sanerar och lagrar; updateQuote ersätter/rensar", () => {
    const quote = createQuote({
      customerId: "cust-1",
      title: "Altan",
      lines: [labor({})],
      rot: null,
      paymentPlan: [{ label: "Allt", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2099-01-01",
      terms: "Villkor",
      richText: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Bra", marks: [{ type: "link", attrs: { href: "javascript:x" } }] }] },
          { type: "unknownBlock" },
        ],
      } as unknown as RichTextDoc,
    });
    const version = currentVersion(quote);
    assert.deepEqual(version.richText, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Bra" }] }] });

    updateQuote(quote.id, {
      title: "Altan",
      lines: [labor({})],
      rot: null,
      paymentPlan: [{ label: "Allt", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2099-01-01",
      terms: "Villkor",
      richText: undefined,
    });
    assert.equal(currentVersion(db().quotes[0]).richText, undefined);
  });
});

describe("faktura: snapshot-oföränderlighet", () => {
  beforeEach(() => replaceDb(emptyTestDb()));

  it("utfärdad faktura renderar frusen rik text även om live-fältet muteras", () => {
    const draft = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 10_000 })],
      rot: null,
      richText: simpleDoc,
    });
    assert.deepEqual(draft.richText, simpleDoc);

    const issued = issueInvoice(draft.id);
    assert.deepEqual(issued.issuedSnapshot?.richText, simpleDoc, "snapshoten bär den frusna kopian");

    // Simulerad bugg/otillåten mutation av live-fältet efter utfärdande.
    issued.richText = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "MANIPULERAD" }] }],
    };

    const view = resolveInvoiceView(issued, { seller: db().settings, buyer: db().customers[0] });
    assert.deepEqual(view.invoice.richText, simpleDoc, "dokumentvyn läser alltid snapshoten");
    assert.ok(!richTextToPlain(view.invoice.richText).includes("MANIPULERAD"));
  });

  it("utkast: updateInvoice sanerar och kan rensa fältet", () => {
    const draft = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({})], rot: null });
    updateInvoice(draft.id, { lines: draft.lines, rot: null, richText: simpleDoc });
    assert.deepEqual(db().invoices[0].richText, simpleDoc);
    updateInvoice(draft.id, { lines: draft.lines, rot: null, richText: undefined });
    assert.equal(db().invoices[0].richText, undefined);
  });

  it("faktura utan rik text: snapshoten saknar fältet helt (värde-exakta äldre snapshots)", () => {
    const draft = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({})], rot: null });
    const issued = issueInvoice(draft.id);
    assert.ok(issued.issuedSnapshot);
    assert.ok(!("richText" in issued.issuedSnapshot));
  });
});

/* ------------------------------ AI-förbättring ---------------------------- */

type TransportStep = { status: number; body: string } | { content: string };

function scriptImproveTransport(steps: TransportStep[]) {
  const bodies: string[] = [];
  let calls = 0;
  __setAiTransportForTests(async (_url, init) => {
    bodies.push(String(init.body));
    const step = steps[calls] ?? { content: "SLUT" };
    calls += 1;
    if ("status" in step) return new Response(step.body, { status: step.status });
    return new Response(
      JSON.stringify({
        model: "google/gemini-3.7-flash",
        choices: [{ message: { content: step.content } }],
        usage: { prompt_tokens: 50, completion_tokens: 30 },
      }),
      { status: 200 }
    );
  });
  return { bodies, count: () => calls };
}

function configureAi() {
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-nyckel-anvands-aldrig-transporten-ar-mockad";
}

describe("richtext-shortcuts", () => {
  const mac = { metaKey: true, ctrlKey: false, altKey: false, isComposing: false };
  const win = { metaKey: false, ctrlKey: true, altKey: false, isComposing: false };

  it("Cmd/Ctrl+B/I/U och ångra/gör om, även när Shift ger versalt Z", () => {
    assert.equal(shortcutFromEvent({ ...mac, key: "b", shiftKey: false }), "bold");
    assert.equal(shortcutFromEvent({ ...mac, key: "i", shiftKey: false }), "italic");
    assert.equal(shortcutFromEvent({ ...mac, key: "u", shiftKey: false }), "underline");
    assert.equal(shortcutFromEvent({ ...mac, key: "z", shiftKey: false }), "undo");
    assert.equal(shortcutFromEvent({ ...mac, key: "Z", shiftKey: true }), "redo");
    assert.equal(shortcutFromEvent({ ...win, key: "z", shiftKey: false }), "undo");
    assert.equal(shortcutFromEvent({ ...win, key: "y", shiftKey: false }), "redo");
    assert.equal(shortcutFromEvent({ ...win, key: "Z", shiftKey: true }), "redo");
    assert.equal(shortcutFromEvent({ ...mac, key: "z", shiftKey: false, altKey: true }), null);
    assert.equal(shortcutFromEvent({ key: "z", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }), null);
  });

  it("använder synlig DOM-markering när ProseMirror-selection fortfarande är tom", () => {
    const start = { nodeType: 3 } as Node;
    const end = start;
    assert.deepEqual(
      markRangeFromDomFallback({
        empty: false,
        from: 2,
        to: 6,
        posAtDOM: () => 0,
        contains: () => true,
        domSelection: null,
      }),
      { from: 2, to: 6 }
    );
    assert.deepEqual(
      markRangeFromDomFallback({
        empty: true,
        from: 8,
        to: 8,
        posAtDOM: (_node, offset) => 1 + offset,
        contains: () => true,
        domSelection: {
          isCollapsed: false,
          rangeCount: 1,
          getRangeAt: () => ({ startContainer: start, startOffset: 0, endContainer: end, endOffset: 7 }),
        },
      }),
      { from: 1, to: 8 }
    );
    assert.equal(
      markRangeFromDomFallback({
        empty: true,
        from: 8,
        to: 8,
        posAtDOM: () => 8,
        contains: () => true,
        domSelection: { isCollapsed: true, rangeCount: 1, getRangeAt: () => ({ startContainer: start, startOffset: 0, endContainer: end, endOffset: 0 }) },
      }),
      null
    );
  });
});

/* -------------------- Avdelare lämnar listor på toppnivå ------------------- */

const dividerSchema = getSchema([
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    strike: false,
    heading: { levels: [1, 2, 3] },
    horizontalRule: false,
  }),
  rootHorizontalRule,
]);

function listItems(...texts: string[]) {
  return texts.map((text) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  }));
}

function findTextEnd(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) {
      found = pos + (node.text.indexOf(text) + text.length);
      return false;
    }
  });
  if (found < 0) throw new Error(`Saknar text: ${text}`);
  return found;
}

function runDivider(docJson: object, cursor: number | { text: string } | { afterList: true }) {
  const doc = dividerSchema.nodeFromJSON(docJson);
  const pos =
    typeof cursor === "number"
      ? cursor
      : "text" in cursor
        ? findTextEnd(doc, cursor.text)
        : (() => {
            let after = -1;
            doc.forEach((node, offset) => {
              if (after < 0 && (node.type.name === "bulletList" || node.type.name === "orderedList")) {
                after = offset + node.nodeSize;
              }
            });
            if (after < 0) throw new Error("Saknar lista");
            return after + 1; // in i följande toppnivåstycke
          })();
  const state = EditorState.create({
    schema: dividerSchema,
    doc,
    selection: TextSelection.create(doc, pos),
  });
  let next = state;
  const ok = applyInsertDividerAtRoot(state, (tr) => {
    next = state.apply(tr);
  });
  assert.equal(ok, true, "avdelarkommandot ska lyckas");
  return next;
}

function topTypes(json: { content?: { type: string }[] }): string[] {
  return (json.content ?? []).map((n) => n.type);
}

function assertRootDividerThenParagraph(
  state: EditorState,
  listType: "bulletList" | "orderedList" | "paragraph" | "heading"
) {
  const json = state.doc.toJSON() as { content: { type: string }[] };
  const types = topTypes(json);
  assert.equal(types[0], listType);
  assert.ok(types.includes("horizontalRule"), `förväntade hr bland ${types.join(",")}`);
  const hrAt = types.indexOf("horizontalRule");
  assert.equal(types[hrAt + 1], "paragraph", "stycket efter avdelaren ska vara syskon på toppnivå");
  assert.equal(state.selection.$from.parent.type.name, "paragraph");
  assert.equal(state.selection.$from.depth, 1, "markören ska stå i ett toppnivåstycke, inte i en lista");

  const typed = state.apply(state.tr.insertText("Vanlig text börjar här"));
  const saved = sanitizeRichText(typed.doc.toJSON())!;
  const savedTypes = saved.content.map((b) => b.type);
  const savedHr = savedTypes.indexOf("horizontalRule");
  assert.ok(savedHr >= 0, "hr ska överleva sanering (inte ligga inuti listItem där den kastas)");
  assert.equal(savedTypes[savedHr + 1], "paragraph");
  const after = saved.content[savedHr + 1];
  assert.ok(after.type === "paragraph" && after.content?.some((n) => n.type === "text" && n.text === "Vanlig text börjar här"));

  const reloaded = sanitizeRichText(markdownToRichText(richTextToMarkdown(saved)));
  assert.ok(reloaded);
  const reloadTypes = reloaded.content.map((b) => b.type);
  const reloadHr = reloadTypes.indexOf("horizontalRule");
  assert.equal(reloadTypes[reloadHr + 1], "paragraph");
  assert.notEqual(reloadTypes[0], "horizontalRule");
}

describe("avdelare lämnar listkontext (dokumentstruktur)", () => {
  const bullets = {
    type: "doc",
    content: [{ type: "bulletList", content: listItems("Arbete", "Städning", "Iordningställande efteråt") }],
  };
  const numbered = {
    type: "doc",
    content: [{ type: "orderedList", content: listItems("Ett", "Två", "Tre") }],
  };

  it("punktlista → avdelare → följande stycke är toppnivå (syskon till lista och hr)", () => {
    const next = runDivider(bullets, { text: "Iordningställande efteråt" });
    assertRootDividerThenParagraph(next, "bulletList");
    const list = next.doc.firstChild!;
    assert.equal(list.type.name, "bulletList");
    assert.equal(list.childCount, 3, "listpunkterna ska vara kvar – inte lyftas ut");
    list.descendants((node) => {
      assert.notEqual(node.type.name, "horizontalRule", "hr får inte nästlas i listan");
    });
  });

  it("numrerad lista → avdelare → följande stycke är toppnivå", () => {
    const next = runDivider(numbered, { text: "Tre" });
    assertRootDividerThenParagraph(next, "orderedList");
    const list = next.doc.firstChild!;
    assert.equal(list.childCount, 3);
    list.descendants((node) => {
      assert.notEqual(node.type.name, "horizontalRule");
    });
  });

  it("stycke → avdelare → text är fortfarande korrekt (ingen regression)", () => {
    const next = runDivider(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ingress" }] }] },
      { text: "Ingress" }
    );
    assertRootDividerThenParagraph(next, "paragraph");
  });

  it("H1/H2/H3 → avdelare → text är fortfarande korrekt", () => {
    for (const level of [1, 2, 3] as const) {
      const next = runDivider(
        {
          type: "doc",
          content: [{ type: "heading", attrs: { level }, content: [{ type: "text", text: `Rubrik ${level}` }] }],
        },
        { text: `Rubrik ${level}` }
      );
      assertRootDividerThenParagraph(next, "heading");
    }
  });

  it("avdelare från sista listpunkten (verktygsraden) lämnar listan helt", () => {
    const next = runDivider(bullets, { text: "Iordningställande efteråt" });
    assert.deepEqual(topTypes(next.doc.toJSON()), ["bulletList", "horizontalRule", "paragraph"]);
    assert.equal(next.selection.$from.depth, 1);
  });

  it("avdelare precis efter sista listpunkten ger toppnivå-hr och -stycke", () => {
    const afterList = {
      type: "doc",
      content: [
        { type: "bulletList", content: listItems("Arbete", "Städning", "Iordningställande efteråt") },
        { type: "paragraph" },
      ],
    };
    const next = runDivider(afterList, { afterList: true });
    const types = topTypes(next.doc.toJSON());
    assert.equal(types[0], "bulletList");
    assert.ok(types.includes("horizontalRule"));
    const hrAt = types.indexOf("horizontalRule");
    assert.equal(types[hrAt + 1], "paragraph");
    assert.equal(next.selection.$from.depth, 1);
    assert.equal(next.selection.$from.parent.type.name, "paragraph");

    const typed = next.apply(next.tr.insertText("Vanlig text börjar här"));
    const saved = sanitizeRichText(typed.doc.toJSON())!;
    const savedTypes = saved.content.map((b) => b.type);
    const savedHr = savedTypes.indexOf("horizontalRule");
    assert.equal(savedTypes[savedHr + 1], "paragraph");
    const reloaded = sanitizeRichText(markdownToRichText(richTextToMarkdown(saved)))!;
    const reloadTypes = reloaded.content.map((b) => b.type);
    assert.equal(reloadTypes[reloadTypes.indexOf("horizontalRule") + 1], "paragraph");
  });
});

describe("improveRichText (mockad transport)", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb());
    configureAi();
    __setAiTransportForTests(null);
  });

  it("markdown-svar → parsat + sanerat dokument; anropet har varken verktyg eller affärsdata", async () => {
    const t = scriptImproveTransport([
      { content: "## Detta ingår\n\n- Material och bortforsling\n- **Städning** efter avslutat arbete" },
    ]);
    const result = await improveRichText({ actionId: "forbattra", doc: simpleDoc });
    assert.ok(result.ok, "förslaget ska lyckas");
    if (!result.ok) return;
    assert.deepEqual(result.doc.content[0], {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Detta ingår" }],
    });
    const list = result.doc.content[1];
    assert.equal(list.type, "bulletList");

    // HTTP-kroppen: inga verktyg, ingen tool_choice, bara system + user.
    assert.equal(t.count(), 1);
    const body = JSON.parse(t.bodies[0]) as Record<string, unknown>;
    assert.ok(!("tools" in body), "tools ska utelämnas helt");
    assert.ok(!("tool_choice" in body), "tool_choice ska utelämnas helt");
    const messages = body.messages as { role: string; content: string }[];
    assert.deepEqual(messages.map((m) => m.role), ["system", "user"]);
    // Endast fältets egen text – ingen kund-/affärsdata från databasen.
    assert.ok(messages[1].content.includes("Detta ingår"));
    assert.ok(!t.bodies[0].includes("Anna Andersson"), "kundregistret får aldrig läcka in");
    assert.ok(messages[0].content.includes("Förbättra endast språk och struktur. Lägg inte till nya fakta eller åtaganden."));

    // Lätt användningslogg skrevs.
    assert.ok(db().assistantAudit.some((e) => e.tool === "llm_richtext_improve" && e.success));
  });

  it("HTML-svar från modellen blir bokstavlig text – aldrig markup", async () => {
    scriptImproveTransport([{ content: '<b onclick="x()">Viktigt</b> meddelande' }]);
    const result = await improveRichText({ actionId: "ratta", doc: simpleDoc });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(richTextToPlain(result.doc), '<b onclick="x()">Viktigt</b> meddelande');
  });

  it("kodstaket runt svaret städas deterministiskt", async () => {
    scriptImproveTransport([{ content: "```markdown\n## Rubrik\n\ntext\n```" }]);
    const result = await improveRichText({ actionId: "tydligare", doc: simpleDoc });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.doc.content[0].type, "heading");
  });

  it("okonfigurerad leverantör → ärligt fel, inget nätverksanrop", async () => {
    process.env.AI_PROVIDER = "none";
    const t = scriptImproveTransport([{ content: "ska aldrig nås" }]);
    const result = await improveRichText({ actionId: "forbattra", doc: simpleDoc });
    assert.deepEqual(result, { ok: false, error: RICHTEXT_AI_NOT_CONFIGURED });
    assert.equal(t.count(), 0);
  });

  it("transportfel → ärligt fel, aldrig ett fejkat förslag", async () => {
    scriptImproveTransport([{ status: 500, body: "internt fel" }]);
    const result = await improveRichText({ actionId: "kortare", doc: simpleDoc });
    assert.deepEqual(result, { ok: false, error: RICHTEXT_AI_FAILED });
    assert.ok(db().assistantAudit.some((e) => e.tool === "llm_richtext_improve" && !e.success));
  });

  it("tomt fält → begripligt fel utan anrop", async () => {
    const t = scriptImproveTransport([{ content: "nås ej" }]);
    const result = await improveRichText({ actionId: "forbattra", doc: undefined });
    assert.equal(result.ok, false);
    assert.equal(t.count(), 0);
  });
});

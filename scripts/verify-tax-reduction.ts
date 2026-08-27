process.env.DRIVA_TEST = "1";

import { db, replaceDb } from "../src/lib/store";
import { buildSeed } from "../src/lib/seed";
import { quoteVersionHash } from "../src/lib/hash";
import { currentVersion } from "../src/lib/services/data";
import { createQuote, STANDARD_TERMS, updateQuote, quoteDefaults, type QuoteInput } from "../src/lib/services/quotes";
import {
  createDeniedReductionInvoice,
  createInvoice,
  issueInvoice,
} from "../src/lib/services/invoices";
import { finalizeApproval } from "../src/lib/services/bankid";
import { createQuoteDraft } from "../src/lib/ai/domain";
import { executeTool } from "../src/lib/ai/tools";
import { dispatchRules } from "../src/lib/services/assistant";
import { getTaxReductionTerms, snapshotTaxReductionTerms } from "../src/lib/tax-reduction-terms";
import type { DocLine } from "../src/lib/types";

type Check = { name: string; ok: boolean; detail: string };

function assert(name: string, ok: boolean, detail: string): Check {
  return { name, ok, detail };
}

function reset() {
  replaceDb(buildSeed());
}

const labor: DocLine = {
  id: "line-test-arbete",
  kind: "arbete",
  description: "Snickeri",
  qty: 10,
  unit: "tim",
  unitPrice: 500,
  vatRate: 25,
};

function baseInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  const defaults = quoteDefaults();
  return {
    customerId: "cust-anna",
    title: "Testoffert",
    intro: "Test",
    lines: [labor],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: STANDARD_TERMS,
    ...overrides,
  };
}

async function run(): Promise<Check[]> {
  const checks: Check[] = [];

  reset();
  {
    const q = createQuote(baseInput({ rot: { type: "rot" } }));
    const v = currentVersion(q);
    const expected = getTaxReductionTerms("rot");
    const ok =
      v.rot?.type === "rot" &&
      v.taxReductionTerms?.version === expected.version &&
      v.taxReductionTerms?.text === expected.text &&
      v.terms === STANDARD_TERMS &&
      !v.terms.includes("Skatteverket");
    checks.push(assert("ROT auto-adds disclaimer", ok, `version=${v.taxReductionTerms?.version} termsSeparate=${v.terms === STANDARD_TERMS}`));
  }

  reset();
  {
    const q = createQuote(baseInput({ rot: { type: "rut" } }));
    const v = currentVersion(q);
    const expected = getTaxReductionTerms("rut");
    const ok = v.rot?.type === "rut" && v.taxReductionTerms?.text === expected.text && v.terms === STANDARD_TERMS;
    checks.push(assert("RUT auto-adds disclaimer", ok, `type=${v.taxReductionTerms?.type}`));
  }

  reset();
  {
    const manual = "Egna villkor om materialval.";
    const q = createQuote(baseInput({ rot: { type: "rot" }, terms: manual }));
    const created = currentVersion(q);
    updateQuote(q.id, {
      title: created.title,
      intro: created.intro,
      lines: created.lines,
      rot: null,
      paymentPlan: created.paymentPlan,
      paymentTermsDays: created.paymentTermsDays,
      lateInterestRate: created.lateInterestRate,
      validUntil: created.validUntil,
      terms: manual,
    });
    const v = currentVersion(q);
    const ok = v.rot == null && v.taxReductionTerms == null && v.terms === manual;
    checks.push(assert("Clause removed when ROT turned off, manual terms kept", ok, `rot=${String(v.rot)} terms=${v.terms}`));
  }

  reset();
  {
    const locked = db().quoteVersions.find((v) => v.id === "quote-nord1-v1");
    const ok = Boolean(locked?.contentHash) && quoteVersionHash(locked!) === locked!.contentHash;
    checks.push(assert("Existing signed quotes hash unchanged without taxReductionTerms", ok, `hash=${locked?.contentHash?.slice(0, 12)}`));
  }

  reset();
  {
    const q = createQuote(baseInput({ rot: { type: "rot" } }));
    const v = currentVersion(q);
    const withTerms = quoteVersionHash(v);
    const stripped = { ...v, taxReductionTerms: undefined };
    const without = quoteVersionHash(stripped);
    const ok = withTerms !== without && withTerms.length === 64;
    checks.push(assert("Hash includes tax reduction terms for new ROT quotes", ok, `with=${withTerms.slice(0, 12)} without=${without.slice(0, 12)}`));
  }

  reset();
  {
    const inv = createInvoice({
      customerId: "cust-anna",
      type: "faktura",
      lines: [labor],
      rot: { type: "rot" },
    });
    const hasClause = Boolean(inv.taxReductionTerms);
    checks.push(
      assert(
        "Manual ROT invoice without signed quote still gets disclaimer",
        hasClause && inv.rot?.type === "rot",
        `snapshot=${inv.taxReductionTerms?.version}`
      )
    );
  }

  reset();
  {
    const q = createQuote(baseInput({ rot: { type: "rot" } }));
    const version = currentVersion(q);
    finalizeApproval({
      orderRef: "test-rot",
      quoteId: q.id,
      quoteVersionId: version.id,
      status: "complete",
      hintCode: "complete",
      method: "qr",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const signed = currentVersion(q);
    const inv = createInvoice({
      customerId: "cust-anna",
      quoteId: q.id,
      type: "faktura",
      lines: [labor],
      rot: { type: "rot" },
    });
    const ok =
      Boolean(signed.lockedAt) &&
      signed.contentHash === quoteVersionHash(signed) &&
      inv.taxReductionTerms?.text === signed.taxReductionTerms?.text;
    checks.push(assert("Signed ROT quote copies locked terms onto invoice", ok, `locked=${Boolean(signed.lockedAt)}`));
  }

  reset();
  {
    const viaService = createQuote(baseInput({ rot: { type: "rot" } }));
    const viaAi = createQuoteDraft({ customerId: "cust-anna", title: "ROT-arbete", amountInclVat: 10000, rot: "rot" });
    const q = db().quotes.find((x) => x.id === (viaAi.forModel.quoteId as string))!;
    const v = currentVersion(q);
    const expected = snapshotTaxReductionTerms("rot");
    const ok =
      v.terms === STANDARD_TERMS &&
      v.taxReductionTerms?.text === expected.text &&
      currentVersion(viaService).taxReductionTerms?.text === expected.text;
    checks.push(assert("Quote service is the single writer of the clause", ok, `aiTermsLen=${v.terms.length} clauseVersion=${v.taxReductionTerms?.version}`));
  }

  reset();
  {
    await executeTool("create_quote", {
      customerId: "cust-anna",
      title: "Garderob",
      amountInclVat: 20000,
      taxReduction: "rot",
    });
    const q = db().quotes[db().quotes.length - 1];
    const v = currentVersion(q);
    const ok = v.rot?.type === "rot" && v.taxReductionTerms?.version === "v1" && v.terms === STANDARD_TERMS;
    checks.push(assert("AI tool cannot bypass clause (calls quote service)", ok, `rot=${v.rot?.type} termsHasSkatteverket=${v.terms.includes("Skatteverket")}`));
  }

  reset();
  {
    dispatchRules("Skapa en ROT-offert till Anna");
    const q = db().quotes[db().quotes.length - 1];
    const v = currentVersion(q);
    const ok = q.customerId === "cust-anna" && v.rot?.type === "rot" && Boolean(v.taxReductionTerms) && v.terms === STANDARD_TERMS;
    checks.push(assert("Rule-based ROT-offert uses central clause", ok, `rot=${v.rot?.type} status=${q.status}`));
  }

  reset();
  {
    const inv = createInvoice({
      customerId: "cust-anna",
      type: "faktura",
      lines: [labor],
      rot: { type: "rot" },
    });
    issueInvoice(inv.id);
    const deduction = 1875; // 10*500*1.25 * 0.3 = 1875
    const draft = createDeniedReductionInvoice(inv.id, 500);
    const ok =
      draft.status === "utkast" &&
      draft.rot == null &&
      draft.taxReductionTerms == null &&
      draft.lines[0].description.includes("Skatteverket") &&
      deduction === 1875;
    checks.push(assert("Denied-reduction creates remainder draft invoice", ok, `toPay line=${draft.lines[0].unitPrice} rot=${String(draft.rot)}`));
  }

  return checks;
}

void (async () => {
  const checks = await run();
  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? "ok" : "FAIL";
    if (!c.ok) failed += 1;
    console.log(`${mark}  ${c.name}  — ${c.detail}`);
  }
  if (failed > 0) {
    console.error(`\n${failed} tester misslyckades.`);
    process.exit(1);
  }
  console.log(`\n${checks.length} tester godkända.`);
})();

process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { db, replaceDb } from "../store";
import { consultantApprovedScope, emptyTestDb, testCompany } from "../invoices/test-db";
import { setTestActor } from "../collaboration/actor";
import { can } from "../collaboration/permissions";
import {
  SUPPORT_MATRIX,
  SUPPORT_MATRIX_VERSION,
  entriesAtLevel,
  entryEffectiveOn,
  supportEntry,
  worstLevel,
} from "./matrix";
import {
  SCOPE_QUESTIONS,
  assessEligibility,
  businessEligibility,
  entryStatusFor,
  newBusinessScope,
  normalizeBusinessScope,
  parseScopeFlags,
  pendingConsultantEntries,
} from "./eligibility";
import { ScopeBlockedError, assertCompanyFormSupported, assertEligibleToCreate, assertScopeAllowed } from "./guard";
import { approveScopeEntry, revokeScopeApproval, updateScopeFlags } from "../services/scope";
import { validateOnboardingFields, type OnboardingValues } from "../onboarding";
import { updateBusinessProfile } from "../services/settings";

/* ------------------------------ matrisen själv ------------------------------ */

describe("supportmatrisen – form och spårbarhet", () => {
  it("har en version, unika id:n och alla obligatoriska fält per post", () => {
    assert.match(SUPPORT_MATRIX_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
    const ids = new Set<string>();
    for (const e of SUPPORT_MATRIX) {
      assert.equal(ids.has(e.id), false, `dubblett: ${e.id}`);
      ids.add(e.id);
      assert.ok(e.label.trim().length >= 2, `${e.id}: label`);
      assert.ok(e.summary.trim().length > 20, `${e.id}: summary`);
      assert.ok(e.enforcement.trim().length > 20, `${e.id}: enforcement`);
      assert.ok(e.source.trim().length > 10, `${e.id}: primärkälla saknas`);
      assert.match(e.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/, `${e.id}: effectiveFrom`);
      assert.ok(e.owner.trim().length > 3, `${e.id}: ägare saknas`);
      assert.ok(e.tests.length > 0, `${e.id}: testmatris saknas`);
    }
  });

  it("pekar bara på testfiler som finns – ingen regel utan test", () => {
    for (const e of SUPPORT_MATRIX) {
      for (const t of e.tests) {
        assert.ok(existsSync(path.join(process.cwd(), t)), `${e.id} → ${t} finns inte`);
      }
    }
  });

  it("låser spec §10: stött, konsult och ej stött ligger på rätt nivå", () => {
    const level = (id: Parameters<typeof supportEntry>[0]) => supportEntry(id).level;
    assert.equal(level("company_ab"), "supported");
    assert.equal(level("framework_k2"), "supported");
    assert.equal(level("market_sweden_sek"), "supported");
    assert.equal(level("invoicing_domestic_vat"), "supported");
    assert.equal(level("rot_rut"), "supported");
    assert.equal(level("payroll_fixed_monthly"), "supported");
    assert.equal(level("bookkeeping_core"), "supported");
    assert.equal(level("filing_manual"), "supported");

    assert.equal(level("company_enskild"), "consultant");
    assert.equal(level("reverse_charge_construction_outgoing"), "consultant");

    for (const id of [
      "company_other",
      "group_company",
      "framework_k3",
      "foreign_currency",
      "eu_sales_export",
      "margin_scheme",
      "inventory_manufacturing",
      "complex_equity_events",
      "payroll_complex",
      "year_end_other",
      "e_invoice_peppol",
      "filing_electronic",
    ] as const) {
      assert.equal(level(id), "unsupported", id);
    }
    assert.equal(entriesAtLevel("consultant").length, 2);
  });

  it("strängaste nivån vinner och giltighetsdatum respekteras", () => {
    assert.equal(worstLevel(["supported", "consultant"]), "consultant");
    assert.equal(worstLevel(["consultant", "unsupported", "supported"]), "unsupported");
    assert.equal(worstLevel([]), "supported");
    const e = supportEntry("company_ab");
    assert.equal(entryEffectiveOn(e, "2026-09-13"), true);
    assert.equal(entryEffectiveOn(e, "2020-01-01"), false);
    assert.equal(entryEffectiveOn({ ...e, effectiveTo: "2026-12-31" }, "2027-01-01"), false);
  });

  it("varje onboardingfråga pekar på befintliga poster med nivå konsult eller ej stött", () => {
    for (const q of SCOPE_QUESTIONS) {
      assert.ok(q.entryIds.length > 0, q.flag);
      for (const id of q.entryIds) assert.notEqual(supportEntry(id).level, "supported", `${q.flag} → ${id}`);
    }
  });
});

/* --------------------------------- eligibility -------------------------------- */

describe("eligibility – onboardingens besked", () => {
  it("ett vanligt AB utan markeringar passar", () => {
    const e = assessEligibility({ companyForm: "ab", flags: [] });
    assert.equal(e.verdict, "supported");
    assert.deepEqual(e.blocking, []);
    assert.deepEqual(e.consultant, []);
    assert.equal(e.matrixVersion, SUPPORT_MATRIX_VERSION);
  });

  it("enskild firma och omvänd byggmoms är konsultfall, inte hinder", () => {
    const e = assessEligibility({ companyForm: "enskild", flags: ["reverse_charge"] });
    assert.equal(e.verdict, "consultant");
    assert.deepEqual(
      e.consultant.map((x) => x.id),
      ["company_enskild", "reverse_charge_construction_outgoing"],
    );
    assert.deepEqual(e.blocking, []);
  });

  it("utland/valuta, lager, K3/koncern och komplex lön stoppar bolaget", () => {
    for (const flag of ["foreign", "inventory", "k3_group", "complex_payroll"] as const) {
      const e = assessEligibility({ companyForm: "ab", flags: [flag] });
      assert.equal(e.verdict, "unsupported", flag);
      assert.ok(e.blocking.length >= 1, flag);
    }
    // Annan företagsform är ett hinder i sig.
    assert.equal(assessEligibility({ companyForm: "annan", flags: [] }).verdict, "unsupported");
    // Obesvarad form är formulärets fel, inte matrisens.
    assert.equal(assessEligibility({ companyForm: "", flags: [] }).verdict, "supported");
  });

  it("parseScopeFlags kastar skräp och dubbletter men behåller frågeordningen", () => {
    assert.deepEqual(parseScopeFlags(["reverse_charge", "foo", "foreign", "reverse_charge", 3, null]), [
      "foreign",
      "reverse_charge",
    ]);
  });

  it("normalizeBusinessScope läser tolerant och släpper trasiga godkännanden", () => {
    assert.equal(normalizeBusinessScope(null), undefined);
    assert.equal(normalizeBusinessScope("x"), undefined);
    const scope = normalizeBusinessScope({
      matrixVersion: "2026-01-01.1",
      assessedAt: "2026-01-01T00:00:00.000Z",
      flags: ["inventory", "nonsense"],
      approvals: [
        { entryId: "reverse_charge_construction_outgoing", approvedAt: "2026-02-01T00:00:00.000Z", approvedBy: { userId: "u1", name: "K" } },
        { entryId: "not_an_entry", approvedAt: "x", approvedBy: { userId: "u1" } },
        { entryId: "company_enskild", approvedBy: { userId: "u1" } },
        "garbage",
      ],
    });
    assert.ok(scope);
    assert.deepEqual(scope.flags, ["inventory"]);
    assert.equal(scope.approvals.length, 1);
    assert.equal(scope.approvals[0].entryId, "reverse_charge_construction_outgoing");
    assert.equal(scope.approvals[0].approvedBy.email, "");
  });

  it("status per post: godkänt konsultfall räknas som tillåtet, ogodkänt inte", () => {
    const plain = testCompany();
    assert.equal(entryStatusFor(plain, "company_ab"), "supported");
    assert.equal(entryStatusFor(plain, "foreign_currency"), "unsupported");
    assert.equal(entryStatusFor(plain, "reverse_charge_construction_outgoing"), "consultant");
    const approved = testCompany({ scope: consultantApprovedScope("reverse_charge_construction_outgoing") });
    assert.equal(entryStatusFor(approved, "reverse_charge_construction_outgoing"), "approved");
    // Bolag från före matrisen: bedöms bara på formen.
    assert.equal(businessEligibility({ companyForm: undefined, scope: undefined }).verdict, "supported");
    assert.equal(businessEligibility({ companyForm: "enskild", scope: undefined }).verdict, "consultant");
    assert.deepEqual(
      pendingConsultantEntries(testCompany({ companyForm: "enskild", scope: newBusinessScope(["reverse_charge"]) })).map((e) => e.id),
      ["company_enskild", "reverse_charge_construction_outgoing"],
    );
  });
});

/* ------------------------------- servervakterna ------------------------------- */

describe("servervakter – blockerar även när UI kringgås", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ settings: testCompany() }));
    setTestActor(null);
  });
  afterEach(() => setTestActor(null));

  it("företagsform: aktiebolag och enskild firma släpps, allt annat kastar", () => {
    assert.doesNotThrow(() => assertCompanyFormSupported("ab"));
    assert.doesNotThrow(() => assertCompanyFormSupported("enskild"));
    assert.throws(() => assertCompanyFormSupported("hb"), ScopeBlockedError);
    assert.throws(() => assertCompanyFormSupported(""), /stöds inte/);
  });

  it("onboarding: servern avvisar ej stödda svar med matrisens ord", () => {
    assert.doesNotThrow(() => assertEligibleToCreate({ companyForm: "ab", flags: [] }));
    assert.doesNotThrow(() => assertEligibleToCreate({ companyForm: "enskild", flags: ["reverse_charge"] }));
    assert.throws(() => assertEligibleToCreate({ companyForm: "ab", flags: ["foreign"] }), (e: unknown) => {
      assert.ok(e instanceof ScopeBlockedError);
      assert.match(e.message, /stöder inte företaget ännu/);
      assert.match(e.message, /utanför sverige/i);
      return true;
    });
    assert.throws(() => assertEligibleToCreate({ companyForm: "ab", flags: ["inventory"] }), /Lager och tillverkning stöds inte/);
  });

  it("onboardingens fältvalidering ger ett scope-fel på ej stödda svar och sparar flaggorna annars", () => {
    const values: OnboardingValues = {
      name: "Söders Snickeri AB",
      companyForm: "ab",
      scopeFlags: ["reverse_charge", "junk"],
      orgNumber: "5591234567",
      vatNumber: "",
      paymentTiming: "later",
      address: "Renstiernas gata 12",
      postalCode: "11624",
      city: "Stockholm",
      paymentMethod: "",
      bankgiro: "",
      plusgiro: "",
      bankAccount: "",
      email: "info@soders.se",
      phone: "",
    };
    const ok = validateOnboardingFields(values);
    assert.equal(ok.fieldErrors.scope, undefined);
    assert.deepEqual(ok.values.scopeFlags, ["reverse_charge"]);

    const blocked = validateOnboardingFields({ ...values, scopeFlags: ["k3_group"] });
    assert.match(blocked.fieldErrors.scope ?? "", /stöder inte företaget ännu/);
    assert.equal(blocked.firstField, "ob-scope");
  });

  it("Inställningar: företagsformen går genom samma vakt", () => {
    const base = db().settings;
    const input = {
      name: base.name,
      orgNumber: base.orgNumber,
      vatNumber: base.vatNumber,
      email: base.email,
      phone: base.phone,
      address: base.address,
      postalCode: base.postalCode,
      city: base.city,
      bankgiro: base.bankgiro,
      websiteNotificationEmail: "",
      websiteUrl: "",
      sate: "",
      country: "",
      plusgiro: "",
      bankAccount: "",
      iban: "",
      bic: "",
      logoInitials: base.logoInitials,
    };
    assert.throws(
      () => updateBusinessProfile({ ...input, companyForm: "hb" as unknown as "ab" }),
      /stöds inte i Ferva ännu/,
    );
    updateBusinessProfile({ ...input, companyForm: "enskild" });
    assert.equal(db().settings.companyForm, "enskild");
  });

  it("assertScopeAllowed: konsultfall kastar utan godkännande och släpper med", () => {
    assert.throws(() => assertScopeAllowed("reverse_charge_construction_outgoing"), /konsultfall/);
    assert.throws(() => assertScopeAllowed("foreign_currency"), /stöds inte/);
    assert.doesNotThrow(() => assertScopeAllowed("company_ab"));
    db().settings.scope = consultantApprovedScope("reverse_charge_construction_outgoing");
    assert.doesNotThrow(() => assertScopeAllowed("reverse_charge_construction_outgoing"));
  });
});

/* --------------------------- konsultens godkännande --------------------------- */

describe("konsultgodkännande – behörighet, audit och återkallande", () => {
  const consultant = {
    userId: "konsult-1",
    email: "karin@byran.se",
    name: "Karin Konsult",
    role: "accounting_consultant" as const,
    businessId: "biz-test",
  };

  beforeEach(() => {
    replaceDb(emptyTestDb({ settings: testCompany() }));
    setTestActor(null);
  });
  afterEach(() => setTestActor(null));

  it("bara redovisningskonsulten har approve_scope", () => {
    assert.equal(can("accounting_consultant", "approve_scope"), true);
    assert.equal(can("owner", "approve_scope"), false);
    assert.equal(can("admin", "approve_scope"), false);
    assert.equal(can("member", "approve_scope"), false);
    assert.equal(can("auditor", "approve_scope"), false);
  });

  it("ägaren kan inte godkänna åt sig själv", () => {
    setTestActor({ ...consultant, userId: "owner-1", role: "owner" });
    assert.throws(() => approveScopeEntry("reverse_charge_construction_outgoing"), /redovisningskonsult/);
    assert.equal(db().settings.scope?.approvals.length ?? 0, 0);
  });

  it("konsulten godkänner, det auditloggas och spärren släpper; återkallande spärrar igen", () => {
    setTestActor(consultant);
    const approval = approveScopeEntry("reverse_charge_construction_outgoing", "  Underentreprenör åt två byggbolag  ");
    assert.equal(approval.approvedBy.userId, "konsult-1");
    assert.equal(approval.matrixVersion, SUPPORT_MATRIX_VERSION);
    assert.equal(approval.note, "Underentreprenör åt två byggbolag");
    assert.equal(entryStatusFor(db().settings, "reverse_charge_construction_outgoing"), "approved");
    assert.doesNotThrow(() => assertScopeAllowed("reverse_charge_construction_outgoing"));
    assert.equal(db().auditTrail.filter((e) => e.action === "omfattning_godkand").length, 1);

    // Idempotent: ett andra godkännande ersätter, skapar inte dubblett.
    approveScopeEntry("reverse_charge_construction_outgoing");
    assert.equal(db().settings.scope?.approvals.length, 1);

    revokeScopeApproval("reverse_charge_construction_outgoing");
    assert.equal(db().settings.scope?.approvals.length, 0);
    assert.throws(() => assertScopeAllowed("reverse_charge_construction_outgoing"), ScopeBlockedError);
    assert.equal(db().auditTrail.filter((e) => e.action === "omfattning_aterkallad").length, 1);
  });

  it("stödda och ej stödda poster kan inte godkännas", () => {
    setTestActor(consultant);
    assert.throws(() => approveScopeEntry("company_ab"), /behöver inget godkännande/);
    assert.throws(() => approveScopeEntry("foreign_currency"), /kan inte godkännas av konsult/);
  });

  it("ägarens ändrade svar rör inte konsultens godkännanden", () => {
    setTestActor(consultant);
    approveScopeEntry("reverse_charge_construction_outgoing");
    setTestActor(null);
    const scope = updateScopeFlags(["reverse_charge", "nonsense"]);
    assert.deepEqual(scope.flags, ["reverse_charge"]);
    assert.equal(scope.approvals.length, 1);
    assert.equal(db().auditTrail.filter((e) => e.action === "omfattning_andrad").length, 1);
    // Samma svar igen → ingen ny auditrad.
    updateScopeFlags(["reverse_charge"]);
    assert.equal(db().auditTrail.filter((e) => e.action === "omfattning_andrad").length, 1);
  });
});

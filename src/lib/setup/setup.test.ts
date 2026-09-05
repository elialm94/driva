process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb, testCompany, testCustomer } from "../invoices/test-db";
import { isOwnerRole } from "../collaboration/permissions";
import {
  industriesSummary,
  newOnboardingState,
  onboardingAfterCompany,
  onboardingAfterPersonalization,
  onboardingIsComplete,
  ownerNeedsOnboarding,
  resumeStepFor,
  validatePersonalization,
} from "./onboarding-state";
import { setupSummary, setupTasks } from "./tasks";
import { applyPersonalization, setSetupTaskOverride, updateSetupProfile } from "../services/onboarding";
import { onboardingFromRow, onboardingToRow } from "../storage/mappers";
import type { OnboardingState } from "../types";

function freshCompany(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(
    emptyTestDb({
      settings: testCompany({ bankgiro: "", plusgiro: undefined, bankAccount: undefined, iban: undefined }),
      customers: [],
      jobs: [],
      invoices: [],
      quotes: [],
      bankAccounts: [],
      bankConnections: [],
      ...over,
    }),
  );
  return db();
}

describe("Onboardingtillstånd", () => {
  it("går från ej påbörjad → företag klart → klar och behåller tidsstämplar", () => {
    const start = newOnboardingState("2026-09-01T10:00:00.000Z");
    assert.equal(start.status, "not_started");
    assert.equal(start.currentStep, "company");
    const afterCompany = onboardingAfterCompany(start, "2026-09-01T10:05:00.000Z");
    assert.equal(afterCompany.status, "company_done");
    assert.equal(afterCompany.currentStep, "personalize");
    assert.equal(afterCompany.companyCompletedAt, "2026-09-01T10:05:00.000Z");
    const done = onboardingAfterPersonalization(
      afterCompany,
      { industries: ["el", "annat"], otherIndustry: "  Larm  ", payroll: "owner", bookkeeping: "existing" },
      "2026-09-01T10:09:00.000Z",
    );
    assert.equal(done.status, "complete");
    assert.equal(done.currentStep, null);
    assert.equal(done.companyCompletedAt, "2026-09-01T10:05:00.000Z");
    assert.equal(done.personalizationCompletedAt, "2026-09-01T10:09:00.000Z");
    assert.equal(done.completedAt, "2026-09-01T10:09:00.000Z");
    assert.deepEqual(done.industries, ["el", "annat"]);
    assert.equal(done.otherIndustry, "Larm");
    assert.equal(industriesSummary(done), "El, Larm");
    // Klar onboarding tvingas aldrig tillbaka av ett nytt "företag klart".
    assert.equal(onboardingAfterCompany(done).status, "complete");
  });

  it("saknad rad räknas som klar – befintliga företag tvingas inte igenom frågorna", () => {
    assert.equal(onboardingIsComplete(null), true);
    assert.equal(onboardingIsComplete(undefined), true);
    assert.equal(resumeStepFor({ hasBusiness: true, status: undefined }), "done");
    assert.equal(resumeStepFor({ hasBusiness: true, status: "complete" }), "done");
  });

  it("återupptar rätt steg: utan företag steg 1, med företag men avbruten steg 2", () => {
    assert.equal(resumeStepFor({ hasBusiness: false, status: undefined }), "company");
    assert.equal(resumeStepFor({ hasBusiness: true, status: "company_done" }), "personalize");
    assert.equal(resumeStepFor({ hasBusiness: true, status: "not_started" }), "personalize");
  });

  it("skickar bara ägare med ofullständig onboarding till /onboarding – aldrig konsulter eller klara företag", () => {
    assert.equal(ownerNeedsOnboarding([{ role: "owner", onboardingStatus: "company_done" }], isOwnerRole), true);
    assert.equal(ownerNeedsOnboarding([{ role: "owner", onboardingStatus: "complete" }], isOwnerRole), false);
    assert.equal(ownerNeedsOnboarding([{ role: "owner" }], isOwnerRole), false);
    assert.equal(ownerNeedsOnboarding([{ role: "accounting_consultant", onboardingStatus: "company_done" }], isOwnerRole), false);
    // Ett klart företag räcker: användaren har någonstans att landa.
    assert.equal(
      ownerNeedsOnboarding(
        [
          { role: "owner", onboardingStatus: "company_done" },
          { role: "admin", onboardingStatus: "complete" },
        ],
        isOwnerRole,
      ),
      false,
    );
    assert.equal(ownerNeedsOnboarding([], isOwnerRole), false);
  });

  it("validerar personaliseringen på servern", () => {
    const missing = validatePersonalization({ industries: [], payroll: "", bookkeeping: "" });
    assert.ok(missing.errors.industries && missing.errors.payroll && missing.errors.bookkeeping);
    assert.equal(missing.values, undefined);
    const other = validatePersonalization({ industries: ["annat"], otherIndustry: "", payroll: "none", bookkeeping: "new" });
    assert.ok(other.errors.otherIndustry);
    const bogus = validatePersonalization({ industries: ["el", "hacker", "el"], payroll: "none", bookkeeping: "new" });
    assert.deepEqual(bogus.values?.industries, ["el"]);
    const ok = validatePersonalization({ industries: ["vvs"], payroll: "later", bookkeeping: "consultant" });
    assert.deepEqual(ok.values, { industries: ["vvs"], payroll: "later", bookkeeping: "consultant" });
  });

  it("speglar business_onboarding-raden (mappers) utan förlust", () => {
    const state: OnboardingState = onboardingAfterPersonalization(
      onboardingAfterCompany(newOnboardingState("2026-09-01T10:00:00.000Z"), "2026-09-01T10:05:00.000Z"),
      { industries: ["bygg"], payroll: "employees", bookkeeping: "later" },
      "2026-09-01T10:09:00.000Z",
    );
    state.taskOverrides = { connect_bank: { state: "later", at: "2026-09-02T08:00:00.000Z" } };
    const row = onboardingToRow(state, "biz-1");
    assert.equal(row.status, "complete");
    assert.equal(row.business_id, "biz-1");
    const back = onboardingFromRow({ ...row, industries: JSON.stringify(state.industries), task_overrides: JSON.stringify(state.taskOverrides) });
    assert.deepEqual(back, state);
  });
});

describe("Kom igång-uppgifter härleds ur verklig data", () => {
  beforeEach(() => {
    freshCompany();
  });

  it("nytt företag: kund, uppdrag, betalning och bank återstår; Hem-kortet visas", () => {
    applyPersonalization({ industries: ["bygg"], payroll: "none", bookkeeping: "new" });
    const summary = setupSummary();
    assert.equal(summary.showHomeCard, true);
    const byId = new Map(summary.tasks.map((t) => [t.id, t]));
    assert.equal(byId.get("first_customer")?.status, "todo");
    assert.equal(byId.get("first_job")?.status, "todo");
    assert.equal(byId.get("payment_details")?.status, "todo");
    assert.equal(byId.get("connect_bank")?.status, "todo");
    // Nystartat: bokföringsflytten är irrelevant och visas inte; lön finns inte som uppgift.
    assert.equal(byId.has("move_bookkeeping"), false);
    assert.equal(byId.has("payroll"), false);
    // Snickare: artiklar/priser är valfritt, inte rekommenderat.
    assert.equal(byId.get("articles_prices")?.relevance, "optional");
    assert.equal(summary.next?.id, "first_customer");
  });

  it("befintlig bokföring prioriterar Flytta in bokföringen; konsult prioriterar inbjudan", () => {
    applyPersonalization({ industries: ["el"], payroll: "none", bookkeeping: "existing" });
    assert.equal(setupSummary().next?.id, "move_bookkeeping");
    assert.equal(setupTasks().find((t) => t.id === "articles_prices")?.relevance, "recommended");
    applyPersonalization({ industries: ["el"], payroll: "none", bookkeeping: "consultant" });
    assert.equal(setupSummary().next?.id, "invite_consultant");
    assert.equal(setupTasks().find((t) => t.id === "move_bookkeeping")?.relevance, "optional");
  });

  it("bank, kund, uppdrag, betalning och konsult markeras klara av datat – inte av användaren", () => {
    applyPersonalization({ industries: ["maleri"], payroll: "none", bookkeeping: "consultant" });
    const data = db();
    data.customers.push(testCustomer({ id: "c1" }));
    data.jobs.push({
      id: "j1",
      customerId: "c1",
      title: "Badrum",
      description: "",
      status: "pagar",
      checklist: [],
      notes: "",
      createdAt: new Date().toISOString(),
    });
    data.settings.bankgiro = "5678-1234";
    data.bankAccounts.push({
      id: "acc",
      provider: "mock",
      name: "Swedbank Företagskonto",
      accountNumber: "···· 4512",
      balance: 1000,
      connectedAt: new Date().toISOString(),
    } as (typeof data.bankAccounts)[number]);
    data.collaborationInvitations = [
      {
        id: "inv",
        businessId: "biz",
        email: "anna@byran.se",
        role: "accounting_consultant",
        invitedByUserId: "u",
        invitedByName: "Du",
        tokenHash: "x",
        expiresAt: "2099-01-01T00:00:00.000Z",
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    ];
    const byId = new Map(setupTasks().map((t) => [t.id, t]));
    assert.equal(byId.get("first_customer")?.status, "done");
    assert.equal(byId.get("first_job")?.status, "done");
    assert.equal(byId.get("payment_details")?.status, "done");
    assert.equal(byId.get("payment_details")?.doneDetail, "Bankgiro 5678-1234");
    assert.equal(byId.get("connect_bank")?.status, "done");
    assert.equal(byId.get("invite_consultant")?.status, "done");
    const summary = setupSummary();
    assert.equal(summary.showHomeCard, false);
    assert.equal(summary.next, null);
  });

  it("gör senare och behövs inte sparas som val, kan återaktiveras och skrivs över av 'klar'", () => {
    applyPersonalization({ industries: ["maleri"], payroll: "later", bookkeeping: "later" });
    setSetupTaskOverride("connect_bank", "later");
    setSetupTaskOverride("first_job", "not_needed");
    let byId = new Map(setupTasks().map((t) => [t.id, t]));
    assert.equal(byId.get("connect_bank")?.status, "later");
    assert.equal(byId.get("first_job")?.status, "not_needed");
    let summary = setupSummary();
    assert.equal(summary.deferred.map((t) => t.id).includes("connect_bank"), true);
    assert.equal(summary.dismissed.map((t) => t.id).includes("first_job"), true);
    assert.equal(summary.open.some((t) => t.id === "connect_bank"), false);

    setSetupTaskOverride("connect_bank", null);
    byId = new Map(setupTasks().map((t) => [t.id, t]));
    assert.equal(byId.get("connect_bank")?.status, "todo");

    // Skapas ett uppdrag utanför Kom igång är uppgiften klar oavsett "behövs inte".
    db().jobs.push({ id: "j2", customerId: "c", title: "Fasad", description: "", status: "pagar", checklist: [], notes: "", createdAt: new Date().toISOString() });
    byId = new Map(setupTasks().map((t) => [t.id, t]));
    assert.equal(byId.get("first_job")?.status, "done");
    summary = setupSummary();
    assert.deepEqual(db().onboarding?.taskOverrides.first_job?.state, "not_needed");
    assert.equal(summary.done.some((t) => t.id === "first_job"), true);
  });

  it("betalningsuppgifter prioriteras först när fakturering behövs", () => {
    applyPersonalization({ industries: ["mark"], payroll: "none", bookkeeping: "new" });
    let order = setupSummary().open.map((t) => t.id);
    assert.ok(order.indexOf("first_customer") < order.indexOf("payment_details"));
    db().customers.push(testCustomer({ id: "c1" }));
    // En offert räcker för att fakturering ska vara "på gång".
    db().quotes.push({
      id: "q1",
      number: 1,
      customerId: "c1",
      status: "utkast",
      currentVersionId: "v1",
      token: "tok",
      followUps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as (typeof db extends () => { quotes: (infer Q)[] } ? Q : never));
    order = setupSummary().open.map((t) => t.id);
    assert.equal(order[0], "payment_details");
  });

  it("profilen kan ändras i efterhand utan att låsa något; företag utan rad får en klar rad", () => {
    assert.equal(db().onboarding, null);
    updateSetupProfile({ industries: ["el", "vvs"], payroll: "employees", bookkeeping: "existing" });
    const state = db().onboarding!;
    assert.equal(state.status, "complete");
    assert.deepEqual(state.industries, ["el", "vvs"]);
    assert.equal(state.payroll, "employees");
    assert.equal(setupTasks().find((t) => t.id === "move_bookkeeping")?.relevance, "recommended");
    assert.throws(() => updateSetupProfile({ industries: [], payroll: "none", bookkeeping: "new" }), /minst ett område/);
  });

  it("bokföringsflytten är klar först när en import har genomförts", () => {
    applyPersonalization({ industries: ["el"], payroll: "none", bookkeeping: "existing" });
    assert.equal(setupTasks().find((t) => t.id === "move_bookkeeping")?.status, "todo");
    db().dataImports = [
      {
        id: "imp",
        kind: "bokforing",
        status: "imported",
        filename: "bokforing.se",
        fileKind: "sie",
        fileHash: "abc",
        fileSize: 10,
        created: 120,
        updated: 0,
        ignored: 0,
        warnings: [],
        summary: "120 verifikationer · 2025",
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      },
    ];
    const task = setupTasks().find((t) => t.id === "move_bookkeeping")!;
    assert.equal(task.status, "done");
    assert.equal(task.doneDetail, "120 verifikationer · 2025");
  });
});

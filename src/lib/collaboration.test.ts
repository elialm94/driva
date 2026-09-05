process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { getBusinessActions } from "./services/actions";
import { uploadReceiptForExpense } from "./services/expenses";
import { executeTool } from "./ai/tools";
import {
  can,
  toolAllowedForRole,
  assertCan,
  assertReadAccess,
  assertWriteAccess,
  CollaborationDeniedError,
} from "./collaboration/permissions";
import {
  resetCollaborationRegistry,
  upsertUser,
  putMembership,
  activeMembershipFor,
  activeMembershipsForUser,
} from "./collaboration/registry";
import {
  acceptInvitation,
  createInvitation,
  hashInviteToken,
  invitationStatus,
  peekInvitation,
  revokeAccess,
  rotateInvitationToken,
  CollaborationError,
} from "./collaboration/invitations";
import { requestClientInformation, resolveClientRequestsForExpense } from "./collaboration/requests";
import { accountantQueue, accountantIssueType } from "./collaboration/issues";
import { clientRowStatus, landingHeadline, searchClients } from "./collaboration/clients";
import { accountantWorkState, isWaitingForClient, matchesAccountantFilter } from "./collaboration/issues";
import { clientSwitchDestination } from "./collaboration/switch";
import { LOCAL_JSON_ACCOUNTANT_ID, LOCAL_JSON_BUSINESS_ID, LOCAL_JSON_USER_ID, setTestActor } from "./collaboration/actor";
import { ensureLocalDemoCollaboration } from "./collaboration/local-demo";
import { createCorrection, postVerification } from "./accounting/engine";
import type { Expense } from "./types";

function owner() {
  return upsertUser({ id: "user-owner", email: "agare@bygg.se", name: "Erik Bygg" });
}
function anna() {
  return upsertUser({ id: "user-anna", email: "anna@byran.se", name: "Anna Svensson" });
}

beforeEach(() => {
  resetCollaborationRegistry();
  setTestActor(null);
  replaceDb(emptyTestDb());
  owner();
  putMembership({
    businessId: "biz-a",
    businessName: "Bygg A",
    userId: "user-owner",
    role: "owner",
    createdAt: new Date().toISOString(),
  });
});

describe("inbjudan", () => {
  it("skapar hash:ad token, accepterar befintlig användare och vägrar återanvändning", () => {
    const { invitation, token } = createInvitation({
      businessId: "biz-a",
      businessName: "Bygg A",
      email: "anna@byran.se",
      role: "accounting_consultant",
      invitedByUserId: "user-owner",
      invitedByName: "Erik Bygg",
    });
    assert.equal(invitation.tokenHash, hashInviteToken(token));
    assert.notEqual(invitation.tokenHash, token);
    assert.equal(invitationStatus(invitation), "pending");

    const accepted = acceptInvitation({
      token,
      user: anna(),
      businessName: "Bygg A",
    });
    assert.equal(accepted.membership.role, "accounting_consultant");
    assert.equal(accepted.membership.businessId, "biz-a");
    assert.equal(activeMembershipFor("user-anna", "biz-a")?.role, "accounting_consultant");

    assert.throws(
      () => acceptInvitation({ token, user: anna(), businessName: "Bygg A" }),
      CollaborationError
    );
  });

  it("skicka igen byter token och ogiltigförklarar den gamla", () => {
    const { invitation, token } = createInvitation({
      businessId: "biz-a",
      businessName: "Bygg A",
      email: "anna@byran.se",
      role: "accounting_consultant",
      invitedByUserId: "user-owner",
      invitedByName: "Erik Bygg",
    });
    const rotated = rotateInvitationToken(invitation.id);
    assert.notEqual(rotated.token, token);
    assert.equal(rotated.invitation.tokenHash, hashInviteToken(rotated.token));
    assert.equal(peekInvitation(token), null);
    assert.equal(invitationStatus(rotated.invitation), "pending");
  });

  it("ny e-post skapar användare vid accept utan dubblett", () => {
    const { token } = createInvitation({
      businessId: "biz-a",
      businessName: "Bygg A",
      email: "ny@byran.se",
      role: "accounting_consultant",
      invitedByUserId: "user-owner",
      invitedByName: "Erik",
    });
    const first = acceptInvitation({
      token,
      user: { id: "user-new", email: "ny@byran.se", name: "Ny Konsult" },
      businessName: "Bygg A",
    });
    assert.equal(first.membership.userId, "user-new");
    assert.equal(activeMembershipsForUser("user-new").length, 1);
  });

  it("vägrar utgången token", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const { token } = createInvitation({
      businessId: "biz-a",
      businessName: "Bygg A",
      email: "anna@byran.se",
      role: "auditor",
      invitedByUserId: "user-owner",
      invitedByName: "Erik",
      now,
    });
    const peeked = peekInvitation(token, new Date("2026-02-20T12:00:00Z"));
    assert.equal(peeked?.status, "expired");
    assert.throws(
      () =>
        acceptInvitation({
          token,
          user: anna(),
          businessName: "Bygg A",
          now: new Date("2026-02-20T12:00:00Z"),
        }),
      /gått ut/i
    );
  });

  it("vägrar accept med fel e-post", () => {
    const { token } = createInvitation({
      businessId: "biz-a",
      businessName: "Bygg A",
      email: "anna@byran.se",
      role: "accounting_consultant",
      invitedByUserId: "user-owner",
      invitedByName: "Erik",
    });
    assert.throws(
      () =>
        acceptInvitation({
          token,
          user: { id: "user-fel", email: "annan@byran.se", name: "Fel" },
          businessName: "Bygg A",
        }),
      /e-post/i
    );
  });
});

describe("lokal demo-konsult", () => {
  it("seedar ägare och Anna på demoföretaget utan dubbletter", () => {
    const first = ensureLocalDemoCollaboration("Södermalms Snickeri AB");
    const again = ensureLocalDemoCollaboration("Södermalms Snickeri AB");
    assert.equal(first.accountantId, LOCAL_JSON_ACCOUNTANT_ID);
    assert.equal(again.accountantId, LOCAL_JSON_ACCOUNTANT_ID);
    assert.equal(activeMembershipFor(LOCAL_JSON_USER_ID, LOCAL_JSON_BUSINESS_ID)?.role, "owner");
    assert.equal(activeMembershipFor(LOCAL_JSON_ACCOUNTANT_ID, LOCAL_JSON_BUSINESS_ID)?.role, "accounting_consultant");
    assert.equal(activeMembershipsForUser(LOCAL_JSON_ACCOUNTANT_ID).length, 3);
  });
});

describe("multi-klient och byte", () => {
  it("samma användare kan äga ett företag och konsultera ett annat", () => {
    upsertUser({ id: "user-mix", email: "mix@driva.se", name: "Mia" });
    putMembership({
      businessId: "biz-own",
      businessName: "Mitt AB",
      userId: "user-mix",
      role: "owner",
      createdAt: new Date().toISOString(),
    });
    putMembership({
      businessId: "biz-client",
      businessName: "Klient AB",
      userId: "user-mix",
      role: "accounting_consultant",
      createdAt: new Date().toISOString(),
    });
    const all = activeMembershipsForUser("user-mix");
    assert.equal(all.length, 2);
    assert.equal(all.find((m) => m.businessId === "biz-own")?.role, "owner");
    assert.equal(all.find((m) => m.businessId === "biz-client")?.role, "accounting_consultant");
    assert.notEqual(
      all.find((m) => m.role === "owner")?.businessId,
      all.find((m) => m.role === "accounting_consultant")?.businessId
    );
  });
});

describe("behörighet", () => {
  it("konsult får bokföra/rätta men inte skicka faktura eller hemsida", () => {
    assert.equal(can("accounting_consultant", "correct_voucher"), true);
    assert.equal(can("accounting_consultant", "categorize"), true);
    assert.equal(can("accounting_consultant", "prepare_supplier_payment"), true);
    assert.equal(can("accounting_consultant", "submit_bank_payment"), false);
    // Konsulten upprättar deklarationsfilen; signering och inlämning är bolagets egen handling.
    assert.equal(can("accounting_consultant", "prepare_filing"), true);
    assert.equal(can("accounting_consultant", "submit_filing"), false);
    assert.equal(can("auditor", "prepare_filing"), false);
    assert.equal(can("owner", "submit_filing"), true);
    assert.equal(can("accounting_consultant", "send_invoice"), false);
    assert.equal(can("accounting_consultant", "create_quote"), false);
    assert.equal(can("accounting_consultant", "change_website"), false);
    assert.equal(can("accounting_consultant", "change_jobs"), false);
    assert.equal(can("accounting_consultant", "buy_domain"), false);
    assert.equal(can("accounting_consultant", "reveal_personnummer"), false);
    assert.equal(toolAllowedForRole("send_invoice", "accounting_consultant"), false);
    assert.equal(toolAllowedForRole("ratta_bokforing", "accounting_consultant"), true);
    assert.equal(toolAllowedForRole("ratta_bokforing", "auditor"), false);
    assert.equal(can("auditor", "write_accounting"), false);
    assert.equal(can("auditor", "read_accounting"), true);
    assert.throws(() => assertCan("auditor", "correct_voucher"), CollaborationDeniedError);
  });

  /**
   * Läsvägen och skrivvägen är två olika grindar. Buggen som fanns var att
   * läsningarna gick genom skrivgrinden utan capability, vilket nekar
   * redovisningsroller – då slutar SIE-export, kvitton, inkorgens bilagor och
   * betalfiler att fungera för konsult och revisor i skarp drift.
   */
  it("läsvägen släpper igenom redovisningsroller, skrivvägen gör det bara med capability", () => {
    for (const role of ["owner", "admin", "member", "accounting_consultant", "auditor"] as const) {
      assert.doesNotThrow(() => assertReadAccess(role), `${role} ska få läsa bokföringen`);
    }
    assert.throws(() => assertReadAccess(null), CollaborationDeniedError);

    // Utan capability är åtgärden ägaryteexklusiv.
    assert.doesNotThrow(() => assertWriteAccess("owner"));
    assert.throws(() => assertWriteAccess("accounting_consultant"), /inte tillgänglig från redovisningsytan/);
    assert.throws(() => assertWriteAccess("auditor"), /inte tillgänglig från redovisningsytan/);

    // Med capability avgör matrisen.
    assert.doesNotThrow(() => assertWriteAccess("accounting_consultant", "write_accounting"));
    assert.throws(() => assertWriteAccess("auditor", "write_accounting"), CollaborationDeniedError);
    assert.throws(() => assertWriteAccess("accounting_consultant", "send_invoice"), CollaborationDeniedError);
  });
});

describe("återkalla", () => {
  it("tar bort åtkomst omedelbart men behåller bokföring", () => {
    const { token } = createInvitation({
      businessId: "biz-a",
      businessName: "Bygg A",
      email: "anna@byran.se",
      role: "accounting_consultant",
      invitedByUserId: "user-owner",
      invitedByName: "Erik",
    });
    acceptInvitation({ token, user: anna(), businessName: "Bygg A" });
    const posted = postVerification({
      date: "2026-08-01",
      description: "Konsultens bokning",
      createdBy: "anvandare",
      source: { type: "manuell" },
      entries: [
        { account: 4010, debit: 1000 },
        { account: 1930, credit: 1000 },
      ],
    });
    revokeAccess({ businessId: "biz-a", targetUserId: "user-anna", revokedByUserId: "user-owner" });
    assert.equal(activeMembershipFor("user-anna", "biz-a"), undefined);
    assert.ok(db().verifications.find((v) => v.id === posted.id));
  });
});

describe("kundunderlag", () => {
  it("be om kvitto syns i åtgärdsmotorn och båda löses vid uppladdning", () => {
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

    setTestActor({
      userId: "user-anna",
      email: "anna@byran.se",
      name: "Anna",
      role: "accounting_consultant",
      businessId: "biz-a",
    });
    const req = requestClientInformation({
      expenseId: "exp-bauhaus",
      requestedByUserId: "user-anna",
      requestedByName: "Anna",
      requestedByRole: "accounting_consultant",
    });
    const actions = getBusinessActions();
    const row = actions.attention.find((a) => a.id === `client-request-${req.id}`);
    assert.ok(row, "Hem ska visa konsultens begäran");
    assert.match(row.title, /Bauhaus/);
    assert.match(row.title, /875/);
    assert.equal(row.cta?.type, "uploadReceipt");
    assert.equal(
      actions.attention.some((a) => a.id === "receipt-exp-bauhaus"),
      false,
      "generisk kvitto-rad ska döljas när konsulten redan bett"
    );

    uploadReceiptForExpense("exp-bauhaus", "kvitto.jpg", "uppladdning");
    const after = getBusinessActions();
    assert.equal(
      after.attention.some((a) => a.id === `client-request-${req.id}`),
      false
    );
    assert.equal(resolveClientRequestsForExpense("exp-bauhaus"), 0);
  });
});

describe("kö och AI-isolering", () => {
  it("filtrerad kö från samma motor + IDOR på businessId", async () => {
    const data = emptyTestDb();
    data.expenses = [
      {
        id: "exp-1",
        date: "2026-08-01",
        supplier: "Bauhaus",
        amount: 200,
        vatAmount: 40,
        category: "",
        status: "saknar_kvitto",
        createdAt: new Date().toISOString(),
      },
    ];
    replaceDb(data);
    const queue = accountantQueue(getBusinessActions().attention);
    assert.ok(queue.some((a) => accountantIssueType(a) === "MISSING_RECEIPT"));
    assert.equal(landingHeadline(12, 6), "12 saker behöver hanteras · över 6 klienter");

    setTestActor({
      userId: "user-anna",
      email: "anna@byran.se",
      name: "Anna",
      role: "accounting_consultant",
      businessId: "biz-a",
    });
    const blocked = await executeTool("send_invoice", { invoiceId: "x", businessId: "biz-other" }, { origin: "user" });
    assert.equal(blocked.ok, false);
    const idor = await executeTool("list_accountant_exceptions", { businessId: "biz-evil" }, { origin: "user" });
    assert.equal(idor.ok, false);
    assert.match(idor.error ?? "", /företag/);
  });

  it("AI-scope är server-satt: current vs alla klienter, modell kan inte byta", async () => {
    upsertUser({ id: "user-anna", email: "anna@byran.se", name: "Anna" });
    putMembership({
      businessId: "biz-a",
      businessName: "Bygg A",
      userId: "user-anna",
      role: "accounting_consultant",
      createdAt: new Date().toISOString(),
    });
    putMembership({
      businessId: "biz-b",
      businessName: "Bygg B",
      userId: "user-anna",
      role: "accounting_consultant",
      createdAt: new Date().toISOString(),
    });
    const data = emptyTestDb();
    data.expenses = [
      {
        id: "exp-1",
        date: "2026-08-01",
        supplier: "Bauhaus",
        amount: 200,
        vatAmount: 40,
        category: "",
        status: "saknar_kvitto",
        createdAt: new Date().toISOString(),
      },
    ];
    replaceDb(data);
    setTestActor({
      userId: "user-anna",
      email: "anna@byran.se",
      name: "Anna",
      role: "accounting_consultant",
      businessId: "biz-a",
    });

    const scoped = await executeTool("list_accountant_exceptions", { scope: "all_clients" }, { origin: "ai", accountantScope: "current" });
    assert.equal(scoped.ok, true);
    assert.equal(scoped.forModel.scope, "current");
    const scopedIds = (scoped.forModel.items as { businessId?: string }[] | undefined) ?? [];
    assert.equal(scopedIds.every((i) => !i.businessId || i.businessId === "biz-a"), true);

    const all = await executeTool("list_accountant_exceptions", { scope: "current" }, { origin: "ai", accountantScope: "all_clients", actorUserId: "user-anna" });
    assert.equal(all.ok, true);
    assert.equal(all.forModel.scope, "all_clients");
    const names = ((all.forModel.items as { businessName?: string }[]) ?? []).map((i) => i.businessName);
    assert.ok(names.includes("Bygg A") || (all.forModel.clients as number) >= 2);
  });
});

describe("kö-tillstånd och filter", () => {
  it("efterfrågat kvitto flyttar till Väntar och tillbaka när underlag kommer", () => {
    const data = emptyTestDb();
    data.expenses = [
      {
        id: "exp-bauhaus",
        date: "2026-08-01",
        supplier: "Bauhaus",
        amount: 875,
        vatAmount: 175,
        category: "",
        status: "saknar_kvitto",
        createdAt: new Date().toISOString(),
      },
    ];
    replaceDb(data);
    const before = accountantQueue(getBusinessActions().attention);
    const receipt = before.find((a) => a.id === "receipt-exp-bauhaus");
    assert.ok(receipt);
    assert.equal(accountantWorkState(receipt), "att_gora");
    assert.equal(isWaitingForClient(receipt), false);

    requestClientInformation({
      expenseId: "exp-bauhaus",
      requestedByUserId: "user-anna",
      requestedByName: "Anna",
      requestedByRole: "accounting_consultant",
    });
    const afterAsk = accountantQueue(getBusinessActions().attention);
    assert.equal(afterAsk.some((a) => a.id === "receipt-exp-bauhaus"), false);
    const waiting = afterAsk.find((a) => a.id.startsWith("client-request-"));
    assert.ok(waiting);
    assert.equal(accountantWorkState(waiting), "vantar");
    assert.equal(matchesAccountantFilter(waiting, "vantar"), true);
    assert.equal(matchesAccountantFilter(waiting, "alla"), false);

    uploadReceiptForExpense("exp-bauhaus", "kvitto.jpg", "uppladdning");
    const afterUpload = accountantQueue(getBusinessActions().attention);
    assert.equal(afterUpload.some((a) => a.id.startsWith("client-request-")), false);
  });

  it("sök klienter och byt-destination", () => {
    upsertUser({ id: "user-anna", email: "anna@byran.se", name: "Anna" });
    putMembership({
      businessId: "biz-sod",
      businessName: "Södermalms Snickeri AB",
      userId: "user-anna",
      role: "accounting_consultant",
      createdAt: new Date().toISOString(),
    });
    putMembership({
      businessId: "biz-ckl",
      businessName: "CKL Bygg AB",
      userId: "user-anna",
      role: "accounting_consultant",
      createdAt: new Date().toISOString(),
    });
    const hit = searchClients("user-anna", "ckl");
    assert.equal(hit.length, 1);
    assert.equal(hit[0].businessName, "CKL Bygg AB");
    assert.equal(clientSwitchDestination("/redovisning", "biz-ckl"), "/redovisning/k/biz-ckl");
    assert.equal(clientSwitchDestination("/redovisning/k/biz-sod/moms", "biz-ckl"), "/redovisning/k/biz-ckl/moms");
    assert.equal(clientSwitchDestination("/redovisning/k/biz-sod", null), "/redovisning");
    assert.equal(clientRowStatus({ health: "klart", openCount: 0, urgentCount: 0 }), "Klart ✓");
    assert.equal(clientRowStatus({ health: "saker", openCount: 3, urgentCount: 0 }), "3 saker");
    assert.match(clientRowStatus({ health: "forsenat", openCount: 4, urgentCount: 1 }), /brådskande/);
  });

  it("revisor får inte rätta eller kategorisera", async () => {
    setTestActor({
      userId: "user-rev",
      email: "rev@byran.se",
      name: "Revisor",
      role: "auditor",
      businessId: "biz-a",
    });
    const r = await executeTool("ratta_bokforing", { verificationId: "v1" }, { origin: "user" });
    assert.equal(r.ok, false);
    const c = await executeTool("answer_expense_question", { expenseId: "e1", answer: "Material" }, { origin: "user" });
    assert.equal(c.ok, false);
  });
});

describe("audit actor", () => {
  it("loggar konsultens userId och roll vid begäran", () => {
    setTestActor({
      userId: "user-anna",
      email: "anna@byran.se",
      name: "Anna",
      role: "accounting_consultant",
      businessId: "biz-a",
    });
    requestClientInformation({
      message: "Behöver kvitto",
      requestedByUserId: "user-anna",
      requestedByName: "Anna",
      requestedByRole: "accounting_consultant",
    });
    const ev = db().auditTrail.find((e) => e.action === "kundunderlag_begart");
    assert.ok(ev);
    assert.equal(ev?.actorUserId, "user-anna");
    assert.equal(ev?.actorRole, "accounting_consultant");
  });
});

describe("rättelse via samma motor", () => {
  it("konsult rättar via createCorrection – originalet skrivs inte över", () => {
    const original = postVerification({
      date: "2026-08-01",
      description: "Kvitto Bauhaus",
      createdBy: "auto",
      source: { type: "utgift", id: "exp-1" },
      entries: [
        { account: 4010, debit: 1000 },
        { account: 2641, debit: 250 },
        { account: 1930, credit: 1250 },
      ],
    });
    const result = createCorrection({
      verificationId: original.id,
      reason: "Fel konto",
      by: "anvandare",
      replacementEntries: [
        { account: 5410, debit: 1000 },
        { account: 2641, debit: 250 },
        { account: 1930, credit: 1250 },
      ],
    });
    assert.ok(result.reversal);
    const kept = db().verifications.find((x) => x.id === original.id);
    assert.ok(kept);
    assert.equal(kept?.entries[0]?.account, 4010);
    assert.ok(kept?.correctedByVerificationId);
  });
});

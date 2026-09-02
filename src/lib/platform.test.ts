process.env.DRIVA_TEST = "1";

/**
 * Driva Admin – tjänstenivåtester (spec §44).
 *
 * Kör i JSON-läget (in-memory-register) och prövar samma tjänstelager som
 * server actions anropar efter requirePlatformAdmin/requireSuperAdmin:
 * rollgränserna admin/super_admin, sista-super_admin-skyddet, inbjudnings-
 * flödet, supportsessioner, ärenden, raderingspolicyer och auditloggen.
 * SQL-vägen (RLS, triggrar) valideras separat av test:db/test:adapter.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { resetPlatformRegistry, platformRegistry } from "./platform/registry";
import {
  resetCollaborationRegistry,
  upsertUser,
  putMembership,
} from "./collaboration/registry";
import { LOCAL_JSON_BUSINESS_ID } from "./collaboration/actor";
import {
  insertPlatformAdmin,
  listPlatformAdmins,
  platformAdminByUserId,
  updatePlatformAdminRow,
  deletePlatformAdminRow,
  LastSuperAdminError,
  insertEmailEvent,
  countEmailEventsSince,
  listAdminAudit,
  setBusinessDisabled,
} from "./platform/store";
import {
  acceptPlatformInvitation,
  disablePlatformAdmin,
  enablePlatformAdmin,
  hashPlatformInviteToken,
  invitePlatformAdmin,
  peekPlatformInvitation,
  platformInvitationStatus,
  removePlatformAdmin,
  resendPlatformInvitation,
  revokePlatformInvitation,
  PlatformAdminError,
} from "./platform/admins";
import {
  endSupportSession,
  startSupportSession,
  SupportSessionError,
} from "./platform/support";
import { supportSessionIsActive } from "./platform/auth";
import {
  assignTicket,
  createSupportTicket,
  setTicketStatus,
  SupportTicketError,
} from "./platform/tickets";
import { listSupportTickets, countSupportTicketsByStatus, supportTicketById } from "./platform/store";
import { setMailTransportForTests } from "./mail";
import {
  businessDeletionPolicy,
  searchBusinesses,
  searchUsers,
  userDeletionPolicy,
  userDetail,
} from "./platform/directory";
import { deleteUserAccount, AdminOperationError } from "./platform/operations";
import { platformOverview } from "./platform/metrics";
import { PlatformAccessError, SUPER_ADMIN, type PlatformAdmin } from "./platform/types";
import { writeAdminAudit } from "./platform/audit";
import type { Verification } from "./types";

function superAdmin(over: Partial<PlatformAdmin> = {}): PlatformAdmin {
  return {
    id: over.id ?? "pa-super",
    userId: over.userId ?? "user-super",
    role: "super_admin",
    email: over.email ?? "super@driva.se",
    name: over.name ?? "Sara Superadmin",
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
  };
}

function plainAdmin(over: Partial<PlatformAdmin> = {}): PlatformAdmin {
  return {
    id: over.id ?? "pa-admin",
    userId: over.userId ?? "user-admin",
    role: "admin",
    email: over.email ?? "anna@driva.se",
    name: over.name ?? "Anna Admin",
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
  };
}

function verifikation(over: Partial<Verification> = {}): Verification {
  return {
    id: over.id ?? "ver-1",
    series: "A",
    number: over.number ?? 1,
    date: over.date ?? "2026-08-01",
    description: over.description ?? "Test",
    entries: over.entries ?? [],
    source: over.source ?? { type: "manuell" },
    confidence: "hog",
    createdBy: over.createdBy ?? "anvandare",
    status: "bokford",
    postedAt: over.postedAt ?? new Date().toISOString(),
  } as Verification;
}

beforeEach(async () => {
  resetPlatformRegistry();
  resetCollaborationRegistry();
  replaceDb(emptyTestDb());
  await insertPlatformAdmin(superAdmin());
  await insertPlatformAdmin(plainAdmin());
});

describe("plattformsroller: admin vs super_admin", () => {
  it("admin får inte bjuda in admins – super_admin får", async () => {
    const admin = (await platformAdminByUserId("user-admin"))!;
    await assert.rejects(
      () => invitePlatformAdmin(admin, "ny@driva.se"),
      (e: unknown) => e instanceof PlatformAccessError && e.status === 403
    );
    const sup = (await platformAdminByUserId("user-super"))!;
    const { invitation } = await invitePlatformAdmin(sup, "ny@driva.se");
    assert.equal(invitation.role, "admin"); // aldrig super_admin via inbjudan
  });

  it("admin får inte inaktivera/ta bort/återaktivera någon – inte ens en annan admin", async () => {
    const admin = (await platformAdminByUserId("user-admin"))!;
    for (const fn of [
      () => disablePlatformAdmin(admin, "pa-super"),
      () => disablePlatformAdmin(admin, "pa-admin"),
      () => removePlatformAdmin(admin, "pa-super"),
      () => enablePlatformAdmin(admin, "pa-admin"),
    ]) {
      await assert.rejects(fn, (e: unknown) => e instanceof PlatformAccessError && e.status === 403);
    }
  });

  it("inaktiverad super_admin har ingen aktörsbehörighet", async () => {
    await insertPlatformAdmin(superAdmin({ id: "pa-super2", userId: "user-super2", email: "s2@driva.se" }));
    const sup = (await platformAdminByUserId("user-super"))!;
    await disablePlatformAdmin(sup, "pa-super2");
    const disabled = { ...superAdmin({ id: "pa-super2", userId: "user-super2" }), disabledAt: new Date().toISOString() };
    await assert.rejects(
      () => invitePlatformAdmin(disabled, "x@driva.se"),
      (e: unknown) => e instanceof PlatformAccessError
    );
  });

  it("super_admin kan inaktivera, återaktivera och ta bort en admin (audit skrivs)", async () => {
    const sup = (await platformAdminByUserId("user-super"))!;
    await disablePlatformAdmin(sup, "pa-admin");
    assert.ok((await platformAdminByUserId("user-admin"))?.disabledAt);
    await enablePlatformAdmin(sup, "pa-admin");
    assert.equal((await platformAdminByUserId("user-admin"))?.disabledAt, undefined);
    await removePlatformAdmin(sup, "pa-admin");
    assert.equal(await platformAdminByUserId("user-admin"), null);
    const actions = (await listAdminAudit({})).map((a) => a.action);
    assert.ok(actions.includes("admin_disabled"));
    assert.ok(actions.includes("admin_enabled"));
    assert.ok(actions.includes("admin_removed"));
  });
});

describe("sista super_admin-skyddet", () => {
  it("den sista aktiva super_admin kan inte inaktiveras, tas bort eller nedgraderas", async () => {
    const sup = (await platformAdminByUserId("user-super"))!;
    await assert.rejects(() => disablePlatformAdmin(sup, "pa-super"), LastSuperAdminError);
    await assert.rejects(() => removePlatformAdmin(sup, "pa-super"), LastSuperAdminError);
    await assert.rejects(
      () => updatePlatformAdminRow("pa-super", { role: "admin" }),
      LastSuperAdminError
    );
    await assert.rejects(() => deletePlatformAdminRow("pa-super"), LastSuperAdminError);
  });

  it("med två aktiva super_admins kan en tas bort", async () => {
    await insertPlatformAdmin(superAdmin({ id: "pa-super2", userId: "user-super2", email: "s2@driva.se" }));
    const sup = (await platformAdminByUserId("user-super"))!;
    await removePlatformAdmin(sup, "pa-super2");
    const remaining = (await listPlatformAdmins()).filter((a) => a.role === SUPER_ADMIN && !a.disabledAt);
    assert.equal(remaining.length, 1);
  });
});

describe("admin-inbjudan", () => {
  it("token hashas, accepteras bara med rätt e-post och blir alltid admin", async () => {
    const sup = (await platformAdminByUserId("user-super"))!;
    const { invitation, token } = await invitePlatformAdmin(sup, "Ny@Driva.se");
    assert.equal(invitation.email, "ny@driva.se");
    assert.equal(invitation.tokenHash, hashPlatformInviteToken(token));
    assert.notEqual(invitation.tokenHash, token);

    await assert.rejects(
      () =>
        acceptPlatformInvitation({
          token,
          user: { id: "user-x", email: "fel@driva.se" },
        }),
      PlatformAdminError
    );

    const created = await acceptPlatformInvitation({
      token,
      user: { id: "user-ny", email: "ny@driva.se", name: "Nils Ny" },
    });
    assert.equal(created.role, "admin");
    assert.equal((await peekPlatformInvitation(token))?.status, "accepted");

    // Engångslänk: kan inte användas igen.
    await assert.rejects(
      () => acceptPlatformInvitation({ token, user: { id: "user-ny2", email: "ny@driva.se" } }),
      PlatformAdminError
    );
  });

  it("utgången inbjudan avvisas men kan skickas om med ny token", async () => {
    const sup = (await platformAdminByUserId("user-super"))!;
    const past = new Date(Date.now() - 30 * 86_400_000);
    const { invitation, token } = await invitePlatformAdmin(sup, "sen@driva.se", past);
    assert.equal(platformInvitationStatus(invitation), "expired");
    await assert.rejects(
      () => acceptPlatformInvitation({ token, user: { id: "u", email: "sen@driva.se" } }),
      PlatformAdminError
    );
    const resent = await resendPlatformInvitation(sup, invitation.id);
    assert.notEqual(resent.token, token);
    const again = await acceptPlatformInvitation({
      token: resent.token,
      user: { id: "user-sen", email: "sen@driva.se" },
    });
    assert.equal(again.role, "admin");
  });

  it("återkallad inbjudan kan aldrig accepteras", async () => {
    const sup = (await platformAdminByUserId("user-super"))!;
    const { invitation, token } = await invitePlatformAdmin(sup, "avbruten@driva.se");
    await revokePlatformInvitation(sup, invitation.id);
    await assert.rejects(
      () => acceptPlatformInvitation({ token, user: { id: "u", email: "avbruten@driva.se" } }),
      PlatformAdminError
    );
  });
});

describe("supportsessioner (Öppna som kund)", () => {
  it("kräver skäl, är tidsbegränsad till 60 min och auditeras", async () => {
    const sup = (await platformAdminByUserId("user-super"))!;
    await assert.rejects(
      () => startSupportSession(sup, { businessId: "biz-1", reason: "  x " }),
      SupportSessionError
    );
    const now = new Date("2026-08-30T10:00:00Z");
    const session = await startSupportSession(sup, {
      businessId: "biz-1",
      reason: "Kunden kan inte skicka faktura 1047",
      ticketId: "ticket-1",
      now,
    });
    assert.equal(session.businessId, "biz-1");
    assert.equal(session.expiresAt, new Date(now.getTime() + 60 * 60_000).toISOString());
    assert.ok(supportSessionIsActive(session, now.getTime()));
    assert.equal(supportSessionIsActive(session, now.getTime() + 61 * 60_000), false);
    const audit = await listAdminAudit({ targetType: "support_session" });
    assert.equal(audit[0]?.action, "support_session_started");
    assert.equal(audit[0]?.metadata.reason, "Kunden kan inte skicka faktura 1047");
  });

  it("ny session avslutar den föregående – aldrig två aktiva tenants samtidigt", async () => {
    const sup = (await platformAdminByUserId("user-super"))!;
    const first = await startSupportSession(sup, { businessId: "biz-1", reason: "Första ärendet" });
    const second = await startSupportSession(sup, { businessId: "biz-2", reason: "Andra ärendet" });
    const reg = platformRegistry();
    const firstRow = reg.sessions.find((s) => s.id === first.id)!;
    assert.ok(firstRow.endedAt, "första sessionen ska ha avslutats");
    assert.equal(reg.sessions.find((s) => s.id === second.id)?.endedAt, undefined);
  });

  it("en admin kan inte avsluta någon annans session, och explicit avslut loggas", async () => {
    const sup = (await platformAdminByUserId("user-super"))!;
    const admin = (await platformAdminByUserId("user-admin"))!;
    const session = await startSupportSession(sup, { businessId: "biz-1", reason: "Felsökning" });
    await assert.rejects(() => endSupportSession(admin, session.id), SupportSessionError);
    await endSupportSession(sup, session.id);
    assert.ok(platformRegistry().sessions.find((s) => s.id === session.id)?.endedAt);
    const audit = await listAdminAudit({ targetType: "support_session", targetId: session.id });
    assert.ok(audit.some((a) => a.action === "support_session_ended"));
  });
});

describe("supportärenden", () => {
  it("A: meddelande skapar öppet ärende med företag och användare", async () => {
    const ticket = await createSupportTicket({
      businessId: "biz-1",
      businessName: "Södermalms Snickeri AB",
      userId: "user-k",
      userEmail: "Kund@Firma.se",
      userName: "Kim Kund",
      message: "Jag kan inte skicka min faktura",
      route: "/ekonomi/fakturor/1047",
      userAgent: "Mozilla/5.0",
      appVersion: "abc123",
      environment: "test",
    });
    assert.equal(ticket.status, "open");
    assert.equal(ticket.priority, "normal");
    assert.equal(ticket.userEmail, "kund@firma.se");
    assert.equal(ticket.userName, "Kim Kund");
    assert.equal(ticket.businessId, "biz-1");
    assert.equal(ticket.businessName, "Södermalms Snickeri AB");
    assert.equal(ticket.subject, "Jag kan inte skicka min faktura");
    assert.equal(ticket.route, "/ekonomi/fakturor/1047");
    assert.equal(ticket.environment, "test");
    const listed = await listSupportTickets({ statuses: ["open"] });
    assert.equal(listed[0]?.id, ticket.id);
    assert.equal(listed[0]?.businessName, "Södermalms Snickeri AB");
    assert.equal(listed[0]?.userEmail, "kund@firma.se");
  });

  it("B: bildbilaga följer med och stannar på ärendet (privat, ingen publik URL)", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const ticket = await createSupportTicket({
      businessId: "biz-1",
      businessName: "Södermalms Snickeri AB",
      userId: "user-k",
      userEmail: "kund@firma.se",
      message: "Här är en skärmdump på felet",
      attachment: { name: "screenshot.png", dataUrl: png },
    });
    assert.equal(ticket.attachmentName, "screenshot.png");
    assert.ok(ticket.attachmentDataUrl?.startsWith("data:image/png"));
    assert.equal(ticket.attachmentDataUrl?.startsWith("http"), false);
    const stored = await supportTicketById(ticket.id);
    assert.equal(stored?.attachmentName, "screenshot.png");
    assert.ok(stored?.attachmentDataUrl?.startsWith("data:image/png"));
  });

  it("C: tomt/för kort meddelande ger svenskt fel och inget ärende", async () => {
    await assert.rejects(
      () => createSupportTicket({ userEmail: "k@k.se", message: "" }),
      (e: unknown) => e instanceof SupportTicketError && /beskriv vad du behöver hjälp med/i.test(e.message)
    );
    await assert.rejects(
      () => createSupportTicket({ userEmail: "k@k.se", message: "hej" }),
      SupportTicketError
    );
    await assert.rejects(
      () =>
        createSupportTicket({
          userEmail: "k@k.se",
          message: "Något är fel med fakturan",
          attachment: { name: "x.exe", dataUrl: "data:application/x-msdownload;base64,AAAA" },
        }),
      SupportTicketError
    );
    assert.equal((await listSupportTickets()).length, 0);
  });

  it("D: Resend nere – ärendet skapas ändå", async () => {
    process.env.SUPPORT_NOTIFY_EMAIL = "ops@driva.se";
    setMailTransportForTests(async () => {
      throw new Error("Resend unavailable");
    });
    try {
      const ticket = await createSupportTicket({
        businessId: "biz-1",
        businessName: "Södermalms Snickeri AB",
        userEmail: "kund@firma.se",
        message: "Jag kan inte skicka min faktura",
      });
      assert.equal(ticket.status, "open");
      const found = await listSupportTickets({ q: "skicka min faktura" });
      assert.equal(found.length, 1);
      assert.equal(found[0]?.id, ticket.id);
    } finally {
      delete process.env.SUPPORT_NOTIFY_EMAIL;
      setMailTransportForTests(undefined);
    }
  });

  it("E: admin öppnar ärende, sätter Pågår och sedan Löst", async () => {
    const sup = (await platformAdminByUserId("user-super"))!;
    const t = await createSupportTicket({
      userEmail: "k@k.se",
      message: "Hjälp med bokföringen tack",
    });
    await setTicketStatus(sup, t.id, "in_progress");
    let current = await supportTicketById(t.id);
    assert.equal(current?.status, "in_progress");
    assert.equal(current?.resolvedAt, undefined);
    await assignTicket(sup, t.id, sup.userId);
    await setTicketStatus(sup, t.id, "resolved");
    current = await supportTicketById(t.id);
    assert.equal(current?.status, "resolved");
    assert.ok(current?.resolvedAt);
    assert.equal(current?.resolvedBy, sup.userId);
    const counts = await countSupportTicketsByStatus();
    assert.equal(counts.resolved, 1);
    assert.equal(counts.open, 0);
    const audit = await listAdminAudit({ targetType: "support_ticket", targetId: t.id });
    const actions = audit.map((a) => a.action);
    assert.ok(actions.includes("ticket_status_changed"));
    assert.ok(actions.includes("ticket_assigned"));
    const found = await listSupportTickets({ q: "bokföringen" });
    assert.equal(found.length, 1);
  });
});

describe("raderingspolicyer (bokföringsdata bevaras alltid)", () => {
  it("användare med bokförd historik i sitt företag kan inte raderas", async () => {
    upsertUser({ id: "user-owner", email: "agare@bygg.se", name: "Erik" });
    putMembership({
      businessId: LOCAL_JSON_BUSINESS_ID,
      businessName: "Bygg AB",
      userId: "user-owner",
      role: "owner",
      createdAt: new Date().toISOString(),
    });
    replaceDb(emptyTestDb({ verifications: [verifikation()] }));
    const policy = await userDeletionPolicy("user-owner");
    assert.equal(policy.canDelete, false);
    assert.ok(policy.blockers[0].includes("bokföringslagen"));
    assert.ok(policy.preserved.length > 0);
    const sup = (await platformAdminByUserId("user-super"))!;
    await assert.rejects(
      () => deleteUserAccount(sup, "user-owner", "agare@bygg.se"),
      AdminOperationError
    );
  });

  it("plattformsadmins och företag med andra medlemmar blockerar radering", async () => {
    // Plattformsadmin: blockeras tills rollen tas bort.
    upsertUser({ id: "user-admin", email: "anna@driva.se", name: "Anna" });
    const adminPolicy = await userDeletionPolicy("user-admin");
    assert.equal(adminPolicy.canDelete, false);

    // Ägare med kvarvarande medlem: blockeras tills ägarskapet flyttats.
    upsertUser({ id: "user-owner", email: "agare@bygg.se", name: "Erik" });
    upsertUser({ id: "user-member", email: "medlem@bygg.se", name: "Moa" });
    for (const [userId, role] of [
      ["user-owner", "owner"],
      ["user-member", "member"],
    ] as const) {
      putMembership({
        businessId: LOCAL_JSON_BUSINESS_ID,
        businessName: "Bygg AB",
        userId,
        role,
        createdAt: new Date().toISOString(),
      });
    }
    const ownerPolicy = await userDeletionPolicy("user-owner");
    assert.equal(ownerPolicy.canDelete, false);
    assert.ok(ownerPolicy.blockers[0].includes("andra aktiva medlemmar"));
  });

  it("ensam ägare av tomt företag kan raderas – medlemskap i andras företag återkallas", async () => {
    upsertUser({ id: "user-solo", email: "solo@firma.se", name: "Sixten" });
    putMembership({
      businessId: LOCAL_JSON_BUSINESS_ID,
      businessName: "Solofirman",
      userId: "user-solo",
      role: "owner",
      createdAt: new Date().toISOString(),
    });
    const policy = await userDeletionPolicy("user-solo");
    assert.equal(policy.canDelete, true);
    assert.equal(policy.businessesToDelete.length, 1);
    const sup = (await platformAdminByUserId("user-super"))!;
    await deleteUserAccount(sup, "user-solo", "solo@firma.se");
    assert.equal(await userDetail("user-solo"), null);
    const audit = await listAdminAudit({ targetType: "user", targetId: "user-solo" });
    assert.equal(audit[0]?.action, "user_deleted");
  });

  it("företag med bokföring kan inte raderas – inaktivering är vägen", async () => {
    replaceDb(emptyTestDb({ verifications: [verifikation()] }));
    const policy = await businessDeletionPolicy(LOCAL_JSON_BUSINESS_ID);
    assert.equal(policy.canDelete, false);
    assert.ok(policy.blockers[0].includes("bokföringslagen"));
  });
});

describe("katalog + inaktiverade företag", () => {
  it("sök hittar företaget och inaktivering stänger åtkomsten i JSON-läget", async () => {
    const { rows } = await searchBusinesses({ q: "Test Snickeri" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Test Snickeri AB");

    await setBusinessDisabled(LOCAL_JSON_BUSINESS_ID, true, "user-super");
    const after = await searchBusinesses({ status: "inaktiverade" });
    assert.equal(after.rows.length, 1);
    assert.ok(after.rows[0].disabledAt);

    // listMemberships-filtret (session.ts) läser samma register: företaget
    // är borta ur medlemslistan tills det återaktiveras.
    const { platformRegistry: reg } = await import("./platform/registry");
    assert.equal(reg().disabledBusinesses.length, 1);
    await setBusinessDisabled(LOCAL_JSON_BUSINESS_ID, false, "user-super");
    assert.equal(reg().disabledBusinesses.length, 0);
  });

  it("användarsök matchar e-post och företagsnamn", async () => {
    upsertUser({ id: "user-owner", email: "agare@bygg.se", name: "Erik" });
    putMembership({
      businessId: LOCAL_JSON_BUSINESS_ID,
      businessName: "Bygg AB",
      userId: "user-owner",
      role: "owner",
      createdAt: new Date().toISOString(),
    });
    assert.equal((await searchUsers({ q: "agare@" })).rows.length, 1);
    assert.equal((await searchUsers({ q: "Bygg AB" })).rows.length, 1);
    assert.equal((await searchUsers({ q: "finnsinte" })).rows.length, 0);
  });
});

describe("audit + mejllogg + metrik", () => {
  it("auditloggen är append-only via modulen och registret exponerar ingen radering", async () => {
    const sup = (await platformAdminByUserId("user-super"))!;
    await writeAdminAudit(sup, { action: "admin_bootstrap", targetType: "platform_admin" });
    const before = (await listAdminAudit({})).length;
    assert.ok(before >= 1);
    const storeExports = await import("./platform/store");
    const deleters = Object.keys(storeExports).filter(
      (k) => /delete|remove|clear/i.test(k) && /audit/i.test(k)
    );
    assert.deepEqual(deleters, []); // ingen raderingsväg för audit
  });

  it("mejlhändelser räknas per status", async () => {
    const at = new Date().toISOString();
    await insertEmailEvent({
      id: "e1", kind: "quote", toEmail: "a@b.se", status: "sent", mode: "test", createdAt: at,
    });
    await insertEmailEvent({
      id: "e2", kind: "invoice", toEmail: "a@b.se", status: "failed", error: "boom", mode: "test", createdAt: at,
    });
    const counts = await countEmailEventsSince(new Date(Date.now() - 60_000).toISOString());
    assert.equal(counts.sent, 1);
    assert.equal(counts.failed, 1);
  });

  it("platformOverview räknar ärenden och sätter null i stället för fejkade tal", async () => {
    await createSupportTicket({ userEmail: "k@k.se", message: "Behöver hjälp med moms" });
    const m = await platformOverview();
    assert.equal(m.support.open, 1);
    assert.equal(m.ai.estimatedCostUsd30d, null); // ingen AI-data → null, ingen påhittad nolla
    assert.equal(m.automation.autoShare30d, null); // inga verifikationer → null
    assert.equal(m.trends.signups.length, 14);
  });
});

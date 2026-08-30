/**
 * Supportläge ("Öppna som kund") – INTE osäker imitation.
 *
 * Flödet: admin anger ett skäl → en tidsbegränsad SupportSession skapas →
 * kundens Driva öppnas med sessionens företag som tenantkontext och en
 * ständigt synlig banner. Admin arbetar hela tiden som SIG SJÄLV:
 *
 *   * inga kundlösenord, inga hashar, ingen inloggning som kunden,
 *   * alla skrivningar attribueras till adminen (aktörsnamn i aktivitets-
 *     loggen + admin_audit_log-rad per skrivning),
 *   * sessionen går ut automatiskt (60 min) och kan avslutas explicit.
 */
import { uid } from "../ids";
import { SUPPORT_SESSION_TTL_MS } from "./auth";
import { writeAdminAudit } from "./audit";
import {
  endSupportSessionRow,
  insertSupportSession,
  listSupportSessions,
  supportSessionById,
} from "./store";
import type { PlatformAdmin, SupportSession } from "./types";

export class SupportSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportSessionError";
  }
}

export async function startSupportSession(
  actor: PlatformAdmin,
  input: { businessId: string; reason: string; ticketId?: string; now?: Date }
): Promise<SupportSession> {
  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw new SupportSessionError("Ange varför du behöver åtkomst (minst några ord).");
  }
  if (!input.businessId) throw new SupportSessionError("Inget företag valt.");

  const now = input.now ?? new Date();

  // En aktiv session per admin: avsluta ev. pågående session först så att
  // det aldrig är tvetydigt vilket företag som ändras.
  const existing = await listSupportSessions({ adminUserId: actor.userId, limit: 10 });
  for (const s of existing) {
    if (!s.endedAt && new Date(s.expiresAt).getTime() > now.getTime()) {
      await endSupportSessionRow(s.id, now.toISOString());
      await writeAdminAudit(actor, {
        action: "support_session_ended",
        targetType: "support_session",
        targetId: s.id,
        businessId: s.businessId,
        metadata: { reason: "ersattes av ny session" },
      });
    }
  }

  const session: SupportSession = {
    id: uid(),
    adminUserId: actor.userId,
    businessId: input.businessId,
    reason,
    ticketId: input.ticketId,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SUPPORT_SESSION_TTL_MS).toISOString(),
  };
  await insertSupportSession(session);
  await writeAdminAudit(actor, {
    action: "support_session_started",
    targetType: "support_session",
    targetId: session.id,
    businessId: input.businessId,
    metadata: { reason, ticketId: input.ticketId ?? null },
  });
  return session;
}

export async function endSupportSession(actor: PlatformAdmin, sessionId: string): Promise<void> {
  const session = await supportSessionById(sessionId);
  if (!session) return;
  if (session.adminUserId !== actor.userId) {
    throw new SupportSessionError("Sessionen tillhör en annan admin.");
  }
  if (session.endedAt) return;
  await endSupportSessionRow(sessionId, new Date().toISOString());
  await writeAdminAudit(actor, {
    action: "support_session_ended",
    targetType: "support_session",
    targetId: sessionId,
    businessId: session.businessId,
    metadata: { reason: "avslutad manuellt" },
  });
}

export { listSupportSessions, supportSessionById };

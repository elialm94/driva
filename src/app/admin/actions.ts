"use server";

/**
 * Server actions för Ferva Admin. VARJE action verifierar behörigheten på
 * nytt (requirePlatformAdmin/requireSuperAdmin) – UI:t döljer bara knappar,
 * servern är källan till sanning (spec §33/§34/§37). Ingen action litar på
 * roll, admin-id eller behörighet från formulärdata.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getPlatformSessionUser,
  requirePlatformAdmin,
  requireSuperAdmin,
  SUPPORT_SESSION_COOKIE,
  SUPPORT_SESSION_TTL_MS,
} from "@/lib/platform/auth";
import {
  acceptPlatformInvitation,
  disablePlatformAdmin,
  enablePlatformAdmin,
  invitePlatformAdmin,
  removePlatformAdmin,
  resendPlatformInvitation,
  revokePlatformInvitation,
  PlatformAdminError,
} from "@/lib/platform/admins";
import { sendPlatformAdminInvite } from "@/lib/platform/mail";
import {
  assignTicket,
  setTicketAdminNotes,
  setTicketPriority,
  setTicketStatus,
  SupportTicketError,
} from "@/lib/platform/tickets";
import { endSupportSession, startSupportSession, SupportSessionError } from "@/lib/platform/support";
import {
  AdminOperationError,
  anonymizeUserAccount,
  deleteBusiness,
  deleteUserAccount,
  disableBusiness,
  disableUserAccount,
  enableBusiness,
  enableUserAccount,
  parseDataSubjectRequest,
  resendAccountantInvite,
  resendVerificationEmail,
} from "@/lib/platform/operations";
import { writeAdminAudit } from "@/lib/platform/audit";
import { OpsError, parseRestoreDrillInput, recordRestoreDrill, sendAdminTestEmail } from "@/lib/platform/ops";
import { PlatformAccessError } from "@/lib/platform/types";
import type { SupportTicketPriority, SupportTicketStatus } from "@/lib/platform/types";
import { BUSINESS_COOKIE } from "@/lib/auth/session";

export type AdminActionState = { error?: string; notice?: string };

/** Kända, avsiktliga fel visas för operatören – allt annat blir generiskt. */
function toError(e: unknown, fallback: string): AdminActionState {
  if (
    e instanceof PlatformAccessError ||
    e instanceof PlatformAdminError ||
    e instanceof SupportTicketError ||
    e instanceof SupportSessionError ||
    e instanceof AdminOperationError ||
    e instanceof OpsError
  ) {
    return { error: e.message };
  }
  return { error: e instanceof Error ? e.message : fallback };
}

/* -------------------------------- Ärenden ---------------------------------- */

export async function setTicketStatusAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const ticketId = String(formData.get("ticketId") ?? "");
    const status = String(formData.get("status") ?? "") as SupportTicketStatus;
    await setTicketStatus(ctx.admin, ticketId, status);
    revalidatePath("/admin/support");
    revalidatePath(`/admin/support/${ticketId}`);
    return { notice: "Status uppdaterad." };
  } catch (e) {
    return toError(e, "Kunde inte uppdatera status.");
  }
}

export async function setTicketPriorityAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const ticketId = String(formData.get("ticketId") ?? "");
    const priority = String(formData.get("priority") ?? "") as SupportTicketPriority;
    await setTicketPriority(ctx.admin, ticketId, priority);
    revalidatePath(`/admin/support/${ticketId}`);
    return { notice: "Prioritet uppdaterad." };
  } catch (e) {
    return toError(e, "Kunde inte uppdatera prioriteten.");
  }
}

export async function setTicketAdminNotesAction(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const ticketId = String(formData.get("ticketId") ?? "");
    const notes = String(formData.get("notes") ?? "");
    await setTicketAdminNotes(ctx.admin, ticketId, notes);
    revalidatePath(`/admin/support/${ticketId}`);
    return { notice: "Anteckningen sparad." };
  } catch (e) {
    return toError(e, "Kunde inte spara anteckningen.");
  }
}

export async function assignTicketToMeAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const ticketId = String(formData.get("ticketId") ?? "");
    const release = formData.get("release") === "1";
    await assignTicket(ctx.admin, ticketId, release ? null : ctx.admin.userId);
    revalidatePath("/admin/support");
    revalidatePath(`/admin/support/${ticketId}`);
    return { notice: release ? "Tilldelningen släppt." : "Ärendet tilldelat dig." };
  } catch (e) {
    return toError(e, "Kunde inte tilldela ärendet.");
  }
}

/* ------------------------------ Supportläge -------------------------------- */

/**
 * Starta supportsession ("Öppna som kund"): kräver skäl, skapar en
 * tidsbegränsad sessionsrad och sätter cookien som pekar ut den. Cookien
 * bär INGEN behörighet – varje request verifierar admin + sessionsrad i DB.
 */
export async function startSupportSessionAction(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  let target = "/";
  try {
    const ctx = await requirePlatformAdmin();
    const businessId = String(formData.get("businessId") ?? "").trim();
    const reason = String(formData.get("reason") ?? "");
    const ticketId = String(formData.get("ticketId") ?? "").trim() || undefined;
    const route = String(formData.get("route") ?? "").trim();
    const session = await startSupportSession(ctx.admin, { businessId, reason, ticketId });
    const jar = await cookies();
    jar.set(SUPPORT_SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: Math.floor(SUPPORT_SESSION_TTL_MS / 1000),
      path: "/",
    });
    // Kundens aktiva företag = sessionens företag (annars öppnas fel tenant).
    jar.set(BUSINESS_COOKIE, businessId, { path: "/", sameSite: "lax" });
    if (route.startsWith("/") && !route.startsWith("//")) target = route;
  } catch (e) {
    return toError(e, "Kunde inte starta supportsessionen.");
  }
  redirect(target);
}

/** Avsluta supportläget: stäng sessionsraden och rensa cookien. */
export async function endSupportSessionAction(): Promise<void> {
  const ctx = await requirePlatformAdmin();
  const jar = await cookies();
  const sessionId = jar.get(SUPPORT_SESSION_COOKIE)?.value;
  if (sessionId) await endSupportSession(ctx.admin, sessionId);
  jar.delete(SUPPORT_SESSION_COOKIE);
  jar.delete(BUSINESS_COOKIE);
  revalidatePath("/", "layout");
  redirect("/admin");
}

/* ------------------------- Admin-teamet (super_admin) ----------------------- */

export async function inviteAdminAction(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const ctx = await requireSuperAdmin();
    const email = String(formData.get("email") ?? "");
    const { invitation, token } = await invitePlatformAdmin(ctx.admin, email);
    const mail = await sendPlatformAdminInvite({ invitation, token });
    revalidatePath("/admin/admins");
    return {
      notice: mail.ok
        ? `Inbjudan skickad till ${invitation.email}.`
        : `Inbjudan skapad men mejlet kunde inte skickas (${mail.error ?? "okänt fel"}). Skicka om den när mejl är konfigurerat.`,
    };
  } catch (e) {
    return toError(e, "Kunde inte skicka inbjudan.");
  }
}

export async function resendAdminInviteAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requireSuperAdmin();
    const invitationId = String(formData.get("invitationId") ?? "");
    const { invitation, token } = await resendPlatformInvitation(ctx.admin, invitationId);
    const mail = await sendPlatformAdminInvite({ invitation, token });
    revalidatePath("/admin/admins");
    return {
      notice: mail.ok
        ? `Inbjudan skickad på nytt till ${invitation.email}.`
        : `Ny länk skapad men mejlet kunde inte skickas (${mail.error ?? "okänt fel"}).`,
    };
  } catch (e) {
    return toError(e, "Kunde inte skicka om inbjudan.");
  }
}

export async function revokeAdminInviteAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requireSuperAdmin();
    await revokePlatformInvitation(ctx.admin, String(formData.get("invitationId") ?? ""));
    revalidatePath("/admin/admins");
    return { notice: "Inbjudan återkallad." };
  } catch (e) {
    return toError(e, "Kunde inte återkalla inbjudan.");
  }
}

export async function disableAdminAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requireSuperAdmin();
    await disablePlatformAdmin(ctx.admin, String(formData.get("adminId") ?? ""));
    revalidatePath("/admin/admins");
    return { notice: "Admin inaktiverad." };
  } catch (e) {
    return toError(e, "Kunde inte inaktivera admin.");
  }
}

export async function enableAdminAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requireSuperAdmin();
    await enablePlatformAdmin(ctx.admin, String(formData.get("adminId") ?? ""));
    revalidatePath("/admin/admins");
    return { notice: "Admin återaktiverad." };
  } catch (e) {
    return toError(e, "Kunde inte återaktivera admin.");
  }
}

export async function removeAdminAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requireSuperAdmin();
    await removePlatformAdmin(ctx.admin, String(formData.get("adminId") ?? ""));
    revalidatePath("/admin/admins");
    return { notice: "Admin borttagen." };
  } catch (e) {
    return toError(e, "Kunde inte ta bort admin.");
  }
}

/**
 * Acceptera admin-inbjudan. Kräver inloggad användare (vanlig Supabase-auth,
 * eller dev-identiteten i JSON-läget) vars e-post matchar inbjudan – men
 * INTE befintlig admin-behörighet (mottagaren är ju inte admin ännu).
 */
export async function acceptAdminInviteAction(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const user = await getPlatformSessionUser();
    if (!user) return { error: "Logga in först med den e-postadress som inbjudan skickades till." };
    const token = String(formData.get("token") ?? "");
    await acceptPlatformInvitation({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (e) {
    return toError(e, "Kunde inte acceptera inbjudan.");
  }
  redirect("/admin");
}

/* -------------------------------- Användare -------------------------------- */

export async function resendVerificationAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return { error: "E-postadress saknas." };
    await resendVerificationEmail(ctx.admin, email);
    return { notice: `Verifieringsmejl skickat till ${email}.` };
  } catch (e) {
    return toError(e, "Kunde inte skicka verifieringsmejlet.");
  }
}

export async function disableUserAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const userId = String(formData.get("userId") ?? "");
    const email = String(formData.get("email") ?? "");
    await disableUserAccount(ctx.admin, userId, email);
    revalidatePath(`/admin/users/${userId}`);
    return { notice: "Kontot inaktiverat. Användaren kan inte längre logga in." };
  } catch (e) {
    return toError(e, "Kunde inte inaktivera kontot.");
  }
}

export async function enableUserAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const userId = String(formData.get("userId") ?? "");
    const email = String(formData.get("email") ?? "");
    await enableUserAccount(ctx.admin, userId, email);
    revalidatePath(`/admin/users/${userId}`);
    return { notice: "Kontot återställt." };
  } catch (e) {
    return toError(e, "Kunde inte återställa kontot.");
  }
}

export async function deleteUserAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const userId = String(formData.get("userId") ?? "");
    const email = String(formData.get("email") ?? "");
    const confirm = String(formData.get("confirmEmail") ?? "").trim().toLowerCase();
    if (confirm !== email.trim().toLowerCase()) {
      return { error: "Bekräfta genom att skriva användarens e-postadress exakt." };
    }
    await deleteUserAccount(ctx.admin, userId, email);
  } catch (e) {
    return toError(e, "Kontot kunde inte raderas.");
  }
  revalidatePath("/admin/users");
  redirect("/admin/users?raderad=1");
}

/**
 * Registrerades begäran (spec §7): rättelse loggas som ärende (admin utför
 * rättelsen i berörd vy eller ber företaget), radering följer
 * raderingspolicyn, anonymisering är vägen när bokföringslagen blockerar
 * radering. Allt auditeras med grund. Bara super_admin får radera/anonymisera.
 */
export async function dataSubjectRequestAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let outcome: { redirectTo?: string; notice?: string } = {};
  try {
    const ctx = await requirePlatformAdmin();
    const userId = String(formData.get("userId") ?? "");
    const email = String(formData.get("email") ?? "");
    const input = parseDataSubjectRequest(Object.fromEntries(formData.entries()));
    if (!userId) return { error: "Användare saknas." };

    if (input.kind === "rattelse") {
      await writeAdminAudit(ctx.admin, {
        action: "data_subject_request",
        targetType: "user",
        targetId: userId,
        metadata: { kind: input.kind, reason: input.reason },
      });
      outcome = {
        notice:
          "Begäran om rättelse är loggad. Utför rättelsen i berörd vy (eller be företaget rätta sina egna kunduppgifter) och notera i ärendet.",
      };
    } else {
      if (ctx.admin.role !== "super_admin") {
        return { error: "Bara super_admin får radera eller anonymisera konton på registrerads begäran." };
      }
      const confirm = String(formData.get("confirmEmail") ?? "").trim().toLowerCase();
      if (confirm !== email.trim().toLowerCase()) {
        return { error: "Bekräfta genom att skriva användarens e-postadress exakt." };
      }
      await writeAdminAudit(ctx.admin, {
        action: "data_subject_request",
        targetType: "user",
        targetId: userId,
        metadata: { kind: input.kind, reason: input.reason },
      });
      if (input.kind === "radering") {
        await deleteUserAccount(ctx.admin, userId, email);
        outcome = { redirectTo: "/admin/users?raderad=1" };
      } else {
        const policy = await anonymizeUserAccount(ctx.admin, userId, email, input.reason);
        outcome = {
          notice: `Kontot är anonymiserat. ${policy.retainedBusinesses.length} företag med bevarandeplikt behålls inaktiverade; ${policy.membershipsToRevoke} medlemskap återkallades.`,
        };
      }
    }
    revalidatePath(`/admin/users/${userId}`);
  } catch (e) {
    return toError(e, "Begäran kunde inte hanteras.");
  }
  if (outcome.redirectTo) {
    revalidatePath("/admin/users");
    redirect(outcome.redirectTo);
  }
  return { notice: outcome.notice };
}

/* --------------------------------- Företag --------------------------------- */

export async function disableBusinessAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const businessId = String(formData.get("businessId") ?? "");
    const name = String(formData.get("name") ?? "");
    await disableBusiness(ctx.admin, businessId, name);
    revalidatePath(`/admin/businesses/${businessId}`);
    return { notice: "Företaget inaktiverat. Medlemmarna kan inte längre öppna det." };
  } catch (e) {
    return toError(e, "Kunde inte inaktivera företaget.");
  }
}

export async function enableBusinessAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const businessId = String(formData.get("businessId") ?? "");
    const name = String(formData.get("name") ?? "");
    await enableBusiness(ctx.admin, businessId, name);
    revalidatePath(`/admin/businesses/${businessId}`);
    return { notice: "Företaget återaktiverat." };
  } catch (e) {
    return toError(e, "Kunde inte återaktivera företaget.");
  }
}

export async function deleteBusinessAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const businessId = String(formData.get("businessId") ?? "");
    const name = String(formData.get("name") ?? "");
    const confirm = String(formData.get("confirmName") ?? "").trim();
    if (!name || confirm !== name.trim()) {
      return { error: "Bekräfta genom att skriva företagets namn exakt." };
    }
    await deleteBusiness(ctx.admin, businessId, name);
  } catch (e) {
    return toError(e, "Företaget kunde inte raderas.");
  }
  revalidatePath("/admin/businesses");
  redirect("/admin/businesses?raderad=1");
}

export async function resendAccountantInviteAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const businessId = String(formData.get("businessId") ?? "");
    const invitationId = String(formData.get("invitationId") ?? "");
    const result = await resendAccountantInvite(ctx.admin, businessId, invitationId);
    revalidatePath(`/admin/businesses/${businessId}`);
    return {
      notice: result.mailOk
        ? "Inbjudan skickad på nytt."
        : "Ny inbjudningslänk skapad men mejlet kunde inte skickas (mejl ej konfigurerat).",
    };
  } catch (e) {
    return toError(e, "Kunde inte skicka om inbjudan.");
  }
}

/* ---------------------------------- Drift ---------------------------------- */

/** Testmejl till adminens EGEN adress – aldrig fri mottagare. Loggas utan innehåll. */
export async function sendTestEmailAction(_prev: AdminActionState, _formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdmin();
    const result = await sendAdminTestEmail(ctx.admin);
    revalidatePath("/admin/system");
    return result.ok ? { notice: result.message } : { error: result.message };
  } catch (e) {
    return toError(e, "Testmejlet kunde inte skickas.");
  }
}

/** Registrera en genomförd restore drill (endast super_admin, auditeras). */
export async function recordRestoreDrillAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requireSuperAdmin();
    const input = parseRestoreDrillInput(Object.fromEntries(formData.entries()));
    await recordRestoreDrill(ctx.admin, input);
    revalidatePath("/admin/system");
    return { notice: `Restore drill ${input.performedOn} (${input.result === "ok" ? "godkänd" : "underkänd"}) är registrerad.` };
  } catch (e) {
    return toError(e, "Drillen kunde inte registreras.");
  }
}

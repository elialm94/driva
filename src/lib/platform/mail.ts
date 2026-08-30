/**
 * Mejl för Driva Admin (admin-inbjudan). Går genom samma sendMail-transport
 * som övriga utskick (Resend, ärliga fel, email_events-logg) men läser ALDRIG
 * tenantdata – adminflödet har ingen tenantkontext.
 */
import { absoluteAppUrl, mailFromAddress, sendMail, type MailResult } from "../mail";
import type { PlatformAdminInvitation } from "./types";

export function adminInviteAcceptPath(token: string): string {
  return `/admin/inbjudan/${encodeURIComponent(token)}`;
}

export async function sendPlatformAdminInvite(input: {
  invitation: PlatformAdminInvitation;
  token: string;
}): Promise<MailResult> {
  const url = absoluteAppUrl(adminInviteAcceptPath(input.token));
  const days = Math.max(
    1,
    Math.round((new Date(input.invitation.expiresAt).getTime() - Date.now()) / 86_400_000)
  );
  const subject = "Du har bjudits in som admin i Driva Admin";
  const text = [
    `Hej!`,
    ``,
    `${input.invitation.invitedByName || "En superadmin"} har bjudit in dig som administratör i Driva Admin (plattformens interna adminverktyg).`,
    ``,
    `Acceptera inbjudan här (giltig i ${days} dagar):`,
    url,
    ``,
    `Du behöver logga in med (eller skapa) ett Driva-konto på exakt den här e-postadressen.`,
    `Om du inte väntade dig det här mejlet kan du ignorera det.`,
  ].join("\n");
  const html = `
    <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 560px; margin: 0 auto; color: #111">
      <h2 style="font-size:18px">Du har bjudits in som admin i Driva Admin</h2>
      <p>${escapeHtml(input.invitation.invitedByName || "En superadmin")} har bjudit in dig som administratör i Driva Admin (plattformens interna adminverktyg).</p>
      <p><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">Acceptera inbjudan</a></p>
      <p style="color:#555;font-size:13px">Länken är giltig i ${days} dagar och kan bara användas en gång.
      Du behöver logga in med (eller skapa) ett Driva-konto på exakt den här e-postadressen.</p>
      <p style="color:#555;font-size:13px">Om du inte väntade dig det här mejlet kan du ignorera det.</p>
    </div>`;
  return sendMail(
    { to: input.invitation.email, from: mailFromAddress(), subject, text, html },
    { kind: "platform_admin_invite", documentId: input.invitation.id }
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

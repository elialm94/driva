"use server";

/**
 * Kundens "Hjälp & support": skapar ett supportärende till Driva Admin.
 * Teknisk kontext (användare, företag, rutt, enhet, version) bifogas
 * automatiskt på SERVERN – kunden skriver aldrig tekniska uppgifter, och
 * klienten kan inte ljuga om vem den är (identiteten tas från sessionen).
 */
import { headers } from "next/headers";
import { getSessionUser, listMemberships, preferredBusinessFromCookie } from "@/lib/auth/session";
import { createSupportTicket, SupportTicketError, TICKET_ATTACHMENT_MAX_BYTES } from "@/lib/platform/tickets";
import { businessNameById } from "@/lib/platform/store";

export type SupportFormState = { error?: string; notice?: string };

export async function createSupportTicketAction(
  _prev: SupportFormState,
  formData: FormData
): Promise<SupportFormState> {
  const user = await getSessionUser();
  if (!user) return { error: "Logga in för att kontakta supporten." };

  const message = String(formData.get("message") ?? "");
  const route = String(formData.get("route") ?? "");

  // Aktivt företag härleds ur sessionen (cookie → medlemskap), aldrig ur
  // formulärdata – en användare kan inte skapa ärenden i andras namn.
  let businessId: string | undefined;
  let businessName = "";
  try {
    const memberships = await listMemberships(user.id);
    const preferred = await preferredBusinessFromCookie();
    businessId =
      preferred && memberships.some((m) => m.businessId === preferred)
        ? preferred
        : memberships[0]?.businessId;
    if (businessId) businessName = (await businessNameById(businessId)) ?? "";
  } catch {
    // Ärendet är värdefullt även utan företagskontext.
  }

  let attachment: { name: string; dataUrl: string } | undefined;
  const file = formData.get("attachment");
  if (file instanceof File && file.size > 0) {
    if (file.size > TICKET_ATTACHMENT_MAX_BYTES) {
      return { error: "Bilagan är för stor (max ca 1,5 MB)." };
    }
    const buf = Buffer.from(await file.arrayBuffer());
    attachment = {
      name: file.name,
      dataUrl: `data:${file.type || "application/octet-stream"};base64,${buf.toString("base64")}`,
    };
  }

  const h = await headers().catch(() => null);
  try {
    await createSupportTicket({
      businessId,
      businessName,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      message,
      route,
      userAgent: h?.get("user-agent") ?? "",
      appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev",
      attachment,
    });
  } catch (e) {
    if (e instanceof SupportTicketError) return { error: e.message };
    return { error: "Något gick fel – försök igen om en stund." };
  }
  return {
    notice: "Tack! Ditt ärende är mottaget – vi återkommer via mejl så snart vi kan.",
  };
}

"use server";

/**
 * Kundens "Hjälp & support": skapar ett supportärende i Driva Admin.
 * Identitet och företag tas från sessionen – aldrig från klientpåståenden.
 * Mejl är inte ett krav; databasen är källan till sanning.
 */
import { headers } from "next/headers";
import { getSessionUser, listMemberships, preferredBusinessFromCookie } from "@/lib/auth/session";
import { createSupportTicket, SupportTicketError, TICKET_ATTACHMENT_MAX_BYTES } from "@/lib/platform/tickets";
import { isAllowedTicketAttachmentMime } from "@/lib/platform/ticket-attachments";
import { businessNameById } from "@/lib/platform/store";

export type SupportFormState = {
  error?: string;
  notice?: string;
  warning?: string;
  field?: "message" | "attachment";
};

const GENERIC_ERROR = "Kunde inte skicka ärendet. Försök igen.";

export async function createSupportTicketAction(
  _prev: SupportFormState,
  formData: FormData
): Promise<SupportFormState> {
  const user = await getSessionUser();
  if (!user) return { error: "Logga in för att kontakta supporten." };

  const message = String(formData.get("message") ?? "").trim();
  if (!message) {
    return { error: "Beskriv vad du behöver hjälp med.", field: "message" };
  }

  const route = String(formData.get("route") ?? "").trim();

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
  } catch (err) {
    console.error("[driva:support] kunde inte läsa företagskontext", err);
  }

  let attachment: { name: string; bytes: Buffer; mime: string } | undefined;
  let attachmentFailed = false;
  const file = formData.get("attachment");
  if (file instanceof File && file.size > 0) {
    if (file.size > TICKET_ATTACHMENT_MAX_BYTES) {
      return { error: "Bilagan är för stor (max 5 MB).", field: "attachment" };
    }
    const mime = file.type || "application/octet-stream";
    if (!isAllowedTicketAttachmentMime(mime)) {
      return { error: "Bilagan måste vara en bild eller PDF.", field: "attachment" };
    }
    try {
      attachment = {
        name: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
        mime,
      };
    } catch (err) {
      console.error("[driva:support] kunde inte läsa bilagan", err);
      attachmentFailed = true;
    }
  }

  const h = await headers().catch(() => null);
  const pageUrl = route || refererPath(h?.get("referer"));
  try {
    await createSupportTicket({
      businessId,
      businessName,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      message,
      route: pageUrl,
      userAgent: h?.get("user-agent") ?? "",
      appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev",
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "",
      attachment,
    });
  } catch (e) {
    if (e instanceof SupportTicketError) {
      return { error: e.message, field: /beskriv/i.test(e.message) ? "message" : undefined };
    }
    console.error("[driva:support] kunde inte skapa ärende", e);
    return { error: GENERIC_ERROR };
  }

  if (attachmentFailed) {
    return {
      notice: "Tack! Ditt ärende är skickat.",
      warning: "Bilagan gick inte att bifoga. Skicka ett nytt ärende om du vill komplettera med filen.",
    };
  }
  return { notice: "Tack! Ditt ärende är skickat." };
}

function refererPath(referer: string | null | undefined): string {
  if (!referer) return "";
  try {
    const url = new URL(referer);
    return `${url.pathname}${url.search}`.slice(0, 300);
  } catch {
    return referer.slice(0, 300);
  }
}

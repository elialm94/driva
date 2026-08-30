/**
 * Supportärenden. Medvetet enkelt (ingen Zendesk): ett ärende, en status,
 * en valfri tilldelad admin. Kundens "Hjälp & support" skapar ärendet med
 * automatiskt bifogad teknisk kontext – kunden skriver aldrig tekniska
 * uppgifter själv.
 */
import { uid } from "../ids";
import { writeAdminAudit } from "./audit";
import {
  insertSupportTicket,
  listSupportTickets,
  countSupportTicketsByStatus,
  supportTicketById,
  updateSupportTicketRow,
} from "./store";
import type {
  PlatformAdmin,
  SupportTicket,
  SupportTicketPriority,
  SupportTicketStatus,
} from "./types";

export class SupportTicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportTicketError";
  }
}

/** Bilagor lagras som data-URL i ärendet – hård storleksgräns på servern. */
export const TICKET_ATTACHMENT_MAX_BYTES = 1_500_000;
const TICKET_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

export function ticketSubjectFromMessage(message: string): string {
  const firstLine = message.replace(/\s+/g, " ").trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

export async function createSupportTicket(input: {
  businessId?: string;
  businessName?: string;
  userId?: string;
  userEmail: string;
  userName?: string;
  message: string;
  route?: string;
  userAgent?: string;
  appVersion?: string;
  attachment?: { name: string; dataUrl: string };
  now?: Date;
}): Promise<SupportTicket> {
  const message = input.message.trim();
  if (message.length < 5) {
    throw new SupportTicketError("Beskriv kort vad du behöver hjälp med (minst några ord).");
  }
  if (message.length > 5000) {
    throw new SupportTicketError("Beskrivningen är för lång (max 5000 tecken).");
  }
  let attachmentName: string | undefined;
  let attachmentDataUrl: string | undefined;
  if (input.attachment?.dataUrl) {
    const { name, dataUrl } = input.attachment;
    const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
    const mime = match?.[1] ?? "";
    if (!TICKET_ATTACHMENT_TYPES.includes(mime)) {
      throw new SupportTicketError("Bilagan måste vara en bild (PNG/JPEG/WebP/GIF) eller PDF.");
    }
    if (dataUrl.length > TICKET_ATTACHMENT_MAX_BYTES * 1.4) {
      throw new SupportTicketError("Bilagan är för stor (max ca 1,5 MB).");
    }
    attachmentName = name.slice(0, 200);
    attachmentDataUrl = dataUrl;
  }

  const now = (input.now ?? new Date()).toISOString();
  const ticket: SupportTicket = {
    id: uid(),
    businessId: input.businessId,
    userId: input.userId,
    userEmail: input.userEmail.trim().toLowerCase(),
    userName: input.userName?.trim() ?? "",
    businessName: input.businessName?.trim() ?? "",
    subject: ticketSubjectFromMessage(message),
    message,
    status: "open",
    priority: "normal",
    route: (input.route ?? "").slice(0, 300),
    userAgent: (input.userAgent ?? "").slice(0, 300),
    appVersion: (input.appVersion ?? "").slice(0, 100),
    attachmentName,
    attachmentDataUrl,
    createdAt: now,
    updatedAt: now,
  };
  await insertSupportTicket(ticket);
  return ticket;
}

const VALID_STATUSES: SupportTicketStatus[] = ["open", "in_progress", "waiting_for_customer", "resolved"];
const VALID_PRIORITIES: SupportTicketPriority[] = ["low", "normal", "high"];

export async function setTicketStatus(
  actor: PlatformAdmin,
  ticketId: string,
  status: SupportTicketStatus
): Promise<void> {
  if (!VALID_STATUSES.includes(status)) throw new SupportTicketError("Ogiltig status.");
  const ticket = await supportTicketById(ticketId);
  if (!ticket) throw new SupportTicketError("Ärendet finns inte.");
  if (ticket.status === status) return;
  await updateSupportTicketRow(ticketId, { status, updatedAt: new Date().toISOString() });
  await writeAdminAudit(actor, {
    action: "ticket_status_changed",
    targetType: "support_ticket",
    targetId: ticketId,
    businessId: ticket.businessId,
    metadata: { from: ticket.status, to: status },
  });
}

export async function setTicketPriority(
  actor: PlatformAdmin,
  ticketId: string,
  priority: SupportTicketPriority
): Promise<void> {
  if (!VALID_PRIORITIES.includes(priority)) throw new SupportTicketError("Ogiltig prioritet.");
  const ticket = await supportTicketById(ticketId);
  if (!ticket) throw new SupportTicketError("Ärendet finns inte.");
  if (ticket.priority === priority) return;
  await updateSupportTicketRow(ticketId, { priority, updatedAt: new Date().toISOString() });
}

export async function assignTicket(
  actor: PlatformAdmin,
  ticketId: string,
  adminUserId: string | null
): Promise<void> {
  const ticket = await supportTicketById(ticketId);
  if (!ticket) throw new SupportTicketError("Ärendet finns inte.");
  await updateSupportTicketRow(ticketId, {
    assignedAdminId: adminUserId,
    updatedAt: new Date().toISOString(),
  });
  await writeAdminAudit(actor, {
    action: "ticket_assigned",
    targetType: "support_ticket",
    targetId: ticketId,
    businessId: ticket.businessId,
    metadata: { assignedAdminId: adminUserId },
  });
}

export { listSupportTickets, countSupportTicketsByStatus, supportTicketById };

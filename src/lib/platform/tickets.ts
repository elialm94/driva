/**
 * Supportärenden. Medvetet enkelt (ingen Zendesk): ett ärende, en status,
 * en valfri intern anteckning. Kundens "Hjälp & support" skapar ärendet i
 * databasen med automatiskt bifogad kontext – mejl är aldrig krav.
 */
import { uid } from "../ids";
import { writeAdminAudit } from "./audit";
import { notifyNewSupportTicket } from "./mail";
import {
  insertSupportTicket,
  listSupportTickets,
  countSupportTicketsByStatus,
  supportTicketById,
  updateSupportTicketRow,
} from "./store";
import {
  isAllowedTicketAttachmentMime,
  storeSupportAttachment,
  TICKET_ATTACHMENT_MAX_BYTES,
} from "./ticket-attachments";
import type {
  PlatformAdmin,
  SupportTicket,
  SupportTicketPriority,
  SupportTicketStatus,
} from "./types";

export { TICKET_ATTACHMENT_MAX_BYTES } from "./ticket-attachments";

export class SupportTicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportTicketError";
  }
}

export function ticketSubjectFromMessage(message: string): string {
  const firstLine = message.replace(/\s+/g, " ").trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

function currentEnvironment(): string {
  return (process.env.VERCEL_ENV || process.env.NODE_ENV || "").slice(0, 40);
}

function mimeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1] ?? "";
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
  environment?: string;
  attachment?: { name: string; dataUrl?: string; bytes?: Buffer; mime?: string };
  now?: Date;
}): Promise<SupportTicket> {
  const message = input.message.trim();
  if (message.length < 5) {
    throw new SupportTicketError("Beskriv vad du behöver hjälp med.");
  }
  if (message.length > 5000) {
    throw new SupportTicketError("Beskrivningen är för lång (max 5000 tecken).");
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
    environment: (input.environment ?? currentEnvironment()).slice(0, 40),
    adminNotes: "",
    createdAt: now,
    updatedAt: now,
  };

  if (input.attachment?.dataUrl || input.attachment?.bytes) {
    const mime = input.attachment.mime || "";
    if (mime && !isAllowedTicketAttachmentMime(mime) && !input.attachment.dataUrl) {
      throw new SupportTicketError("Bilagan måste vara en bild (PNG/JPEG/WebP/GIF) eller PDF.");
    }
    try {
      const stored = await storeSupportAttachment({
        ticketId: ticket.id,
        businessId: input.businessId,
        name: input.attachment.name,
        dataUrl: input.attachment.dataUrl,
        bytes: input.attachment.bytes,
        mime: input.attachment.mime,
      });
      ticket.attachmentName = stored.name;
      ticket.attachmentPath = stored.path;
      ticket.attachmentDataUrl = stored.dataUrl;
    } catch (err) {
      if (err instanceof SupportTicketError) throw err;
      const msg = err instanceof Error ? err.message : "";
      if (/bilagan måste vara|för stor/i.test(msg)) {
        throw new SupportTicketError(msg);
      }
      if (input.attachment.dataUrl && !isAllowedTicketAttachmentMime(mimeFromDataUrl(input.attachment.dataUrl))) {
        throw new SupportTicketError("Bilagan måste vara en bild (PNG/JPEG/WebP/GIF) eller PDF.");
      }
      ticket.attachmentName = undefined;
      ticket.attachmentPath = undefined;
      ticket.attachmentDataUrl = undefined;
      console.error("[driva:support] bilaga kunde inte sparas, ärendet skapas ändå", err);
    }
  }

  await insertSupportTicket(ticket);
  try {
    await notifyNewSupportTicket(ticket);
  } catch (err) {
    console.error("[driva:support] intern avisering misslyckades", err);
  }
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
  const now = new Date().toISOString();
  const resolved = status === "resolved";
  await updateSupportTicketRow(ticketId, {
    status,
    resolvedAt: resolved ? now : null,
    resolvedBy: resolved ? actor.userId : null,
    updatedAt: now,
  });
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

export async function setTicketAdminNotes(_actor: PlatformAdmin, ticketId: string, notes: string): Promise<void> {
  const ticket = await supportTicketById(ticketId);
  if (!ticket) throw new SupportTicketError("Ärendet finns inte.");
  await updateSupportTicketRow(ticketId, {
    adminNotes: notes.trim().slice(0, 4000),
    updatedAt: new Date().toISOString(),
  });
}

export { listSupportTickets, countSupportTicketsByStatus, supportTicketById };

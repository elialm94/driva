import { NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/platform/auth";
import { supportTicketById } from "@/lib/platform/store";
import { signedSupportAttachmentUrl } from "@/lib/platform/ticket-attachments";

/**
 * Privat bilaga: endast plattformsadmin, via signerad Storage-URL.
 * Ingen publik bucket, ingen klient-nyckel.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const ticket = await supportTicketById(id);
  if (!ticket?.attachmentPath) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = await signedSupportAttachmentUrl(ticket.attachmentPath);
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(url);
}

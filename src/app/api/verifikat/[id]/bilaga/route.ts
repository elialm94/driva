import { NextResponse } from "next/server";
import { withBusinessRead } from "@/lib/auth/session";
import { isAllowedReceiptContentType } from "@/lib/receipts/receipt-file";
import { verificationAttachmentContent } from "@/lib/receipts/verification-attachment";
import { verificationWithAttachment } from "@/lib/services/manual-verification";

export const dynamic = "force-dynamic";

/**
 * Serverar underlaget bakom en verifikation, så att en granskare kan öppna
 * det direkt från verifikationsraden. Auktorisering: withBusinessRead –
 * tenantkontexten gör att bara det egna företagets verifikationer går att nå,
 * och bucket-nedladdningen sker med serverns nyckel EFTER den kontrollen.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withBusinessRead(async () => {
    const verification = verificationWithAttachment(id);
    if (!verification?.attachment) {
      return NextResponse.json({ error: "Verifikationen har inget underlag." }, { status: 404 });
    }
    const content = await verificationAttachmentContent(verification.attachment);
    if (!content) {
      return NextResponse.json({ error: "Underlaget finns inte sparat." }, { status: 404 });
    }
    const viewable = isAllowedReceiptContentType(content.contentType) && !/heic/i.test(content.contentType);
    const filename = verification.attachment.filename.replace(/[^\w.\-åäöÅÄÖ ]/g, "_");
    return new NextResponse(new Uint8Array(content.bytes), {
      headers: {
        "Content-Type": viewable ? content.contentType : "application/octet-stream",
        "Content-Disposition": `${viewable ? "inline" : "attachment"}; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  });
}

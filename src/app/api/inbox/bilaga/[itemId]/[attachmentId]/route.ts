import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { attachmentContent, isViewableContentType } from "@/lib/inbox/attachment-content";
import { withBusinessRead } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Serverar en inboxbilaga (PDF/bild) till den inloggade användaren.
 * Auktorisering: withBusinessRead – tenantkontexten gör att bara det egna
 * företagets poster går att nå. Ingen publik URL, ingen token i länken.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ itemId: string; attachmentId: string }> }
) {
  const { itemId, attachmentId } = await ctx.params;
  return withBusinessRead(() => {
    const item = (db().inboxItems ?? []).find((i) => i.id === itemId);
    const attachment = item?.attachments.find((a) => a.id === attachmentId);
    if (!item || !attachment) {
      return NextResponse.json({ error: "Bilagan finns inte." }, { status: 404 });
    }
    const content = attachmentContent(attachment);
    if (!content) {
      return NextResponse.json(
        { error: "Dokumentets innehåll finns inte lagrat – endast uppgifterna om det." },
        { status: 404 }
      );
    }
    // Bara PDF/bilder renderas inline (dokumentvisaren). Allt annat – t.ex.
    // äldre poster med godtycklig contentType – tvingas till nedladdning så att
    // en bilaga aldrig kan köras som HTML/SVG i appens origin.
    const viewable = isViewableContentType(content.contentType);
    const filename = attachment.filename.replace(/[^\w.\-åäöÅÄÖ ]/g, "_");
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

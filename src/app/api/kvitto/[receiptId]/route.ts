import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { withBusinessRead } from "@/lib/auth/session";
import { isAllowedReceiptContentType, receiptFileContent } from "@/lib/receipts/receipt-file";

export const dynamic = "force-dynamic";

/**
 * Serverar kvittofilen bakom en Receipt-rad till den inloggade användaren.
 * Auktorisering: withBusinessRead – tenantkontexten gör att bara det egna
 * företagets kvitton går att nå; bucket-nedladdningen sker med serverns
 * nyckel EFTER den kontrollen. Ingen publik URL.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await ctx.params;
  return withBusinessRead(async () => {
    const receipt = db().receipts.find((r) => r.id === receiptId);
    if (!receipt) return NextResponse.json({ error: "Kvittot finns inte." }, { status: 404 });
    const content = await receiptFileContent(receipt);
    if (!content) {
      return NextResponse.json(
        { error: "Kvittofilen finns inte sparad – endast uppgifterna om köpet." },
        { status: 404 }
      );
    }
    const viewable = isAllowedReceiptContentType(content.contentType) && !/heic/i.test(content.contentType);
    const filename = receipt.filename.replace(/[^\w.\-åäöÅÄÖ ]/g, "_");
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

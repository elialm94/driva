import { NextRequest, NextResponse } from "next/server";
import { withBusinessRead } from "@/lib/auth/session";
import { filingSubmissionById } from "@/lib/filing/submission";
import { filingReceiptFileContent } from "@/lib/filing/receipt-file";
import { isAllowedReceiptContentType } from "@/lib/receipts/receipt-file";

export const dynamic = "force-dynamic";

/**
 * Kvittensfilen från en manuell inlämning, till den inloggade användaren.
 * Samma vakt som kvitton: withBusinessRead ger tenantkontexten (konsultytan
 * skickar ?foretag=<businessId>), och bucketen läses med serverns nyckel
 * först EFTER den kontrollen. Ingen publik URL.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const businessId = req.nextUrl.searchParams.get("foretag") ?? undefined;
  return withBusinessRead(
    async () => {
      const submission = filingSubmissionById(id);
      if (!submission?.manualReceipt?.file) {
        return NextResponse.json({ error: "Det finns ingen kvittensfil för inlämningen." }, { status: 404 });
      }
      const content = await filingReceiptFileContent(submission);
      if (!content) {
        return NextResponse.json({ error: "Kvittensfilen kunde inte läsas från fillagringen." }, { status: 404 });
      }
      const viewable = isAllowedReceiptContentType(content.contentType) && !/heic/i.test(content.contentType);
      const filename = submission.manualReceipt.file.filename.replace(/[^\w.\-åäöÅÄÖ ]/g, "_");
      return new NextResponse(new Uint8Array(content.bytes), {
        headers: {
          "Content-Type": viewable ? content.contentType : "application/octet-stream",
          "Content-Disposition": `${viewable ? "inline" : "attachment"}; filename="${filename}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    },
    { businessId }
  );
}

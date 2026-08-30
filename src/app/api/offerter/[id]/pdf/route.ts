import { NextResponse } from "next/server";
import { withBusinessRead } from "@/lib/auth/session";
import { renderQuotePdfById } from "@/lib/pdf/business-document";
import { contentDisposition } from "@/lib/pdf/filename";

export const dynamic = "force-dynamic";

/** Ladda ner offerten som A4-PDF. Utkast från aktuell draft, skickad från snapshot. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withBusinessRead(() => {
    const pdf = renderQuotePdfById(id);
    if (!pdf) {
      return NextResponse.json({ error: "Offerten finns inte." }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(pdf.filename),
        "Cache-Control": "private, no-store",
      },
    });
  });
}

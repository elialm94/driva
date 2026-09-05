import { NextRequest, NextResponse } from "next/server";
import { withBusiness } from "@/lib/auth/session";
import { buildHusExportFile, markHusFileDownloaded } from "@/lib/services/hus-export";

export const dynamic = "force-dynamic";

/**
 * Laddar ner HUS-filen (Skatteverkets "Begäran" v6, XML) för ett ROT/RUT-ärende.
 * GET /api/skatteverket/hus?jobb=<id> eller ?faktura=<id>
 *
 * Filen byggs och schemakontrolleras vid varje nedladdning och importeras
 * sedan av användaren själv i e-tjänsten "Rot och rut – företag". Inget
 * skickas till Skatteverket härifrån; det enda som skrivs är noteringen att
 * filen hämtats (skrivande tenantkontext).
 */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobb") ?? undefined;
  const invoiceId = req.nextUrl.searchParams.get("faktura") ?? undefined;
  if (!jobId && !invoiceId) {
    return NextResponse.json({ error: "Ange jobb eller faktura." }, { status: 400 });
  }
  return withBusiness(() => {
    try {
      const file = buildHusExportFile({ jobId, invoiceId });
      markHusFileDownloaded({ jobId, invoiceId, fileName: file.fileName });
      return new NextResponse(file.xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${file.fileName}"`,
          "Cache-Control": "private, no-store",
        },
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Filen kunde inte skapas." }, { status: 400 });
    }
  });
}

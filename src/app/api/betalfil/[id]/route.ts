import { NextResponse } from "next/server";
import { getPaymentFile } from "@/lib/services/payment-files";
import { withBusinessRead } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Laddar ned en skapad bankfil (pain.001-XML). Nedladdning är en läsning av
 * en redan skapad fil – att SKAPA filen kräver submit_bank_payment och sker
 * via server actions. XML:en serveras exakt som den genererades ("Hämta
 * bankfil igen" ger alltid samma fil).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withBusinessRead(() => {
    const file = getPaymentFile(id);
    if (!file) {
      return NextResponse.json({ error: "Bankfilen finns inte." }, { status: 404 });
    }
    return new NextResponse(file.xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}

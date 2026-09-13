import { NextResponse } from "next/server";
import { getSessionUser, isDemoSession } from "@/lib/auth/session";
import { buildDataSubjectExport, dataSubjectExportFilename } from "@/lib/legal/data-subject";

/**
 * Registrerades export (art. 15/20 GDPR): den inloggade användarens egna
 * uppgifter som JSON. Ingen tenantkontext behövs – exporten gäller personen,
 * inte företaget. Demosessioner har inget riktigt konto att exportera.
 *
 *   GET /api/konto/export
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Inloggning krävs." }, { status: 401 });
  if (await isDemoSession()) {
    return NextResponse.json({ error: "Demosessionen har inget konto att exportera." }, { status: 403 });
  }
  const data = await buildDataSubjectExport(user);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${dataSubjectExportFilename()}"`,
      "Cache-Control": "no-store",
    },
  });
}

import { NextResponse } from "next/server";
import { advanceProvisioning, enrichDomainView, isDomainError } from "@/lib/domains";
import { getBusinessProfile } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const domain = await advanceProvisioning(id);
    return NextResponse.json({ ok: true, view: await enrichDomainView(domain, getBusinessProfile()) });
  } catch (e) {
    const message = isDomainError(e) ? e.message : "Kunde inte hämta status.";
    const status = isDomainError(e) && e.category === "conflict" ? 404 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

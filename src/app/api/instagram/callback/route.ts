import { NextRequest, NextResponse } from "next/server";
import { completeInstagramConnect } from "@/lib/services/website";
import { withBusiness } from "@/lib/auth/session";
import { instagramHasCredentials } from "@/lib/instagram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth-callback från Instagram API with Instagram Login.
 * Utan INSTAGRAM_APP_ID/SECRET finns inget att byta mot.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  const error = url.searchParams.get("error");
  const hemsida = new URL("/hemsida", url.origin);

  if (error) {
    hemsida.searchParams.set("instagram", "nekad");
    return NextResponse.redirect(hemsida);
  }
  if (!instagramHasCredentials()) {
    hemsida.searchParams.set("instagram", "saknar_uppgifter");
    return NextResponse.redirect(hemsida);
  }
  if (!code || !state) {
    hemsida.searchParams.set("instagram", "fel");
    return NextResponse.redirect(hemsida);
  }

  try {
    await withBusiness(() => completeInstagramConnect({ code, state }), { capability: "change_website" });
    hemsida.searchParams.set("instagram", "ansluten");
    return NextResponse.redirect(hemsida);
  } catch {
    hemsida.searchParams.set("instagram", "fel");
    return NextResponse.redirect(hemsida);
  }
}

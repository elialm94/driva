import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isDrivaAppHost } from "@/lib/domains/config";
import { isWww, apexOf } from "@/lib/domains/hostname";

/**
 * Custom .se-host → publika sajten (/sajt). App-hostar (localhost,
 * driva-alpha.vercel.app) lämnas orörda. Proxy läser inte JSON-lagret –
 * sajtsidan gör hostname-uppslagningen.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? request.headers.get("x-forwarded-host") ?? "";
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (!hostname || isDrivaAppHost(hostname)) return NextResponse.next();

  if (isWww(hostname)) {
    const url = request.nextUrl.clone();
    url.hostname = apexOf(hostname);
    url.protocol = request.nextUrl.protocol;
    return NextResponse.redirect(url, 308);
  }

  const url = request.nextUrl.clone();
  url.pathname = "/sajt";
  const headers = new Headers(request.headers);
  headers.set("x-driva-public-host", hostname);
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

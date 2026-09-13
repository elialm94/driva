import { appRelease } from "@/lib/observability/config";
import { serviceWorkerSource } from "@/lib/pwa/service-worker-source";

/**
 * /sw.js – versionerad service worker (spec §9). Versionen är release-
 * strängen (git-SHA på Vercel), så varje deploy ger en ny worker som städar
 * föregående versions cache vid aktivering. `no-cache` så webbläsaren alltid
 * frågar servern vid uppdateringskontroll; Service-Worker-Allowed låser
 * scopet till roten.
 */
export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  const version = appRelease().replace(/^ferva@/, "");
  return new Response(serviceWorkerSource(version), {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      "service-worker-allowed": "/",
      "content-security-policy": "default-src 'self'; script-src 'self'",
    },
  });
}

import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
    // Ingen staleTimes: dynamic-default är 0 sedan Next 15. Prestandapassets
    // 30 s klientcache återanvände avhuggna RSC-prefetch-payloads vid klick
    // och gav "This page couldn't load" (React #412 Connection closed).
    //
    // useOffline (spec §9): navigeringar och server actions som tappar nätet
    // hålls väntande och görs om när anslutningen är tillbaka, i stället för
    // att kasta. useOffline-hooken driver statuspillen.
    useOffline: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // SAMEORIGIN (inte DENY): dokumentvisaren bäddar in /api/inbox/bilaga i en iframe.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      {
        // Service workern får aldrig cachas av webbläsaren eller CDN – varje
        // deploy är en ny version som ska plockas upp vid nästa kontroll.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/jobb", destination: "/uppdrag", permanent: true },
      { source: "/jobb/:id", destination: "/uppdrag/:id", permanent: true },
      { source: "/pengar", destination: "/ekonomi", permanent: true },
      { source: "/pengar/:path*", destination: "/ekonomi/:path*", permanent: true },
      // /kunder?flik=uppdrag|forfragningar → /uppdrag sköts i kunder/page.tsx så
      // att `flik` städas bort och q/visning/sida/tillbaka följer med.
      { source: "/assistent", destination: "/", permanent: true },
      { source: "/inbox/:id/kontrollera", destination: "/bokforing/underlag/:id/kontrollera", permanent: false },
      { source: "/inbox/:id", destination: "/bokforing/underlag/:id", permanent: false },
      { source: "/inbox", destination: "/bokforing/underlag", permanent: false },
    ];
  },
};

/**
 * Sentry kopplas bara på när en DSN finns – utan konfiguration är bygget
 * identiskt med tidigare. Source maps laddas upp enbart när SENTRY_ORG,
 * SENTRY_PROJECT och SENTRY_AUTH_TOKEN alla är satta (CI/Vercel).
 */
const sentryEnabled = Boolean(process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim());
const sourceMaps = Boolean(
  process.env.SENTRY_ORG?.trim() && process.env.SENTRY_PROJECT?.trim() && process.env.SENTRY_AUTH_TOKEN?.trim()
);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      telemetry: false,
      disableLogger: true,
      widenClientFileUpload: sourceMaps,
      sourcemaps: { disable: !sourceMaps, deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;

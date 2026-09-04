import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
    // Ingen staleTimes: dynamic-default är 0 sedan Next 15. Prestandapassets
    // 30 s klientcache återanvände avhuggna RSC-prefetch-payloads vid klick
    // och gav "This page couldn't load" (React #412 Connection closed).
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
    ];
  },
};

export default nextConfig;

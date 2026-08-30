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
  async redirects() {
    return [
      { source: "/jobb", destination: "/uppdrag", permanent: true },
      { source: "/jobb/:id", destination: "/uppdrag/:id", permanent: true },
      { source: "/pengar", destination: "/ekonomi", permanent: true },
      { source: "/pengar/:path*", destination: "/ekonomi/:path*", permanent: true },
      { source: "/uppdrag", destination: "/kunder?flik=uppdrag", permanent: true },
      { source: "/assistent", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
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

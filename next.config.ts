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
    ];
  },
};

export default nextConfig;

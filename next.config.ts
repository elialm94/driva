import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    /**
     * Klientcache för besökta sidor (§ prestandapasset): tillbaka-navigering
     * och upprepade besök inom fönstret återanvänder RSC-payloaden direkt –
     * ingen refetch-laddning-rendering. Muterande flöden invaliderar cachen
     * (server actions med revalidatePath, router.refresh() efter åtgärder,
     * cookie-byten vid företags-/arbetsytebyte), så finansiella vyer visar
     * aldrig inaktuellt efter en egen ändring.
     */
    staleTimes: {
      dynamic: 30,
      static: 300,
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

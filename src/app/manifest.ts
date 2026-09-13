import type { MetadataRoute } from "next";

/**
 * Web app manifest (spec §9). Installerbar på Android/Chrome och iOS Safari
 * ("Lägg till på hemskärmen"). start_url är appens start – proxyn skickar
 * utloggade till /login precis som vanligt.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Ferva",
    short_name: "Ferva",
    description: "Du gör jobbet. Ferva sköter administrationen – offerter, fakturor, betalningar och bokföring.",
    lang: "sv",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f6f2",
    theme_color: "#f7f6f2",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Fältläge", short_name: "Fält", url: "/falt", description: "Registrera tid, foton och kvitton – även utan nät." },
      { name: "Uppdrag", url: "/uppdrag" },
      { name: "Bokföring", url: "/bokforing" },
    ],
  };
}

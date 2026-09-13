import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor-skal runt Fervas webbapp (spec §9). Skalet laddar den driftsatta
 * PWA:n via `server.url` – ingen webbkod byggs in i appen, så en deploy av
 * webben är en deploy av mobilappen. URL:en sätts i miljön vid bygget:
 *
 *   FERVA_APP_URL=https://app.ferva.se npx cap sync
 *
 * Utan variabeln pekar skalet på den lokala dev-servern (Android-emulatorns
 * alias för värdmaskinen). Inga hemligheter här – filen checkas in.
 */
const appUrl = process.env.FERVA_APP_URL?.trim() || "http://10.0.2.2:3000";

const config: CapacitorConfig = {
  appId: "se.ferva.app",
  appName: "Ferva",
  // Tomt webDir: allt innehåll kommer från server.url. Mappen finns bara för
  // att Capacitor kräver den vid sync.
  webDir: "www",
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith("http://"),
    // Så att cookies (Supabase-sessionen) hör till appens origin på iOS.
    iosScheme: "https",
    androidScheme: "https",
  },
  ios: {
    contentInset: "automatic",
    limitsNavigationsToAppBoundDomains: true,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    StatusBar: { style: "LIGHT", backgroundColor: "#f7f6f2" },
  },
};

export default config;

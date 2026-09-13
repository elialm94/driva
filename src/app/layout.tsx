import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { appOrigin } from "@/lib/app-origin";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Delningsbilden (opengraph-image.tsx) måste anges med absolut URL.
  metadataBase: new URL(appOrigin()),
  title: { default: "Ferva", template: "%s · Ferva" },
  description:
    "Du gör jobbet. Ferva sköter administrationen – offerter som kunden godkänner digitalt, fakturor, betalningar och bokföring.",
  applicationName: "Ferva",
  appleWebApp: { capable: true, title: "Ferva", statusBarStyle: "default" },
  icons: {
    // .ico-länken kommer redan från src/app/favicon.ico (filkonventionen), så
    // den ska inte upprepas här. SVG:n läggs till vid sidan av den: webbläsare
    // som klarar SVG får det skarpa märket, övriga faller tillbaka på .ico.
    icon: { url: "/brand/favicon.svg", type: "image/svg+xml" },
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f6f2",
  width: "device-width",
  initialScale: 1,
  // Krävs för env(safe-area-inset-*) på iOS – bottennav och sticky knappar
  // lägger sig annars bakom hemindikatorn. Ingen maximum-scale/user-scalable:
  // användare ska kunna zooma.
  viewportFit: "cover",
};

// All data läses från den fil-baserade demodatabasen vid varje request.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="sv" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full font-sans text-[15px] leading-relaxed">
        {children}
      </body>
    </html>
  );
}

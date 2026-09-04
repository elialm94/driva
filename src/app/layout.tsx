import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Driva", template: "%s · Driva" },
  description:
    "Du gör jobbet. Driva sköter administrationen – offerter som kunden godkänner digitalt, fakturor, betalningar och bokföring.",
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

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
    "Du gör jobbet. Driva sköter administrationen – offerter med BankID, fakturor, betalningar och bokföring.",
};

export const viewport: Viewport = {
  themeColor: "#f7f6f2",
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

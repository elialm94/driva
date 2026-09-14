import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui-classes";
import { FervaMark } from "@/components/ferva-mark";

export const metadata: Metadata = { title: "Ingen anslutning" };

/**
 * Statisk reservsida som service workern visar när en navigering misslyckas
 * utan nät (spec §9). Läser ingen data och kräver ingen session – den
 * förcachas vid installationen. Fältläget länkas eftersom det är det enda i
 * appen som fungerar offline.
 */
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      {/* Inline SVG, så märket finns även när sidan visas helt utan nät. */}
      <FervaMark size={48} />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Ingen anslutning</h1>
        <p className="text-soft">
          Den här sidan behöver nät. Ferva sparar inget företagsinnehåll i webbläsaren, så det som visas här är alltid
          färskt från servern.
        </p>
        <p className="text-soft">
          Behöver du registrera tid, ta foton eller spara kvitton ute på plats? Fältläget fungerar utan nät på de
          uppdrag du valt att ha med dig, och synkar när anslutningen är tillbaka.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/falt" className={buttonClasses("primary")}>
          Öppna fältläget
        </Link>
        <Link href="/" className={buttonClasses("secondary")}>
          Försök igen
        </Link>
      </div>
    </main>
  );
}

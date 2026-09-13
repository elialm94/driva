import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { LEGAL_DOCUMENTS, dpaSections } from "@/lib/legal/documents";
import { legalEntityStatus } from "@/lib/legal/entity";
import { activeProviders } from "@/lib/legal/providers";

export const metadata: Metadata = {
  title: "Personuppgiftsbiträdesavtal",
  description: "Personuppgiftsbiträdesavtal och säkerhetsbilaga för tjänsten Ferva.",
};

export const dynamic = "force-dynamic";

export default function BitradesavtalPage() {
  const entity = legalEntityStatus();
  return (
    <LegalDocument
      meta={LEGAL_DOCUMENTS.dpa}
      sections={dpaSections(entity, activeProviders())}
      entity={entity}
      intro={
        <p className="leading-relaxed text-soft">
          Biträdesavtalet ingår i de allmänna villkoren och gäller automatiskt för alla företag som använder Ferva. Det
          behöver inte signeras separat; företaget kan när som helst hämta en kopia från den här sidan.
        </p>
      }
    />
  );
}

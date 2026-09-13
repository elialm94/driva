import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { LEGAL_DOCUMENTS, privacySections } from "@/lib/legal/documents";
import { legalEntityStatus } from "@/lib/legal/entity";
import { activeProviders } from "@/lib/legal/providers";

export const metadata: Metadata = {
  title: "Integritetspolicy",
  description: "Hur Ferva behandlar personuppgifter.",
};

export const dynamic = "force-dynamic";

export default function IntegritetPage() {
  const entity = legalEntityStatus();
  return (
    <LegalDocument
      meta={LEGAL_DOCUMENTS.integritet}
      sections={privacySections(entity, activeProviders())}
      entity={entity}
    />
  );
}

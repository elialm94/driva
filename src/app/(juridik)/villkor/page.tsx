import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { LEGAL_DOCUMENTS, termsSections } from "@/lib/legal/documents";
import { legalEntityStatus } from "@/lib/legal/entity";

export const metadata: Metadata = {
  title: "Villkor",
  description: "Allmänna villkor för tjänsten Ferva.",
};

export const dynamic = "force-dynamic";

export default function VillkorPage() {
  const entity = legalEntityStatus();
  return <LegalDocument meta={LEGAL_DOCUMENTS.villkor} sections={termsSections(entity)} entity={entity} />;
}

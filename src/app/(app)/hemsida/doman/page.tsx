import { PageHeader } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { DomainSearchPanel } from "@/components/domain-widgets";
import { enrichDomainView, isMockDomainMode, missingRegistrantFields, primaryDomain } from "@/lib/domains";
import { getBusinessProfile } from "@/lib/services/settings";

export const metadata = { title: "Domän" };

export default async function DomainPage() {
  const company = getBusinessProfile();
  const domain = primaryDomain();
  const missing = missingRegistrantFields(company);
  const view = domain ? await enrichDomainView(domain, company) : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<BackLink fallbackHref="/hemsida" fallbackLabel="Hemsida" />}
        title="Domän"
        subtitle="Sök en .se-adress, köp och koppla – vi sköter resten."
      />
      <div className="mx-auto max-w-xl">
        <DomainSearchPanel
          demo={isMockDomainMode()}
          companyName={company.name}
          orgNumber={company.orgNumber}
          email={company.email}
          initialView={view}
          missingProfile={missing.length > 0 && !view}
        />
      </div>
    </div>
  );
}

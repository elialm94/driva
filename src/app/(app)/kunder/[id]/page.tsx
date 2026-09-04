import { notFound } from "next/navigation";
import { getCustomer } from "@/lib/services/data";
import { isDesignationOnlyLocation } from "@/lib/services/work-locations";
import { maskPersonnummer } from "@/lib/personnummer";
import { customerActivityFeed, customerMoneyLine } from "@/lib/services/customer-activity";
import { customerChainCtas } from "@/lib/services/business-chain";
import { SectionTitle } from "@/components/ui";
import { CustomerDetailsPanel } from "@/components/customer-details-panel";
import { CustomerRotSection } from "@/components/customer-rot-section";
import { CustomerActivity } from "@/components/customer-activity";
import { CustomerChainActions } from "@/components/customer-chain-actions";
import { SmartBack } from "@/components/back-link";
import { pageOrigin } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Kund" };

export default async function CustomerPage(props: PageProps<"/kunder/[id]">) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const customer = getCustomer(id);
  if (!customer) notFound();

  const fromHere = pageOrigin(`/kunder/${customer.id}`, searchParams, customer.name);
  const activity = customerActivityFeed(customer.id);
  const money = customerMoneyLine(customer.id);
  const designations = (customer.workLocations ?? [])
    .map((location) => location.propertyDesignation?.trim())
    .filter((value): value is string => Boolean(value));

  return (
    <div className="animate-fade-up">
      <CustomerDetailsPanel
        customer={{
          id: customer.id,
          kind: customer.kind,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          postalCode: customer.postalCode,
          city: customer.city,
          orgNumber: customer.orgNumber,
          contactPerson: customer.contactPerson,
          notes: customer.notes,
          personalIdentityNumberMasked: customer.personalIdentityNumber
            ? maskPersonnummer(customer.personalIdentityNumber)
            : "",
          hasPersonnummer: Boolean(customer.personalIdentityNumber),
          properties: (customer.workLocations ?? [])
            .filter((location) => location.propertyDesignation?.trim() || isDesignationOnlyLocation(location))
            .map((location) => ({ id: location.id, designation: location.propertyDesignation ?? "" })),
        }}
        designations={designations}
        maskedPersonnummer={
          customer.personalIdentityNumber ? maskPersonnummer(customer.personalIdentityNumber) : undefined
        }
        back={<SmartBack />}
        actions={
          <CustomerChainActions
            customerId={customer.id}
            customerName={customer.name}
            customerKind={customer.kind}
            workLocations={(customer.workLocations ?? []).map((l) => ({
              id: l.id,
              label: l.label,
              city: l.city,
            }))}
            defaultWorkLocationId={customer.defaultWorkLocationId}
            ctas={customerChainCtas(customer.id, fromHere)}
            from={fromHere}
          />
        }
      />

      {customer.kind === "privat" ? (
        <div className="mt-8">
          <SectionTitle>ROT/RUT</SectionTitle>
          <CustomerRotSection
            customerId={customer.id}
            workLocations={customer.workLocations ?? []}
            defaultWorkLocationId={customer.defaultWorkLocationId}
          />
        </div>
      ) : null}

      <div className="mt-8">
        <SectionTitle>Aktivitet</SectionTitle>
        <CustomerActivity rows={activity} money={money} originLabel={customer.name} />
      </div>
    </div>
  );
}

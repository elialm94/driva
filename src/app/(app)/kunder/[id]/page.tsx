import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { getCustomer } from "@/lib/services/data";
import { isDesignationOnlyLocation } from "@/lib/services/work-locations";
import { maskPersonnummer } from "@/lib/personnummer";
import { customerActivityFeed, customerMoneyLine } from "@/lib/services/customer-activity";
import { ButtonLink, SectionTitle } from "@/components/ui";
import { CustomerDetailsPanel } from "@/components/customer-details-panel";
import { CustomerRotSection } from "@/components/customer-rot-section";
import { CustomerActivity } from "@/components/customer-activity";
import { NewUppdragButton } from "@/components/uppdrag-form";
import { SmartBack } from "@/components/back-link";
import { newInvoiceHref, newQuoteHref } from "@/lib/nav";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Kund" };

export default async function CustomerPage(props: PageProps<"/kunder/[id]">) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const customer = getCustomer(id);
  if (!customer) notFound();

  const fromHere = { href: `/kunder/${customer.id}`, label: customer.name };
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
          <div className="flex flex-wrap gap-2">
            <NewUppdragButton
              customers={[{ id: customer.id, name: customer.name, kind: customer.kind }]}
              defaultCustomerId={customer.id}
              workLocations={(customer.workLocations ?? []).map((l) => ({
                id: l.id,
                label: l.label,
                city: l.city,
              }))}
              defaultWorkLocationId={customer.defaultWorkLocationId}
              size="sm"
              variant="secondary"
            />
            <ButtonLink href={newQuoteHref({ kund: customer.id, from: fromHere })} size="sm" variant="secondary">
              <Plus className="size-3.5" /> Ny offert
            </ButtonLink>
            <ButtonLink href={newInvoiceHref({ kund: customer.id, from: fromHere })} size="sm">
              <Plus className="size-3.5" /> Ny faktura
            </ButtonLink>
          </div>
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

import { notFound } from "next/navigation";
import { Mail, Phone, MapPin, Plus } from "lucide-react";
import { getCustomer } from "@/lib/services/data";
import { maskPersonnummer } from "@/lib/personnummer";
import { customerActivityFeed, customerMoneyLine } from "@/lib/services/customer-activity";
import { ButtonLink, PageHeader, SectionTitle } from "@/components/ui";
import { CustomerAutosaveFields } from "@/components/customer-details-form";
import { CustomerRotSection } from "@/components/customer-rot-section";
import { CustomerActivity } from "@/components/customer-activity";
import { NewUppdragButton } from "@/components/uppdrag-form";
import { SmartBack } from "@/components/back-link";
import { newInvoiceHref, newQuoteHref } from "@/lib/nav";
import { CustomerEditDisclosure } from "@/components/customer-edit-disclosure";
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
  const addressLine = [customer.address, [customer.postalCode, customer.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack />}
        crumbs={[{ href: "/kunder?flik=kunder", label: "Kunder" }, { label: customer.name }]}
        title={customer.name}
        subtitle={customer.kind === "foretag" ? "Företag" : "Privatperson"}
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

      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] text-soft">
        {customer.kind === "foretag" && customer.orgNumber ? <span>Org.nr {customer.orgNumber}</span> : null}
        {customer.kind === "foretag" && customer.contactPerson ? <span>{customer.contactPerson}</span> : null}
        {customer.email ? (
          <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 hover:text-ink">
            <Mail className="size-3.5 text-muted" /> {customer.email}
          </a>
        ) : null}
        {customer.phone ? (
          <span className="flex items-center gap-1.5">
            <Phone className="size-3.5 text-muted" /> {customer.phone}
          </span>
        ) : null}
        {addressLine ? (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3.5 text-muted" /> {addressLine}
          </span>
        ) : null}
      </div>

      <CustomerEditDisclosure>
        <CustomerAutosaveFields
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
          }}
        />
      </CustomerEditDisclosure>

      {customer.kind === "privat" ? (
        <div className="mt-8">
          <SectionTitle>ROT/RUT</SectionTitle>
          <CustomerRotSection
            customerId={customer.id}
            personalIdentityNumberMasked={
              customer.personalIdentityNumber ? maskPersonnummer(customer.personalIdentityNumber) : ""
            }
            hasPersonnummer={Boolean(customer.personalIdentityNumber)}
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

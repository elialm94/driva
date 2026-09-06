"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Mail, Phone, MapPin } from "lucide-react";
import { IDLE_AUTOSAVE, type AutosaveState } from "@/lib/autosave";
import { PageHeader } from "./ui";
import { CustomerEditDisclosure } from "./customer-edit-disclosure";
import {
  CustomerAutosaveFields,
  identityFromCustomer,
  type CustomerContactDraft,
  type CustomerIdentityDraft,
} from "./customer-details-form";
import { SaveStatus } from "./save-status";

export function CustomerDetailsPanel({
  customer,
  designations,
  maskedPersonnummer,
  back,
  actions,
}: {
  customer: CustomerContactDraft;
  designations: string[];
  maskedPersonnummer?: string;
  back: ReactNode;
  actions: ReactNode;
}) {
  const [identity, setIdentity] = useState<CustomerIdentityDraft>(() => identityFromCustomer(customer));
  const [save, setSave] = useState<AutosaveState>(IDLE_AUTOSAVE);
  const retryRef = useRef<() => void>(() => {});
  const onRetryReady = useCallback((retry: () => void) => {
    retryRef.current = retry;
  }, []);

  const title = identity.name.trim() || "Kund";
  const addressLine = [identity.address, [identity.postalCode, identity.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageHeader
        back={back}
        crumbs={[{ href: "/kunder", label: "Kunder" }, { label: title }]}
        title={title}
        subtitle={customer.kind === "foretag" ? "Företag" : "Privatperson"}
        actions={actions}
      />

      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] text-soft">
        {customer.kind === "foretag" && identity.orgNumber ? <span>Org.nr {identity.orgNumber}</span> : null}
        {customer.kind === "privat" && maskedPersonnummer ? <span>Pers.nr {maskedPersonnummer}</span> : null}
        {customer.kind === "foretag" && identity.contactPerson ? <span>{identity.contactPerson}</span> : null}
        {customer.reverseChargeConstruction ? <span>Omvänd byggmoms</span> : null}
        {designations.length > 0 ? <span>{designations.join(" · ")}</span> : null}
        {identity.email ? (
          <a href={`mailto:${identity.email}`} className="flex items-center gap-1.5 hover:text-ink">
            <Mail className="size-3.5 text-muted" /> {identity.email}
          </a>
        ) : null}
        {identity.phone ? (
          <span className="flex items-center gap-1.5">
            <Phone className="size-3.5 text-muted" /> {identity.phone}
          </span>
        ) : null}
        {addressLine ? (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3.5 text-muted" /> {addressLine}
          </span>
        ) : null}
      </div>

      <CustomerEditDisclosure
        status={<SaveStatus state={save} onRetry={() => retryRef.current()} />}
      >
        <CustomerAutosaveFields
          customer={customer}
          onIdentityChange={setIdentity}
          onSaveStateChange={setSave}
          onRetryReady={onRetryReady}
        />
      </CustomerEditDisclosure>
    </>
  );
}

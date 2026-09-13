"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerDetailsAction } from "@/app/actions";
import {
  formatSwedishOrganizationNumber,
  validateSwedishOrganizationNumber,
} from "@/lib/validation";
import type { AutosaveState } from "@/lib/autosave";
import { AddressFields } from "./address-input";
import { FieldError, invalidFieldCls } from "./form-validation";
import { useAutosaveLoop } from "./use-autosave";
import { cx } from "./ui";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export type CustomerContactDraft = {
  id: string;
  kind: "privat" | "foretag";
  name: string;
  email: string;
  phone: string;
  address?: string;
  postalCode?: string;
  city?: string;
  orgNumber?: string;
  contactPerson?: string;
  notes: string;
  reverseChargeConstruction?: boolean;
};

export type CustomerIdentityDraft = {
  name: string;
  email: string;
  phone: string;
  address?: string;
  postalCode?: string;
  city?: string;
  orgNumber?: string;
  contactPerson?: string;
};

export function identityFromCustomer(customer: CustomerContactDraft): CustomerIdentityDraft {
  return {
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    postalCode: customer.postalCode,
    city: customer.city,
    orgNumber: customer.orgNumber,
    contactPerson: customer.contactPerson,
  };
}

export function CustomerAutosaveFields({
  customer,
  onIdentityChange,
  onSaveStateChange,
  onRetryReady,
}: {
  customer: CustomerContactDraft;
  onIdentityChange?: (identity: CustomerIdentityDraft) => void;
  onSaveStateChange?: (state: AutosaveState) => void;
  onRetryReady?: (retry: () => void) => void;
}) {
  const router = useRouter();
  const { state, loop } = useAutosaveLoop();
  const [values, setValues] = useState(customer);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const valuesRef = useRef(values);
  const savedSnap = useRef(snap(customer));
  valuesRef.current = values;

  useEffect(() => {
    onSaveStateChange?.(state);
  }, [onSaveStateChange, state]);

  useEffect(() => {
    onRetryReady?.(() => {
      void loop.flush();
    });
  }, [loop, onRetryReady]);

  function emitIdentity(next: CustomerContactDraft) {
    onIdentityChange?.(identityFromCustomer(next));
  }

  function schedulePersist() {
    loop.notify(snap(valuesRef.current), persistAll);
  }

  function patch(next: Partial<CustomerContactDraft>) {
    const merged = { ...valuesRef.current, ...next };
    valuesRef.current = merged;
    setValues(merged);
    emitIdentity(merged);
    if (next.email !== undefined) setFieldError(null);
    schedulePersist();
  }

  function flush() {
    void loop.flush();
  }

  async function persistAll() {
    const next = valuesRef.current;
    const detailsKey = snap(next);

    if (detailsKey !== savedSnap.current) {
      const result = await updateCustomerDetailsAction(customer.id, {
        name: next.name,
        email: next.email,
        phone: next.phone,
        address: next.address,
        postalCode: next.postalCode,
        city: next.city,
        orgNumber: next.orgNumber,
        contactPerson: next.contactPerson,
        notes: next.notes,
        reverseChargeConstruction: Boolean(next.reverseChargeConstruction),
      });
      if (!result.ok) {
        if (result.field === "email") setFieldError(result.error);
        return result;
      }
      savedSnap.current = detailsKey;
      setFieldError(null);
    }

    router.refresh();
    return { ok: true } as const;
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} htmlFor="kund-namn">
          Namn
        </label>
        <input
          id="kund-namn"
          value={values.name}
          onChange={(e) => patch({ name: e.target.value })}
          onBlur={flush}
          className={inputCls}
        />
      </div>
      {customer.kind === "foretag" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Kontaktperson</label>
            <input
              value={values.contactPerson ?? ""}
              onChange={(e) => patch({ contactPerson: e.target.value })}
              onBlur={flush}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Org.nr</label>
            <input
              inputMode="numeric"
              autoComplete="off"
              placeholder="555555-5555"
              value={values.orgNumber ?? ""}
              onChange={(e) => patch({ orgNumber: e.target.value })}
              onBlur={() => {
                const r = validateSwedishOrganizationNumber(values.orgNumber ?? "");
                if (r.ok && r.normalized) patch({ orgNumber: formatSwedishOrganizationNumber(r.normalized) });
                flush();
              }}
              className={inputCls}
            />
          </div>
          <ReverseChargeField
            checked={Boolean(values.reverseChargeConstruction)}
            onChange={(next) => {
              patch({ reverseChargeConstruction: next });
              flush();
            }}
          />
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="kund-epost">
            E-post
          </label>
          <input
            id="kund-epost"
            type="email"
            value={values.email}
            onChange={(e) => patch({ email: e.target.value })}
            onBlur={flush}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? "kund-epost-fel" : undefined}
            className={cx(inputCls, fieldError && invalidFieldCls)}
          />
          <FieldError id="kund-epost-fel">{fieldError}</FieldError>
        </div>
        <div>
          <label className={labelCls}>Telefon</label>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={(e) => patch({ phone: e.target.value })}
            onBlur={flush}
            className={inputCls}
          />
        </div>
      </div>
      <AddressFields
        defaults={{
          address: customer.address ?? "",
          postalCode: customer.postalCode ?? "",
          city: customer.city ?? "",
        }}
        onChange={(parts) => patch(parts)}
        onBlur={flush}
      />
      <div>
        <label className={labelCls} htmlFor="kund-anteckningar">
          Anteckningar
        </label>
        <textarea
          id="kund-anteckningar"
          value={values.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          onBlur={flush}
          rows={2}
          placeholder="Portkod, önskemål, bra att veta …"
          className={cx(inputCls, "resize-none")}
        />
      </div>
    </div>
  );
}

function snap(c: CustomerContactDraft): string {
  return JSON.stringify({
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address ?? "",
    postalCode: c.postalCode ?? "",
    city: c.city ?? "",
    orgNumber: c.orgNumber ?? "",
    contactPerson: c.contactPerson ?? "",
    notes: c.notes,
    reverseChargeConstruction: Boolean(c.reverseChargeConstruction),
  });
}

/**
 * Omvänd byggmoms är ett uttryckligt val, inte en bedömning: produkten vet
 * inte om köparen bedriver byggverksamhet. Slås den på faktureras kunden utan
 * moms och laghänvisningen hamnar på fakturan.
 */
function ReverseChargeField({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 sm:col-span-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 rounded border-line-strong accent-accent"
      />
      <span className="text-[13px] leading-snug">
        <span className="font-medium text-ink">Omvänd byggmoms</span>
        <span className="block text-muted">
          Kunden är ett byggföretag som redovisar momsen själv. Fakturor till kunden får 0 % moms och laghänvisning.
        </span>
      </span>
    </label>
  );
}

export { SaveHint } from "./save-status";

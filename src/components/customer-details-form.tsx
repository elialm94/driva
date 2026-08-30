"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  revealCustomerPersonnummerAction,
  syncCustomerPropertiesAction,
  updateCustomerDetailsAction,
  updateCustomerPersonnummerAction,
} from "@/app/actions";
import { formatPersonnummer, isPersonnummerFormat } from "@/lib/personnummer";
import { IDLE_AUTOSAVE, mergeAutosaveStates, type AutosaveState } from "@/lib/autosave";
import { AddressFields } from "./address-input";
import { FieldError, invalidFieldCls } from "./form-validation";
import { PropertyDesignationFields, type PropertyDesignationDraft } from "./property-designation-fields";
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
  personalIdentityNumberMasked?: string;
  hasPersonnummer?: boolean;
  properties?: PropertyDesignationDraft[];
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
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [pinState, setPinState] = useState<AutosaveState>(IDLE_AUTOSAVE);
  const [properties, setProperties] = useState<PropertyDesignationDraft[]>(
    customer.properties?.length ? customer.properties : [{ designation: "" }]
  );
  const valuesRef = useRef(values);
  const propertiesRef = useRef(properties);
  const savedSnap = useRef(snap(customer));
  const savedProperties = useRef(propertySnap(properties));
  valuesRef.current = values;
  propertiesRef.current = properties;

  const saveState = mergeAutosaveStates(state, pinState);

  useEffect(() => {
    onSaveStateChange?.(saveState);
  }, [onSaveStateChange, saveState]);

  useEffect(() => {
    onRetryReady?.(() => {
      void loop.flush();
    });
  }, [loop, onRetryReady]);

  function emitIdentity(next: CustomerContactDraft) {
    onIdentityChange?.(identityFromCustomer(next));
  }

  function schedulePersist() {
    loop.notify(combinedSnap(valuesRef.current, propertiesRef.current), persistAll);
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
    const rows = propertiesRef.current;
    const detailsKey = snap(next);
    const propsKey = propertySnap(rows);

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
      });
      if (!result.ok) {
        if (result.field === "email") setFieldError(result.error);
        return result;
      }
      savedSnap.current = detailsKey;
      setFieldError(null);
    }

    if (propsKey !== savedProperties.current) {
      const result = await syncCustomerPropertiesAction(customer.id, rows);
      if (!result.ok) {
        if (result.field === "propertyDesignation") setPropertyError(result.error);
        return result;
      }
      const nextRows = result.properties.length ? result.properties : [{ designation: "" }];
      setProperties(nextRows);
      propertiesRef.current = nextRows;
      savedProperties.current = propertySnap(nextRows);
      setPropertyError(null);
    }

    router.refresh();
    return { ok: true } as const;
  }

  function scheduleProperties(next: PropertyDesignationDraft[]) {
    setProperties(next);
    propertiesRef.current = next;
    setPropertyError(null);
    schedulePersist();
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
      {customer.kind === "privat" ? (
        <PersonnummerAutosaveField
          customerId={customer.id}
          masked={customer.personalIdentityNumberMasked ?? ""}
          hasValue={Boolean(customer.hasPersonnummer)}
          onStateChange={setPinState}
        />
      ) : (
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
              value={values.orgNumber ?? ""}
              onChange={(e) => patch({ orgNumber: e.target.value })}
              onBlur={flush}
              className={inputCls}
            />
          </div>
        </div>
      )}
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
      <PropertyDesignationFields
        values={properties}
        onChange={scheduleProperties}
        onBlur={flush}
        error={propertyError ?? undefined}
        inputClassName={inputCls}
        labelClassName={labelCls}
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
  });
}

function propertySnap(rows: PropertyDesignationDraft[]): string {
  return JSON.stringify(rows.map((row) => ({ id: row.id ?? "", designation: row.designation.trim() })));
}

function combinedSnap(c: CustomerContactDraft, rows: PropertyDesignationDraft[]): string {
  return `${snap(c)}\n${propertySnap(rows)}`;
}

function PersonnummerAutosaveField({
  customerId,
  masked,
  hasValue,
  onStateChange,
}: {
  customerId: string;
  masked: string;
  hasValue: boolean;
  onStateChange?: (state: AutosaveState) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!hasValue);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (fade.current) clearTimeout(fade.current);
    };
  }, []);

  function report(next: AutosaveState) {
    onStateChange?.(next);
  }

  async function reveal() {
    const result = await revealCustomerPersonnummerAction(customerId);
    if (result.ok) setRevealed(result.value);
  }

  async function persist() {
    if (!editing) return;
    if (!value.trim()) {
      if (hasValue) setEditing(false);
      return;
    }
    if (value.trim() && !isPersonnummerFormat(value)) {
      setError("Ange personnummer med 10 eller 12 siffror.");
      report({ status: "error", error: "Ange personnummer med 10 eller 12 siffror.", field: "personnummer" });
      return;
    }
    setError(null);
    report({ status: "saving", error: null });
    const result = await updateCustomerPersonnummerAction(customerId, value);
    if (!result.ok) {
      setError(result.error);
      report({ status: "error", error: result.error, field: "personnummer" });
      return;
    }
    setEditing(false);
    setRevealed(null);
    setValue("");
    report({ status: "saved", error: null });
    router.refresh();
    if (fade.current) clearTimeout(fade.current);
    fade.current = setTimeout(() => report(IDLE_AUTOSAVE), 2500);
  }

  if (!editing && hasValue) {
    return (
      <div id="kund-personnummer">
        <label className={labelCls}>Personnummer</label>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
          <span className="font-medium tabular text-ink">{revealed ?? masked}</span>
          <button
            type="button"
            className="text-[13px] font-medium text-accent hover:text-accent-deep"
            onClick={() => (revealed ? setRevealed(null) : void reveal())}
          >
            {revealed ? "Dölj" : "Visa"}
          </button>
          <button
            type="button"
            className="text-[13px] text-muted hover:text-ink"
            onClick={() => {
              setEditing(true);
              setValue("");
            }}
          >
            Ändra
          </button>
        </div>
        <p className="mt-1 text-[12px] text-muted">Behövs för ROT/RUT</p>
      </div>
    );
  }

  return (
    <div>
      <label className={labelCls} htmlFor="kund-personnummer">
        Personnummer
      </label>
      <input
        id="kund-personnummer"
        value={value}
        onChange={(e) => setValue(formatPersonnummer(e.target.value))}
        onBlur={() => void persist()}
        inputMode="numeric"
        autoComplete="off"
        placeholder="ÅÅÅÅMMDD-XXXX"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "kund-personnummer-fel" : undefined}
        className={cx(inputCls, error && invalidFieldCls)}
      />
      <FieldError id="kund-personnummer-fel">{error}</FieldError>
      <p className="mt-1 text-[12px] text-muted">Behövs för ROT/RUT</p>
      {hasValue ? (
        <button type="button" className="mt-1 text-[13px] text-muted hover:text-ink" onClick={() => setEditing(false)}>
          Avbryt
        </button>
      ) : null}
    </div>
  );
}

export { SaveHint } from "./save-status";

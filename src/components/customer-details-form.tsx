"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerDetailsAction } from "@/app/actions";
import { AddressFields } from "./address-input";
import { FieldError, invalidFieldCls } from "./form-validation";
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
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function CustomerAutosaveFields({ customer }: { customer: CustomerContactDraft }) {
  const router = useRouter();
  const [values, setValues] = useState(customer);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const valuesRef = useRef(values);
  const savedSnap = useRef(snap(customer));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);
  valuesRef.current = values;

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (fade.current) clearTimeout(fade.current);
    };
  }, []);

  function patch(next: Partial<CustomerContactDraft>) {
    const merged = { ...valuesRef.current, ...next };
    setValues(merged);
    schedule(merged);
  }

  function schedule(next: CustomerContactDraft) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(next), 500);
  }

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    void persist(valuesRef.current);
  }

  async function persist(next: CustomerContactDraft) {
    const serialized = snap(next);
    if (serialized === savedSnap.current) return;
    setStatus("saving");
    setError(null);
    setFieldError(null);
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
      setStatus("error");
      setError(result.error);
      if (result.field === "email") setFieldError(result.error);
      return;
    }
    savedSnap.current = serialized;
    setStatus("saved");
    router.refresh();
    if (fade.current) clearTimeout(fade.current);
    fade.current = setTimeout(() => setStatus("idle"), 1800);
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
              value={values.orgNumber ?? ""}
              onChange={(e) => patch({ orgNumber: e.target.value })}
              onBlur={flush}
              className={inputCls}
            />
          </div>
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
      <SaveHint status={status} error={error} onRetry={() => void persist(valuesRef.current)} />
    </div>
  );
}

export function SaveHint({
  status,
  error,
  onRetry,
}: {
  status: SaveStatus;
  error: string | null;
  onRetry: () => void;
}) {
  if (status === "idle") return <div className="h-5" />;
  if (status === "saving") {
    return <p className="h-5 text-[12px] text-muted">Sparar…</p>;
  }
  if (status === "saved") {
    return <p className="h-5 text-[12px] font-medium text-ok">Sparat ✓</p>;
  }
  return (
    <div className="flex h-5 items-center gap-2 text-[12px]">
      <p className="text-danger">{error ?? "Kunde inte spara ändringen"}</p>
      <button type="button" className="font-medium text-accent hover:text-accent-deep" onClick={onRetry}>
        Försök igen
      </button>
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

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  revealCustomerPersonnummerAction,
  updateCustomerPersonnummerAction,
  upsertCustomerWorkLocationAction,
} from "@/app/actions";
import type { DwellingType, WorkLocation } from "@/lib/types";
import { formatPersonnummer, personnummerInputChange } from "@/lib/personnummer";
import { validateSwedishPersonalIdentityNumber } from "@/lib/validation";
import { AddressFields } from "./address-input";
import { FieldError, invalidFieldCls } from "./form-validation";
import { RotUsedField } from "./rot-used-field";
import { SaveHint } from "./save-status";
import { buttonClasses, cx } from "./ui";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export type WorkLocationView = Pick<
  WorkLocation,
  "id" | "label" | "address" | "postalCode" | "city" | "propertyType" | "propertyDesignation" | "brfOrgNumber" | "apartmentNumber"
>;

export function CustomerRotSection({
  customerId,
  workLocations,
  defaultWorkLocationId,
  maskedPersonnummer,
  hasPersonnummer,
  year,
  fervaRot,
  fervaRut,
}: {
  customerId: string;
  workLocations: WorkLocationView[];
  defaultWorkLocationId?: string;
  maskedPersonnummer?: string;
  hasPersonnummer?: boolean;
  year: number;
  fervaRot: number;
  fervaRut: number;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <RotUsedField year={year} rot={fervaRot} rut={fervaRut} />
      <PersonnummerAutosaveField
        customerId={customerId}
        masked={maskedPersonnummer ?? ""}
        hasValue={Boolean(hasPersonnummer)}
      />
      {workLocations.length > 0 ? (
        <ul className="space-y-3">
          {workLocations.map((loc) =>
            editingId === loc.id ? (
              <li key={loc.id}>
                <WorkLocationForm
                  customerId={customerId}
                  initial={loc}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={loc.id} className="rounded-2xl border border-line/80 px-4 py-3 text-[14px]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-ink">{loc.label}</span>
                  {loc.id === defaultWorkLocationId ? (
                    <span className="text-[12px] text-muted">Standard</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-soft">{addressLine(loc) || "Ingen adress"}</p>
                <p className="mt-0.5 text-[13px] text-muted">{propertySummary(loc)}</p>
                <button
                  type="button"
                  className="mt-2 text-[13px] font-medium text-accent hover:text-accent-deep"
                  onClick={() => {
                    setAdding(false);
                    setEditingId(loc.id);
                  }}
                >
                  Ändra
                </button>
              </li>
            )
          )}
        </ul>
      ) : null}
      {adding ? (
        <WorkLocationForm
          customerId={customerId}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          className="text-[14px] font-medium text-accent hover:text-accent-deep"
          onClick={() => {
            setEditingId(null);
            setAdding(true);
          }}
        >
          <Plus className="mr-1 inline size-3.5" />
          Lägg till fastighet
        </button>
      )}
    </div>
  );
}

function addressLine(loc: WorkLocationView): string {
  return [loc.address, [loc.postalCode, loc.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

function propertySummary(loc: WorkLocationView): string {
  const type = loc.propertyType === "bostadsratt" ? "Bostadsrätt" : "Fastighet/småhus";
  if (loc.propertyType === "bostadsratt") {
    const extra = [loc.brfOrgNumber, loc.apartmentNumber].filter(Boolean).join(" · ");
    return extra ? `${type} · ${extra}` : type;
  }
  return loc.propertyDesignation ? `${type} · ${loc.propertyDesignation}` : type;
}

function WorkLocationForm({
  customerId,
  initial,
  onDone,
  onCancel,
}: {
  customerId: string;
  initial?: WorkLocationView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [address, setAddress] = useState({
    address: initial?.address ?? "",
    postalCode: initial?.postalCode ?? "",
    city: initial?.city ?? "",
  });
  const [propertyType, setPropertyType] = useState<DwellingType>(initial?.propertyType ?? "smahus");
  const [propertyDesignation, setPropertyDesignation] = useState(initial?.propertyDesignation ?? "");
  const [brfOrgNumber, setBrfOrgNumber] = useState(initial?.brfOrgNumber ?? "");
  const [apartmentNumber, setApartmentNumber] = useState(initial?.apartmentNumber ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const canSave = Boolean(propertyDesignation.trim() || address.address.trim());

  async function save() {
    setStatus("saving");
    setError(null);
    const result = await upsertCustomerWorkLocationAction(customerId, {
      id: initial?.id,
      label: label || (propertyType === "smahus" ? "Hem" : "Bostad"),
      address: address.address,
      postalCode: address.postalCode,
      city: address.city,
      propertyType,
      propertyDesignation,
      brfOrgNumber,
      apartmentNumber,
    });
    if (!result.ok) {
      setStatus("error");
      setError(result.error);
      return;
    }
    setStatus("saved");
    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-3 rounded-2xl border border-line/80 bg-canvas/40 p-4">
      <div>
        <label className={labelCls} htmlFor={initial ? `bostad-etikett-${initial.id}` : "bostad-etikett"}>
          Namn
        </label>
        <input
          id={initial ? `bostad-etikett-${initial.id}` : "bostad-etikett"}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Hem, Fritidshus …"
          className={inputCls}
        />
      </div>
      <AddressFields defaults={address} onChange={setAddress} />
      <div>
        <p className={labelCls}>Bostadstyp</p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["smahus", "Fastighet/småhus"],
              ["bostadsratt", "Bostadsrätt"],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPropertyType(id)}
              className={cx(
                "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                propertyType === id ? "border-ink bg-ink text-white" : "border-line-strong text-soft hover:border-muted"
              )}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      {propertyType === "smahus" ? (
        <div>
          <label className={labelCls} htmlFor={initial ? `fastighet-${initial.id}` : "fastighetsbeteckning"}>
            Fastighetsbeteckning
          </label>
          <input
            id={initial ? `fastighet-${initial.id}` : "fastighetsbeteckning"}
            value={propertyDesignation}
            onChange={(e) => setPropertyDesignation(e.target.value)}
            className={inputCls}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>BRF org.nr</label>
            <input value={brfOrgNumber} onChange={(e) => setBrfOrgNumber(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Lägenhetsnummer</label>
            <input value={apartmentNumber} onChange={(e) => setApartmentNumber(e.target.value)} className={inputCls} />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => void save()} disabled={!canSave}>
          {status === "saving" ? "Sparar…" : initial ? "Spara" : "Lägg till"}
        </button>
        <button type="button" className="text-[13px] text-muted hover:text-ink" onClick={onCancel}>
          Avbryt
        </button>
      </div>
      <SaveHint status={status === "saved" ? "idle" : status} error={error} onRetry={() => void save()} />
    </div>
  );
}

function PersonnummerAutosaveField({
  customerId,
  masked,
  hasValue,
}: {
  customerId: string;
  masked: string;
  hasValue: boolean;
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
    const pn = validateSwedishPersonalIdentityNumber(value);
    if (!pn.ok) {
      setError(pn.message);
      return;
    }
    setError(null);
    const result = await updateCustomerPersonnummerAction(customerId, value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    setRevealed(null);
    setValue("");
    router.refresh();
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
        <p className="mt-1 text-[12px] text-muted">Samma nummer för alla fastigheter. Behövs för ROT/RUT.</p>
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
        onChange={(e) => setValue(personnummerInputChange(value, e.target.value))}
        onBlur={() => {
          if (value.trim()) setValue(formatPersonnummer(value));
          void persist();
        }}
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYYMMDD-XXXX"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "kund-personnummer-fel" : undefined}
        className={cx(inputCls, error && invalidFieldCls)}
      />
      <FieldError id="kund-personnummer-fel">{error}</FieldError>
      <p className="mt-1 text-[12px] text-muted">Samma nummer för alla fastigheter. Behövs för ROT/RUT.</p>
      {hasValue ? (
        <button type="button" className="mt-1 text-[13px] text-muted hover:text-ink" onClick={() => setEditing(false)}>
          Avbryt
        </button>
      ) : null}
    </div>
  );
}

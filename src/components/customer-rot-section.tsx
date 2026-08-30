"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { upsertCustomerWorkLocationAction } from "@/app/actions";
import type { DwellingType, WorkLocation } from "@/lib/types";
import { AddressFields } from "./address-input";
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
}: {
  customerId: string;
  workLocations: WorkLocationView[];
  defaultWorkLocationId?: string;
}) {
  const hasData = workLocations.length > 0;
  const [open, setOpen] = useState(hasData);
  const [adding, setAdding] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="text-[14px] font-medium text-accent hover:text-accent-deep"
        onClick={() => {
          setOpen(true);
          setAdding(true);
        }}
      >
        + Lägg till ROT/RUT-uppgifter
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {workLocations.length > 0 ? (
        <ul className="space-y-2">
          {workLocations.map((loc) => (
            <li key={loc.id} className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
              <span>
                <span className="font-medium text-ink">{loc.label}</span>
                <span className="text-soft">
                  {" "}
                  · {propertyTypeLabel(loc.propertyType)}
                  {loc.id === defaultWorkLocationId ? " · standard" : ""}
                </span>
              </span>
              <span className="text-[13px] text-muted">
                {housingHint(loc)}
                {loc.address ? ` · ${loc.address}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <WorkLocationForm
          customerId={customerId}
          onDone={() => setAdding(false)}
          onCancel={() => {
            setAdding(false);
            if (!hasData) setOpen(false);
          }}
        />
      ) : (
        <button type="button" className="text-[14px] font-medium text-accent hover:text-accent-deep" onClick={() => setAdding(true)}>
          <Plus className="mr-1 inline size-3.5" />
          Lägg till bostad
        </button>
      )}
    </div>
  );
}

function WorkLocationForm({
  customerId,
  onDone,
  onCancel,
}: {
  customerId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState({ address: "", postalCode: "", city: "" });
  const [propertyType, setPropertyType] = useState<DwellingType>("smahus");
  const [propertyDesignation, setPropertyDesignation] = useState("");
  const [brfOrgNumber, setBrfOrgNumber] = useState("");
  const [apartmentNumber, setApartmentNumber] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setStatus("saving");
    setError(null);
    const result = await upsertCustomerWorkLocationAction(customerId, {
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
        <label className={labelCls} htmlFor="bostad-etikett">
          Namn
        </label>
        <input
          id="bostad-etikett"
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
          <label className={labelCls}>Fastighetsbeteckning</label>
          <input value={propertyDesignation} onChange={(e) => setPropertyDesignation(e.target.value)} className={inputCls} />
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
        <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => void save()} disabled={!address.address.trim()}>
          {status === "saving" ? "Sparar…" : "Lägg till"}
        </button>
        <button type="button" className="text-[13px] text-muted hover:text-ink" onClick={onCancel}>
          Avbryt
        </button>
      </div>
      <SaveHint status={status === "saved" ? "idle" : status} error={error} onRetry={() => void save()} />
    </div>
  );
}

function propertyTypeLabel(type: DwellingType): string {
  return type === "bostadsratt" ? "Bostadsrätt" : "Fastighet/småhus";
}

function housingHint(loc: WorkLocationView): string {
  if (loc.propertyType === "smahus") {
    return loc.propertyDesignation ? "Beteckning finns" : "Ingen beteckning";
  }
  return loc.brfOrgNumber ? "BRF finns" : "Ingen BRF";
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upsertCustomerWorkLocationAction } from "@/app/actions";
import type { DwellingType } from "@/lib/types";
import { derivedPropertyLabel, toPropertyOption, type PropertyOption } from "@/lib/work-location-label";
import { AddressFields } from "./address-input";
import { SaveHint } from "./save-status";
import { buttonClasses, cx } from "./ui";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export type WorkLocationFormValue = {
  id?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  propertyType?: DwellingType;
  propertyDesignation?: string;
  brfOrgNumber?: string;
  apartmentNumber?: string;
};

export function WorkLocationForm({
  customerId,
  initial,
  onDone,
  onCancel,
  designationFieldId,
  refreshOnSave = true,
}: {
  customerId: string;
  initial?: WorkLocationFormValue;
  onDone: (saved: PropertyOption) => void;
  onCancel: () => void;
  /** Behåller luckan mot bostadsblocket på fakturan. */
  designationFieldId?: string;
  refreshOnSave?: boolean;
}) {
  const router = useRouter();
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
    const label = derivedPropertyLabel({
      address: address.address,
      propertyDesignation,
      propertyType,
    });
    const result = await upsertCustomerWorkLocationAction(customerId, {
      id: initial?.id,
      label,
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
    onDone(
      toPropertyOption({
        id: result.id,
        address: address.address,
        postalCode: address.postalCode,
        city: address.city,
        propertyType,
        propertyDesignation,
        brfOrgNumber,
        apartmentNumber,
      })
    );
    if (refreshOnSave) router.refresh();
  }

  const designationId = designationFieldId ?? (initial?.id ? `fastighet-${initial.id}` : "fastighetsbeteckning");

  return (
    <div className="space-y-3 rounded-2xl border border-line/80 bg-canvas/40 p-4">
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
          <label className={labelCls} htmlFor={designationId}>
            Fastighetsbeteckning
          </label>
          <input
            id={designationId}
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
          {status === "saving" ? "Sparar…" : initial?.id ? "Spara" : "Lägg till"}
        </button>
        <button type="button" className="text-[13px] text-muted hover:text-ink" onClick={onCancel}>
          Avbryt
        </button>
      </div>
      <SaveHint status={status === "saved" ? "idle" : status} error={error} onRetry={() => void save()} />
    </div>
  );
}

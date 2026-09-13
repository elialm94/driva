"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  removeCustomerWorkLocationAction,
  revealCustomerPersonnummerAction,
  updateCustomerPersonnummerAction,
} from "@/app/actions";
import type { WorkLocation } from "@/lib/types";
import { formatPersonnummer, personnummerInputChange } from "@/lib/personnummer";
import { validateSwedishPersonalIdentityNumber } from "@/lib/validation";
import { derivedPropertyLabel, propertyTypeLabel, WORK_LOCATION_IN_USE_MESSAGE } from "@/lib/work-location-label";
import { FieldError, invalidFieldCls } from "./form-validation";
import { cx } from "./ui";
import { WorkLocationForm } from "./work-location-form";

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
  usedWorkLocationIds,
  maskedPersonnummer,
  hasPersonnummer,
}: {
  customerId: string;
  workLocations: WorkLocationView[];
  defaultWorkLocationId?: string;
  usedWorkLocationIds?: string[];
  maskedPersonnummer?: string;
  hasPersonnummer?: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const used = new Set(usedWorkLocationIds ?? []);

  async function remove(loc: WorkLocationView) {
    setBlockReason(null);
    if (used.has(loc.id)) {
      setBlockReason(WORK_LOCATION_IN_USE_MESSAGE);
      return;
    }
    setRemovingId(loc.id);
    const result = await removeCustomerWorkLocationAction(customerId, loc.id);
    setRemovingId(null);
    if (!result.ok) {
      setBlockReason(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
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
                  <span className="font-medium text-ink">{derivedPropertyLabel(loc)}</span>
                  {loc.id === defaultWorkLocationId ? (
                    <span className="text-[12px] text-muted">Standard</span>
                  ) : null}
                </div>
                {propertyListPlace(loc) ? <p className="mt-0.5 text-soft">{propertyListPlace(loc)}</p> : null}
                <p className="mt-0.5 text-[13px] text-muted">{propertySummary(loc)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="text-[13px] font-medium text-accent hover:text-accent-deep"
                    onClick={() => {
                      setAdding(false);
                      setBlockReason(null);
                      setEditingId(loc.id);
                    }}
                  >
                    Ändra
                  </button>
                  <button
                    type="button"
                    className="text-[13px] text-muted hover:text-ink"
                    disabled={removingId === loc.id}
                    onClick={() => void remove(loc)}
                  >
                    {removingId === loc.id ? "Tar bort…" : "Ta bort"}
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      ) : null}
      {blockReason ? <p className="text-[13px] text-soft">{blockReason}</p> : null}
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
            setBlockReason(null);
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

function propertyListPlace(loc: WorkLocationView): string {
  return [loc.postalCode, loc.city].filter(Boolean).join(" ");
}

function propertySummary(loc: WorkLocationView): string {
  const type = propertyTypeLabel(loc.propertyType);
  if (loc.propertyType === "bostadsratt") {
    const extra = [loc.brfOrgNumber, loc.apartmentNumber].filter(Boolean).join(" · ");
    return extra ? `${type} · ${extra}` : type;
  }
  const designation = loc.propertyDesignation?.trim() ?? "";
  if (designation && designation !== loc.address?.trim()) return `${type} · ${designation}`;
  return type;
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


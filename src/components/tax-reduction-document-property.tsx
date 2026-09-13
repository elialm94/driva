"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { InvoicePropertyOption } from "./tax-reduction-fields";
import type { DwellingType } from "@/lib/types";
import { formatPostalAddress, propertyRowLabel } from "@/lib/work-location-label";
import { SearchableCombobox } from "./searchable-combobox";
import { WorkLocationForm } from "./work-location-form";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

/**
 * Bostaden som dokumentet gäller: valet som sparas som workLocationId.
 * ROT: enda stället fastighet väljs och redigeras. RUT: ingen väljare,
 * arbetet utgår från kundens postadress.
 */
export function TaxReductionDocumentProperty({
  customerId,
  type,
  properties,
  value,
  onChange,
  onPropertiesChange,
  fieldId,
  documentKind,
  workAddress,
  onWorkAddressChange,
}: {
  customerId: string;
  type: "rot" | "rut";
  dwellingType?: DwellingType;
  properties: InvoicePropertyOption[];
  value: string;
  onChange: (workLocationId: string, selected?: InvoicePropertyOption) => void;
  onPropertiesChange?: (properties: InvoicePropertyOption[]) => void;
  designation?: string;
  onDesignationChange?: (designation: string) => void;
  fieldId: string;
  documentKind: "offert" | "faktura";
  workAddress?: string;
  onWorkAddressChange?: (workAddress: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const doc = documentKind === "offert" ? "offerten" : "fakturan";

  if (type === "rut") {
    return (
      <div id={fieldId} className="space-y-2">
        <label className={labelCls} htmlFor={`${fieldId}-adress`}>
          Adress där arbetet utförs
        </label>
        <input
          id={`${fieldId}-adress`}
          value={workAddress ?? ""}
          onChange={(e) => onWorkAddressChange?.(e.target.value)}
          className={inputCls}
        />
        <p className="text-[12px] leading-relaxed text-muted">Utgår från kundens postadress. RUT kräver inget fastighetsval.</p>
      </div>
    );
  }

  function select(option: InvoicePropertyOption) {
    onChange(option.id, option);
  }

  return (
    <div id={fieldId} className="space-y-2">
      <label className={labelCls} htmlFor={`${fieldId}-val`}>
        Bostad
      </label>
      <SearchableCombobox
        id={`${fieldId}-val`}
        options={properties.map((property) => ({
          id: property.id,
          title: propertyRowLabel(property),
        }))}
        value={value}
        onChange={(id) => {
          const property = properties.find((row) => row.id === id);
          if (property) select(property);
        }}
        emptyLabel={properties.length === 1 ? "Välj bostad" : "Välj vilken bostad avdraget gäller"}
        searchPlaceholder="Sök fastighet …"
        footer={
          customerId
            ? {
                label: (
                  <>
                    <Plus className="size-4 shrink-0" /> Ny fastighet
                  </>
                ),
                onSelect: () => setAdding(true),
              }
            : undefined
        }
      />
      <p className="text-[12px] leading-relaxed text-muted">
        ROT kräver att bostaden är vald och sparad på {doc}. Kundens fastigheter räcker inte.
      </p>
      {adding ? (
        <WorkLocationForm
          customerId={customerId}
          designationFieldId={`${fieldId}-ny`}
          refreshOnSave={false}
          onDone={(saved) => {
            const next = [...properties.filter((row) => row.id !== saved.id), saved];
            onPropertiesChange?.(next);
            select(saved);
            if (saved.address || saved.postalCode || saved.city) {
              onWorkAddressChange?.(formatPostalAddress(saved));
            }
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

export function autoSelectWorkLocationId(
  properties: InvoicePropertyOption[],
  current?: string
): string {
  if (current && properties.some((property) => property.id === current)) return current;
  if (properties.length === 1) return properties[0].id;
  return "";
}

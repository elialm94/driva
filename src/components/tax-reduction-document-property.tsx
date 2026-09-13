"use client";

import { useState, useTransition } from "react";
import { upsertCustomerWorkLocationAction } from "@/app/actions";
import type { InvoicePropertyOption } from "./tax-reduction-fields";
import type { DwellingType } from "@/lib/types";
import { FieldError } from "./form-validation";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

/**
 * Bostaden som dokumentet gäller: valet som sparas som workLocationId, och det
 * enda stället där fastighetsbeteckningen skrivs in. Fältet under bostadstyp i
 * TaxReductionFields visar samma värde, så beteckningen har exakt en ägare.
 * RUT har inga bostadsuppgifter i husarbetsbegäran och får därför ingen
 * fastighetsbeteckning alls.
 */
export function TaxReductionDocumentProperty({
  customerId,
  type,
  dwellingType,
  properties,
  value,
  onChange,
  onPropertiesChange,
  designation,
  onDesignationChange,
  fieldId,
  documentKind,
}: {
  customerId: string;
  type: "rot" | "rut";
  dwellingType?: DwellingType;
  properties: InvoicePropertyOption[];
  value: string;
  onChange: (workLocationId: string, designation?: string) => void;
  onPropertiesChange?: (properties: InvoicePropertyOption[]) => void;
  /** Styrs utifrån av fakturaeditorn. Utan prop håller komponenten värdet själv. */
  designation?: string;
  onDesignationChange?: (designation: string) => void;
  fieldId: string;
  documentKind: "offert" | "faktura";
}) {
  const [draft, setDraft] = useState(designation ?? "");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const doc = documentKind === "offert" ? "offerten" : "fakturan";
  const text = designation ?? draft;
  const forProperty = type === "rot" && dwellingType !== "bostadsratt";
  // Fältet visas så länge beteckningen saknas, så att luckan alltid går att
  // klicka på och fylla i. Med beteckning på plats räcker knappen.
  const showDesignation = forProperty && (adding || !text.trim());

  function setText(next: string) {
    setDraft(next);
    onDesignationChange?.(next);
  }

  function addProperty() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Ange fastighetsbeteckning.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await upsertCustomerWorkLocationAction(customerId, {
        label: trimmed,
        address: "",
        propertyType: "smahus",
        propertyDesignation: trimmed,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const next: InvoicePropertyOption = { id: result.id, designation: trimmed, label: trimmed };
      onPropertiesChange?.([...properties, next]);
      onChange(result.id, trimmed);
      setText(trimmed);
      setAdding(false);
    });
  }

  return (
    <div id={fieldId} className="space-y-2">
      <label className={labelCls} htmlFor={`${fieldId}-val`}>
        Bostad
      </label>
      {properties.length > 0 ? (
        <select
          id={`${fieldId}-val`}
          value={value}
          onChange={(e) => {
            const id = e.target.value;
            onChange(id, properties.find((property) => property.id === id)?.designation);
          }}
          className={inputCls}
        >
          <option value="">{properties.length === 1 ? "Välj bostad" : "Välj vilken bostad avdraget gäller"}</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.label || property.designation || "Bostad"}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-[13px] text-soft">Kunden har ingen bostad ännu.</p>
      )}
      <p className="text-[12px] leading-relaxed text-muted">
        ROT/RUT kräver att bostaden är vald och sparad på {doc}. Kundens fastigheter räcker inte.
      </p>
      {showDesignation ? (
        <div className="space-y-2">
          <label className={labelCls} htmlFor={`${fieldId}-ny`}>
            Fastighetsbeteckning
          </label>
          <input
            id={`${fieldId}-ny`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="T.ex. Södermalm 12:34"
            autoComplete="off"
            className={inputCls}
          />
          <button
            type="button"
            disabled={pending || !customerId}
            onClick={addProperty}
            className="text-[13px] font-medium text-ink underline-offset-2 hover:underline disabled:text-muted"
          >
            {pending ? "Sparar …" : "Lägg till fastighet"}
          </button>
          <FieldError>{error}</FieldError>
        </div>
      ) : forProperty ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-[13px] font-medium text-soft underline-offset-2 hover:text-ink hover:underline"
        >
          Lägg till fastighet
        </button>
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

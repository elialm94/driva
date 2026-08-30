"use client";

import { useState, useTransition } from "react";
import { upsertCustomerWorkLocationAction } from "@/app/actions";
import type { InvoicePropertyOption } from "./tax-reduction-fields";
import { FieldError } from "./form-validation";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export function TaxReductionDocumentProperty({
  customerId,
  properties,
  value,
  onChange,
  onPropertiesChange,
  fieldId,
  documentKind,
}: {
  customerId: string;
  properties: InvoicePropertyOption[];
  value: string;
  onChange: (workLocationId: string) => void;
  onPropertiesChange?: (properties: InvoicePropertyOption[]) => void;
  fieldId: string;
  documentKind: "offert" | "faktura";
}) {
  const [adding, setAdding] = useState(properties.length === 0);
  const [designation, setDesignation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const doc = documentKind === "offert" ? "offerten" : "fakturan";

  function addProperty() {
    const trimmed = designation.trim();
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
      onChange(result.id);
      setDesignation("");
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
          onChange={(e) => onChange(e.target.value)}
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
      {adding || properties.length === 0 ? (
        <div className="space-y-2">
          <label className={labelCls} htmlFor={`${fieldId}-ny`}>
            Fastighetsbeteckning
          </label>
          <input
            id={`${fieldId}-ny`}
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
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
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-[13px] font-medium text-soft underline-offset-2 hover:text-ink hover:underline"
        >
          Lägg till fastighet
        </button>
      )}
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

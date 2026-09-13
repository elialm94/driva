"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DwellingType, HousingDetails, TaxReductionDetails } from "@/lib/types";
import {
  formatPersonnummer,
  isPersonnummerFormat,
  maskPersonnummer,
  personnummerInputChange,
} from "@/lib/personnummer";
import {
  formatWorkPeriodRange,
  taxReductionMissingFields,
  type TaxReductionMissingCode,
  type WorkPeriodSource,
} from "@/lib/tax-reduction-gaps";
import { DateField } from "./date-field";
import { cx } from "./ui";
import { SoftMissingHint } from "./form-validation";
import { kr } from "@/lib/format";
import {
  TAX_REDUCTION_USE_MAX_LABEL,
  taxReductionAmountHelp,
  taxReductionAppliedLabel,
  taxReductionDeductionLabel,
  taxReductionDocumentMaxLabel,
  taxReductionExceedsMaxError,
  taxReductionMaxLabel,
} from "@/lib/tax-reduction-terms";
import type { TaxReductionDocumentKind } from "@/lib/tax-reduction-amount";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export interface TaxReductionFormValue {
  personalIdentityNumber: string;
  workAddress: string;
  workPeriodStart: string;
  workPeriodEnd: string;
  /** Härledd period visas men sparas inte som manuell. Ändra gör den manuell. */
  workPeriodSource?: WorkPeriodSource;
  housing: HousingDetails;
}

export function taxReductionDetailsFromForm(value: TaxReductionFormValue): TaxReductionDetails {
  const housing: HousingDetails =
    value.housing.dwellingType === "smahus"
      ? { dwellingType: "smahus", propertyDesignation: value.housing.propertyDesignation?.trim() || undefined }
      : value.housing.dwellingType === "bostadsratt"
        ? {
            dwellingType: "bostadsratt",
            brfOrgNumber: value.housing.brfOrgNumber?.trim() || undefined,
            apartmentNumber: value.housing.apartmentNumber?.trim() || undefined,
          }
        : {};
  return {
    workAddress: value.workAddress.trim() || undefined,
    workPeriodStart: value.workPeriodStart || undefined,
    workPeriodEnd: value.workPeriodEnd || undefined,
    workPeriodSource: value.workPeriodSource,
    housing,
  };
}

function ChangeButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-1.5 text-[13px] font-medium text-soft underline-offset-2 hover:text-ink hover:underline"
    >
      Ändra
    </button>
  );
}

function parseKronorInput(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00a0]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function TaxReductionAmountPanel({
  type,
  documentKind,
  laborInclVat,
  calculated,
  applied,
  toPay,
  toPayLabel = "Att betala",
  manuallyAdjusted,
  clampNotice,
  onApply,
  onUseMax,
}: {
  type: "rot" | "rut";
  documentKind: TaxReductionDocumentKind;
  laborInclVat: number;
  calculated: number;
  applied: number;
  toPay: number;
  toPayLabel?: string;
  manuallyAdjusted: boolean;
  clampNotice?: string | null;
  onApply: (amount: number) => void;
  onUseMax: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(applied));
  const [error, setError] = useState<string | null>(null);
  const prevCalculated = useRef(calculated);

  function startEdit() {
    setDraft(String(applied));
    setError(null);
    setEditing(true);
  }

  useEffect(() => {
    if (!editing) setDraft(String(applied));
  }, [applied, editing]);

  useEffect(() => {
    const previous = prevCalculated.current;
    prevCalculated.current = calculated;
    if (calculated >= previous) return;
    setDraft(String(applied));
    setEditing(false);
    setError(null);
  }, [applied, calculated]);

  function tryApply(raw: string, commit: boolean) {
    if (raw.trim() === "" && !commit) {
      setError(null);
      return;
    }
    const parsed = parseKronorInput(raw);
    if (parsed == null) {
      setError("Ange avdraget i hela kronor.");
      return;
    }
    if (parsed > calculated) {
      if (commit) {
        setError(null);
        onApply(calculated);
        setDraft(String(calculated));
        setEditing(false);
        return;
      }
      setError(taxReductionExceedsMaxError(calculated, documentKind));
      return;
    }
    setError(null);
    onApply(parsed);
    if (commit) {
      setDraft(String(parsed));
      setEditing(false);
    }
  }

  return (
    <div className="space-y-1.5 text-[13px]">
      <div className="flex justify-between text-soft">
        <span>Arbetskostnad</span>
        <span className="tabular">{kr(laborInclVat)}</span>
      </div>
      <div className="flex justify-between text-soft">
        <span>{taxReductionMaxLabel(type)}</span>
        <span className="tabular">{kr(calculated)}</span>
      </div>
      {editing ? (
        <div>
          <label className="mb-1 block text-[13px] font-medium text-soft">{taxReductionAppliedLabel(type)}</label>
          <input
            value={draft}
            onChange={(e) => {
              const next = e.target.value;
              if (next !== "" && !/^[\d\s\u00a0]*$/.test(next)) return;
              setDraft(next);
              tryApply(next, false);
            }}
            onBlur={() => tryApply(draft, true)}
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            className={cx(inputCls, error ? "border-danger" : "")}
            aria-invalid={Boolean(error)}
            aria-label={taxReductionAppliedLabel(type)}
          />
        </div>
      ) : (
        <p className="flex justify-between text-accent-deep">
          <span>
            <button type="button" onClick={startEdit} className="text-left underline-offset-2 hover:underline">
              {taxReductionDeductionLabel(type)} {kr(applied)}
            </button>
            <ChangeButton onClick={startEdit} />
          </span>
          <button
            type="button"
            onClick={startEdit}
            className="tabular underline-offset-2 hover:underline"
            aria-label={`${taxReductionDeductionLabel(type)} ${kr(applied)}`}
          >
            −{kr(applied)}
          </button>
        </p>
      )}
      {error ? <p className="text-[13px] font-medium text-danger">{error}</p> : null}
      {clampNotice ? <p className="text-[13px] font-medium text-soft">{clampNotice}</p> : null}
      {manuallyAdjusted ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted">{taxReductionDocumentMaxLabel(documentKind, calculated)}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditing(false);
              onUseMax();
            }}
            className="text-[13px] font-medium text-soft underline-offset-2 hover:text-ink hover:underline"
          >
            {TAX_REDUCTION_USE_MAX_LABEL}
          </button>
        </div>
      ) : null}
      <div className="flex justify-between font-medium">
        <span>{toPayLabel}</span>
        <span className="tabular">{kr(toPay)}</span>
      </div>
      <p className="text-[12px] leading-relaxed text-muted">{taxReductionAmountHelp(documentKind)}</p>
    </div>
  );
}

function KnownRow({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-soft">{children}</p>;
}

export type InvoicePropertyOption = {
  id: string;
  designation: string;
  label: string;
  address?: string;
  postalCode?: string;
  city?: string;
  propertyType?: DwellingType;
  brfOrgNumber?: string;
  apartmentNumber?: string;
};

export function TaxReductionFields({
  type,
  value,
  onChange,
  onPersonnummerCommit,
  propertyFieldId,
  amountSlot,
}: {
  type: "rot" | "rut";
  value: TaxReductionFormValue;
  onChange: (next: TaxReductionFormValue) => void;
  /** Spara personnummret på kunden redan vid blur, inte bara när fakturan sparas. */
  onPersonnummerCommit?: (personalIdentityNumber: string) => void;
  /** Fältet som äger fastighetsbeteckningen, i bostadsblocket. Dit pekar luckan. */
  propertyFieldId?: string;
  amountSlot?: ReactNode;
}) {
  const pnKnown = isPersonnummerFormat(value.personalIdentityNumber);
  const periodKnown = Boolean(value.workPeriodStart || value.workPeriodEnd);

  const [pnEditing, setPnEditing] = useState(!pnKnown);
  // Arbetsperioden härleds alltid fram (uppdragets datum, annars aktuell
  // månad), så den börjar sammanfattad. Två tomma datumfält ska aldrig möta
  // användaren - de öppnas bara med Ändra.
  const [periodEditing, setPeriodEditing] = useState(false);

  const missing = taxReductionMissingFields({
    type,
    personalIdentityNumber: value.personalIdentityNumber,
    details: taxReductionDetailsFromForm(value),
    scope: "invoice",
  }).filter((m) => m.code === "personnummer");
  const fieldIds: Partial<Record<TaxReductionMissingCode, string>> = {
    personnummer: `${type}-personnummer`,
  };
  const missingItems = missing.map((m) => ({ id: m.code, label: m.label, fieldId: fieldIds[m.code] }));

  function patch(partial: Partial<TaxReductionFormValue>) {
    onChange({ ...value, ...partial });
  }

  const showPnInput = pnEditing || !pnKnown;
  const showPeriodInput = periodEditing;

  return (
    <div className="mt-3 space-y-2.5">
      {amountSlot}
      {showPnInput ? (
        <div id={`${type}-personnummer`}>
          <label className={labelCls}>Personnummer</label>
          <input
            value={value.personalIdentityNumber}
            onChange={(e) =>
              patch({ personalIdentityNumber: personnummerInputChange(value.personalIdentityNumber, e.target.value) })
            }
            onBlur={() => {
              if (isPersonnummerFormat(value.personalIdentityNumber)) {
                const formatted = formatPersonnummer(value.personalIdentityNumber);
                patch({ personalIdentityNumber: formatted });
                setPnEditing(false);
                onPersonnummerCommit?.(formatted);
              }
            }}
            inputMode="numeric"
            autoComplete="off"
            placeholder="YYYYMMDD-XXXX"
            className={inputCls}
          />
        </div>
      ) : (
        <KnownRow>
          Personnummer {maskPersonnummer(value.personalIdentityNumber)} ✓
          <ChangeButton onClick={() => setPnEditing(true)} />
        </KnownRow>
      )}

      {showPeriodInput ? (
        <div id={`${type}-arbetsperiod`} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Arbetsperiod från</label>
            <DateField
              value={value.workPeriodStart}
              onChange={(workPeriodStart) => {
                patch({ workPeriodStart, workPeriodSource: "invoice" });
                if (workPeriodStart && value.workPeriodEnd) setPeriodEditing(false);
              }}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Arbetsperiod till</label>
            <DateField
              value={value.workPeriodEnd}
              onChange={(workPeriodEnd) => {
                patch({ workPeriodEnd, workPeriodSource: "invoice" });
                if (value.workPeriodStart && workPeriodEnd) setPeriodEditing(false);
              }}
              className={inputCls}
            />
          </div>
        </div>
      ) : (
        <KnownRow>
          Arbetsperiod: {periodKnown ? formatWorkPeriodRange(value.workPeriodStart, value.workPeriodEnd) : "inte angiven"}
          <ChangeButton onClick={() => setPeriodEditing(true)} />
        </KnownRow>
      )}

      {missing.length === 0 ? (
        <p className="text-[13px] font-medium text-ok">✓ Alla uppgifter finns</p>
      ) : (
        <SoftMissingHint missing={missingItems} intro={`för ${type === "rot" ? "ROT" : "RUT"}-ansökan`} />
      )}
    </div>
  );
}

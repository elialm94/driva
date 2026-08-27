"use client";

import { useState, type ReactNode } from "react";
import type { DwellingType, HousingDetails, TaxReductionDetails } from "@/lib/types";
import { formatPersonnummer, isPersonnummerFormat, maskPersonnummer } from "@/lib/personnummer";
import { formatOrgnr } from "@/lib/invoices/formats";
import {
  formatWorkPeriodRange,
  taxReductionMissingFields,
  taxReductionMissingHint,
} from "@/lib/tax-reduction-gaps";
import { DateField } from "./date-field";
import { cx } from "./ui";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export interface TaxReductionFormValue {
  personalIdentityNumber: string;
  workAddress: string;
  workPeriodStart: string;
  workPeriodEnd: string;
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

function KnownRow({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-soft">{children}</p>;
}

export function TaxReductionFields({
  type,
  value,
  onChange,
}: {
  type: "rot" | "rut";
  value: TaxReductionFormValue;
  onChange: (next: TaxReductionFormValue) => void;
}) {
  const pnKnown = isPersonnummerFormat(value.personalIdentityNumber);
  const periodKnown = Boolean(value.workPeriodStart || value.workPeriodEnd);
  const dwelling = value.housing.dwellingType;

  const [pnEditing, setPnEditing] = useState(!pnKnown);
  const [periodEditing, setPeriodEditing] = useState(!periodKnown);
  const [dwellingEditing, setDwellingEditing] = useState(type === "rot" && !dwelling);
  const [propertyEditing, setPropertyEditing] = useState(
    type === "rot" && dwelling === "smahus" && !value.housing.propertyDesignation?.trim()
  );
  const [brfEditing, setBrfEditing] = useState(
    type === "rot" && dwelling === "bostadsratt" && !value.housing.brfOrgNumber?.trim()
  );
  const [aptEditing, setAptEditing] = useState(
    type === "rot" && dwelling === "bostadsratt" && !value.housing.apartmentNumber?.trim()
  );

  const missing = taxReductionMissingFields({
    type,
    personalIdentityNumber: value.personalIdentityNumber,
    details: taxReductionDetailsFromForm(value),
    scope: "invoice",
  });
  const hint = taxReductionMissingHint(type, missing);

  function patch(partial: Partial<TaxReductionFormValue>) {
    onChange({ ...value, ...partial });
  }

  function setDwelling(dwellingType: DwellingType) {
    patch({
      housing:
        dwellingType === "smahus"
          ? { dwellingType, propertyDesignation: value.housing.propertyDesignation }
          : {
              dwellingType,
              brfOrgNumber: value.housing.brfOrgNumber,
              apartmentNumber: value.housing.apartmentNumber,
            },
    });
    setDwellingEditing(false);
    setPropertyEditing(dwellingType === "smahus");
    setBrfEditing(dwellingType === "bostadsratt");
    setAptEditing(dwellingType === "bostadsratt");
  }

  const showPnInput = pnEditing || !pnKnown;
  const showPeriodInput = periodEditing || !periodKnown;
  const showDwellingPicker = type === "rot" && (dwellingEditing || !dwelling);
  const showProperty =
    type === "rot" && dwelling === "smahus" && (propertyEditing || !value.housing.propertyDesignation?.trim());
  const showBrf =
    type === "rot" && dwelling === "bostadsratt" && (brfEditing || !value.housing.brfOrgNumber?.trim());
  const showApt =
    type === "rot" && dwelling === "bostadsratt" && (aptEditing || !value.housing.apartmentNumber?.trim());

  return (
    <div className="mt-3 space-y-2.5">
      {showPnInput ? (
        <div>
          <label className={labelCls}>Personnummer</label>
          <input
            value={formatPersonnummer(value.personalIdentityNumber)}
            onChange={(e) => patch({ personalIdentityNumber: formatPersonnummer(e.target.value) })}
            onBlur={() => {
              if (isPersonnummerFormat(value.personalIdentityNumber)) setPnEditing(false);
            }}
            inputMode="numeric"
            autoComplete="off"
            placeholder="ÅÅÅÅMMDD-NNNN"
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Arbetsperiod från</label>
            <DateField
              value={value.workPeriodStart}
              onChange={(workPeriodStart) => {
                patch({ workPeriodStart });
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
                patch({ workPeriodEnd });
                if (value.workPeriodStart && workPeriodEnd) setPeriodEditing(false);
              }}
              className={inputCls}
            />
          </div>
        </div>
      ) : (
        <KnownRow>
          Arbetsperiod: {formatWorkPeriodRange(value.workPeriodStart, value.workPeriodEnd)}
          <ChangeButton onClick={() => setPeriodEditing(true)} />
        </KnownRow>
      )}

      {type === "rot" ? (
        showDwellingPicker ? (
          <div>
            <label className={labelCls}>Bostadstyp</label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["smahus", "Fastighet/småhus"],
                  ["bostadsratt", "Bostadsrätt"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDwelling(id)}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    value.housing.dwellingType === id
                      ? "border-ink bg-ink text-white"
                      : "border-line-strong text-soft hover:border-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : dwelling ? (
          <KnownRow>
            Bostadstyp {dwelling === "smahus" ? "Fastighet/småhus" : "Bostadsrätt"}
            <ChangeButton onClick={() => setDwellingEditing(true)} />
          </KnownRow>
        ) : null
      ) : null}

      {showProperty ? (
        <div>
          <label className={labelCls}>Fastighetsbeteckning</label>
          <input
            value={value.housing.propertyDesignation ?? ""}
            onChange={(e) =>
              patch({ housing: { dwellingType: "smahus", propertyDesignation: e.target.value } })
            }
            onBlur={() => {
              if (value.housing.propertyDesignation?.trim()) setPropertyEditing(false);
            }}
            placeholder="T.ex. Södermalm 12:34"
            className={inputCls}
          />
        </div>
      ) : null}

      {showBrf ? (
        <div>
          <label className={labelCls}>BRF organisationsnummer</label>
          <input
            value={formatOrgnr(value.housing.brfOrgNumber ?? "")}
            onChange={(e) =>
              patch({
                housing: {
                  dwellingType: "bostadsratt",
                  brfOrgNumber: formatOrgnr(e.target.value),
                  apartmentNumber: value.housing.apartmentNumber,
                },
              })
            }
            onBlur={() => {
              if (value.housing.brfOrgNumber?.trim()) setBrfEditing(false);
            }}
            inputMode="numeric"
            placeholder="NNNNNN-NNNN"
            className={inputCls}
          />
        </div>
      ) : null}

      {showApt ? (
        <div>
          <label className={labelCls}>Lägenhetsnummer</label>
          <input
            value={value.housing.apartmentNumber ?? ""}
            onChange={(e) =>
              patch({
                housing: {
                  dwellingType: "bostadsratt",
                  brfOrgNumber: value.housing.brfOrgNumber,
                  apartmentNumber: e.target.value,
                },
              })
            }
            onBlur={() => {
              if (value.housing.apartmentNumber?.trim()) setAptEditing(false);
            }}
            className={inputCls}
          />
        </div>
      ) : null}

      {missing.length === 0 ? (
        <p className="text-[13px] font-medium text-ok">✓ Alla uppgifter finns</p>
      ) : hint ? (
        <p className="text-[12px] leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

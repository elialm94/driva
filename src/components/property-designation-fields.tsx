"use client";

import { FieldError, invalidFieldCls } from "./form-validation";
import { cx } from "./ui";

const defaultInputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

export type PropertyDesignationDraft = { id?: string; designation: string };

function withDefaultRow(rows: PropertyDesignationDraft[]): PropertyDesignationDraft[] {
  return rows.length === 0 ? [{ designation: "" }] : rows;
}

export function PropertyDesignationFields({
  values,
  onChange,
  onBlur,
  error,
  errorId = "fastighetsbeteckning-fel",
  inputClassName = defaultInputCls,
  labelClassName = "mb-1 block text-[13px] font-medium text-soft",
}: {
  values: PropertyDesignationDraft[];
  onChange: (rows: PropertyDesignationDraft[]) => void;
  onBlur?: () => void;
  error?: string;
  errorId?: string;
  inputClassName?: string;
  labelClassName?: string;
}) {
  const rows = withDefaultRow(values);
  const canRemove = (row: PropertyDesignationDraft) => rows.length > 1 || Boolean(row.designation.trim());

  function patchRow(index: number, designation: string) {
    const next = rows.map((row, i) => (i === index ? { ...row, designation } : row));
    onChange(next);
  }

  function addRow() {
    onChange([...rows, { designation: "" }]);
  }

  function removeRow(index: number) {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length === 0 ? [{ designation: "" }] : next);
    onBlur?.();
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={row.id ?? `new-${index}`}>
          <label className={labelClassName} htmlFor={index === 0 ? "fastighetsbeteckning" : undefined}>
            {index === 0 ? "Fastighetsbeteckning" : `Fastighet ${index + 1}`}
          </label>
          <div className="flex items-center gap-2">
            <input
              id={index === 0 ? "fastighetsbeteckning" : undefined}
              name="propertyDesignation"
              value={row.designation}
              onChange={(e) => patchRow(index, e.target.value)}
              onBlur={onBlur}
              autoComplete="off"
              placeholder="Skövde Aspen 2:14"
              className={cx(inputClassName, error && invalidFieldCls)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            {canRemove(row) ? (
              <button
                type="button"
                className="shrink-0 text-[13px] text-muted hover:text-ink"
                onClick={() => removeRow(index)}
              >
                Ta bort
              </button>
            ) : null}
          </div>
        </div>
      ))}
      <button type="button" className="text-[13px] font-medium text-muted hover:text-ink" onClick={addRow}>
        + Lägg till fastighet
      </button>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

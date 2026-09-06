"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { buttonClasses, Card } from "./ui";
import { DateField } from "./date-field";
import { FieldError, invalidFieldCls } from "./form-validation";
import { createNextFiscalYearAction, updateFiscalYearPeriodAction } from "@/app/actions";
import { fiscalYearToExtend, nextDay } from "@/lib/accounting/dates";
import { datumLang } from "@/lib/format";

export interface FiscalYearSettingsYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: "oppet" | "stangt";
}

const labelCls = "mb-1 block text-[13px] font-medium text-soft";
const hintCls = "mt-1 text-[12px] text-muted";

export function FiscalYearSettings({ years, today }: { years: FiscalYearSettingsYear[]; today: string }) {
  const router = useRouter();
  const current =
    years.find((y) => y.startDate <= today && today <= y.endDate) ?? years[years.length - 1] ?? null;
  const [startDate, setStartDate] = useState(current?.startDate ?? `${today.slice(0, 4)}-01-01`);
  const [endDate, setEndDate] = useState(current?.endDate ?? `${today.slice(0, 4)}-12-31`);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [creating, startCreate] = useTransition();

  const base = fiscalYearToExtend(years, today);
  const successorStart = base ? nextDay(base.endDate) : null;
  const canCreateNext = Boolean(base) && !years.some((y) => y.startDate === successorStart);
  const editable = current?.status === "oppet";
  const dirty = current ? startDate !== current.startDate || endDate !== current.endDate : true;

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateFiscalYearPeriodAction({
        fiscalYearId: current?.id,
        startDate,
        endDate,
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function createNext() {
    setError(null);
    startCreate(async () => {
      const result = await createNextFiscalYearAction();
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="space-y-4 p-6">
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Räkenskapsår</p>
      <p className={hintCls}>
        Huvudbok, rapporter, moms och bokslut utgår från det här året. Default är 1 januari–31 december.
        Ett brutet år går bra – ange bara start och slut.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="installningar-rakenskapsar-start">
            Startdatum
          </label>
          <DateField
            id="installningar-rakenskapsar-start"
            value={startDate}
            onChange={(v) => {
              setSaved(false);
              setStartDate(v);
            }}
            className={`w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink${error ? ` ${invalidFieldCls}` : ""}`}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="installningar-rakenskapsar-slut">
            Slutdatum
          </label>
          <DateField
            id="installningar-rakenskapsar-slut"
            value={endDate}
            onChange={(v) => {
              setSaved(false);
              setEndDate(v);
            }}
            className={`w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink${error ? ` ${invalidFieldCls}` : ""}`}
          />
        </div>
      </div>
      {current ? (
        <p className={hintCls}>
          {current.label}: {datumLang(current.startDate)}–{datumLang(current.endDate)}
          {current.status === "stangt" ? " · stängt" : ""}
        </p>
      ) : (
        <p className={hintCls}>Inget år är sparat ännu – 1 januari–31 december används tills du sparar.</p>
      )}
      {error ? <FieldError id="installningar-rakenskapsar-fel">{error}</FieldError> : null}
      <div className="flex flex-wrap items-center gap-3">
        {editable || !current ? (
          <button
            type="button"
            className={buttonClasses("secondary", "sm")}
            disabled={isPending || !dirty}
            onClick={save}
          >
            {isPending ? "Sparar …" : "Spara räkenskapsår"}
          </button>
        ) : (
          <p className={hintCls}>Stängda år ändras inte. Öppna året igen under Bokslut om datumen måste rättas.</p>
        )}
        {canCreateNext ? (
          <button type="button" className={buttonClasses("secondary", "sm")} disabled={creating} onClick={createNext}>
            {creating ? "Skapar …" : "Skapa nästa år"}
          </button>
        ) : null}
        {saved && !dirty ? (
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ok">
            <Check className="size-4" /> Sparat
          </p>
        ) : null}
      </div>
      {years.length > 1 ? (
        <ul className="space-y-1 text-[13px] text-soft">
          {years.map((y) => (
            <li key={y.id}>
              <span className="font-medium text-ink">{y.label}</span> · {datumLang(y.startDate)}–{datumLang(y.endDate)}
              {y.status === "stangt" ? " · stängt" : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

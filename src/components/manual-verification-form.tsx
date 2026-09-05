"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Plus, Trash2 } from "lucide-react";
import { Card, buttonClasses, cx } from "./ui";
import { DateField } from "./date-field";
import { AccountCombobox } from "./account-combobox";
import { kr } from "@/lib/format";
import { postManualVerificationAction } from "@/app/bokforing-actions";
import type { AccountPickerOption } from "@/lib/services/manual-verification";

/**
 * Manuellt verifikat. Formuläret är avsiktligt rakt: konto, debet, kredit och
 * en beskrivning. Balanskravet visas medan man skriver, men det är motorn som
 * avgör – knappen är inte sanningen.
 */

interface Row {
  key: string;
  account: string;
  debit: string;
  credit: string;
  note: string;
}

const fieldCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent";

function emptyRow(): Row {
  return { key: Math.random().toString(36).slice(2), account: "", debit: "", credit: "", note: "" };
}

/** Hela kronor. Tomt fält och skräp blir 0 – motorn avvisar ändå obalans. */
function amount(value: string): number {
  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

export function ManualVerificationForm({
  accounts,
  today,
  lockedThrough,
  firstOpenDate,
  businessId,
  backHref = "/bokforing/verifikationer",
}: {
  accounts: AccountPickerOption[];
  today: string;
  /** Sista låsta dagen, om bokföringen är låst. Visas som förklaring. */
  lockedThrough?: string;
  /** Första bokföringsbara dagen. Kalendern spärrar allt före den. */
  firstOpenDate?: string;
  /** Klienten bokföringen gäller – sätts från konsultytan, inte från ägarytan. */
  businessId?: string;
  backHref?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [date, setDate] = useState(today);
  const [transactionDate, setTransactionDate] = useState("");
  const [description, setDescription] = useState("");
  const [explanation, setExplanation] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; dataUrl: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ label: string; total: number; id: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const comboOptions = useMemo(
    () => accounts.map((a) => ({ key: String(a.account), account: a.account, label: a.label })),
    [accounts]
  );

  const sumDebit = rows.reduce((s, r) => s + amount(r.debit), 0);
  const sumCredit = rows.reduce((s, r) => s + amount(r.credit), 0);
  const diff = sumDebit - sumCredit;
  const balanced = sumDebit > 0 && diff === 0;

  function patch(key: string, next: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }

  function submit() {
    setError(null);
    const lines = rows
      .filter((r) => r.account && (amount(r.debit) > 0 || amount(r.credit) > 0))
      .map((r) => ({
        account: Number(r.account),
        debit: amount(r.debit),
        credit: amount(r.credit),
        note: r.note.trim() || undefined,
      }));
    startTransition(async () => {
      const result = await postManualVerificationAction({
        date,
        transactionDate: transactionDate || undefined,
        description,
        explanation: explanation || undefined,
        lines,
        attachmentDataUrl: attachment?.dataUrl,
        attachmentFilename: attachment?.name,
        businessId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPosted({ label: result.label, total: result.total, id: result.id });
      setRows([emptyRow(), emptyRow()]);
      setDescription("");
      setExplanation("");
      setTransactionDate("");
      setAttachment(null);
      router.refresh();
    });
  }

  if (posted) {
    return (
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">
          {posted.label} är bokförd på {kr(posted.total)}
        </h2>
        <p className="mt-1 text-[13px] text-soft">
          Verifikationen är låst. Blev något fel rättas det med en rättelseverifikation – bokföring skrivs
          aldrig om.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`${backHref}?v=${posted.id}`} className={buttonClasses("primary", "sm")}>
            Öppna {posted.label}
          </a>
          <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => setPosted(null)}>
            Bokför ett till
          </button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-soft">Bokföringsdatum</span>
            <DateField value={date} onChange={setDate} className={fieldCls} min={firstOpenDate} />
            <span className="mt-1 block text-[12px] text-muted">
              Styr period, moms och räkenskapsår.
              {lockedThrough ? ` Bokföringen är låst till och med ${lockedThrough}.` : ""}
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-soft">
              Handelsdatum <span className="font-normal text-muted">(om annat)</span>
            </span>
            <DateField
              value={transactionDate}
              onChange={setTransactionDate}
              className={fieldCls}
              placeholder="Samma som bokföringsdatum"
            />
            <span className="mt-1 block text-[12px] text-muted">
              När händelsen faktiskt inträffade. Påverkar inte perioden.
            </span>
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-soft">Vad har hänt?</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="T.ex. Omföring av felkonterad hyra"
            className={fieldCls}
          />
        </label>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Kontering</h2>
          <span className={cx("text-[13px] tabular", balanced ? "text-ok" : "text-muted")}>
            Debet {kr(sumDebit)} · Kredit {kr(sumCredit)}
          </span>
        </div>

        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2.5rem]">
              <AccountCombobox
                options={comboOptions}
                value={row.account}
                onChange={(key) => patch(row.key, { account: key })}
                emptyLabel="Välj konto"
              />
              <input
                value={row.debit}
                inputMode="numeric"
                onChange={(e) => patch(row.key, { debit: e.target.value, credit: "" })}
                placeholder="Debet"
                className={cx(fieldCls, "text-right tabular")}
                aria-label="Debet"
              />
              <input
                value={row.credit}
                inputMode="numeric"
                onChange={(e) => patch(row.key, { credit: e.target.value, debit: "" })}
                placeholder="Kredit"
                className={cx(fieldCls, "text-right tabular")}
                aria-label="Kredit"
              />
              <button
                type="button"
                onClick={() => setRows((current) => (current.length > 2 ? current.filter((r) => r.key !== row.key) : current))}
                disabled={rows.length <= 2}
                className="flex items-center justify-center rounded-xl border border-line text-muted hover:text-ink disabled:opacity-40"
                aria-label="Ta bort raden"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setRows((current) => [...current, emptyRow()])}
            className={buttonClasses("ghost", "sm")}
          >
            <Plus className="size-3.5" /> Lägg till rad
          </button>
          {sumDebit > 0 && diff !== 0 ? (
            <span className="text-[13px] text-warn tabular">
              {diff > 0 ? `${kr(diff)} mer i debet` : `${kr(-diff)} mer i kredit`}
            </span>
          ) : null}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-soft">
            Underlag <span className="font-normal text-muted">(rekommenderas)</span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <label className={buttonClasses("secondary", "sm") + " cursor-pointer"}>
              <Paperclip className="size-3.5" />
              {attachment ? "Byt fil" : "Välj fil"}
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () =>
                    setAttachment({ name: file.name, dataUrl: String(reader.result), size: file.size });
                  reader.onerror = () => setError("Filen kunde inte läsas.");
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {attachment ? (
              <span className="text-[13px] text-soft">
                {attachment.name}
                <button
                  type="button"
                  className="ml-2 text-muted underline hover:text-ink"
                  onClick={() => {
                    setAttachment(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                >
                  Ta bort
                </button>
              </span>
            ) : (
              <span className="text-[13px] text-muted">Fakturan, kvittot eller avtalet bakom bokningen.</span>
            )}
          </div>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-soft">
            Förklaring <span className="font-normal text-muted">(valfritt)</span>
          </span>
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={2}
            placeholder="Varför bokförs det så här? Visas på verifikationen."
            className={fieldCls}
          />
        </label>
      </Card>

      {error ? (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !balanced || !description.trim()}
          className={buttonClasses("primary", "md")}
        >
          {pending ? "Bokför …" : "Bokför verifikatet"}
        </button>
        <a href={backHref} className={buttonClasses("ghost", "md")}>
          Avbryt
        </a>
        {!balanced && sumDebit > 0 ? (
          <span className="text-[13px] text-muted">Debet och kredit måste vara lika stora.</span>
        ) : null}
      </div>
    </div>
  );
}

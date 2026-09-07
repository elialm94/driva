"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Landmark, Pencil } from "lucide-react";
import { declareVatPeriodAction, setTaxAccountOcrAction } from "@/app/bokforing-actions";
import { buttonClasses, cx } from "./ui";
import { useToast } from "./toast";
import { kr } from "@/lib/format";

/**
 * Klientdelarna i momsflödet. All logik bor i lib/accounting/vat-flow.ts och
 * serveråtgärderna – här finns bara knapparna, bekräftelsen och klippbordet.
 */

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 text-[13px] font-medium text-danger">
      {error}
    </p>
  );
}

/** Steg 2: "Jag har deklarerat" – skapar rapporten och markerar den som deklarerad i ett klick. */
export function DeclareVatButton({ periodKey, label, attBetala }: { periodKey: string; label: string; attBetala: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await declareVatPeriodAction(periodKey);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirming(false);
      toast({
        title: `Momsen för ${label} är deklarerad`,
        text:
          attBetala > 0
            ? `Siffrorna är frysta och perioden låst. Nästa steg: betala ${kr(attBetala)} till skattekontot.`
            : attBetala < 0
              ? `Siffrorna är frysta och perioden låst. ${kr(-attBetala)} kommer tillbaka från Skatteverket.`
              : "Siffrorna är frysta och perioden låst. Ingen moms att betala.",
        tone: "ok",
      });
      router.refresh();
    });
  }

  if (confirming) {
    return (
      <div data-vat-declare-confirm className="rounded-xl border border-line bg-canvas/60 px-4 py-3">
        <p className="text-[13px] text-ink">
          Har du lämnat in momsdeklarationen för <span className="font-medium">{label}</span> hos Skatteverket?
        </p>
        <p className="mt-1 text-[12px] text-muted">
          Driva fryser då siffrorna, för momsen till redovisningskontot (2650) och låser perioden. Det går inte att bokföra
          mer i perioden efteråt.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClasses("primary", "sm")} disabled={isPending} onClick={confirm}>
            {isPending ? "Markerar …" : "Ja, den är inlämnad"}
          </button>
          <button type="button" className={buttonClasses("ghost", "sm")} disabled={isPending} onClick={() => setConfirming(false)}>
            Inte ännu
          </button>
        </div>
        <ErrorNote error={error} />
      </div>
    );
  }
  return (
    <div>
      <button type="button" data-vat-declare className={buttonClasses("primary", "sm")} onClick={() => setConfirming(true)}>
        <Landmark className="size-3.5" />
        Jag har deklarerat
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

/** Kopiera ett värde (belopp, bankgiro, OCR) – för att fylla i hos Skatteverket eller i banken. */
export function CopyValue({ value, label, className }: { value: string; label: string; className?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ id: "copy-vat", title: `${label} kopierat`, text: value, duration: 2500 });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ id: "copy-vat", title: "Kunde inte kopiera", text: "Markera och kopiera värdet för hand.", tone: "danger" });
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Kopiera ${label.toLowerCase()}`}
      title={`Kopiera ${label.toLowerCase()}`}
      className={cx(
        "inline-flex size-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-ink/6 hover:text-ink",
        className
      )}
    >
      {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </button>
  );
}

const SKV_OCR_URL =
  "https://www.skatteverket.se/foretag/etjansterochblanketter/allaetjanster/tjanster/ocrberakning.106.233f91f71260075abe8800010991.html";

/**
 * OCR-numret för skattekontot: visas med kopiera-knapp när det är sparat,
 * annars en länk till Skatteverkets OCR-beräkning och ett fält att spara det i.
 */
export function TaxAccountOcrField({ ocr, readOnly }: { ocr?: string; readOnly?: boolean }) {
  const router = useRouter();
  const inputId = useId();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(!ocr);
  const [value, setValue] = useState(ocr ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await setTaxAccountOcrAction(value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (ocr && !editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[14px] tabular text-ink">{ocr}</span>
        <CopyValue value={ocr} label="OCR-nummer" />
        {readOnly ? null : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Ändra OCR-nummer"
            className="inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-ink/6 hover:text-ink"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  if (readOnly) {
    return <span className="text-[13px] text-muted">Inte sparat</span>;
  }

  return (
    <div data-vat-ocr-field>
      <p className="text-[12.5px] leading-relaxed text-soft">
        Numret är unikt för bolaget och hämtas hos Skatteverket.{" "}
        <a href={SKV_OCR_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
          Öppna OCR-beräkningen
          <ExternalLink className="size-3" />
        </a>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          OCR-nummer för skattekontot
        </label>
        <input
          id={inputId}
          value={value}
          inputMode="numeric"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Klistra in numret här"
          className="w-56 rounded-lg border border-line bg-card px-3 py-1.5 font-mono text-[13px] tabular outline-none focus:border-accent"
        />
        <button type="button" className={buttonClasses("secondary", "sm")} disabled={isPending || !value.trim()} onClick={submit}>
          {isPending ? "Sparar …" : "Spara"}
        </button>
        {ocr ? (
          <button
            type="button"
            className={buttonClasses("ghost", "sm")}
            disabled={isPending}
            onClick={() => {
              setEditing(false);
              setValue(ocr);
              setError(null);
            }}
          >
            Avbryt
          </button>
        ) : null}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileCheck2, PenLine, RefreshCw, Send } from "lucide-react";
import {
  fetchFilingReceiptAction,
  generateFilingAction,
  signFilingAction,
  submitFilingAction,
} from "@/app/inlamning-actions";
import type { FilingKind, FilingSubmission } from "@/lib/types";
import { Badge, DemoTag, buttonClasses, cx } from "./ui";
import { datumKort } from "@/lib/format";

/**
 * Inlämningen av en deklaration: statusen och nästa steg.
 *
 * Samma panel på alla fyra ytor (moms, lön, INK2, årsredovisning) så att
 * stegen betyder samma sak överallt. Panelen påstår ingenting av sig själv –
 * den visar vad statusen säger, och statusen sätts bara av serverlagret.
 */

const AUTHORITY_NAME = { skatteverket: "Skatteverket", bolagsverket: "Bolagsverket" } as const;

const STATUS_TONE = {
  utkast: "neutral",
  genererad: "info",
  signerad: "info",
  inlamnad: "warn",
  kvitterad: "ok",
  avvisad: "danger",
} as const;

const STATUS_TEXT: Record<FilingSubmission["status"], string> = {
  utkast: "Utkast",
  genererad: "Fil genererad",
  signerad: "Signerad",
  inlamnad: "Inlämnad – väntar på kvittens",
  kvitterad: "Kvitterad",
  avvisad: "Avvisad",
};

export interface InlamningPanelProps {
  kind: FilingKind;
  /** Momsperiodens nyckel, AGI-månaden, räkenskapsårets id eller rapportens id. */
  subjectId: string;
  submission: FilingSubmission | null;
  /** Finns en leverantör att lämna in genom? Annars hämtas filen och lämnas in för hand. */
  available: boolean;
  /** Går det att signera här? BankID-kroken är demolåst tills en riktig leverantör finns. */
  signingAvailable: boolean;
  /** Sådant som måste vara klart innan filen bör lämnas in. */
  blockers?: string[];
  demo?: boolean;
  className?: string;
}

export function InlamningPanel({
  kind,
  subjectId,
  submission,
  available,
  signingAvailable,
  blockers = [],
  demo = false,
  className,
}: InlamningPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const status = submission?.status ?? "utkast";
  const authority = submission ? AUTHORITY_NAME[submission.authority] : null;
  const blocked = blockers.length > 0;

  function act(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (!available) {
    return (
      <div className={cx("rounded-xl border border-line/60 bg-canvas/60 px-4 py-3", className)}>
        <p className="text-[13px] leading-relaxed text-soft">
          Driva lämnar inte in deklarationen maskinellt för det här företaget – det kräver ett avtal om inlämning.
          Filen ovan är komplett: ladda ner den och lämna in den i myndighetens e-tjänst.
        </p>
      </div>
    );
  }

  return (
    <div className={cx("rounded-xl border border-line/60 px-4 py-3.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[13.5px] font-semibold">Inlämning</h3>
          <Badge tone={STATUS_TONE[status]}>{STATUS_TEXT[status]}</Badge>
          {demo ? <DemoTag /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status === "utkast" || status === "avvisad" ? (
            <button
              type="button"
              className={buttonClasses("secondary", "sm")}
              disabled={isPending || blocked}
              onClick={() => act(() => generateFilingAction(kind, subjectId))}
            >
              <FileCheck2 className="size-3.5 shrink-0" />
              {isPending ? "Genererar …" : status === "avvisad" ? "Gör ett nytt försök" : "Förbered inlämning"}
            </button>
          ) : null}

          {status === "genererad" ? (
            <>
              <button
                type="button"
                className={buttonClasses("secondary", "sm")}
                disabled={isPending}
                onClick={() => act(() => generateFilingAction(kind, subjectId))}
              >
                <RefreshCw className={cx("size-3.5 shrink-0", isPending && "animate-spin")} />
                Generera om
              </button>
              <button
                type="button"
                className={buttonClasses(signingAvailable ? "bankid" : "secondary", "sm")}
                disabled={isPending || blocked || !signingAvailable}
                onClick={() => act(() => signFilingAction(submission!.id))}
              >
                <PenLine className="size-3.5 shrink-0" />
                {isPending ? "Signerar …" : "Signera"}
              </button>
            </>
          ) : null}

          {status === "signerad" ? (
            <button
              type="button"
              className={buttonClasses("primary", "sm")}
              disabled={isPending || blocked}
              onClick={() => act(() => submitFilingAction(submission!.id))}
            >
              <Send className="size-3.5 shrink-0" />
              {isPending ? "Lämnar in …" : `Lämna in till ${authority}`}
            </button>
          ) : null}

          {status === "inlamnad" ? (
            <button
              type="button"
              className={buttonClasses("secondary", "sm")}
              disabled={isPending}
              onClick={() => act(() => fetchFilingReceiptAction(submission!.id))}
            >
              <RefreshCw className={cx("size-3.5 shrink-0", isPending && "animate-spin")} />
              {isPending ? "Hämtar …" : "Hämta kvittens"}
            </button>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-soft">
        {status === "utkast"
          ? "Förbered inlämningen: filen byggs ur bokföringen och låses med en kontrollsumma, signeras och lämnas sedan in."
          : null}
        {status === "genererad" && submission
          ? `Filen är genererad ${submission.generatedAt ? datumKort(submission.generatedAt) : ""} och låst med en kontrollsumma. Signera den innan den lämnas in.`
          : null}
        {status === "signerad" && submission?.signature
          ? `Signerad av ${submission.signature.signedByName} ${datumKort(submission.signature.signedAt)}.` +
            (submission.signature.note ? ` ${submission.signature.note}` : "")
          : null}
        {status === "inlamnad" && submission
          ? `Mottagen av ${authority}${submission.submittedAt ? ` ${datumKort(submission.submittedAt)}` : ""} med id ${submission.providerSubmissionId}. Kvittensen kommer när deklarationen behandlats.`
          : null}
        {status === "kvitterad" && submission?.receipt
          ? `Kvittens ${submission.receipt.receiptId} från ${authority} ${datumKort(submission.receipt.receivedAt)}.` +
            (submission.receipt.message ? ` ${submission.receipt.message}` : "")
          : null}
        {status === "avvisad" && submission?.rejection ? submission.rejection.reason : null}
      </p>

      {status === "kvitterad" ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-ok">
          <CheckCircle2 className="size-3.5 shrink-0" />
          Deklarationen är inlämnad och kvitterad.
        </p>
      ) : null}

      {submission && submission.files.length > 0 && status !== "kvitterad" ? (
        <ul className="mt-2 space-y-0.5">
          {submission.files.map((f) => (
            <li key={f.filename} className="font-mono text-[11.5px] text-muted">
              {f.filename} · {f.size} byte · SHA-256 {f.sha256.slice(0, 16)}…
            </li>
          ))}
        </ul>
      ) : null}

      {status === "genererad" && !signingAvailable ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-warn">
          Signering med BankID är inte påslagen för det här företaget än. Filen går att hämta och lämna in för hand.
        </p>
      ) : null}

      {blocked ? (
        <ul className="mt-2 space-y-1">
          {blockers.map((b, i) => (
            <li key={i} className="text-[12.5px] leading-relaxed text-warn">
              {b}
            </li>
          ))}
        </ul>
      ) : null}

      {error ?? submission?.lastError ? (
        <p role="alert" className="mt-2 text-[12.5px] font-medium text-danger">
          {error ?? submission?.lastError}
        </p>
      ) : null}
    </div>
  );
}

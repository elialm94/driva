"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, Package, Send } from "lucide-react";
import { markFilingDownloadedAction, reportManualFilingAction } from "@/app/inlamning-actions";
import { RECEIPT_FILE_FIELD } from "@/lib/filing/receipt-file";
import { FERVA_DOES_NOT_SEND, type FilingInstruction } from "@/lib/filing/instructions";
import type { FilingCaseFile } from "@/lib/filing/deklarationer";
import type { FilingKind, FilingSubmission } from "@/lib/types";
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from "@/lib/uploads/limits";
import { datumLang } from "@/lib/format";
import { Badge, buttonClasses, cx } from "./ui";

/**
 * Den manuella inlämningen, steg för steg. Ferva bygger filen och håller
 * historiken; användaren gör själva inlämningen i myndighetens e-tjänst.
 *
 *   1 Ferva kontrollerar underlaget          (blockerare/varningar – serverns)
 *   2 Hämta filen/filerna                    (kontrollsumma låses per rad)
 *   3 Öppna e-tjänsten i ny flik
 *   4 Gör så här                             (versionerade instruktioner)
 *   5 Jag har lämnat in                      (referens och/eller kvittensfil)
 *   6 Historik                               (datum, vem, kontrollsumma, kvittens)
 *
 * Komponenten påstår ingenting själv: blockerare, filer och status kommer från
 * servern, och knappen i steg 5 finns bara för den som får lämna in.
 */

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export interface ManuellInlamningProps {
  kind: FilingKind;
  subjectId: string;
  /** Klienten på konsultytan; ägaren skickar inget. */
  businessId?: string;
  authorityName: string;
  periodLabel: string;
  instruction: FilingInstruction;
  instructionsVersion: string;
  files: FilingCaseFile[];
  packageHref?: string;
  blockers: string[];
  warnings: string[];
  payloadError?: string;
  canReport: boolean;
  canPrepare: boolean;
  canSubmit: boolean;
  downloadedCurrent: boolean;
  open: FilingSubmission | null;
  history: FilingSubmission[];
  alreadyFiled: boolean;
  /** Filen går att lämna in via leverantör härifrån (mock i demo, live med avtal). */
  machineAvailable: boolean;
}

type ActionResult = { ok: true } | { ok: false; error: string };

export function ManuellInlamning(props: ManuellInlamningProps) {
  const {
    kind,
    subjectId,
    businessId,
    authorityName,
    instruction,
    instructionsVersion,
    files,
    packageHref,
    blockers,
    warnings,
    payloadError,
    canReport,
    canPrepare,
    canSubmit,
    downloadedCurrent,
    open,
    history,
    alreadyFiled,
    machineAvailable,
  } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [downloaded, setDownloaded] = useState(downloadedCurrent);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const blocked = blockers.length > 0 || Boolean(payloadError);
  const withBusiness = (href: string) => (businessId ? `${href}&foretag=${encodeURIComponent(businessId)}` : href);

  function noteDownload() {
    if (!canPrepare) return;
    setDownloaded(true);
    void markFilingDownloadedAction(kind, subjectId, businessId).then((r: ActionResult) => {
      if (r.ok) router.refresh();
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    const form = new FormData(formRef.current);
    form.set("kind", kind);
    form.set("subjectId", subjectId);
    if (businessId) form.set("businessId", businessId);
    const file = form.get(RECEIPT_FILE_FIELD);
    if (file instanceof File && file.size === 0) form.delete(RECEIPT_FILE_FIELD);
    setError(null);
    startTransition(async () => {
      const result: ActionResult = await reportManualFilingAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      formRef.current?.reset();
      setFileName(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4" data-manual-filing={kind}>
      {/* 1 · Kontroll */}
      <Step n={1} title="Ferva kontrollerar underlaget" tone={blocked ? "warn" : "ok"}>
        {payloadError ? <p className="text-[13px] leading-relaxed text-warn">{payloadError}</p> : null}
        {blockers.length > 0 ? (
          <ul className="space-y-1">
            {blockers.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : !payloadError ? (
          <p className="flex items-center gap-1.5 text-[13px] text-ok">
            <CheckCircle2 className="size-3.5 shrink-0" />
            Inget hindrar inlämningen. Filen bygger på bokföringen som den ser ut nu.
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed text-soft">
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </Step>

      {/* 2 · Hämta */}
      <Step n={2} title={files.length > 1 ? "Hämta filerna" : "Hämta filen"} tone={downloaded ? "ok" : "neutral"}>
        <p className="text-[13px] leading-relaxed text-soft">{instruction.fileHint}</p>
        {files.length > 0 ? (
          <ul className="mt-2.5 space-y-1.5">
            {files.map((f) => (
              <li key={f.filename} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-medium">
                    <FileText className="size-3.5 shrink-0 text-muted" />
                    {f.filename}
                  </p>
                  <p className="font-mono text-[11px] text-muted" title={`SHA-256 ${f.sha256}`}>
                    {f.size} byte · SHA-256 {f.sha256.slice(0, 16)}…
                  </p>
                </div>
                <a
                  href={withBusiness(f.href)}
                  onClick={noteDownload}
                  className={buttonClasses("secondary", "sm")}
                  aria-disabled={Boolean(payloadError)}
                >
                  <Download className="size-3.5" />
                  Hämta
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {packageHref && files.length > 1 ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <a href={withBusiness(packageHref)} onClick={noteDownload} className={buttonClasses("primary", "sm")}>
              <Package className="size-3.5" />
              Hämta paket (zip med båda)
            </a>
            <p className="text-[12.5px] text-muted">Packa upp och ladda upp båda filerna i samma överföring.</p>
          </div>
        ) : null}
        {open?.downloadedAt ? (
          <p className="mt-2 text-[12px] text-muted">Senast hämtad {datumLang(open.downloadedAt)}. Kontrollsumman låstes då.</p>
        ) : null}
      </Step>

      {/* 3 · Öppna e-tjänsten */}
      <Step n={3} title={`Öppna ${authorityName}`} tone="neutral">
        <a
          href={instruction.serviceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline"
        >
          {instruction.serviceName} hos {authorityName}
          <ExternalLink className="size-3.5" />
        </a>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Öppnas i en ny flik. {FERVA_DOES_NOT_SEND}
          {machineAvailable ? " Vill du hellre lämna in via leverantören används panelen längre ner." : ""}
        </p>
      </Step>

      {/* 4 · Gör så här */}
      <Step n={4} title="Gör så här i e-tjänsten" tone="neutral" right={<span className="text-[11px] text-muted">Instruktion v{instructionsVersion}</span>}>
        <ol className="list-decimal space-y-1.5 pl-5">
          {instruction.steps.map((s, i) => (
            <li key={i} className="text-[13px] leading-relaxed text-soft">
              {s}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{instruction.receiptHint}</p>
        {instruction.alternative ? (
          <details className="mt-3 rounded-xl border border-line/60 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium">{instruction.alternative.title}</summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              {instruction.alternative.steps.map((s, i) => (
                <li key={i} className="text-[13px] leading-relaxed text-soft">
                  {s}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </Step>

      {/* 5 · Jag har lämnat in */}
      <Step n={5} title="Jag har lämnat in" tone={alreadyFiled || done ? "ok" : "neutral"}>
        {alreadyFiled || done ? (
          <p className="flex items-center gap-1.5 text-[13px] text-ok">
            <CheckCircle2 className="size-3.5 shrink-0" />
            Inlämningen är rapporterad. Behöver du rätta något lämnar du in en ny fil och rapporterar igen – historiken behåller den
            första.
          </p>
        ) : !canSubmit ? (
          <p className="text-[13px] leading-relaxed text-soft">
            Att rapportera den slutliga inlämningen är ägarens handling. Du kan förbereda och hämta filen; ägaren (eller en roll med
            rätt att lämna in) rapporterar här när det är gjort.
          </p>
        ) : (
          <form ref={formRef} onSubmit={submit} className="space-y-3">
            {!downloaded ? (
              <p className="text-[12.5px] leading-relaxed text-warn">
                Hämta filen i steg 2 först, så att kontrollsumman för det du lämnar in är låst.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="filing-reference" className={labelCls}>
                  Referens- eller kvittensnummer från {authorityName}
                </label>
                <input id="filing-reference" name="reference" className={inputCls} maxLength={80} placeholder="t.ex. 2026-09-12-1234567" autoComplete="off" />
              </div>
              <div>
                <label htmlFor="filing-receipt" className={labelCls}>
                  Kvittens (PDF eller bild) – valfritt om du har referensnumret
                </label>
                <input
                  id="filing-receipt"
                  name={RECEIPT_FILE_FIELD}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                  className="block w-full text-[13px] text-soft file:mr-3 file:rounded-lg file:border-0 file:bg-ink/6 file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-ink"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFileName(f?.name ?? null);
                    setFileError(f && f.size > UPLOAD_MAX_BYTES ? `Kvittensen är för stor (max ${UPLOAD_MAX_LABEL}).` : null);
                  }}
                />
                {fileName ? <p className="mt-1 text-[12px] text-muted">{fileName}</p> : null}
                {fileError ? <p className="mt-1 text-[12px] font-medium text-danger">{fileError}</p> : null}
              </div>
            </div>
            <div>
              <label htmlFor="filing-note" className={labelCls}>
                Anteckning (valfritt)
              </label>
              <input id="filing-note" name="note" className={inputCls} maxLength={300} placeholder="t.ex. lämnad med ruta 41 justerad för hand" />
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Kvittensen sparas privat på företaget, bara för den som har tillgång till bokföringen, och bevaras som underlag. Ferva
              kontrollerar inte kvittensen hos {authorityName} – det du anger är din uppgift och sparas med ditt namn och datum.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={buttonClasses("primary", "md")} disabled={isPending || !canReport || Boolean(fileError)}>
                <Send className="size-4" />
                {isPending ? "Sparar …" : "Jag har lämnat in"}
              </button>
              {!canReport && !alreadyFiled ? (
                <span className="text-[12.5px] text-muted">Åtgärda blockerarna i steg 1 först.</span>
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="text-[12.5px] font-medium text-danger">
                {error}
              </p>
            ) : null}
          </form>
        )}
      </Step>

      {/* 6 · Historik */}
      <Step n={6} title="Historik" tone="neutral">
        {history.length === 0 ? (
          <p className="text-[13px] text-muted">Ingen inlämning är påbörjad för perioden.</p>
        ) : (
          <ul className="space-y-2">
            {[...history].reverse().map((s) => (
              <li key={s.id} className="rounded-xl border border-line/60 px-3 py-2.5" data-filing-history={s.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={s.status === "kvitterad" ? "ok" : s.status === "avvisad" ? "danger" : "info"}>{statusLabel(s)}</Badge>
                  <span className="text-[12.5px] text-soft">
                    {s.provider === "manuell" ? "För hand" : s.provider === "mock" ? "Demo-leverantör" : "Via leverantör"}
                  </span>
                </div>
                <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[12.5px] sm:grid-cols-2">
                  {s.manualReceipt ? (
                    <>
                      <Row k="Rapporterad">
                        {datumLang(s.manualReceipt.reportedAt)} av {s.manualReceipt.reportedByName}
                      </Row>
                      {s.manualReceipt.reference ? <Row k="Referens">{s.manualReceipt.reference}</Row> : null}
                      {s.manualReceipt.note ? <Row k="Anteckning">{s.manualReceipt.note}</Row> : null}
                      {s.manualReceipt.file ? (
                        <Row k="Kvittensfil">
                          <a
                            href={`/api/bokforing/inlamning/${encodeURIComponent(s.id)}/kvittens${businessId ? `?foretag=${encodeURIComponent(businessId)}` : ""}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-accent hover:underline"
                          >
                            {s.manualReceipt.file.filename}
                          </a>
                        </Row>
                      ) : null}
                    </>
                  ) : null}
                  {s.receipt && !s.manualReceipt ? (
                    <Row k="Kvittens">
                      {s.receipt.receiptId} · {datumLang(s.receipt.receivedAt)}
                    </Row>
                  ) : null}
                  {s.signature ? (
                    <Row k="Signerad">
                      {datumLang(s.signature.signedAt)} av {s.signature.signedByName}
                      {s.signature.note ? ` · ${s.signature.note}` : ""}
                    </Row>
                  ) : null}
                  {s.rejection ? <Row k="Avvisad">{s.rejection.reason}</Row> : null}
                  {s.generatedAt ? <Row k="Fil byggd">{datumLang(s.generatedAt)}</Row> : null}
                  {s.downloadedAt ? <Row k="Hämtad">{datumLang(s.downloadedAt)}</Row> : null}
                  <Row k="Skapad av">{s.createdBy === "assistent" ? "Assistenten" : "Användaren"} · {datumLang(s.createdAt)}</Row>
                </dl>
                <ul className="mt-1.5 space-y-0.5">
                  {s.files.map((f) => (
                    <li key={f.filename} className="font-mono text-[11px] text-muted" title={`SHA-256 ${f.sha256}`}>
                      {f.filename} · SHA-256 {f.sha256}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Step>
    </div>
  );
}

function statusLabel(s: FilingSubmission): string {
  switch (s.status) {
    case "kvitterad":
      return s.provider === "manuell" ? "Inlämnad (rapporterad)" : "Kvitterad";
    case "inlamnad":
      return "Mottagen";
    case "avvisad":
      return "Avvisad";
    case "signerad":
      return "Signerad";
    case "genererad":
      return "Fil byggd";
    case "utkast":
      return "Utkast";
  }
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted">{k}</dt>
      <dd className="min-w-0 text-soft">{children}</dd>
    </div>
  );
}

function Step({
  n,
  title,
  tone,
  right,
  children,
}: {
  n: number;
  title: string;
  tone: "ok" | "warn" | "neutral";
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line/60 px-4 py-3.5" data-step={n}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold">
          <span
            className={cx(
              "inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold",
              tone === "ok" ? "bg-ok-soft text-ok" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-ink/6 text-soft"
            )}
          >
            {n}
          </span>
          {title}
        </h3>
        {right}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

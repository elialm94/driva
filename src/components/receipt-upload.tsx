"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, FileText, Loader2, X } from "lucide-react";
import { FileDropzone, type FileDropzoneVariant } from "./file-dropzone";
import { cx } from "./ui";
import { RECEIPT_MAX_BYTES } from "@/lib/receipts/read-file";
import { UPLOAD_MAX_LABEL } from "@/lib/uploads/limits";

/**
 * Kvittouppladdning som en kö, inte en knapp.
 *
 * Släpp/välj/fota/klistra in flera kvitton på en gång: varje fil får en rad
 * med miniatyr (bilder) eller filikon (PDF), läses av i tur och ordning och
 * landar som "Bokfört", "I inboxen" eller "Sparat" – eller med ett begripligt
 * fel som bara gäller den filen. Resten fortsätter. Uppladdningen sker
 * sekventiellt: tolkningen är det som tar tid, och två samtidiga skrivningar
 * mot samma företag är inget att bjuda på i onödan.
 *
 * Vad som händer med filen avgör anroparen via `upload` – samma yta används
 * för inboxen (fristående kvitto/faktura) och för "Lägg till kvitto" på ett
 * känt bankköp.
 */

export type ReceiptUploadOutcome = { ok: true; note: string } | { ok: false; error: string };

type QueueStatus = "vantar" | "laser" | "klar" | "fel";

interface QueueItem {
  id: string;
  file: File;
  previewUrl: string | null;
  status: QueueStatus;
  note?: string;
}

let queueSeq = 0;

function previewFor(file: File): string | null {
  if (!file.type.startsWith("image/") || /heic|heif/i.test(file.type)) return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function ReceiptUpload({
  upload,
  variant = "landing",
  multiple = true,
  title,
  subtitle,
  formats = "PDF, JPG, PNG, HEIC · max 8 MB per fil",
  className,
  camera = true,
  pasteAnywhere = false,
  refreshAfter = true,
  onDone,
}: {
  upload: (file: File) => Promise<ReceiptUploadOutcome>;
  variant?: FileDropzoneVariant;
  multiple?: boolean;
  title: string;
  subtitle?: string;
  formats?: string;
  className?: string;
  camera?: boolean;
  pasteAnywhere?: boolean;
  /** router.refresh() när kön är klar så listor och räknare hämtas om. */
  refreshAfter?: boolean;
  /** Anropas när alla filer i en omgång är färdiga (minst en lyckades). */
  onDone?: (result: { ok: number; failed: number }) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const running = useRef(false);

  // Objekt-URL:er frigörs när raden försvinner eller komponenten monteras av.
  useEffect(() => {
    return () => {
      for (const item of queueRef.current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  // Kön ändras synkront i ref:en och speglas till state: uppladdningsloopen
  // läser ref:en mellan sina await och får aldrig ett halvgammalt läge.
  function commit(next: QueueItem[]) {
    queueRef.current = next;
    setQueue(next);
  }

  function patch(id: string, changes: Partial<QueueItem>) {
    commit(queueRef.current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  function remove(id: string) {
    const gone = queueRef.current.find((item) => item.id === id);
    if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
    commit(queueRef.current.filter((item) => item.id !== id));
  }

  function clearFinished() {
    const isOpen = (item: QueueItem) => item.status === "laser" || item.status === "vantar";
    for (const item of queueRef.current) if (!isOpen(item) && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    commit(queueRef.current.filter(isOpen));
  }

  function onFiles(files: File[]) {
    setZoneError(null);
    const accepted: QueueItem[] = [];
    for (const file of files) {
      const id = `up-${++queueSeq}`;
      if (file.size > RECEIPT_MAX_BYTES) {
        accepted.push({ id, file, previewUrl: previewFor(file), status: "fel", note: `För stor (${sizeLabel(file.size)}) – max ${UPLOAD_MAX_LABEL}.` });
        continue;
      }
      accepted.push({ id, file, previewUrl: previewFor(file), status: "vantar" });
    }
    if (accepted.length === 0) return;
    commit([...queueRef.current, ...accepted]);
    startTransition(() => drain());
  }

  async function drain() {
    if (running.current) return;
    running.current = true;
    let ok = 0;
    let failed = 0;
    try {
      for (;;) {
        const next = queueRef.current.find((item) => item.status === "vantar");
        if (!next) break;
        patch(next.id, { status: "laser" });
        try {
          const result = await upload(next.file);
          if (result.ok) {
            ok += 1;
            patch(next.id, { status: "klar", note: result.note });
          } else {
            failed += 1;
            patch(next.id, { status: "fel", note: result.error });
          }
        } catch (err) {
          failed += 1;
          patch(next.id, { status: "fel", note: err instanceof Error ? err.message : "Kunde inte spara kvittot." });
        }
      }
    } finally {
      running.current = false;
    }
    if (ok > 0) {
      if (refreshAfter) router.refresh();
      onDone?.({ ok, failed });
    }
  }

  const total = queue.length;
  const finished = queue.filter((item) => item.status === "klar" || item.status === "fel").length;
  const active = queue.some((item) => item.status === "laser" || item.status === "vantar");
  const compact = variant === "compact";

  // Kompakt läge (åtgärdsrad): ett kvitto i taget – raden ersätts av kvittot.
  if (compact) {
    const last = queue[queue.length - 1];
    if (last && (last.status === "klar" || last.status === "laser")) {
      return (
        <span className={cx("flex items-center gap-1.5 text-sm font-medium", last.status === "klar" ? "text-ok" : "text-soft")}>
          {last.status === "klar" ? <Check className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
          {last.status === "klar" ? last.note : "Läser av …"}
        </span>
      );
    }
    return (
      <FileDropzone
        variant="compact"
        accept="image/*,.pdf,.heic,.heif"
        multiple={false}
        busy={pending || active}
        error={last?.status === "fel" ? last.note ?? null : zoneError}
        maxBytes={RECEIPT_MAX_BYTES}
        title={title}
        formats={formats}
        camera={camera}
        className={cx("min-w-[12rem] sm:w-64", className)}
        onFiles={onFiles}
      />
    );
  }

  return (
    <div className={className} data-receipt-upload>
      <FileDropzone
        variant={variant}
        accept="image/*,.pdf,.heic,.heif"
        multiple={multiple}
        busy={false}
        error={zoneError}
        maxBytes={RECEIPT_MAX_BYTES}
        title={active ? `Läser av ${finished + 1} av ${total} …` : title}
        subtitle={subtitle}
        formats={formats}
        camera={camera}
        pasteAnywhere={pasteAnywhere}
        onFiles={onFiles}
      />

      {total > 0 ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-card" aria-live="polite">
          {active ? (
            <div className="h-1 w-full bg-ink/6">
              <div
                className="h-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.max(6, Math.round((finished / total) * 100))}%` }}
              />
            </div>
          ) : null}
          <ul className="divide-y divide-line">
            {queue.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5" data-receipt-upload-row data-status={item.status}>
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink/5">
                  {item.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- lokal object-URL, ingen optimering möjlig
                    <img src={item.previewUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <FileText className="size-4.5 text-muted" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{item.file.name || "kvitto"}</span>
                  <span
                    className={cx(
                      "block truncate text-[12.5px]",
                      item.status === "fel" ? "text-danger" : item.status === "klar" ? "text-ok" : "text-muted"
                    )}
                  >
                    {item.status === "vantar"
                      ? `Väntar · ${sizeLabel(item.file.size)}`
                      : item.status === "laser"
                        ? "Läser av …"
                        : item.note}
                  </span>
                </span>
                <span className="flex size-6 shrink-0 items-center justify-center">
                  {item.status === "laser" ? (
                    <Loader2 className="size-4 animate-spin text-accent" />
                  ) : item.status === "klar" ? (
                    <Check className="size-4 text-ok" />
                  ) : item.status === "fel" ? (
                    <AlertCircle className="size-4 text-danger" />
                  ) : null}
                </span>
                {item.status !== "laser" ? (
                  <button
                    type="button"
                    aria-label="Ta bort ur listan"
                    onClick={() => remove(item.id)}
                    className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-ink/5 hover:text-ink"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : (
                  <span className="size-8 shrink-0" />
                )}
              </li>
            ))}
          </ul>
          {!active && finished > 0 ? (
            <div className="flex items-center justify-between border-t border-line bg-canvas/60 px-4 py-2 text-[12.5px] text-muted">
              <span>
                {finished === 1 ? "1 fil klar" : `${finished} filer klara`}
                {queue.some((i) => i.status === "fel") ? " · något gick fel, se raden" : ""}
              </span>
              <button type="button" onClick={clearFinished} className="font-medium text-soft hover:text-ink">
                Rensa
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

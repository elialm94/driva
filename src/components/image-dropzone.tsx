"use client";

import { useId, useRef, useState, type DragEvent, type KeyboardEvent, type ClipboardEvent, type ReactNode } from "react";
import { ImagePlus } from "lucide-react";
import { buttonClasses, cx } from "./ui";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_EDGE = 960;
const DEFAULT_JPEG_QUALITY = 0.78;
const DEFAULT_MAX_CHARS = 750_000;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp"]);

export type ImageCompressOptions = {
  maxBytes?: number;
  maxEdge?: number;
  quality?: number;
  maxChars?: number;
};

export type ImageDropzoneProps = {
  label?: string;
  /** Below the zone (banner/thumb). In the compact variant it renders inside the zone's empty state. */
  hint?: string;
  value?: string;
  loading?: boolean;
  /** Persisting right now (e.g. autosave) – the compact zone shows "Laddar upp …". */
  saving?: boolean;
  error?: string | null;
  disabled?: boolean;
  /**
   * banner: tall drop area + button row (modals). thumb: short row preview once an image exists.
   * compact: one low full-width clickable zone next to the preview – no separate pick button.
   */
  variant?: "banner" | "thumb" | "compact";
  /** Compact only: custom preview to the left of the zone (e.g. CompanyLogo initials/image). */
  previewSlot?: ReactNode;
  /** Compact only: zone copy when no image exists yet (desktop). */
  emptyLabel?: string;
  /** Gallery-style: accept several files. Single-image fields ignore extras. */
  multiple?: boolean;
  addLabel?: string;
  replaceLabel?: string;
  removeLabel?: string;
  compress?: ImageCompressOptions;
  onChange: (next: string | undefined) => void;
  /** Called after a multi-file drop/pick with every compressed data-URL. */
  onFiles?: (urls: string[]) => void;
  onError?: (msg: string | null) => void;
  onBusy?: (busy: boolean) => void;
};

/** Map Next/React production dumps (#441 m.fl.) to a short Swedish sentence. */
export function humanizeMediaError(err: unknown, fallback = "Kunde inte läsa bilden."): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!raw) return fallback;
  if (/minified react error #441/i.test(raw) || /server components render/i.test(raw)) {
    return "Kunde inte spara bilden. Prova en mindre fil.";
  }
  if (/filformatet stöds inte|not supported|unsupported/i.test(raw)) return "Filformatet stöds inte.";
  if (/för stor|too large|body.*limit|entity too large/i.test(raw)) return "Bilden är för stor.";
  if (/minified react error/i.test(raw)) return fallback;
  return raw;
}

function isAllowedImage(file: File): boolean {
  if (ALLOWED_TYPES.has(file.type)) return true;
  if (file.type && file.type.startsWith("image/") && file.type !== "image/svg+xml" && file.type !== "image/gif") {
    return true;
  }
  return /\.(jpe?g|png|webp)$/i.test(file.name);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Kunde inte läsa filen."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Filformatet stöds inte."));
    img.src = src;
  });
}

export async function fileToCompressedImage(file: File, options?: ImageCompressOptions): Promise<string> {
  const maxBytes = options?.maxBytes ?? MAX_UPLOAD_BYTES;
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = options?.quality ?? DEFAULT_JPEG_QUALITY;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;

  if (!isAllowedImage(file)) throw new Error("Filformatet stöds inte.");
  if (file.size > maxBytes) throw new Error("Bilden är för stor.");

  const original = await readFileAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunde inte behandla bilden.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  if (dataUrl.length > maxChars) throw new Error("Bilden är för stor.");
  return dataUrl;
}

function filesFromDrag(e: DragEvent): File[] {
  return Array.from(e.dataTransfer?.files ?? []).filter(isAllowedImage);
}

function filesFromClipboard(e: ClipboardEvent): File[] {
  const items = Array.from(e.clipboardData?.items ?? []);
  const files: File[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isAllowedImage(file)) files.push(file);
  }
  return files;
}

export function ImageDropzone({
  label,
  hint,
  value,
  loading,
  saving,
  error,
  disabled,
  variant = "banner",
  previewSlot,
  emptyLabel = "Klicka eller släpp en bild här",
  multiple = false,
  addLabel = "Välj bild",
  replaceLabel = "Byt bild",
  removeLabel = "Ta bort",
  compress,
  onChange,
  onFiles,
  onError,
  onBusy,
}: ImageDropzoneProps) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const busy = reading || loading || disabled || saving;

  function setBusy(next: boolean) {
    setReading(next);
    onBusy?.(next);
  }

  async function processFiles(files: File[]) {
    const picked = (multiple ? files : files.slice(0, 1)).filter(isAllowedImage);
    if (picked.length === 0) {
      onError?.("Filformatet stöds inte.");
      return;
    }
    onError?.(null);
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const file of picked) {
        urls.push(await fileToCompressedImage(file, compress));
      }
      if (multiple && onFiles) onFiles(urls);
      else onChange(urls[0]);
    } catch (err: unknown) {
      onError?.(humanizeMediaError(err));
    } finally {
      setBusy(false);
    }
  }

  function openPicker() {
    if (busy) return;
    fileRef.current?.click();
  }

  function onDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    dragDepth.current += 1;
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) return;
    void processFiles(filesFromDrag(e));
  }

  function onPaste(e: ClipboardEvent) {
    if (busy) return;
    const files = filesFromClipboard(e);
    if (files.length === 0) return;
    e.preventDefault();
    void processFiles(files);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  }

  const hasImage = Boolean(value);
  const dropLabel = dragging
    ? hasImage
      ? "Släpp för att byta bild"
      : "Släpp bilden här"
    : null;

  const fileInput = (
    <input
      ref={fileRef}
      id={inputId}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/*"
      multiple={multiple}
      className="sr-only"
      disabled={busy}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length) void processFiles(files);
      }}
    />
  );

  const actions = (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClasses("secondary", "sm")} disabled={busy} onClick={openPicker}>
        <ImagePlus className="size-3.5" />
        {reading ? "Läser in bild …" : hasImage || loading ? replaceLabel : addLabel}
      </button>
      {hasImage ? (
        <button
          type="button"
          className={buttonClasses("ghost", "sm")}
          disabled={busy}
          onClick={() => {
            onChange(undefined);
            onError?.(null);
          }}
        >
          {removeLabel}
        </button>
      ) : null}
    </div>
  );

  const surfaceClass = cx(
    "relative overflow-hidden rounded-xl border border-dashed transition-colors",
    dragging ? "border-accent bg-accent-soft/50" : "border-line-strong bg-canvas/50",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
    busy ? "pointer-events-none opacity-70" : "cursor-pointer",
  );

  const emptyCopy = (
    <div className="flex flex-col items-center justify-center gap-0.5 px-3 text-center">
      <ImagePlus className={cx("text-muted", variant === "banner" ? "size-5" : "size-4")} />
      {/* Mobil har ingen dra-och-släpp – där är ytan en tryckyta för att välja bild. */}
      <p className="text-[13px] font-medium text-soft">
        {dropLabel ?? (
          <>
            <span className="sm:hidden">Tryck för att välja bild</span>
            <span className="hidden sm:inline">Släpp en bild här</span>
          </>
        )}
      </p>
      {dropLabel ? null : <p className="text-[12px] text-muted">JPG, PNG eller WebP</p>}
    </div>
  );

  const preview =
    value && !dragging ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={value} alt="" className="size-full object-cover" />
    ) : loading && !dragging ? (
      <div className="size-full animate-pulse bg-ink/10" aria-hidden />
    ) : (
      emptyCopy
    );

  // Compact: hela zonen är klickbar/släppbar – ingen separat "Välj bild"-knapp.
  const compactMain =
    reading || saving ? (
      "Laddar upp …"
    ) : dropLabel ? (
      dropLabel
    ) : hasImage || loading ? (
      replaceLabel
    ) : (
      <>
        {/* Mobil har ingen dra-och-släpp – där är zonen en tryckyta för att välja bild. */}
        <span className="sm:hidden">Tryck för att välja bild</span>
        <span className="hidden sm:inline">{emptyLabel}</span>
      </>
    );
  const compactSub =
    reading || saving || dropLabel ? null : hasImage || loading ? "JPG, PNG eller WebP" : (hint ?? "JPG, PNG eller WebP");

  const compactPreview =
    previewSlot ??
    (hasImage || loading ? (
      <div className="h-16 w-24 shrink-0 overflow-hidden rounded-xl border border-line">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="size-full object-cover" />
        ) : (
          <div className="size-full animate-pulse bg-ink/10" aria-hidden />
        )}
      </div>
    ) : null);

  return (
    <div>
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-medium text-soft">
          {label}
        </label>
      ) : null}
      {fileInput}

      {variant === "compact" ? (
        <>
          <div className="flex items-center gap-3">
            {compactPreview}
            <div
              role="button"
              tabIndex={busy ? -1 : 0}
              aria-label={hasImage ? replaceLabel : addLabel}
              aria-disabled={busy || undefined}
              className={cx(surfaceClass, "flex min-h-16 min-w-0 flex-1 items-center justify-center px-3 py-2")}
              onClick={openPicker}
              onKeyDown={onKeyDown}
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onPaste={onPaste}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <ImagePlus className="size-4 shrink-0 text-muted" />
                <div className="min-w-0 text-left">
                  <p className="truncate text-[13px] font-medium text-soft">{compactMain}</p>
                  {compactSub ? <p className="truncate text-[12px] text-muted">{compactSub}</p> : null}
                </div>
              </div>
            </div>
          </div>
          {hasImage ? (
            <div className="mt-1">
              <button
                type="button"
                className={buttonClasses("ghost", "sm", "max-lg:h-11")}
                disabled={busy}
                onClick={() => {
                  onChange(undefined);
                  onError?.(null);
                }}
              >
                {removeLabel}
              </button>
            </div>
          ) : null}
        </>
      ) : variant === "thumb" && (hasImage || loading) ? (
        <div
          className={cx("flex items-center gap-3 rounded-xl", dragging && "ring-2 ring-accent/30")}
          tabIndex={busy ? -1 : 0}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onPaste={onPaste}
        >
          <button
            type="button"
            className={cx(
              "relative h-20 w-28 shrink-0 overflow-hidden rounded-xl border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              dragging ? "border-accent" : "border-line",
            )}
            disabled={busy}
            onClick={openPicker}
            aria-label={replaceLabel}
          >
            {value ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value} alt="" className="size-full object-cover" />
            ) : (
              <div className="size-full animate-pulse bg-ink/10" aria-hidden />
            )}
            {dragging ? (
              <span className="absolute inset-0 flex items-center justify-center bg-canvas/80 px-1 text-center text-[11px] font-medium text-soft">
                Släpp för att byta bild
              </span>
            ) : null}
          </button>
          {actions}
        </div>
      ) : (
        <>
          <div
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-label={hasImage ? replaceLabel : "Välj bild"}
            aria-disabled={busy || undefined}
            className={cx(surfaceClass, "flex h-28 w-full items-center justify-center")}
            onClick={openPicker}
            onKeyDown={onKeyDown}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onPaste={onPaste}
          >
            {preview}
            {dragging && (hasImage || loading) ? (
              <div className="absolute inset-0 flex items-center justify-center bg-canvas/80">
                {emptyCopy}
              </div>
            ) : null}
          </div>
          <div className="mt-2">{actions}</div>
        </>
      )}

      {/* I compact-varianten visas hinten inne i zonen i stället. */}
      {hint && !error && variant !== "compact" ? <p className="mt-1.5 text-[12px] text-muted">{hint}</p> : null}
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { FileUp, X, type LucideIcon } from "lucide-react";
import { cx } from "./ui";

export type FileDropzoneVariant = "landing" | "inline" | "compact";

export type FileDropzoneProps = {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  busy?: boolean;
  error?: string | null;
  variant?: FileDropzoneVariant;
  icon?: LucideIcon;
  title?: string;
  subtitle?: string;
  formats?: string;
  /** Visas när en fil redan är vald (inline/compact). */
  fileName?: string | null;
  onClear?: () => void;
  onFiles: (files: File[]) => void;
  /** Native form-fält, t.ex. supportbilaga. */
  name?: string;
  inputId?: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  children?: ReactNode;
  /** Sätter `data-import-dropzone` när värdet är `import`. */
  dropzoneAttr?: "import";
  /** Sätter `data-import-file-input` eller `data-price-file-input`. */
  fileInputAttr?: "import" | "price";
  maxBytes?: number;
  autoFocus?: boolean;
};

function filesFromList(list: FileList | File[] | null | undefined): File[] {
  return list ? Array.from(list) : [];
}

function assignInputFiles(input: HTMLInputElement, files: File[]) {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
}

function setRef(ref: Ref<HTMLInputElement> | undefined, el: HTMLInputElement | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(el);
  else (ref as { current: HTMLInputElement | null }).current = el;
}

export function FileDropzone({
  accept,
  multiple = false,
  disabled,
  busy,
  error,
  variant = "inline",
  icon: Icon = FileUp,
  title,
  subtitle,
  formats,
  fileName,
  onClear,
  onFiles,
  name,
  inputId,
  inputRef,
  className,
  children,
  dropzoneAttr,
  fileInputAttr,
  maxBytes,
  autoFocus,
}: FileDropzoneProps) {
  const autoId = useId();
  const id = inputId ?? autoId;
  const fileRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const locked = Boolean(disabled || busy);

  useEffect(() => {
    if (autoFocus) zoneRef.current?.focus();
  }, [autoFocus]);

  const defaultTitle =
    variant === "landing"
      ? "Släpp filer här eller klicka"
      : variant === "compact"
        ? "Släpp eller klicka"
        : "Släpp en fil här eller klicka";

  function deliver(files: File[]) {
    const picked = multiple ? files : files.slice(0, 1);
    if (picked.length === 0) return;
    if (maxBytes && picked.some((file) => file.size > maxBytes)) {
      if (fileRef.current) fileRef.current.value = "";
      onFiles(picked);
      return;
    }
    // Bara namngivna fält (t.ex. supportbilaga) behöver filen på inputen vid submit.
    if (name && fileRef.current) assignInputFiles(fileRef.current, picked);
    onFiles(picked);
  }

  function openPicker() {
    if (locked) return;
    fileRef.current?.click();
  }

  function onDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (locked) return;
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
    if (locked) return;
    deliver(filesFromList(e.dataTransfer?.files));
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  }

  function clearFile(e: { stopPropagation(): void }) {
    e.stopPropagation();
    onClear?.();
    if (fileRef.current) fileRef.current.value = "";
  }

  const heading = dragging ? (multiple ? "Släpp filerna här" : "Släpp filen här") : busy ? "Läser in …" : (title ?? defaultTitle);
  const hasFile = Boolean(fileName);

  const surface = cx(
    "relative w-full rounded-2xl border border-dashed text-left transition-colors",
    dragging ? "border-accent bg-accent-soft/50" : error ? "border-danger/50 bg-danger-soft/20" : "border-line-strong bg-card",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
    locked ? "pointer-events-none opacity-70" : "cursor-pointer hover:border-accent/70 hover:bg-accent-soft/25",
    className,
  );

  const fileInput = (
    <input
      ref={(el) => {
        fileRef.current = el;
        setRef(inputRef, el);
      }}
      id={id}
      type="file"
      name={name}
      accept={accept}
      multiple={multiple}
      disabled={locked}
      className="sr-only"
      data-import-file-input={fileInputAttr === "import" ? "" : undefined}
      data-price-file-input={fileInputAttr === "price" ? "" : undefined}
      onChange={(e) => {
        const files = filesFromList(e.target.files);
        if (files.length) deliver(files);
        if (!name) e.target.value = "";
      }}
    />
  );

  const zoneProps = {
    ref: zoneRef,
    role: children ? undefined : ("button" as const),
    tabIndex: locked ? -1 : 0,
    "aria-label": title ?? defaultTitle,
    "aria-disabled": locked || undefined,
    "aria-busy": busy || undefined,
    "data-dropzone": dropzoneAttr,
    "data-import-dropzone": dropzoneAttr === "import" ? "" : undefined,
    onClick: openPicker,
    onKeyDown,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };

  if (variant === "compact") {
    return (
      <div>
        {fileInput}
        <div {...zoneProps} className={cx(surface, "flex min-h-11 items-center gap-2.5 px-3 py-2")}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-deep">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">
              {hasFile && !dragging ? fileName : heading}
            </span>
            {formats && !hasFile && !dragging && !busy ? (
              <span className="block truncate text-[12px] text-muted">{formats}</span>
            ) : null}
          </span>
          {hasFile && onClear && !dragging ? (
            <button type="button" aria-label="Ta bort fil" className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink" onClick={clearFile}>
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-1.5 text-[13px] text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <div>
      {fileInput}
      <div
        {...zoneProps}
        className={cx(surface, variant === "landing" ? "px-6 py-8 text-center sm:px-10 sm:py-10" : "px-5 py-6 text-center")}
      >
        <div
          className={cx(
            "mx-auto flex items-center justify-center rounded-2xl bg-accent-soft text-accent-deep",
            variant === "landing" ? "size-12" : "size-10",
          )}
        >
          <Icon className={variant === "landing" ? "size-5" : "size-4"} />
        </div>
        <p className={cx("font-semibold text-ink", variant === "landing" ? "mt-4 text-[17px]" : "mt-3 text-[15px]")}>
          {heading}
        </p>
        {subtitle && !dragging ? <p className="mt-1 text-[14px] text-soft">{subtitle}</p> : null}
        {formats && !dragging && !busy ? <p className="mt-1 text-[12.5px] text-muted">{formats}</p> : null}
        {hasFile && !dragging ? (
          <p className="mt-3 truncate text-[13px] font-medium text-ink">
            {fileName}
            {onClear ? (
              <button type="button" className="ml-2 text-muted underline hover:text-ink" onClick={clearFile}>
                Ta bort
              </button>
            ) : null}
          </p>
        ) : null}
        {children ? (
          <div className="mt-4" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {children}
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}

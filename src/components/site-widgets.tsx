"use client";

import { useEffect, useRef, useState, useTransition, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Globe,
  GripVertical,
  ImagePlus,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { buttonClasses, cx } from "./ui";
import { Modal } from "./modal";
import { humanizeMediaError, ImageDropzone } from "./image-dropzone";
import {
  addServiceItemAction,
  addWebsiteSectionAction,
  generateWebsiteAction,
  getSectionImagesAction,
  publishWebsiteAction,
  removeServiceItemAction,
  removeTestimonialItemAction,
  removeWebsiteSectionAction,
  reorderSectionsAction,
  reorderServiceItemsAction,
  rewriteSectionAction,
  setSectionVisibleAction,
  submitContactFormAction,
  updateSectionAction,
  updateServiceItemAction,
} from "@/app/actions";
import type {
  WebsiteCtaDestination,
  WebsiteImagePosition,
  WebsiteSection,
  WebsiteSectionItem,
} from "@/lib/types";
import { DEFAULT_PRIMARY_CTA_LABEL, PRIMARY_CTA_LABEL_MAX } from "@/lib/types";
import {
  CONTACT_FORM_PRIVACY_LINK_LABEL,
  contactFormPrivacyLead,
  privacyPolicyHref,
} from "@/lib/website-privacy";
import { FieldError, focusField, invalidFieldCls, useNativeFieldErrors } from "./form-validation";
import { canDeleteSection, defaultCtaLabel, isTextSectionType, type AddableSectionType } from "@/lib/website-sections";
import type { SiteContact } from "@/lib/website-contact";
import {
  AddSectionPicker,
  ContactDetailsEditor,
  DeleteSectionDialog,
  TestimonialItemModal,
  TestimonialItemsEditor,
} from "./site-section-builder";

/**
 * Sektionsdata för redigeringslistan – utan tunga bild-data-URL:er.
 * Bilderna hämtas först när en sektion öppnas för redigering (getSectionImagesAction).
 */
export type SectionListItem = Omit<WebsiteSectionItem, "image"> & { hasImage: boolean };
export type SectionListSection = Omit<WebsiteSection, "image" | "items"> & {
  hasImage: boolean;
  items?: SectionListItem[];
};

/* ------------------------- Kontaktformulär på sajten ------------------------- */

/**
 * Formulärets utseendetokens – beräknas av renderaren utifrån temat.
 * Endast presentation: fält, inskick, validering och Driva-integrationen är
 * identiska i alla teman.
 */
export interface SiteFormTokens {
  /** Klasser för <input>/<textarea>. */
  field: string;
  /** Klasser för skicka-knappen (temats primärknapp i full bredd). */
  button: string;
  /** Klasser för kvittenskortet efter lyckat inskick. */
  confirm: string;
  /** Klasser för felmeddelandet (ljus röd på mörka band). */
  error: string;
  /** Diskret integritetsnotis ovanför skicka-knappen. */
  notice: string;
}

export function SiteContactForm({
  interactive,
  tokens,
  companyName,
  privacyHref = privacyPolicyHref(),
}: {
  interactive: boolean;
  tokens: SiteFormTokens;
  companyName: string;
  privacyHref?: string;
}) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "", website: "" });
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  );
  const { errors, formProps, fieldProps } = useNativeFieldErrors({
    name: "Ange ditt namn.",
    email: "Ange en giltig e-postadress.",
    message: "Berätta kort vad du behöver hjälp med.",
  });

  if (sent) {
    return (
      <div className={tokens.confirm}>
        <CheckCircle2 className="mx-auto size-8 text-(--site-accent)" />
        <p className="mt-2 text-[16px] font-semibold">Tack för ditt meddelande!</p>
        <p className="mt-1 text-[14px] opacity-70">Vi återkommer till dig så snart vi kan, oftast samma dag.</p>
      </div>
    );
  }

  return (
    <form
      className="relative space-y-3"
      method="post"
      action="#kontakt"
      {...formProps()}
      onSubmit={(e) => {
        e.preventDefault();
        if (!interactive || !form.name.trim() || !form.email.trim() || !form.message.trim()) return;
        setError(null);
        startTransition(async () => {
          const result = await submitContactFormAction({
            name: form.name.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
            message: form.message.trim(),
            website: form.website,
            idempotencyKey,
          });
          if (result.ok === false) {
            setError(result.error);
            return;
          }
          setSent(true);
        });
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
      >
        <label>
          Webbplats
          <input
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => setForm({ ...form, website: e.target.value })}
          />
        </label>
      </div>
      <div className="grid gap-3 @2xl:grid-cols-2">
        <input
          required
          name="name"
          placeholder="Namn"
          aria-label="Namn"
          autoComplete="name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={tokens.field}
          {...fieldProps("name", "sajtkontakt-namn-fel")}
        />
        <input
          required
          type="email"
          name="email"
          placeholder="E-post"
          aria-label="E-post"
          autoComplete="email"
          autoCapitalize="none"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className={tokens.field}
          {...fieldProps("email", "sajtkontakt-epost-fel")}
        />
      </div>
      <input
        name="phone"
        type="tel"
        placeholder="Telefon (valfritt)"
        aria-label="Telefon (valfritt)"
        autoComplete="tel"
        value={form.phone}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
        className={tokens.field}
      />
      <textarea
        required
        name="message"
        rows={4}
        placeholder="Berätta kort om vad du behöver hjälp med …"
        aria-label="Beskriv vad du behöver hjälp med"
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
        className={tokens.field}
        {...fieldProps("message", "sajtkontakt-meddelande-fel")}
      />
      <FieldError id="sajtkontakt-namn-fel">{errors.name}</FieldError>
      <FieldError id="sajtkontakt-epost-fel">{errors.email}</FieldError>
      <FieldError id="sajtkontakt-meddelande-fel">{errors.message}</FieldError>
      {error ? <p className={tokens.error}>{error}</p> : null}
      <p className={tokens.notice} data-privacy-notice>
        {contactFormPrivacyLead(companyName)} Läs{" "}
        <a href={privacyHref} className="underline decoration-from-font underline-offset-2 hover:opacity-80">
          {CONTACT_FORM_PRIVACY_LINK_LABEL}
        </a>
        .
      </p>
      <button type="submit" disabled={pending} className={tokens.button}>
        {pending ? "Skickar …" : "Skicka meddelande"}
      </button>
    </form>
  );
}

/* ------------------------------ AI-generatorn ------------------------------ */

const EXAMPLES = [
  "Skapa en hemsida för Almqvist Snickeri i Stockholm. Vi bygger kök, garderober och platsbyggda möbler.",
  "Hemsida för Ljusdal El & Installation i Uppsala – elinstallationer, laddboxar och felsökning.",
  "Skapa en sida för mitt fotoföretag Nord Studio i Göteborg. Bröllop, porträtt och företagsfoto.",
];

export function GenerateWebsiteForm() {
  const [description, setDescription] = useState("");
  const [missingHint, setMissingHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function generate() {
    const text = description.trim();
    if (!text) {
      setMissingHint(true);
      focusField("hemsida-ai-beskrivning");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await generateWebsiteAction(text);
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <textarea
        id="hemsida-ai-beskrivning"
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
          if (e.target.value.trim()) setMissingHint(false);
        }}
        rows={3}
        placeholder={`T.ex. "${EXAMPLES[0]}"`}
        aria-invalid={missingHint || undefined}
        aria-describedby={missingHint ? "hemsida-ai-beskrivning-fel" : undefined}
        className={cx(
          "w-full rounded-2xl border border-line-strong bg-card px-4 py-3.5 text-[15px] leading-relaxed placeholder:text-muted focus:border-accent",
          missingHint && invalidFieldCls
        )}
      />
      <FieldError id="hemsida-ai-beskrivning-fel">
        {missingHint ? "Beskriv först ditt företag – vad ni gör och var. Eller utgå från ett exempel nedan." : null}
      </FieldError>
      {error ? (
        <p className="mt-2 text-[13px] leading-relaxed text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setDescription(ex);
                setMissingHint(false);
              }}
              className="max-w-60 truncate rounded-full border border-line bg-card px-3 py-1.5 text-[12px] text-soft transition-colors hover:border-accent hover:text-ink"
            >
              {ex.slice(0, 52)}…
            </button>
          ))}
        </div>
        <button className={buttonClasses("primary", "lg")} disabled={pending} onClick={generate}>
          <WandSparkles className={cx("size-4.5", pending && "animate-pulse")} />
          {pending ? "Bygger din hemsida …" : "Skapa hemsida med AI"}
        </button>
      </div>
    </div>
  );
}

/* -------------------- Gemensam list-DnD (sektioner + tjänster) -------------------- */

function spliceReorderIndex(from: number, insertAt: number): number {
  return insertAt > from ? insertAt - 1 : insertAt;
}

function insertIndexFromClientY(list: HTMLElement, clientY: number, rowSelector: string): number {
  const rows = list.querySelectorAll<HTMLElement>(rowSelector);
  let insert = 0;
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (clientY > rect.top + rect.height / 2) insert += 1;
  }
  return insert;
}

function mountPointerDragGhost(source: HTMLElement, rowAttr: string): HTMLElement {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.removeAttribute(rowAttr);
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("data-pointer-drag-ghost", "");
  ghost.querySelectorAll("button").forEach((button) => button.setAttribute("tabindex", "-1"));
  ghost.style.cssText = [
    "position:fixed",
    `left:${rect.left}px`,
    `top:${rect.top}px`,
    `width:${rect.width}px`,
    "z-index:80",
    "margin:0",
    "pointer-events:none",
    "box-sizing:border-box",
    "background:var(--color-card)",
    "border:1px solid var(--color-line)",
    "border-radius:0.75rem",
    "box-shadow:var(--shadow-pop)",
    "opacity:0.97",
    "transform:rotate(1.25deg) scale(1.03)",
    "transform-origin:left center",
    "will-change:left,top",
  ].join(";");
  document.body.appendChild(ghost);
  return ghost;
}

function ListDropGap() {
  return (
    <div className="px-2 py-0.5" aria-hidden>
      <div className="h-1 rounded-full bg-accent/70" />
    </div>
  );
}

function usePointerListReorder({
  rowAttr,
  disabled,
  onReorder,
}: {
  rowAttr: string;
  disabled?: boolean;
  onReorder: (from: number, to: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const insertIndexRef = useRef<number | null>(null);
  const pointerOffsetRef = useRef({ x: 0, y: 0 });
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const rowSelector = `[${rowAttr}]`;

  function clearGhost() {
    ghostRef.current?.remove();
    ghostRef.current = null;
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
  }

  function finishDrag(cancelled = false) {
    const from = dragIndexRef.current;
    const insertAt = insertIndexRef.current;
    clearGhost();
    dragIndexRef.current = null;
    insertIndexRef.current = null;
    setDragIndex(null);
    setInsertIndex(null);
    if (cancelled || from === null || insertAt === null) return;
    const to = spliceReorderIndex(from, insertAt);
    if (from !== to) onReorderRef.current(from, to);
  }

  useEffect(
    () => () => {
      ghostRef.current?.remove();
      ghostRef.current = null;
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    },
    [],
  );

  function handlePointerDown(e: PointerEvent<HTMLDivElement>, index: number) {
    if (disabledRef.current || e.button !== 0) return;
    const row = e.currentTarget.closest(rowSelector);
    if (!(row instanceof HTMLElement)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = row.getBoundingClientRect();
    pointerOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    ghostRef.current = mountPointerDragGhost(row, rowAttr);
    dragIndexRef.current = index;
    insertIndexRef.current = index;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    setDragIndex(index);
    setInsertIndex(index);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragIndexRef.current === null || !ghostRef.current) return;
    const { x, y } = pointerOffsetRef.current;
    ghostRef.current.style.left = `${e.clientX - x}px`;
    ghostRef.current.style.top = `${e.clientY - y}px`;
    const list = listRef.current;
    if (!list) return;
    const nextInsert = insertIndexFromClientY(list, e.clientY, rowSelector);
    if (nextInsert === insertIndexRef.current) return;
    insertIndexRef.current = nextInsert;
    setInsertIndex(nextInsert);
  }

  function isDropGap(at: number) {
    return dragIndex !== null && insertIndex === at && insertIndex !== dragIndex && insertIndex !== dragIndex + 1;
  }

  return { listRef, dragIndex, isDropGap, handlePointerDown, handlePointerMove, finishDrag };
}

function VisibilitySwitch({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? `Dölj ${label}` : `Visa ${label}`}
      title={on ? "Dölj från hemsidan" : "Visa på hemsidan"}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="inline-flex h-8 w-11 shrink-0 items-center justify-center rounded-lg p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={cx(
          "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
          on ? "bg-ok" : "bg-line-strong",
        )}
      >
        <span
          className={cx(
            "size-4 shrink-0 rounded-full bg-white shadow-sm transition-transform duration-200",
            on ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

/* ------------------------------ Sektionslista ------------------------------ */

function sectionIsVisible(section: SectionListSection): boolean {
  return section.visible !== false;
}

export function SectionList({
  sections,
  labels,
  primaryCtaLabel = DEFAULT_PRIMARY_CTA_LABEL,
  businessContact,
}: {
  sections: SectionListSection[];
  labels: Record<string, string>;
  primaryCtaLabel?: string;
  businessContact?: SiteContact;
}) {
  const [rows, setRows] = useState(sections);
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setRows(sections);
  }, [sections]);

  const reorder = usePointerListReorder({
    rowAttr: "data-section-row",
    disabled: pending,
    onReorder: (from, to) => {
      if (from === to) return;
      const next = [...rows];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setRows(next);
      startTransition(async () => {
        await reorderSectionsAction(next.map((s) => s.id));
        router.refresh();
      });
    },
  });

  function move(from: number, to: number) {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRows(next);
    startTransition(async () => {
      await reorderSectionsAction(next.map((s) => s.id));
      router.refresh();
    });
  }

  function setVisible(sectionId: string, visible: boolean) {
    setRows((prev) => prev.map((s) => (s.id === sectionId ? { ...s, visible } : s)));
    startTransition(async () => {
      await setSectionVisibleAction(sectionId, visible);
      router.refresh();
    });
  }

  function addType(type: AddableSectionType) {
    setAddError(null);
    startTransition(async () => {
      const result = await addWebsiteSectionAction(type);
      if (result.ok === false) {
        setAddError(result.error);
        return;
      }
      setPickerOpen(false);
      router.refresh();
    });
  }

  function remove(sectionId: string) {
    setRows((prev) => prev.filter((s) => s.id !== sectionId));
    startTransition(async () => {
      const result = await removeWebsiteSectionAction(sectionId);
      if (result.ok === false) {
        setRows(sections);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div ref={reorder.listRef}>
        {rows.map((section, index) => (
          <div key={section.id}>
            {reorder.isDropGap(index) ? <ListDropGap /> : null}
            <SectionRow
              section={section}
              typeLabel={labels[section.type] ?? section.type}
              last={index === rows.length - 1}
              dragging={reorder.dragIndex === index}
              pending={pending}
              primaryCtaLabel={primaryCtaLabel}
              businessContact={businessContact}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              canMoveUp={index > 0}
              canMoveDown={index < rows.length - 1}
              onToggle={(visible) => setVisible(section.id, visible)}
              onRemove={() => remove(section.id)}
              onPointerDown={(e) => reorder.handlePointerDown(e, index)}
              onPointerMove={reorder.handlePointerMove}
              onPointerUp={() => reorder.finishDrag()}
              onPointerCancel={() => reorder.finishDrag(true)}
            />
          </div>
        ))}
        {reorder.isDropGap(rows.length) ? <ListDropGap /> : null}
      </div>
      <div className="border-t border-line/70 px-3 py-3 sm:px-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setAddError(null);
            setPickerOpen(true);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong py-2.5 text-[13px] font-medium text-soft transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
        >
          <Plus className="size-4" />
          + Lägg till sektion
        </button>
        {addError ? <p className="mt-2 text-[13px] text-danger">{addError}</p> : null}
      </div>
      <AddSectionPicker
        open={pickerOpen}
        existingTypes={rows}
        pending={pending}
        onClose={() => setPickerOpen(false)}
        onPick={addType}
      />
    </div>
  );
}

function SectionRow({
  section,
  typeLabel,
  last,
  dragging,
  pending,
  primaryCtaLabel,
  businessContact,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onToggle,
  onRemove,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  section: SectionListSection;
  typeLabel: string;
  last: boolean;
  dragging: boolean;
  pending: boolean;
  primaryCtaLabel: string;
  businessContact?: SiteContact;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: (visible: boolean) => void;
  onRemove: () => void;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const visible = sectionIsVisible(section);
  const canHide = section.type !== "hero";
  const canDelete = canDeleteSection(section);

  return (
    <>
      <div data-section-row className={cx(!last && "border-b border-line/70", dragging && "opacity-40")}>
        <div className="flex min-w-0 items-center gap-1 px-3 py-3 sm:px-4">
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown(e);
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            className={cx(
              "hidden shrink-0 touch-none select-none rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink sm:block max-lg:p-2.5",
              dragging ? "cursor-grabbing" : "cursor-grab",
            )}
            aria-label="Dra för att ändra ordning"
            role="button"
            tabIndex={0}
          >
            <GripVertical className="size-4" />
          </div>
          <div className="flex shrink-0 sm:hidden">
            <button
              type="button"
              disabled={pending || !canMoveUp}
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp();
              }}
              className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30 max-lg:p-2.5"
              aria-label="Flytta upp"
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              disabled={pending || !canMoveDown}
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown();
              }}
              className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30 max-lg:p-2.5"
              aria-label="Flytta ner"
            >
              <ChevronDown className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cx("min-w-0 flex-1 overflow-hidden text-left", !visible && "opacity-55")}
          >
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted">{typeLabel}</p>
            <p className="truncate text-[14px] font-medium">{section.heading}</p>
          </button>
          {canHide ? (
            <VisibilitySwitch on={visible} onChange={onToggle} disabled={pending} label={typeLabel} />
          ) : null}
          {canDelete ? (
            <button
              type="button"
              disabled={pending}
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
              aria-label={`Ta bort ${typeLabel.toLowerCase()}`}
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label={`Redigera ${typeLabel.toLowerCase()}`}
          >
            <Pencil className="size-4" />
          </button>
        </div>
        {section.type === "kontakt" && !visible ? (
          <p className="px-3 pb-3 text-[12px] leading-relaxed text-warn sm:pl-11 sm:pr-4">
            Besökare kan inte skicka meddelanden när den här sektionen är dold.
          </p>
        ) : null}
      </div>
      {open ? (
        <SectionEditor
          sectionId={section.id}
          sectionType={section.type}
          typeLabel={typeLabel}
          heading={section.heading}
          body={section.body}
          hasImage={section.hasImage}
          imagePosition={section.imagePosition}
          hours={section.hours}
          cta={section.cta}
          primaryCtaLabel={section.type === "hero" ? primaryCtaLabel : undefined}
          items={section.type === "tjanster" || section.type === "omdomen" ? (section.items ?? []) : undefined}
          businessContact={businessContact}
          onClose={() => setOpen(false)}
        />
      ) : null}
      <DeleteSectionDialog
        open={confirmDelete}
        typeLabel={typeLabel}
        pending={pending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          onRemove();
        }}
      />
    </>
  );
}

/* ------------------------------ Sektionseditor ------------------------------ */

type ServiceDraft = { index: number | "new"; title: string; text: string; image?: string };

/** Listrad i redigeraren: bild-URL fylls i när bilddata hämtats. */
type EditorItem = WebsiteSectionItem & { hasImage?: boolean };

function SectionEditor({
  sectionId,
  sectionType,
  typeLabel,
  heading,
  body,
  hasImage,
  imagePosition,
  hours,
  cta: ctaConfig,
  primaryCtaLabel,
  items,
  businessContact,
  onClose,
}: {
  sectionId: string;
  sectionType?: WebsiteSection["type"];
  typeLabel: string;
  heading: string;
  body: string;
  onClose: () => void;
  hasImage?: boolean;
  imagePosition?: WebsiteImagePosition;
  hours?: string;
  cta?: WebsiteSection["cta"];
  primaryCtaLabel?: string;
  items?: SectionListItem[];
  businessContact?: SiteContact;
}) {
  const isServices = sectionType === "tjanster";
  const isTestimonials = sectionType === "omdomen";
  const isHero = sectionType === "hero" || typeLabel === "Startsektion";
  const isText = sectionType ? isTextSectionType(sectionType) : typeLabel === "Om oss" || typeLabel === "Text";
  const isCta = sectionType === "cta";
  const isContactDetails = sectionType === "kontaktuppgifter";
  const showSectionImage = isHero || isText;
  const [h, setH] = useState(heading);
  const [b, setB] = useState(body);
  const [cta, setCta] = useState(primaryCtaLabel ?? DEFAULT_PRIMARY_CTA_LABEL);
  const [ctaError, setCtaError] = useState<string | null>(null);
  const [imgPos, setImgPos] = useState<WebsiteImagePosition>(imagePosition ?? "right");
  const [hoursValue, setHoursValue] = useState(hours ?? "");
  const [ctaDest, setCtaDest] = useState<WebsiteCtaDestination>(ctaConfig?.destination ?? "kontakt");
  const [ctaBtn, setCtaBtn] = useState(ctaConfig?.label ?? defaultCtaLabel(ctaConfig?.destination ?? "kontakt"));
  const [quoteDraft, setQuoteDraft] = useState<{
    index: number | "new";
    title: string;
    text: string;
    rating?: number;
    location?: string;
  } | null>(null);
  const [image, setImage] = useState<string | undefined>(undefined);
  // Sparad bild på servern – jämförelsepunkt så att oförändrade bilder inte skickas om vid spara.
  const [baselineImage, setBaselineImage] = useState<string | undefined>(undefined);
  const [imageError, setImageError] = useState<string | null>(null);
  const [readingImage, setReadingImage] = useState(false);
  const [list, setList] = useState<EditorItem[]>(items ?? []);
  const [draft, setDraft] = useState<ServiceDraft | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [itemsPending, startItems] = useTransition();
  const [aiPending, startAi] = useTransition();
  const router = useRouter();

  // Bilddata skickas inte med sidan (tunga data-URL:er) utan hämtas när redigeraren öppnas.
  const needsImages = Boolean(hasImage) || (items?.some((it) => it.hasImage) ?? false);
  const [imagesLoaded, setImagesLoaded] = useState(!needsImages);

  useEffect(() => {
    if (!needsImages) return;
    let cancelled = false;
    getSectionImagesAction(sectionId)
      .then((res) => {
        if (cancelled) return;
        if (res) {
          // Skriv inte över en bild användaren redan hunnit välja.
          setImage((prev) => prev ?? res.image ?? undefined);
          setBaselineImage(res.image ?? undefined);
          setList((prev) => prev.map((it, i) => (it.image ? it : { ...it, image: res.itemImages[i] ?? undefined })));
        }
        setImagesLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setImagesLoaded(true); // Spara fungerar ändå; oförändrad bild lämnas orörd.
      });
    return () => {
      cancelled = true;
    };
    // Körs en gång när redigeraren öppnas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function closeAll() {
    setDraft(null);
    setListError(null);
    setImageError(null);
    setCtaError(null);
    onClose();
  }

  return (
    <>
      <Modal open onClose={closeAll} title={`Redigera ${typeLabel.toLowerCase()}`} size={isServices ? "lg" : "md"}>
        <div className="space-y-4 px-6 py-5">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[13px] font-medium text-soft">Rubrik</label>
              <button
                className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline disabled:opacity-50"
                disabled={aiPending}
                onClick={() =>
                  startAi(async () => {
                    await rewriteSectionAction(sectionId);
                    router.refresh();
                    closeAll();
                  })
                }
              >
                <Sparkles className={cx("size-3.5", aiPending && "animate-pulse")} />
                {aiPending ? "Skriver om …" : "Låt AI föreslå en ny"}
              </button>
            </div>
            <input
              value={h}
              onChange={(e) => setH(e.target.value)}
              className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-soft">Text</label>
            <textarea
              value={b}
              onChange={(e) => setB(e.target.value)}
              rows={isServices ? 3 : 4}
              className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-accent"
            />
          </div>

          {isHero ? (
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="hero-cta-label">
                Knapptext
              </label>
              <input
                id="hero-cta-label"
                value={cta}
                onChange={(e) => {
                  setCta(e.target.value);
                  if (ctaError) setCtaError(null);
                }}
                maxLength={PRIMARY_CTA_LABEL_MAX}
                placeholder={DEFAULT_PRIMARY_CTA_LABEL}
                aria-invalid={ctaError ? true : undefined}
                aria-describedby={ctaError ? "hero-cta-label-fel" : undefined}
                className={cx(
                  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent",
                  ctaError && invalidFieldCls
                )}
              />
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Samma knapp i sidhuvudet och på startsidan. Till exempel Kontakta oss, Få en offert eller Boka hembesök.
              </p>
              <FieldError id="hero-cta-label-fel" className="mt-1.5">
                {ctaError}
              </FieldError>
            </div>
          ) : null}

          {showSectionImage ? (
            <div className="space-y-3">
              <SectionImageField
                image={image}
                loading={Boolean(hasImage) && !imagesLoaded}
                onChange={setImage}
                error={imageError}
                onError={setImageError}
                onBusy={setReadingImage}
              />
              {isText && image ? (
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-soft">Bildens sida</p>
                  <div className="flex gap-2">
                    {([["left", "Vänster"], ["right", "Höger"]] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setImgPos(value)}
                        className={cx(
                          "rounded-xl border px-3 py-2 text-[13px] font-medium",
                          imgPos === value ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-soft hover:text-ink",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {isCta ? (
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-soft">Knappen leder till</p>
                <div className="grid gap-2">
                  {([["kontakt", "Kontaktformuläret"], ["phone", "Telefon"], ["email", "E-post"]] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setCtaDest(value);
                        if (!ctaBtn.trim() || ctaBtn === defaultCtaLabel(ctaDest)) setCtaBtn(defaultCtaLabel(value));
                      }}
                      className={cx(
                        "rounded-xl border px-3 py-2 text-left text-[13px] font-medium",
                        ctaDest === value ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-soft hover:text-ink",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-soft">Knapptext</label>
                <input
                  value={ctaBtn}
                  onChange={(e) => setCtaBtn(e.target.value)}
                  maxLength={PRIMARY_CTA_LABEL_MAX}
                  className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
                />
              </div>
            </div>
          ) : null}

          {isContactDetails ? (
            <ContactDetailsEditor hours={hoursValue} onHoursChange={setHoursValue} contact={businessContact} />
          ) : null}

          {isTestimonials ? (
            <TestimonialItemsEditor
              items={list}
              error={listError}
              busy={itemsPending}
              onEdit={(index) => {
                const item = list[index];
                setQuoteDraft({
                  index,
                  title: item.title,
                  text: item.text,
                  rating: item.rating,
                  location: item.location,
                });
              }}
              onAdd={() => setQuoteDraft({ index: "new", title: "", text: "", location: "" })}
              onRemove={(index) => {
                startItems(async () => {
                  const result = await removeTestimonialItemAction(sectionId, index);
                  if (result.error) {
                    setListError(result.error);
                    return;
                  }
                  setList((prev) => prev.filter((_, i) => i !== index));
                  setListError(null);
                  router.refresh();
                });
              }}
            />
          ) : null}

          {isServices ? (
            <ServiceItemsEditor
              items={list}
              error={listError}
              busy={itemsPending || !imagesLoaded}
              onEdit={(index) => {
                const item = list[index];
                setDraft({ index, title: item.title, text: item.text, image: item.image });
              }}
              onAdd={() => setDraft({ index: "new", title: "", text: "", image: undefined })}
              onRemove={(index) => {
                if (list.length <= 1) {
                  setListError("Minst en tjänst behövs");
                  return;
                }
                startItems(async () => {
                  const result = await removeServiceItemAction(sectionId, index);
                  if (result.error) {
                    setListError(result.error);
                    return;
                  }
                  setList((prev) => prev.filter((_, i) => i !== index));
                  setListError(null);
                  router.refresh();
                });
              }}
              onReorder={(from, to) => {
                if (from === to) return;
                setList((prev) => {
                  const next = [...prev];
                  const [moved] = next.splice(from, 1);
                  next.splice(to, 0, moved);
                  return next;
                });
                setListError(null);
                startItems(async () => {
                  await reorderServiceItemsAction(sectionId, from, to);
                  router.refresh();
                });
              }}
            />
          ) : null}

          <div className="flex justify-end gap-2">
            <button className={buttonClasses("ghost")} onClick={closeAll}>
              Avbryt
            </button>
            <button
              className={buttonClasses("primary")}
              disabled={pending || readingImage}
              onClick={() => {
                if (isHero) {
                  const label = cta.trim();
                  if (!label) {
                    setCtaError("Fyll i knapptexten – till exempel Kontakta oss.");
                    focusField("hero-cta-label");
                    return;
                  }
                  if (label.length > PRIMARY_CTA_LABEL_MAX) {
                    setCtaError("Knapptexten är för lång.");
                    focusField("hero-cta-label");
                    return;
                  }
                }
                startTransition(async () => {
                  try {
                    // Bilden skickas bara om den faktiskt ändrats (data-URL:er är tunga).
                    const result = await updateSectionAction(sectionId, {
                      heading: h,
                      body: b,
                      ...(isHero ? { primaryCtaLabel: cta.trim() } : {}),
                      ...(showSectionImage && image !== baselineImage ? { image: image ?? null } : {}),
                      ...(isText ? { imagePosition: imgPos } : {}),
                      ...(isContactDetails ? { hours: hoursValue } : {}),
                      ...(isCta ? { ctaDestination: ctaDest, ctaLabel: ctaBtn } : {}),
                    });
                    if (result && result.ok === false) {
                      const msg = result.error;
                      if (isHero && /fältet|för lång|knapptext/i.test(msg)) {
                        setCtaError(msg);
                        return;
                      }
                      setImageError(humanizeMediaError(msg, "Kunde inte spara."));
                      return;
                    }
                    closeAll();
                    router.refresh();
                  } catch (err) {
                    setImageError(humanizeMediaError(err, "Kunde inte spara."));
                  }
                });
              }}
            >
              {pending ? "Sparar …" : "Spara ändringar"}
            </button>
          </div>
        </div>
      </Modal>

      {isServices ? (
        <ServiceItemModal
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={(saved: { index: number | "new"; item: WebsiteSectionItem; imageChanged: boolean }) => {
            setList((prev) =>
              saved.index === "new"
                ? [...prev, saved.item]
                : prev.map((it, i) =>
                    i !== saved.index
                      ? it
                      : saved.imageChanged
                        ? saved.item
                        : { ...saved.item, image: it.image, hasImage: it.hasImage },
                  ),
            );
            setDraft(null);
            setListError(null);
            router.refresh();
          }}
          sectionId={sectionId}
        />
      ) : null}

      {isTestimonials ? (
        <TestimonialItemModal
          draft={quoteDraft}
          sectionId={sectionId}
          onClose={() => setQuoteDraft(null)}
          onSaved={(saved: { index: number | "new"; item: WebsiteSectionItem }) => {
            setList((prev) =>
              saved.index === "new"
                ? [...prev, saved.item]
                : prev.map((it, i) => (i === saved.index ? saved.item : it)),
            );
            setQuoteDraft(null);
            setListError(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function ServiceItemsEditor({
  items,
  error,
  busy,
  onEdit,
  onAdd,
  onRemove,
  onReorder,
}: {
  items: EditorItem[];
  error: string | null;
  busy: boolean;
  onEdit: (index: number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const reorder = usePointerListReorder({
    rowAttr: "data-service-row",
    disabled: busy,
    onReorder,
  });

  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-soft">Tjänster</label>
      <div ref={reorder.listRef} className="space-y-1.5">
        {items.map((item, index) => (
          <div key={`${item.title}-${index}`}>
            {reorder.isDropGap(index) ? <ListDropGap /> : null}
            <div
              data-service-row
              className={cx(
                "flex items-center gap-2 rounded-xl border border-line bg-canvas/40 px-2 py-2",
                reorder.dragIndex === index && "opacity-40",
              )}
            >
              <div
                onPointerDown={(e) => reorder.handlePointerDown(e, index)}
                onPointerMove={reorder.handlePointerMove}
                onPointerUp={() => reorder.finishDrag()}
                onPointerCancel={() => reorder.finishDrag(true)}
                className={cx(
                  "hidden touch-none select-none rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink sm:block max-lg:p-2.5",
                  reorder.dragIndex === index ? "cursor-grabbing" : "cursor-grab",
                )}
                aria-label="Dra för att ändra ordning"
                role="button"
                tabIndex={0}
              >
                <GripVertical className="size-4" />
              </div>
              <div className="flex sm:hidden">
                <button
                  type="button"
                  disabled={busy || index === 0}
                  onClick={() => onReorder(index, index - 1)}
                  className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30 max-lg:p-2.5"
                  aria-label="Flytta upp"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={busy || index === items.length - 1}
                  onClick={() => onReorder(index, index + 1)}
                  className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30 max-lg:p-2.5"
                  aria-label="Flytta ner"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt="" loading="lazy" decoding="async" className="size-9 shrink-0 rounded-lg object-cover" />
              ) : item.hasImage ? (
                <div className="size-9 shrink-0 animate-pulse rounded-lg bg-ink/10" aria-hidden />
              ) : (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-muted">
                  <ImagePlus className="size-3.5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{item.title || "Namnlös tjänst"}</p>
                <p className="truncate text-[12px] text-muted">{item.text || "Ingen beskrivning"}</p>
              </div>
              <button
                type="button"
                onClick={() => onEdit(index)}
                disabled={busy}
                className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-40"
                aria-label="Redigera tjänst"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={busy}
                className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                aria-label="Ta bort tjänst"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        {reorder.isDropGap(items.length) ? <ListDropGap /> : null}
      </div>
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
      <button
        type="button"
        onClick={onAdd}
        disabled={busy}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong py-2.5 text-[13px] font-medium text-soft transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
      >
        <Plus className="size-4" />
        Lägg till tjänst
      </button>
    </div>
  );
}

export function SectionImageField({
  image,
  loading,
  onChange,
  error,
  onError,
  onBusy,
}: {
  image?: string;
  /** Befintlig bild håller på att hämtas från servern. */
  loading?: boolean;
  onChange: (next: string | undefined) => void;
  error?: string | null;
  onError?: (msg: string | null) => void;
  onBusy?: (busy: boolean) => void;
}) {
  // Ett enda bildfält: hela zonen är klickbar, ingen separat "Välj bild"-knapp.
  return (
    <ImageDropzone
      label="Bild (valfritt)"
      value={image}
      loading={loading}
      error={error}
      onChange={onChange}
      onError={onError}
      onBusy={onBusy}
      variant="compact"
      addLabel="Ladda upp bild"
      replaceLabel="Byt bild"
      removeLabel="Ta bort bild"
    />
  );
}

function ServiceItemModal({
  draft,
  sectionId,
  onClose,
  onSaved,
}: {
  draft: ServiceDraft | null;
  sectionId: string;
  onClose: () => void;
  onSaved: (saved: { index: number | "new"; item: WebsiteSectionItem; imageChanged: boolean }) => void;
}) {
  return draft ? (
    <ServiceItemForm
      key={String(draft.index)}
      draft={draft}
      sectionId={sectionId}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null;
}

function ServiceItemForm({
  draft,
  sectionId,
  onClose,
  onSaved,
}: {
  draft: ServiceDraft;
  sectionId: string;
  onClose: () => void;
  onSaved: (saved: { index: number | "new"; item: WebsiteSectionItem; imageChanged: boolean }) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [text, setText] = useState(draft.text);
  const [image, setImage] = useState<string | undefined>(draft.image);
  const [imageError, setImageError] = useState<string | null>(null);
  const [readingImage, setReadingImage] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!title.trim()) {
      setTitleError("Ange tjänstens namn, till exempel Kök.");
      focusField("tjanst-namn");
      return;
    }
    const item: WebsiteSectionItem = { title: title.trim(), text: text.trim() };
    if (image) item.image = image;
    const imageChanged = image !== draft.image;
    startTransition(async () => {
      try {
        if (draft.index === "new") {
          const result = await addServiceItemAction(sectionId, item);
          if (result && result.ok === false) {
            setImageError(humanizeMediaError(result.error, "Kunde inte spara tjänsten."));
            return;
          }
          onSaved({ index: "new", item, imageChanged: true });
        } else {
          // Oförändrad bild skickas inte om – data-URL:er är tunga.
          const result = await updateServiceItemAction(sectionId, draft.index, {
            title: item.title,
            text: item.text,
            ...(imageChanged ? { image: image ?? null } : {}),
          });
          if (result && result.ok === false) {
            setImageError(humanizeMediaError(result.error, "Kunde inte spara tjänsten."));
            return;
          }
          onSaved({ index: draft.index, item, imageChanged });
        }
      } catch (err) {
        setImageError(humanizeMediaError(err, "Kunde inte spara tjänsten."));
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.index === "new" ? "Lägg till tjänst" : "Redigera tjänst"}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("primary")} disabled={pending || readingImage} onClick={save}>
            {pending ? "Sparar …" : "Spara tjänst"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-6 py-5">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="tjanst-namn">
            Namn
          </label>
          <input
            id="tjanst-namn"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) setTitleError(null);
            }}
            placeholder="T.ex. Kök"
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? "tjanst-namn-fel" : undefined}
            className={cx(
              "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent",
              titleError && invalidFieldCls
            )}
          />
          <FieldError id="tjanst-namn-fel" className="mt-1.5">
            {titleError}
          </FieldError>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-soft">Beskrivning</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Kort vad ni hjälper till med …"
            className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-accent"
          />
        </div>
        <SectionImageField
          image={image}
          onChange={setImage}
          error={imageError}
          onError={setImageError}
          onBusy={setReadingImage}
        />
      </div>
    </Modal>
  );
}

/* ------------------------------- Publicering ------------------------------- */

export function PublishWebsiteButton({ published }: { published: boolean }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <>
      <button className={buttonClasses(published ? "secondary" : "primary")} onClick={() => setOpen(true)}>
        <Globe className="size-4" />
        {published ? "Publicera ändringar" : "Publicera hemsidan"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={done ? undefined : "Publicera hemsidan"} size="sm">
        {done ? (
          <div className="flex flex-col items-center px-6 py-10 text-center animate-fade-up">
            <CheckCircle2 className="size-10 text-ok" />
            <p className="mt-3 text-[18px] font-semibold">Hemsidan är publicerad</p>
            <p className="mt-1 text-[14px] text-soft">
              Nya uppdrag från formuläret dyker upp direkt på din Hem-sida.
            </p>
            <a href="/sajt" target="_blank" rel="noreferrer" className={cx(buttonClasses("primary"), "mt-5")}>
              Öppna sajten
            </a>
          </div>
        ) : (
          <div className="px-6 py-5">
            <p className="text-[14px] leading-relaxed text-soft">
              Sajten blir tillgänglig för besökare och kontaktformuläret börjar skapa uppdrag i Driva. En egen
              .se-adress skaffar du under Domän när du vill.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
                Avbryt
              </button>
              <button
                className={buttonClasses("primary")}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await publishWebsiteAction();
                    setDone(true);
                    router.refresh();
                  })
                }
              >
                {pending ? "Publicerar …" : "Publicera"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

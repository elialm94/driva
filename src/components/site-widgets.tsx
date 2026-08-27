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
import { buttonClasses, cx, DemoTag } from "./ui";
import { Modal } from "./modal";
import {
  addServiceItemAction,
  generateWebsiteAction,
  publishWebsiteAction,
  removeServiceItemAction,
  reorderSectionsAction,
  reorderServiceItemsAction,
  rewriteSectionAction,
  setSectionVisibleAction,
  submitContactFormAction,
  updateSectionAction,
  updateServiceItemAction,
} from "@/app/actions";
import type { WebsiteSection, WebsiteSectionItem } from "@/lib/types";

/* ------------------------- Kontaktformulär på sajten ------------------------- */

export function SiteContactForm({
  interactive,
  accent,
  accentInk,
  line,
  bg,
  ink,
}: {
  interactive: boolean;
  accent: string;
  accentInk: string;
  line: string;
  bg: string;
  ink: string;
}) {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });

  const inputStyle = { background: bg, border: `1px solid ${line}`, color: ink } as const;

  if (sent) {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: bg, border: `1px solid ${line}` }}>
        <CheckCircle2 className="mx-auto size-8" style={{ color: accent }} />
        <p className="mt-2 text-[16px] font-semibold">Tack för din förfrågan!</p>
        <p className="mt-1 text-[14px] opacity-70">Vi återkommer till dig så snart vi kan, oftast samma dag.</p>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!interactive || !form.name.trim() || !form.message.trim()) return;
        startTransition(async () => {
          await submitContactFormAction({
            name: form.name.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
            message: form.message.trim(),
          });
          setSent(true);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          required
          placeholder="Namn"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none"
          style={inputStyle}
        />
        <input
          type="email"
          placeholder="E-post"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none"
          style={inputStyle}
        />
      </div>
      <input
        placeholder="Telefon (valfritt)"
        value={form.phone}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
        className="w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none"
        style={inputStyle}
      />
      <textarea
        required
        rows={4}
        placeholder="Berätta kort om vad du behöver hjälp med …"
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
        className="w-full rounded-xl px-3.5 py-2.5 text-[14px] outline-none"
        style={inputStyle}
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl py-3 text-[14px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: accent, color: accentInk }}
      >
        {pending ? "Skickar …" : "Skicka förfrågan"}
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
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function generate(text: string) {
    startTransition(async () => {
      await generateWebsiteAction(text);
      router.refresh();
    });
  }

  return (
    <div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder={`T.ex. "${EXAMPLES[0]}"`}
        className="w-full rounded-2xl border border-line-strong bg-card px-4 py-3.5 text-[15px] leading-relaxed placeholder:text-muted focus:border-accent"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setDescription(ex)}
              className="max-w-60 truncate rounded-full border border-line bg-card px-3 py-1.5 text-[12px] text-soft transition-colors hover:border-accent hover:text-ink"
            >
              {ex.slice(0, 52)}…
            </button>
          ))}
        </div>
        <button
          className={buttonClasses("primary", "lg")}
          disabled={!description.trim() || pending}
          onClick={() => generate(description.trim())}
        >
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
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? "Dölj sektion" : "Visa sektion"}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full py-0.5 text-[11px] font-semibold",
        on ? "text-ok" : "text-muted",
      )}
    >
      <span className={cx("relative h-4 w-7 rounded-full transition-colors", on ? "bg-ok" : "bg-line-strong")}>
        <span
          className={cx(
            "absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-transform",
            on ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      {on ? "På" : "Av"}
    </button>
  );
}

/* ------------------------------ Sektionslista ------------------------------ */

function sectionIsVisible(section: WebsiteSection): boolean {
  return section.visible !== false;
}

export function SectionList({
  sections,
  labels,
}: {
  sections: WebsiteSection[];
  labels: Record<string, string>;
}) {
  const [rows, setRows] = useState(sections);
  const [pending, startTransition] = useTransition();
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

  return (
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
            onMoveUp={() => move(index, index - 1)}
            onMoveDown={() => move(index, index + 1)}
            canMoveUp={index > 0}
            canMoveDown={index < rows.length - 1}
            onToggle={(visible) => setVisible(section.id, visible)}
            onPointerDown={(e) => reorder.handlePointerDown(e, index)}
            onPointerMove={reorder.handlePointerMove}
            onPointerUp={() => reorder.finishDrag()}
            onPointerCancel={() => reorder.finishDrag(true)}
          />
        </div>
      ))}
      {reorder.isDropGap(rows.length) ? <ListDropGap /> : null}
    </div>
  );
}

function SectionRow({
  section,
  typeLabel,
  last,
  dragging,
  pending,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onToggle,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  section: WebsiteSection;
  typeLabel: string;
  last: boolean;
  dragging: boolean;
  pending: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: (visible: boolean) => void;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const visible = sectionIsVisible(section);
  const canHide = section.type !== "hero";

  return (
    <>
      <div data-section-row className={cx(!last && "border-b border-line/70", dragging && "opacity-40")}>
        <div className={cx("flex items-start gap-1 px-3 py-3 sm:px-4", !visible && "opacity-55")}>
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            className={cx(
              "mt-0.5 hidden touch-none select-none rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink sm:block",
              dragging ? "cursor-grabbing" : "cursor-grab",
            )}
            aria-label="Dra för att ändra ordning"
            role="button"
            tabIndex={0}
          >
            <GripVertical className="size-4" />
          </div>
          <div className="mt-0.5 flex sm:hidden">
            <button
              type="button"
              disabled={pending || !canMoveUp}
              onClick={onMoveUp}
              className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30"
              aria-label="Flytta upp"
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              disabled={pending || !canMoveDown}
              onClick={onMoveDown}
              className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30"
              aria-label="Flytta ner"
            >
              <ChevronDown className="size-4" />
            </button>
          </div>
          <button type="button" onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{typeLabel}</p>
            <p className="truncate text-[14px] font-medium">{section.heading}</p>
          </button>
          <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
            {canHide ? (
              <VisibilitySwitch on={visible} onChange={onToggle} disabled={pending} />
            ) : (
              <span className="px-0.5 py-0.5 text-[11px] font-semibold text-muted">På</span>
            )}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink"
              aria-label={`Redigera ${typeLabel.toLowerCase()}`}
            >
              <Pencil className="size-4" />
            </button>
          </div>
        </div>
        {section.type === "kontakt" && !visible ? (
          <p className="px-3 pb-3 text-[12px] leading-relaxed text-warn sm:pl-11 sm:pr-4">
            Besökare kan inte skicka förfrågningar när den här sektionen är dold.
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
          image={section.image}
          items={section.type === "tjanster" ? (section.items ?? []) : undefined}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/* ------------------------------ Sektionseditor ------------------------------ */

type ServiceDraft = { index: number | "new"; title: string; text: string; image?: string };

function SectionEditor({
  sectionId,
  sectionType,
  typeLabel,
  heading,
  body,
  image: savedImage,
  items,
  onClose,
}: {
  sectionId: string;
  sectionType?: WebsiteSection["type"];
  typeLabel: string;
  heading: string;
  body: string;
  onClose: () => void;
  image?: string;
  items?: WebsiteSectionItem[];
}) {
  const isServices = items !== undefined;
  const showSectionImage =
    sectionType === "hero" ||
    sectionType === "om" ||
    typeLabel === "Startsektion" ||
    typeLabel === "Om oss";
  const [h, setH] = useState(heading);
  const [b, setB] = useState(body);
  const [image, setImage] = useState<string | undefined>(savedImage);
  const [imageError, setImageError] = useState<string | null>(null);
  const [readingImage, setReadingImage] = useState(false);
  const [list, setList] = useState<WebsiteSectionItem[]>(items ?? []);
  const [draft, setDraft] = useState<ServiceDraft | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [itemsPending, startItems] = useTransition();
  const [aiPending, startAi] = useTransition();
  const router = useRouter();

  function closeAll() {
    setDraft(null);
    setListError(null);
    setImageError(null);
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

          {showSectionImage ? (
            <SectionImageField
              image={image}
              onChange={setImage}
              error={imageError}
              onError={setImageError}
              onBusy={setReadingImage}
              variant="section"
            />
          ) : null}

          {isServices ? (
            <ServiceItemsEditor
              items={list}
              error={listError}
              busy={itemsPending}
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
              onClick={() =>
                startTransition(async () => {
                  try {
                    await updateSectionAction(sectionId, {
                      heading: h,
                      body: b,
                      ...(showSectionImage ? { image: image ?? null } : {}),
                    });
                    closeAll();
                    router.refresh();
                  } catch (err) {
                    setImageError(err instanceof Error ? err.message : "Kunde inte spara.");
                  }
                })
              }
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
          onSaved={(saved) => {
            setList((prev) =>
              saved.index === "new" ? [...prev, saved.item] : prev.map((it, i) => (i === saved.index ? saved.item : it)),
            );
            setDraft(null);
            setListError(null);
            router.refresh();
          }}
          sectionId={sectionId}
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
  items: WebsiteSectionItem[];
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
                  "hidden touch-none select-none rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink sm:block",
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
                  className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30"
                  aria-label="Flytta upp"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={busy || index === items.length - 1}
                  onClick={() => onReorder(index, index + 1)}
                  className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-30"
                  aria-label="Flytta ner"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
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
                className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-ink"
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

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 960;
const JPEG_QUALITY = 0.78;
const MAX_DATA_URL_CHARS = 750_000;

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
    img.onerror = () => reject(new Error("Kunde inte läsa bilden."));
    img.src = src;
  });
}

async function fileToItemImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Välj en bildfil (JPG, PNG eller WebP).");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Bilden är för stor. Välj en bild som är mindre än 5 MB.");
  }
  const original = await readFileAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
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
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (dataUrl.length > MAX_DATA_URL_CHARS) {
    throw new Error("Bilden är för stor även efter komprimering. Välj en enklare bild.");
  }
  return dataUrl;
}

export function SectionImageField({
  image,
  onChange,
  error,
  onError,
  onBusy,
  variant,
}: {
  image?: string;
  onChange: (next: string | undefined) => void;
  error?: string | null;
  onError?: (msg: string | null) => void;
  onBusy?: (busy: boolean) => void;
  variant: "card" | "section";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  function setBusy(next: boolean) {
    setReading(next);
    onBusy?.(next);
  }

  function pickFile(file: File) {
    onError?.(null);
    setBusy(true);
    void fileToItemImage(file)
      .then((url) => onChange(url))
      .catch((err: unknown) => {
        onError?.(err instanceof Error ? err.message : "Kunde inte läsa bilden.");
      })
      .finally(() => setBusy(false));
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) pickFile(file);
      }}
    />
  );

  const addOrReplace = (
    <button
      type="button"
      className={buttonClasses("secondary", "sm")}
      disabled={reading}
      onClick={() => fileRef.current?.click()}
    >
      <ImagePlus className="size-3.5" />
      {reading ? "Läser in bild …" : image ? "Byt bild" : "Lägg till bild"}
    </button>
  );

  const remove = image ? (
    <button
      type="button"
      className={buttonClasses("ghost", "sm")}
      onClick={() => {
        onChange(undefined);
        onError?.(null);
      }}
    >
      Ta bort bild
    </button>
  ) : null;

  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-soft">Bild (valfritt)</label>
      {fileInput}
      {variant === "section" ? (
        image ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="" className="h-20 w-28 shrink-0 rounded-xl object-cover" />
            <div className="flex flex-wrap gap-2">
              {addOrReplace}
              {remove}
            </div>
          </div>
        ) : (
          addOrReplace
        )
      ) : (
        <>
          {image ? (
            <div className="overflow-hidden rounded-xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="" className="aspect-[16/10] w-full object-cover" />
            </div>
          ) : (
            <div className="flex aspect-[16/10] items-center justify-center rounded-xl border border-dashed border-line-strong bg-canvas/50 text-[13px] text-muted">
              Ingen bild tillagd
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {addOrReplace}
            {remove}
          </div>
        </>
      )}
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </div>
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
  onSaved: (saved: { index: number | "new"; item: WebsiteSectionItem }) => void;
}) {
  return (
    <Modal
      open={draft !== null}
      onClose={onClose}
      title={draft?.index === "new" ? "Lägg till tjänst" : "Redigera tjänst"}
      size="md"
    >
      {draft ? (
        <ServiceItemForm
          key={`${draft.index}-${draft.title}-${draft.text}-${draft.image ?? ""}`}
          draft={draft}
          sectionId={sectionId}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </Modal>
  );
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
  onSaved: (saved: { index: number | "new"; item: WebsiteSectionItem }) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [text, setText] = useState(draft.text);
  const [image, setImage] = useState<string | undefined>(draft.image);
  const [imageError, setImageError] = useState<string | null>(null);
  const [readingImage, setReadingImage] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4 px-6 py-5">
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-soft">Namn</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="T.ex. Kök"
          className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-soft">Beskrivning</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
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
        variant="card"
      />
      <div className="flex justify-end gap-2">
        <button className={buttonClasses("ghost")} onClick={onClose}>
          Avbryt
        </button>
        <button
          className={buttonClasses("primary")}
          disabled={pending || readingImage || !title.trim()}
          onClick={() => {
            if (!title.trim()) return;
            const item: WebsiteSectionItem = { title: title.trim(), text: text.trim() };
            if (image) item.image = image;
            startTransition(async () => {
              try {
                if (draft.index === "new") {
                  await addServiceItemAction(sectionId, item);
                  onSaved({ index: "new", item });
                } else {
                  await updateServiceItemAction(sectionId, draft.index, {
                    title: item.title,
                    text: item.text,
                    image: image ?? null,
                  });
                  onSaved({ index: draft.index, item });
                }
              } catch (err) {
                setImageError(err instanceof Error ? err.message : "Kunde inte spara tjänsten.");
              }
            });
          }}
        >
          {pending ? "Sparar …" : "Spara tjänst"}
        </button>
      </div>
    </div>
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
              Nya förfrågningar från formuläret dyker upp direkt på din Hem-sida.
            </p>
            <a href="/sajt" target="_blank" rel="noreferrer" className={cx(buttonClasses("primary"), "mt-5")}>
              Öppna sajten
            </a>
          </div>
        ) : (
          <div className="px-6 py-5">
            <p className="text-[14px] leading-relaxed text-soft">
              Sajten blir tillgänglig för besökare och kontaktformuläret börjar skapa förfrågningar i Driva.
              I produktion kopplar du din egen domän här (t.ex. <span className="font-medium text-ink">dittforetag.se</span>).{" "}
            </p>
            <div className="mt-2">
              <DemoTag>I demon publiceras sajten på /sajt</DemoTag>
            </div>
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

"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
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
  reorderServiceItemsAction,
  rewriteSectionAction,
  submitContactFormAction,
  updateSectionAction,
  updateServiceItemAction,
} from "@/app/actions";
import type { WebsiteSectionItem } from "@/lib/types";

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

/* ------------------------------ Sektionseditor ------------------------------ */

type ServiceDraft = { index: number | "new"; title: string; text: string; image?: string };

export function SectionEditor({
  sectionId,
  typeLabel,
  heading,
  body,
  items,
}: {
  sectionId: string;
  typeLabel: string;
  heading: string;
  body: string;
  items?: WebsiteSectionItem[];
}) {
  const isServices = items !== undefined;
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(heading);
  const [b, setB] = useState(body);
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
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => {
          setH(heading);
          setB(body);
          setList(items ?? []);
          setListError(null);
          setOpen(true);
        }}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-canvas/60"
      >
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{typeLabel}</p>
          <p className="truncate text-[14px] font-medium">{heading}</p>
        </div>
        <Pencil className="size-4 shrink-0 text-muted" />
      </button>

      <Modal open={open} onClose={closeAll} title={`Redigera ${typeLabel.toLowerCase()}`} size={isServices ? "lg" : "md"}>
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
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await updateSectionAction(sectionId, { heading: h, body: b });
                  closeAll();
                  router.refresh();
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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function handleDragStart(e: DragEvent, index: number) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }

  function handleDrop(e: DragEvent, index: number) {
    e.preventDefault();
    const from = dragIndex ?? Number(e.dataTransfer.getData("text/plain"));
    setDragIndex(null);
    setOverIndex(null);
    if (Number.isNaN(from)) return;
    onReorder(from, index);
  }

  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-soft">Tjänster</label>
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <div
            key={`${item.title}-${index}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(index);
            }}
            onDrop={(e) => handleDrop(e, index)}
            className={cx(
              "flex items-center gap-2 rounded-xl border bg-canvas/40 px-2 py-2",
              overIndex === index && dragIndex !== null && dragIndex !== index
                ? "border-accent"
                : "border-line",
              dragIndex === index && "opacity-60",
            )}
          >
            <div
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              className="hidden cursor-grab touch-none select-none rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink active:cursor-grabbing sm:block"
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
        ))}
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
  const fileRef = useRef<HTMLInputElement>(null);

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
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-soft">Bild (valfritt)</label>
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
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setImageError(null);
            setReadingImage(true);
            void fileToItemImage(file)
              .then((url) => setImage(url))
              .catch((err: unknown) => {
                setImageError(err instanceof Error ? err.message : "Kunde inte läsa bilden.");
              })
              .finally(() => setReadingImage(false));
          }}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClasses("secondary", "sm")}
            disabled={readingImage}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-3.5" />
            {readingImage ? "Läser in bild …" : image ? "Byt bild" : "Lägg till bild"}
          </button>
          {image ? (
            <button
              type="button"
              className={buttonClasses("ghost", "sm")}
              onClick={() => {
                setImage(undefined);
                setImageError(null);
              }}
            >
              Ta bort bild
            </button>
          ) : null}
        </div>
        {imageError ? <p className="mt-2 text-[13px] text-danger">{imageError}</p> : null}
      </div>
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

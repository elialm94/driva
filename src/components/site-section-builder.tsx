"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { addTestimonialItemAction, updateTestimonialItemAction } from "@/app/actions";
import { Modal } from "@/components/modal";
import { buttonClasses, cx } from "@/components/ui";
import { FieldError, focusField, invalidFieldCls } from "@/components/form-validation";
import { addableTypesFor, type AddableSectionType } from "@/lib/website-sections";
import type { WebsiteSection, WebsiteSectionItem } from "@/lib/types";
import type { SiteContact } from "@/lib/website-contact";
import { formatAddressLine } from "@/lib/website-contact";
import { SETTINGS_HREF } from "@/lib/settings-routes";

export function AddSectionPicker({
  open,
  existingTypes,
  pending,
  onClose,
  onPick,
}: {
  open: boolean;
  existingTypes: Pick<WebsiteSection, "type">[];
  pending: boolean;
  onClose: () => void;
  onPick: (type: AddableSectionType) => void;
}) {
  const options = addableTypesFor(existingTypes);

  return (
    <Modal open={open} onClose={onClose} title="Lägg till sektion" size="sm">
      <div className="space-y-2 px-6 py-5">
        <p className="text-[13px] leading-relaxed text-soft">
          Välj en sektion. Startsektionen finns redan och kan inte läggas till igen.
        </p>
        {options.length === 0 ? (
          <p className="text-[13px] text-muted">Alla extra sektioner är redan tillagda. Text och call to action kan läggas till flera gånger.</p>
        ) : (
          <div className="grid gap-1.5">
            {options.map((option) => (
              <button
                key={option.type}
                type="button"
                disabled={pending}
                onClick={() => onPick(option.type)}
                className="rounded-xl border border-line-strong px-3.5 py-3 text-left transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-50"
              >
                <span className="block text-[14px] font-medium text-ink">{option.label}</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{option.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function DeleteSectionDialog({
  open,
  typeLabel,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  typeLabel: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Ta bort ${typeLabel.toLowerCase()}?`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("ghost")} disabled={pending} onClick={onClose}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("danger")} disabled={pending} onClick={onConfirm}>
            {pending ? "Tar bort …" : "Ta bort sektionen"}
          </button>
        </div>
      }
    >
      <p className="px-6 py-5 text-[14px] leading-relaxed text-soft">
        Sektionen och dess innehåll tas bort från hemsidan. Det går inte att ångra. Vill du bara dölja den tills vidare
        kan du stänga av synligheten i stället.
      </p>
    </Modal>
  );
}

export function ContactDetailsEditor({
  hours,
  onHoursChange,
  contact,
}: {
  hours: string;
  onHoursChange: (value: string) => void;
  contact?: SiteContact;
}) {
  const address = contact ? formatAddressLine(contact) : "";
  return (
    <div className="space-y-3 rounded-xl border border-line bg-canvas/50 p-3.5">
      <p className="text-[13px] leading-relaxed text-soft">
        Telefon, e-post och adress hämtas från Inställningar → Kontakt. Du behöver inte skriva dem igen här.
      </p>
      <dl className="grid gap-2 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Telefon</dt>
          <dd className="text-right font-medium">{contact?.phone || "Saknas"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">E-post</dt>
          <dd className="text-right font-medium">{contact?.email || "Saknas"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Adress</dt>
          <dd className="text-right font-medium">{address || "Saknas"}</dd>
        </div>
      </dl>
      <Link href={`${SETTINGS_HREF.foretag}#installningar-phone` as never} className="text-[13px] font-medium text-accent hover:underline">
        Ändra i Inställningar →
      </Link>
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="kontaktuppgifter-hours">
          Öppettider (valfritt)
        </label>
        <input
          id="kontaktuppgifter-hours"
          value={hours}
          onChange={(e) => onHoursChange(e.target.value)}
          placeholder="Vardagar 7–16"
          className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
        />
      </div>
    </div>
  );
}

export function TestimonialItemsEditor({
  items,
  error,
  busy,
  onEdit,
  onAdd,
  onRemove,
}: {
  items: Array<Pick<WebsiteSectionItem, "title" | "text" | "rating" | "location">>;
  error: string | null;
  busy: boolean;
  onEdit: (index: number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-soft">Omdömen</label>
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <div key={`${item.title}-${index}`} className="flex items-start gap-2 rounded-xl border border-line bg-canvas/40 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{item.title || "Namnlöst omdöme"}</p>
              {item.rating ? (
                <p className="text-[12px] text-muted" aria-label={`${item.rating} av 5`}>
                  {"★".repeat(item.rating)}
                  <span className="text-muted/40">{"★".repeat(5 - item.rating)}</span>
                </p>
              ) : null}
              <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{item.text || "Ingen text"}</p>
              {item.location ? <p className="text-[12px] text-muted">{item.location}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => onEdit(index)}
              disabled={busy}
              className="rounded-lg px-2 py-1 text-[12px] font-medium text-accent hover:underline disabled:opacity-40"
            >
              Redigera
            </button>
            <button
              type="button"
              onClick={() => onRemove(index)}
              disabled={busy}
              className="rounded-lg px-2 py-1 text-[12px] font-medium text-danger hover:underline disabled:opacity-40"
            >
              Ta bort
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
        + Lägg till omdöme
      </button>
    </div>
  );
}

export type TestimonialDraft = {
  index: number | "new";
  title: string;
  text: string;
  rating?: number;
  location?: string;
};

export function TestimonialItemModal({
  draft,
  sectionId,
  onClose,
  onSaved,
}: {
  draft: TestimonialDraft | null;
  sectionId: string;
  onClose: () => void;
  onSaved: (saved: { index: number | "new"; item: WebsiteSectionItem }) => void;
}) {
  if (!draft) return null;
  return <TestimonialItemForm key={String(draft.index)} draft={draft} sectionId={sectionId} onClose={onClose} onSaved={onSaved} />;
}

function TestimonialItemForm({
  draft,
  sectionId,
  onClose,
  onSaved,
}: {
  draft: TestimonialDraft;
  sectionId: string;
  onClose: () => void;
  onSaved: (saved: { index: number | "new"; item: WebsiteSectionItem }) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [text, setText] = useState(draft.text);
  const [location, setLocation] = useState(draft.location ?? "");
  const [rating, setRating] = useState(draft.rating ? String(draft.rating) : "");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    const nextTitle = title.trim();
    const nextText = text.trim();
    if (!nextTitle) {
      setTitleError("Ange namnet, till exempel Anna.");
      focusField("omdome-namn");
      return;
    }
    if (!nextText) {
      setTextError("Skriv omdömet.");
      focusField("omdome-text");
      return;
    }
    const parsedRating = rating.trim() ? Number(rating) : undefined;
    const item: WebsiteSectionItem = {
      title: nextTitle,
      text: nextText,
      source: "manual",
    };
    if (location.trim()) item.location = location.trim();
    if (parsedRating) item.rating = parsedRating;
    start(async () => {
      setFormError(null);
      if (draft.index === "new") {
        const result = await addTestimonialItemAction(sectionId, item);
        if (result.ok === false) {
          setFormError(result.error);
          return;
        }
        onSaved({ index: "new", item });
        return;
      }
      const result = await updateTestimonialItemAction(sectionId, draft.index, {
        title: item.title,
        text: item.text,
        location: item.location ?? null,
        rating: item.rating ?? null,
      });
      if (result.ok === false) {
        setFormError(result.error);
        return;
      }
      onSaved({ index: draft.index, item });
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.index === "new" ? "Lägg till omdöme" : "Redigera omdöme"}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("primary")} disabled={pending} onClick={save}>
            {pending ? "Sparar …" : "Spara omdöme"}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-6 py-5">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="omdome-namn">
            Namn
          </label>
          <input
            id="omdome-namn"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) setTitleError(null);
            }}
            className={cx(
              "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent",
              titleError && invalidFieldCls,
            )}
            aria-invalid={titleError ? true : undefined}
          />
          <FieldError id="omdome-namn-fel" className="mt-1.5">
            {titleError}
          </FieldError>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="omdome-text">
            Omdöme
          </label>
          <textarea
            id="omdome-text"
            value={text}
            rows={4}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim()) setTextError(null);
            }}
            className={cx(
              "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-accent",
              textError && invalidFieldCls,
            )}
            aria-invalid={textError ? true : undefined}
          />
          <FieldError id="omdome-text-fel" className="mt-1.5">
            {textError}
          </FieldError>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="omdome-betyg">
              Betyg (1–5, valfritt)
            </label>
            <input
              id="omdome-betyg"
              type="number"
              min={1}
              max={5}
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-soft" htmlFor="omdome-ort">
              Ort (valfritt)
            </label>
            <input
              id="omdome-ort"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Stockholm"
              className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
            />
          </div>
        </div>
        {formError ? <p className="text-[13px] text-danger">{formError}</p> : null}
      </div>
    </Modal>
  );
}

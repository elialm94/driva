"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Star, Trash2 } from "lucide-react";
import { buttonClasses, cx } from "./ui";
import { Modal } from "./modal";
import {
  addWebsiteSectionAction,
  addTestimonialItemAction,
  beginInstagramConnectAction,
  disconnectInstagramAction,
  instagramStatusAction,
  removeWebsiteSectionAction,
  removeTestimonialItemAction,
  updateTestimonialItemAction,
} from "@/app/actions";
import type { WebsiteCtaDestination, WebsiteSection, WebsiteSectionItem } from "@/lib/types";
import { addableTypesFor, canDeleteSection } from "@/lib/website-sections";
import type { InstagramProviderState } from "@/lib/instagram";
import { SETTINGS_HREF } from "@/lib/settings-routes";
import { FieldError, focusField, invalidFieldCls } from "./form-validation";

const DESTINATIONS: { id: WebsiteCtaDestination; label: string }[] = [
  { id: "kontakt", label: "Kontaktformuläret" },
  { id: "phone", label: "Telefon" },
  { id: "email", label: "E-post" },
];

export function AddSectionButton({ sections }: { sections: Pick<WebsiteSection, "type">[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const options = addableTypesFor(sections);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-line/70 px-4 py-3 text-[13px] font-medium text-soft transition-colors hover:bg-ink/4 hover:text-ink"
      >
        <Plus className="size-4" />
        Lägg till sektion
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Lägg till sektion" size="md">
        <div className="space-y-1 px-2 py-3">
          {options.length === 0 ? (
            <p className="px-4 py-6 text-center text-[14px] text-soft">Alla sektionstyper finns redan på hemsidan.</p>
          ) : (
            options.map((option) => (
              <button
                key={option.type}
                type="button"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await addWebsiteSectionAction(option.type);
                    if (result.ok === false) {
                      setError(result.error);
                      return;
                    }
                    setOpen(false);
                    router.refresh();
                  });
                }}
                className="flex w-full flex-col items-start rounded-xl px-4 py-3 text-left hover:bg-ink/5 disabled:opacity-50"
              >
                <span className="text-[14px] font-medium">{option.label}</span>
                <span className="mt-0.5 text-[13px] text-soft">{option.description}</span>
              </button>
            ))
          )}
          {error ? <p className="px-4 pb-2 text-[13px] text-danger">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}

export function DeleteSectionButton({
  sectionId,
  typeLabel,
  type,
}: {
  sectionId: string;
  typeLabel: string;
  type: WebsiteSection["type"];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!canDeleteSection({ type })) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        aria-label={`Ta bort ${typeLabel.toLowerCase()}`}
      >
        <Trash2 className="size-4" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Ta bort sektionen?" size="sm">
        <div className="px-6 py-5">
          <p className="text-[14px] leading-relaxed text-soft">
            {typeLabel} tas bort från hemsidan. Det här går inte att ångra.
          </p>
          {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
              Avbryt
            </button>
            <button
              type="button"
              className={buttonClasses("danger")}
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await removeWebsiteSectionAction(sectionId);
                  if (result.ok === false) {
                    setError(result.error);
                    return;
                  }
                  setOpen(false);
                  router.refresh();
                });
              }}
            >
              {pending ? "Tar bort …" : "Ta bort"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function ImagePositionField({
  value,
  onChange,
}: {
  value: "left" | "right";
  onChange: (next: "left" | "right") => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-soft">Bildens plats</p>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["left", "Till vänster"],
            ["right", "Till höger"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={cx(
              "rounded-xl border px-3 py-2 text-[13px] font-medium",
              value === id ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-soft hover:bg-ink/4",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ContactDetailsFields({
  hours,
  onHours,
  phone,
  email,
  address,
}: {
  hours: string;
  onHours: (next: string) => void;
  phone: string;
  email: string;
  address: string;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-canvas/50 px-3.5 py-3 text-[13px] leading-relaxed text-soft">
        <p className="font-medium text-ink">Från Inställningar → Kontakt</p>
        <p className="mt-1">{phone || "Ingen telefon"} · {email || "Ingen e-post"}</p>
        {address ? <p className="mt-0.5">{address}</p> : null}
        <a href={SETTINGS_HREF.foretag} className="mt-2 inline-block font-medium text-accent hover:underline">
          Ändra i Inställningar →
        </a>
      </div>
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-soft">Öppettider (valfritt)</label>
        <input
          value={hours}
          onChange={(e) => onHours(e.target.value)}
          placeholder="T.ex. Vardagar 8–16"
          className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
        />
      </div>
    </div>
  );
}

export function CtaFields({
  destination,
  label,
  onDestination,
  onLabel,
}: {
  destination: WebsiteCtaDestination;
  label: string;
  onDestination: (next: WebsiteCtaDestination) => void;
  onLabel: (next: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-soft">Knappen leder till</label>
        <div className="grid gap-2">
          {DESTINATIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onDestination(d.id)}
              className={cx(
                "rounded-xl border px-3 py-2 text-left text-[13px] font-medium",
                destination === d.id ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-soft hover:bg-ink/4",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-soft">Knapptext</label>
        <input
          value={label}
          onChange={(e) => onLabel(e.target.value)}
          maxLength={40}
          className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
        />
      </div>
    </div>
  );
}

export function InstagramFields({
  sectionId,
  handle,
  limit,
  onHandle,
  onLimit,
}: {
  sectionId: string;
  handle: string;
  limit: number;
  onHandle: (next: string) => void;
  onLimit: (next: number) => void;
}) {
  const [status, setStatus] = useState<InstagramProviderState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    instagramStatusAction(sectionId).then((s) => {
      if (!cancelled && s) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [sectionId]);

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-soft">Instagram-konto</label>
        <input
          value={handle.startsWith("@") || !handle ? handle && `@${handle.replace(/^@/, "")}` : `@${handle}`}
          onChange={(e) => onHandle(e.target.value.replace(/^@/, ""))}
          placeholder="@dittforetag"
          className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-soft">Visa senaste</label>
        <select
          value={limit}
          onChange={(e) => onLimit(Number(e.target.value))}
          className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
        >
          <option value={3}>3</option>
          <option value={6}>6</option>
          <option value={9}>9</option>
        </select>
      </div>
      {status?.connected ? (
        <p className="text-[13px] text-ok">Anslutet{status.handle ? ` som @${status.handle}` : ""}.</p>
      ) : (
        <p className="text-[13px] leading-relaxed text-soft">
          Inte anslutet. Driva skrapar inte Instagram – en Meta-app med INSTAGRAM_APP_ID och
          INSTAGRAM_APP_SECRET krävs innan Anslut Instagram fungerar.
        </p>
      )}
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {status?.connected ? (
          <button
            type="button"
            className={buttonClasses("secondary", "sm")}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await disconnectInstagramAction(sectionId);
                if (result && result.ok === false) setError(result.error);
                else router.refresh();
              })
            }
          >
            Koppla från
          </button>
        ) : (
          <button
            type="button"
            className={buttonClasses("secondary", "sm")}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await beginInstagramConnectAction(sectionId, handle);
                if (result.ok === false) {
                  setError(result.error);
                  return;
                }
                window.location.href = result.url;
              })
            }
          >
            Anslut Instagram
          </button>
        )}
      </div>
    </div>
  );
}

export function TestimonialsEditor({
  sectionId,
  items,
  onItems,
}: {
  sectionId: string;
  items: WebsiteSectionItem[];
  onItems: (next: WebsiteSectionItem[]) => void;
}) {
  const [draft, setDraft] = useState<{ index: number | "new"; title: string; text: string; location: string; rating?: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-soft">Omdömen</label>
      <div className="space-y-1.5">
        {items.map((item, index) => (
          <div key={`${item.title}-${index}`} className="flex items-center gap-2 rounded-xl border border-line bg-canvas/40 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{item.title}</p>
              <p className="truncate text-[12px] text-muted">{item.text}</p>
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-[12px] font-medium text-muted hover:bg-ink/5 hover:text-ink"
              onClick={() =>
                setDraft({
                  index,
                  title: item.title,
                  text: item.text,
                  location: item.location ?? "",
                  rating: item.rating,
                })
              }
            >
              Redigera
            </button>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removeTestimonialItemAction(sectionId, index);
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  onItems(items.filter((_, i) => i !== index));
                  router.refresh();
                })
              }
              aria-label="Ta bort omdöme"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
      <button
        type="button"
        onClick={() => setDraft({ index: "new", title: "", text: "", location: "", rating: 5 })}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong py-2.5 text-[13px] font-medium text-soft hover:border-accent hover:text-ink"
      >
        <Plus className="size-4" />
        Lägg till omdöme
      </button>
      {draft ? (
        <TestimonialForm
          draft={draft}
          sectionId={sectionId}
          onClose={() => setDraft(null)}
          onSaved={(saved) => {
            onItems(
              saved.index === "new"
                ? [...items, saved.item]
                : items.map((it, i) => (i === saved.index ? saved.item : it)),
            );
            setDraft(null);
            setError(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function TestimonialForm({
  draft,
  sectionId,
  onClose,
  onSaved,
}: {
  draft: { index: number | "new"; title: string; text: string; location: string; rating?: number };
  sectionId: string;
  onClose: () => void;
  onSaved: (saved: { index: number | "new"; item: WebsiteSectionItem }) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [text, setText] = useState(draft.text);
  const [location, setLocation] = useState(draft.location);
  const [rating, setRating] = useState<number | undefined>(draft.rating);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!title.trim()) {
      setError("Ange namnet på personen.");
      focusField("omdome-namn");
      return;
    }
    if (!text.trim()) {
      setError("Skriv omdömet.");
      return;
    }
    const item: WebsiteSectionItem = { title: title.trim(), text: text.trim(), source: "manual" };
    if (location.trim()) item.location = location.trim();
    if (rating) item.rating = rating;
    startTransition(async () => {
      if (draft.index === "new") {
        const result = await addTestimonialItemAction(sectionId, item);
        if (result.ok === false) {
          setError(result.error);
          return;
        }
        onSaved({ index: "new", item });
      } else {
        const result = await updateTestimonialItemAction(sectionId, draft.index, {
          title: item.title,
          text: item.text,
          location: item.location ?? null,
          rating: item.rating ?? null,
        });
        if (result.ok === false) {
          setError(result.error);
          return;
        }
        onSaved({ index: draft.index, item });
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={draft.index === "new" ? "Lägg till omdöme" : "Redigera omdöme"}
      size="md"
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
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Anna"
            className={cx("w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent", error && !title.trim() && invalidFieldCls)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-soft">Omdöme</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Otroligt nöjda med vårt nya kök."
            className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-accent"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-soft">Ort (valfritt)</label>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Stockholm"
            className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] focus:border-accent"
          />
        </div>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-soft">Betyg (valfritt)</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(rating === n ? undefined : n)} className="rounded-lg p-1 text-muted hover:text-ink" aria-label={`${n} stjärnor`}>
                <Star className={cx("size-5", rating && n <= rating ? "fill-current text-accent" : "")} />
              </button>
            ))}
          </div>
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    </Modal>
  );
}

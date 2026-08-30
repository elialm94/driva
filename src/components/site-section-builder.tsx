"use client";

import { useMemo, useState, useTransition } from "react";
import {
  addTestimonialItem,
  addWebsiteSection,
  beginInstagramConnect,
  disconnectInstagram,
  refreshInstagramPosts,
  removeTestimonialItem,
  removeWebsiteSection,
  reorderTestimonialItems,
  updateSection,
  updateTestimonialItem,
} from "@/app/actions";
import { Button, Input, Label, Textarea } from "@/components/ui";
import { ADDABLE_SECTION_TYPES, SECTION_LABELS, type AddableSectionType } from "@/lib/website-sections";
import type { WebsiteSection } from "@/lib/types";

export function AddSectionButton({
  addableTypes,
  onAdded,
}: {
  addableTypes: AddableSectionType[];
  onAdded: (sectionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  if (addableTypes.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted">
        Alla extra sektioner är redan tillagda. Text och call to action kan läggas till flera gånger.
      </p>
    );
  }

  return (
    <div className="relative mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-2xl border border-dashed border-ink/20 px-3 py-2.5 text-sm font-medium text-ink hover:bg-paper"
      >
        + Lägg till sektion
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-20 mt-2 rounded-2xl border border-line bg-white p-2 shadow-lg">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
            Välj sektion
          </p>
          {addableTypes.map((type) => (
            <button
              key={type}
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const added = await addWebsiteSection(type);
                  setOpen(false);
                  onAdded(added.id);
                })
              }
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-paper disabled:opacity-50"
            >
              <span>{SECTION_LABELS[type]}</span>
              {ADDABLE_SECTION_TYPES.find((item) => item.type === type)?.hint ? (
                <span className="max-w-[55%] text-right text-[11px] text-muted">
                  {ADDABLE_SECTION_TYPES.find((item) => item.type === type)?.hint}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const AddSectionPicker = AddSectionButton;

export function DeleteSectionButton({
  section,
  onDeleted,
}: {
  section: WebsiteSection;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  if (section.type === "hero") return null;

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="text-[11px] text-red-700 hover:underline">
        Ta bort
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-[11px]">
      <span className="text-red-700">Ta bort sektionen?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await removeWebsiteSection(section.id);
            onDeleted();
          })
        }
        className="font-semibold text-red-700 hover:underline disabled:opacity-50"
      >
        Ja, ta bort
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-muted hover:underline">
        Avbryt
      </button>
    </span>
  );
}

export const DeleteSectionDialog = DeleteSectionButton;

export function ImagePositionField({
  section,
}: {
  section: WebsiteSection;
}) {
  if (section.type !== "text" && section.type !== "om") return null;
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">Bildplacering</span>
      <select
        defaultValue={section.imagePosition ?? "right"}
        onChange={(event) => void updateSection(section.id, { imagePosition: event.target.value as "left" | "right" })}
        className="w-full rounded-2xl border border-line bg-paper px-4 py-3 text-sm"
      >
        <option value="right">Bild till höger</option>
        <option value="left">Bild till vänster</option>
      </select>
    </label>
  );
}

export function ContactDetailsFields({
  section,
  fallbackPhone,
  fallbackEmail,
  fallbackAddress,
  fallbackCity,
}: {
  section: WebsiteSection;
  fallbackPhone?: string;
  fallbackEmail?: string;
  fallbackAddress?: string;
  fallbackCity?: string;
}) {
  if (section.type !== "kontaktuppgifter") return null;
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-paper/70 p-3 text-sm">
      <p className="text-xs text-muted">
        Telefon, e-post och adress hämtas från Inställningar → Kontakt. Ändra där så uppdateras hemsidan.
      </p>
      <p>
        <span className="text-muted">Telefon:</span> {fallbackPhone || "Saknas"}
      </p>
      <p>
        <span className="text-muted">E-post:</span> {fallbackEmail || "Saknas"}
      </p>
      <p>
        <span className="text-muted">Adress:</span> {[fallbackAddress, fallbackCity].filter(Boolean).join(", ") || "Saknas"}
      </p>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">Öppettider (valfritt)</span>
        <Input defaultValue={section.hours ?? ""} onBlur={(event) => void updateSection(section.id, { hours: event.target.value })} />
      </label>
    </div>
  );
}

export const ContactDetailsEditor = ContactDetailsFields;

export function CtaFields({ section }: { section: WebsiteSection }) {
  if (section.type !== "cta") return null;
  const cta = section.cta ?? { label: "Kontakta oss", destination: "contact" as const };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">Knapptext</span>
        <Input defaultValue={cta.label} onBlur={(event) => void updateSection(section.id, { cta: { ...cta, label: event.target.value } })} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">Knappen går till</span>
        <select
          defaultValue={cta.destination}
          onChange={(event) =>
            void updateSection(section.id, {
              cta: { ...cta, destination: event.target.value as "contact" | "phone" | "email" },
            })
          }
          className="w-full rounded-2xl border border-line bg-paper px-4 py-3 text-sm"
        >
          <option value="contact">Kontaktformulär</option>
          <option value="phone">Telefon</option>
          <option value="email">E-post</option>
        </select>
      </label>
    </div>
  );
}

export function InstagramFields({
  section,
  status,
}: {
  section: WebsiteSection;
  status?: { status: string; setupSteps?: string[] };
}) {
  const [pending, start] = useTransition();
  if (section.type !== "instagram") return null;
  const ig = section.instagram;
  const connected = ig?.connected;
  const needsCredentials = status?.status === "needs_credentials";

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-paper/70 p-3">
      <p className="text-xs text-muted">
        Visar senaste inlägg via Instagrams officiella API. Driva skrapar inte Instagram.
      </p>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">Konto</span>
        <Input
          defaultValue={ig?.handle ?? ""}
          placeholder="@dittforetag"
          onBlur={(event) =>
            void updateSection(section.id, {
              instagram: { ...(ig ?? { connected: false, postCount: 6, posts: [] }), handle: event.target.value },
            })
          }
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted">Antal inlägg</span>
        <Input
          type="number"
          min={3}
          max={12}
          defaultValue={ig?.postCount ?? 6}
          onBlur={(event) =>
            void updateSection(section.id, {
              instagram: { ...(ig ?? { connected: false, postCount: 6, posts: [] }), postCount: Number(event.target.value) || 6 },
            })
          }
        />
      </label>
      {needsCredentials && status?.setupSteps?.length ? (
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
          {status.setupSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || needsCredentials}
          onClick={() =>
            start(async () => {
              const result = await beginInstagramConnect(section.id);
              if (result.ok && result.url) window.location.href = result.url;
            })
          }
        >
          {connected ? "Anslut igen" : "Anslut Instagram"}
        </Button>
        {connected ? (
          <>
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => start(() => refreshInstagramPosts(section.id))}>
              Uppdatera
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => start(() => disconnectInstagram(section.id))}>
              Koppla från
            </Button>
          </>
        ) : null}
      </div>
      {connected && ig?.posts?.length ? (
        <p className="text-xs text-muted">{ig.posts.length} inlägg hämtade. De syns på sajten efter publicering.</p>
      ) : connected ? (
        <p className="text-xs text-muted">Kontot är anslutet men inga inlägg hämtades. Kontrollera att kontot är ett professionellt Instagram-konto.</p>
      ) : (
        <p className="text-xs text-muted">Sektionen är redo. Inga inlägg visas publikt förrän Instagram är anslutet.</p>
      )}
    </div>
  );
}

export const InstagramEditor = InstagramFields;

function TestimonialForm({
  sectionId,
  initial,
  onClose,
}: {
  sectionId: string;
  initial?: { id?: string; title?: string; body?: string; rating?: number };
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const payload = {
          title: String(form.get("title") ?? ""),
          body: String(form.get("body") ?? ""),
          rating: Number(form.get("rating") || 0) || undefined,
        };
        start(async () => {
          if (initial?.id) await updateTestimonialItem(sectionId, initial.id, payload);
          else await addTestimonialItem(sectionId, payload);
          onClose();
        });
      }}
    >
      <label className="block">
        <Label>Namn</Label>
        <Input name="title" required defaultValue={initial?.title} />
      </label>
      <label className="block">
        <Label>Omdöme</Label>
        <Textarea name="body" required rows={4} defaultValue={initial?.body} />
      </label>
      <label className="block">
        <Label>Betyg (1–5, valfritt)</Label>
        <Input name="rating" type="number" min={1} max={5} defaultValue={initial?.rating ?? ""} />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Avbryt</Button>
        <Button type="submit" disabled={pending}>{pending ? "Sparar…" : "Spara"}</Button>
      </div>
    </form>
  );
}

export const TestimonialItemModal = TestimonialForm;

export function TestimonialsEditor({
  section,
  onItemsChange,
}: {
  section: WebsiteSection;
  onItemsChange: (items: WebsiteSection["items"]) => void;
}) {
  const [editing, setEditing] = useState<WebsiteSection["items"][number] | "new" | null>(null);
  const [pending, start] = useTransition();
  const items = useMemo(() => section.items ?? [], [section.items]);
  if (section.type !== "omdomen") return null;

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item.id} className="rounded-2xl border border-line bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{item.title}</p>
              {item.rating ? <p className="text-xs text-muted">{"★".repeat(item.rating)}</p> : null}
              <p className="mt-1 text-sm text-ink/80">{item.body}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-1 text-right">
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => setEditing(item)}>Redigera</button>
              <button
                type="button"
                className="text-xs text-muted hover:underline"
                disabled={index === 0 || pending}
                onClick={() =>
                  start(async () => {
                    const next = [...items];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    await reorderTestimonialItems(section.id, next.map((entry) => entry.id));
                    onItemsChange(next);
                  })
                }
              >
                Upp
              </button>
              <button
                type="button"
                className="text-xs text-red-700 hover:underline"
                onClick={() =>
                  start(async () => {
                    await removeTestimonialItem(section.id, item.id);
                    onItemsChange(items.filter((entry) => entry.id !== item.id));
                  })
                }
              >
                Ta bort
              </button>
            </div>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" onClick={() => setEditing("new")}>
        + Lägg till omdöme
      </Button>
      {editing ? (
        <div className="rounded-2xl border border-line bg-paper p-3">
          <TestimonialForm
            sectionId={section.id}
            initial={editing === "new" ? undefined : editing}
            onClose={() => setEditing(null)}
          />
        </div>
      ) : null}
    </div>
  );
}

export const TestimonialItemsEditor = TestimonialsEditor;

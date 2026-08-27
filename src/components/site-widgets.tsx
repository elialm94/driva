"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Globe, Pencil, Sparkles, WandSparkles } from "lucide-react";
import { buttonClasses, cx, DemoTag } from "./ui";
import { Modal } from "./modal";
import {
  generateWebsiteAction,
  publishWebsiteAction,
  rewriteSectionAction,
  submitContactFormAction,
  updateSectionAction,
} from "@/app/actions";

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

export function SectionEditor({
  sectionId,
  typeLabel,
  heading,
  body,
}: {
  sectionId: string;
  typeLabel: string;
  heading: string;
  body: string;
}) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(heading);
  const [b, setB] = useState(body);
  const [pending, startTransition] = useTransition();
  const [aiPending, startAi] = useTransition();
  const router = useRouter();

  return (
    <>
      <button
        onClick={() => {
          setH(heading);
          setB(body);
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

      <Modal open={open} onClose={() => setOpen(false)} title={`Redigera ${typeLabel.toLowerCase()}`} size="md">
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
                    setOpen(false);
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
              rows={4}
              className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] leading-relaxed focus:border-accent"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
              Avbryt
            </button>
            <button
              className={buttonClasses("primary")}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await updateSectionAction(sectionId, { heading: h, body: b });
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? "Sparar …" : "Spara ändringar"}
            </button>
          </div>
        </div>
      </Modal>
    </>
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

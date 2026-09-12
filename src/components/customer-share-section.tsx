"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, FileText, Printer } from "lucide-react";
import type { JobCustomerShare, JobPhoto } from "@/lib/types";
import { disableCustomerShareAction, updateCustomerShareAction } from "@/app/closeout-actions";
import { ShareCustomerLink } from "./share-customer-link";
import { Badge, Card, SectionTitle, buttonClasses, cx } from "./ui";

type Flag = "quote" | "changes" | "invoices" | "paymentStatus" | "closeoutSummary";

const FLAGS: { key: Flag; label: string; hint: string }[] = [
  { key: "quote", label: "Godkänd offert", hint: "Raderna och summan kunden redan godkänt." },
  { key: "changes", label: "Godkända ändringar", hint: "Bara ändringar kunden själv godkänt." },
  { key: "invoices", label: "Fakturor", hint: "Utfärdade fakturor med länk till kundens fakturasida." },
  { key: "paymentStatus", label: "Betalningsstatus", hint: "Fakturerat, betalt och kvar att betala." },
  { key: "closeoutSummary", label: "Slutunderlag", hint: "Sammanställningen med utfört arbete och delade bilder." },
];

/**
 * Ägarens panel för kundvyn: vad kunden ser via sin uppdragslänk, vilka
 * foton som delas och förhandsgranskning av slutunderlaget. Inget skickas
 * automatiskt – länken delas via kopiera/SMS/dela precis som offerten.
 */
export function CustomerShareSection({
  jobId,
  share,
  photos,
  phone,
  hasQuote,
  hasChanges,
  hasInvoices,
}: {
  jobId: string;
  share?: JobCustomerShare;
  photos: JobPhoto[];
  phone?: string;
  hasQuote: boolean;
  hasChanges: boolean;
  hasInvoices: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const active = Boolean(share && !share.disabledAt);

  function update(patch: Partial<Record<Flag, boolean>> & { photoIds?: string[] }) {
    setError(null);
    start(async () => {
      const r = await updateCustomerShareAction(jobId, patch);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function togglePhoto(id: string) {
    const current = share?.photoIds ?? [];
    update({ photoIds: current.includes(id) ? current.filter((p) => p !== id) : [...current, id] });
  }

  function disable() {
    setError(null);
    start(async () => {
      const r = await disableCustomerShareAction(jobId);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const available: Record<Flag, boolean> = {
    quote: hasQuote,
    changes: hasChanges,
    invoices: hasInvoices,
    paymentStatus: hasInvoices || hasQuote,
    closeoutSummary: true,
  };

  return (
    <div className="mb-8 scroll-mt-4" id="kundvy" data-testid="customer-share" data-share-path={active && share ? `/uppdrag-kund/${share.token}` : undefined}>
      <SectionTitle
        right={
          <Link href={`/uppdrag/${jobId}/slutunderlag` as never} className={buttonClasses("secondary", "sm")} data-testid="closeout-summary-preview">
            <Printer className="size-3.5" /> Förhandsgranska slutunderlag
          </Link>
        }
      >
        Kundvy och slutunderlag
      </SectionTitle>
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
              Kundens uppdragslänk
              {active ? <Badge tone="ok">Delad</Badge> : share ? <Badge tone="neutral">Stängd</Badge> : <Badge tone="neutral">Inte delad</Badge>}
            </p>
            <p className="text-[13px] text-soft">
              Kunden ser bara det du bockar för här. Aldrig inköp, täckning, anteckningar eller bokföring.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {active && share ? (
              <>
                <ShareCustomerLink path={`/uppdrag-kund/${share.token}`} kind="uppdrag" phone={phone} />
                <button type="button" className={buttonClasses("ghost", "sm")} disabled={pending} onClick={disable} data-testid="customer-share-disable">
                  <EyeOff className="size-3.5" /> Stäng länken
                </button>
              </>
            ) : (
              <button type="button" className={buttonClasses("primary", "sm")} disabled={pending} onClick={() => update({})} data-testid="customer-share-enable">
                <Eye className="size-3.5" /> {share ? "Öppna länken igen" : "Dela med kunden"}
              </button>
            )}
          </div>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[13px] font-medium text-danger">
            {error}
          </p>
        ) : null}

        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {FLAGS.map((f) => {
            const checked = active ? Boolean(share?.[f.key]) : false;
            const disabled = pending || !available[f.key];
            return (
              <li key={f.key}>
                <label className={cx("flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5", disabled && "opacity-60")}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--color-accent)]"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => update({ [f.key]: e.target.checked })}
                    data-testid={`customer-share-${f.key}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-ink">{f.label}</span>
                    <span className="block text-[12.5px] text-muted">{available[f.key] ? f.hint : "Finns inget att dela än."}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {photos.length > 0 ? (
          <div className="mt-4">
            <p className="text-[13px] font-medium text-ink">Delade foton</p>
            <p className="text-[12.5px] text-muted">Bocka för de bilder kunden får se. Övriga stannar hos dig.</p>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {photos.map((p) => {
                const on = Boolean(share?.photoIds.includes(p.id));
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={pending}
                    onClick={() => togglePhoto(p.id)}
                    aria-pressed={on}
                    className={cx("relative overflow-hidden rounded-lg border-2", on ? "border-accent" : "border-transparent opacity-70 hover:opacity-100")}
                    data-testid="customer-share-photo"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- data-URL från uppdraget */}
                    <img src={p.dataUrl} alt={p.caption ?? ""} className="aspect-square w-full object-cover" />
                    {on ? <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">Delad</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-muted">
          <FileText className="size-3.5" /> Slutunderlaget kan skrivas ut eller sparas som PDF från förhandsgranskningen. Ingenting skickas automatiskt.
        </p>
      </Card>
    </div>
  );
}

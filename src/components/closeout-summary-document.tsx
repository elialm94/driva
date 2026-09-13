import type { CompanySettings } from "@/lib/types";
import type { CustomerShareView } from "@/lib/services/customer-share";
import { datumLang, datumNumeriskt, datumTid, kr } from "@/lib/format";
import { docTotals } from "@/lib/calc";
import { paymentPlanAmounts } from "@/lib/payment-plan";
import { DocCompanyHeader, DocFooter, DocLinesTable, DocTotalsBlock } from "./quote-document";

/**
 * Slutunderlaget som dokument (A4/utskrift och kundvy). Renderar BARA det som
 * finns i vyn – kundens variant får en vy byggd av delningsinställningarna,
 * ägarens förhandsgranskning en vy med allt. Inga interna belopp: aldrig
 * inköp, täckning eller anteckningar.
 */
export function CloseoutSummaryDocument({
  company,
  view,
  createdAt = new Date().toISOString(),
}: {
  company: CompanySettings;
  view: CustomerShareView;
  createdAt?: string;
}) {
  const { job, quote, changes, photos, invoices, paymentStatus, work } = view;
  const plan = quote?.version.paymentPlan ?? [];
  const planAmounts = quote ? paymentPlanAmounts(plan, docTotals(quote.version.lines, quote.version.rot).toPay) : [];
  const rotLabel = quote?.rot === "rut" ? "RUT" : quote?.rot === "rot" ? "ROT" : null;
  const quoteTotals = quote ? docTotals(quote.version.lines, quote.version.rot) : null;

  return (
    <div className="p-6 sm:p-10" data-closeout-summary="">
      <DocCompanyHeader company={company} docType="Slutunderlag" docNumber={job.title} />

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Kund</p>
          <p className="mt-1 text-[15px] font-medium text-ink">{view.customerName}</p>
          {job.address ? <p className="text-[13px] text-soft">{job.address}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:justify-end">
          <div>
            <p className="text-[12px] text-muted">Uppdraget</p>
            <p className="text-[13px] font-medium text-ink">{job.completedAt ? `Avslutat ${datumNumeriskt(job.completedAt)}` : "Pågår"}</p>
          </div>
          <div>
            <p className="text-[12px] text-muted">Underlag daterat</p>
            <p className="text-[13px] font-medium text-ink">{datumNumeriskt(createdAt)}</p>
          </div>
        </div>
      </div>

      {job.description.trim() ? (
        <section className="mt-8">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Uppdraget</h2>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-ink">{job.description}</p>
        </section>
      ) : null}

      {quote ? (
        <section className="mt-8" data-summary-quote="">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Godkänd offert #{quote.number}</h2>
          {quote.approvedAt ? (
            <p className="mt-1 text-[13px] text-soft">
              Godkänd {datumTid(quote.approvedAt)} av {quote.approvedBy}
            </p>
          ) : null}
          <div className="mt-4">
            <DocLinesTable lines={quote.version.lines} />
          </div>
          <div className="mt-4">
            <DocTotalsBlock lines={quote.version.lines} rot={quote.version.rot} toPayLabel="Avtalat att betala" />
          </div>
          {plan.length > 0 ? (
            <div className="mt-4 rounded-xl border border-line px-4 py-3 text-[14px]">
              <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Betalplan</p>
              <ul className="space-y-1">
                {plan.map((part, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3">
                    <span className="text-ink">{part.label}</span>
                    <span className="tabular text-soft">{kr(planAmounts[i] ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {changes.length > 0 ? (
        <section className="mt-8" data-summary-changes="">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Godkända ändringar och tillägg</h2>
          <ul className="mt-3 divide-y divide-line/70 rounded-xl border border-line">
            {changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-[14px]">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    Ändring {c.number}
                    {c.version > 1 ? ` (version ${c.version})` : ""} · {c.title}
                  </p>
                  {c.description ? <p className="text-[13px] text-soft">{c.description}</p> : null}
                  <p className="text-[12.5px] text-muted">
                    Godkänd {datumTid(c.approvedAt)} av {c.approvedBy}
                  </p>
                </div>
                <p className="tabular font-medium text-ink">{c.toPay < 0 ? `−${kr(Math.abs(c.toPay))}` : kr(c.toPay)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {work ? (
        <section className="mt-8" data-summary-work="">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Utfört arbete</h2>
          <p className="mt-2 text-[14px] text-ink">
            {work.hours > 0 ? `${work.hours.toLocaleString("sv-SE")} timmar` : "Inga timmar registrerade"}
            {work.firstDate && work.lastDate
              ? work.firstDate === work.lastDate
                ? ` · ${datumLang(work.firstDate)}`
                : ` · ${datumLang(work.firstDate)} till ${datumLang(work.lastDate)}`
              : ""}
          </p>
          {work.descriptions.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[14px] text-soft">
              {work.descriptions.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {photos.length > 0 ? (
        <section className="mt-8" data-summary-photos="">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Bilder</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((p) => (
              <figure key={p.id} className="overflow-hidden rounded-xl border border-line bg-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element -- data-URL från uppdraget, ingen extern källa */}
                <img src={p.dataUrl} alt={p.caption ?? "Foto från uppdraget"} className="aspect-[4/3] w-full object-cover" />
                <figcaption className="px-2.5 py-1.5 text-[12px] text-soft">
                  {p.caption ? `${p.caption} · ` : ""}
                  {datumNumeriskt(p.createdAt)}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {invoices.length > 0 || paymentStatus ? (
        <section className="mt-8" data-summary-invoices="">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Fakturor och betalning</h2>
          {invoices.length > 0 ? (
            <ul className="mt-3 divide-y divide-line/70 rounded-xl border border-line">
              {invoices.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-[14px]">
                  <span className="text-ink">
                    {inv.type === "kredit" ? "Kreditfaktura" : inv.type === "delbetalning" ? "Delfaktura" : inv.type === "slutfaktura" ? "Slutfaktura" : "Faktura"}
                    {inv.number != null ? ` #${inv.number}` : ""}
                    {inv.issuedAt ? <span className="text-muted"> · {datumNumeriskt(inv.issuedAt)}</span> : null}
                  </span>
                  <span className="flex items-baseline gap-3">
                    <span className="text-[12.5px] text-soft">{inv.label}</span>
                    <span className="tabular font-medium text-ink">{kr(inv.amount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {paymentStatus ? (
            <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px] tabular">
              <div>
                <dt className="text-muted">Fakturerat</dt>
                <dd className="font-medium text-ink">{kr(paymentStatus.invoiced)}</dd>
              </div>
              <div>
                <dt className="text-muted">Betalt</dt>
                <dd className="font-medium text-ink">{kr(paymentStatus.paid)}</dd>
              </div>
              <div>
                <dt className="text-muted">Kvar att betala</dt>
                <dd className={paymentStatus.overdue ? "font-medium text-danger" : "font-medium text-ink"}>{kr(paymentStatus.remaining)}</dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}

      {rotLabel && quoteTotals && quoteTotals.deduction > 0 ? (
        <section className="mt-8" data-summary-rot="">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{rotLabel}-underlag</h2>
          <p className="mt-2 text-[14px] text-ink">
            Arbetskostnad {kr(quoteTotals.laborInclVat)} inkl. moms · preliminär skattereduktion {kr(quoteTotals.deduction)}.
          </p>
          <p className="text-[12.5px] text-muted">Avdraget förutsätter att Skatteverket beviljar ansökan. Det slutliga beloppet framgår av fakturan.</p>
        </section>
      ) : null}

      <DocFooter company={company} />
    </div>
  );
}

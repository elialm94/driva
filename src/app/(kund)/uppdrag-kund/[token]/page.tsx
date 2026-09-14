import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, Camera, FileText, PenLine, Printer, ReceiptText, Wallet } from "lucide-react";
import { db } from "@/lib/store";
import { customerShareView, getJobByShareToken } from "@/lib/services/customer-share";
import { datumLang, datumNumeriskt, datumTid, kr } from "@/lib/format";
import { CompanyLogo } from "@/components/company-logo";
import { PublicDocumentFooter } from "@/components/public-document-chrome";
import { ensurePublicPage } from "@/lib/auth/session";
import { buttonClasses } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/uppdrag-kund/[token]">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("job_share", token))) return { title: "Ditt uppdrag" };
  const job = getJobByShareToken(token);
  if (!job || job.customerShare?.disabledAt) return { title: "Ditt uppdrag" };
  return { title: `${job.title} – ${db().settings.name}` };
}

const STATUS_LABEL: Record<string, string> = {
  kommande: "Planerat",
  pagar: "Pågår",
  klart: "Avslutat",
};

/**
 * Kundens uppdragssida. Bara det företaget uttryckligen delat byggs in i vyn
 * (customerShareView) – sidan kan därför inte råka visa interna belopp.
 * Länken identifieras enbart av token, aldrig av id eller inloggning.
 */
export default async function CustomerJobPage(props: PageProps<"/uppdrag-kund/[token]">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("job_share", token))) notFound();
  const job = getJobByShareToken(token);
  if (!job) notFound();
  const view = customerShareView(job);
  const seller = db().settings;

  if (!view) {
    return (
      <div className="min-h-dvh bg-canvas">
        <main className="mx-auto max-w-xl px-5 py-16 text-center" data-testid="customer-job-closed">
          <CompanyLogo company={seller} size="md" className="mx-auto" />
          <h1 className="mt-6 text-[22px] font-semibold tracking-tight">Sidan är inte tillgänglig</h1>
          <p className="mt-2 text-[15px] text-soft">
            Länken har stängts av {seller.name}. Hör av dig på {seller.phone} om du vill ha en ny.
          </p>
        </main>
      </div>
    );
  }

  const { quote, changes, photos, invoices, paymentStatus } = view;
  const nothingShared = !quote && changes.length === 0 && photos.length === 0 && invoices.length === 0 && !paymentStatus && !view.closeoutSummary;

  return (
    <div className="min-h-dvh bg-canvas" data-testid="customer-job-page">
      <header className="border-b border-line bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <CompanyLogo company={seller} size="sm" />
            <div>
              <p className="text-[14px] font-semibold leading-tight">{seller.name}</p>
              <p className="text-[12px] text-muted">Ditt uppdrag</p>
            </div>
          </div>
          <span className="rounded-full bg-canvas px-2.5 py-1 text-[12px] font-medium text-soft">{STATUS_LABEL[view.job.status] ?? view.job.status}</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-5">
        <h1 className="text-[26px] font-semibold tracking-tight">{view.job.title}</h1>
        <p className="mt-1 text-[14px] text-soft">
          {view.customerName}
          {view.job.address ? ` · ${view.job.address}` : ""}
          {view.job.completedAt ? ` · Avslutat ${datumLang(view.job.completedAt)}` : ""}
        </p>

        {nothingShared ? (
          <p className="mt-8 rounded-2xl border border-line bg-card px-5 py-4 text-[14px] text-soft">
            {seller.name} har inte delat något här än.
          </p>
        ) : null}

        <div className="mt-6 space-y-4">
          {quote ? (
            <section className="rounded-2xl border border-line bg-card px-5 py-4" data-testid="customer-quote">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 size-5 text-muted" />
                  <div>
                    <p className="text-[15px] font-semibold">Offert #{quote.number}</p>
                    {quote.approvedAt ? (
                      <p className="flex items-center gap-1 text-[13px] text-ok">
                        <BadgeCheck className="size-3.5" /> Godkänd {datumTid(quote.approvedAt)} av {quote.approvedBy}
                      </p>
                    ) : null}
                  </div>
                </div>
                <p className="text-[15px] font-semibold tabular">{kr(quote.toPay)}</p>
              </div>
              <Link href={`/offert/${quote.token}` as never} className={`${buttonClasses("secondary", "sm")} mt-3`}>
                Visa offerten
              </Link>
            </section>
          ) : null}

          {changes.length > 0 ? (
            <section className="rounded-2xl border border-line bg-card px-5 py-4" data-testid="customer-changes">
              <p className="flex items-center gap-2 text-[15px] font-semibold">
                <PenLine className="size-4 text-muted" /> Godkända ändringar
              </p>
              <ul className="mt-3 divide-y divide-line/70">
                {changes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/andring/${c.token}` as never} className="text-[14px] font-medium text-ink hover:underline">
                        Ändring {c.number} · {c.title}
                      </Link>
                      <p className="text-[12.5px] text-muted">
                        Godkänd {datumTid(c.approvedAt)} av {c.approvedBy}
                      </p>
                    </div>
                    <p className="tabular text-[14px] font-medium">{c.toPay < 0 ? `−${kr(Math.abs(c.toPay))}` : kr(c.toPay)}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {photos.length > 0 ? (
            <section className="rounded-2xl border border-line bg-card px-5 py-4" data-testid="customer-photos">
              <p className="flex items-center gap-2 text-[15px] font-semibold">
                <Camera className="size-4 text-muted" /> Bilder från uppdraget
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((p) => (
                  <figure key={p.id} className="overflow-hidden rounded-xl border border-line bg-canvas">
                    {/* eslint-disable-next-line @next/next/no-img-element -- data-URL från uppdraget */}
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

          {invoices.length > 0 ? (
            <section className="rounded-2xl border border-line bg-card px-5 py-4" data-testid="customer-invoices">
              <p className="flex items-center gap-2 text-[15px] font-semibold">
                <ReceiptText className="size-4 text-muted" /> Fakturor
              </p>
              <ul className="mt-3 divide-y divide-line/70">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/faktura/${inv.token}` as never} className="text-[14px] font-medium text-ink hover:underline">
                        {inv.type === "kredit" ? "Kreditfaktura" : "Faktura"}
                        {inv.number != null ? ` #${inv.number}` : ""}
                      </Link>
                      <p className="text-[12.5px] text-muted">
                        {inv.issuedAt ? `${datumNumeriskt(inv.issuedAt)} · ` : ""}
                        {inv.type !== "kredit" && inv.status !== "betald" ? `Förfaller ${datumNumeriskt(inv.dueDate)}` : inv.label}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-[14px] font-medium">{kr(inv.amount)}</p>
                      <p className={inv.status === "forfallen" ? "text-[12px] font-medium text-danger" : inv.status === "betald" ? "text-[12px] font-medium text-ok" : "text-[12px] text-soft"}>{inv.label}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {paymentStatus ? (
            <section className="rounded-2xl border border-line bg-card px-5 py-4" data-testid="customer-payment-status">
              <p className="flex items-center gap-2 text-[15px] font-semibold">
                <Wallet className="size-4 text-muted" /> Betalning
              </p>
              <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px] tabular">
                <div>
                  <dt className="text-muted">Fakturerat</dt>
                  <dd className="text-[15px] font-medium">{kr(paymentStatus.invoiced)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Betalt</dt>
                  <dd className="text-[15px] font-medium">{kr(paymentStatus.paid)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Kvar att betala</dt>
                  <dd className={`text-[15px] font-medium ${paymentStatus.overdue ? "text-danger" : ""}`}>{kr(paymentStatus.remaining)}</dd>
                </div>
              </dl>
              {paymentStatus.upcoming.length > 0 ? (
                <p className="mt-2 text-[12.5px] text-muted">
                  Kommande enligt betalplan: {paymentStatus.upcoming.map((u) => `${u.label} ${kr(u.amount)}`).join(" · ")}
                </p>
              ) : null}
            </section>
          ) : null}

          {view.closeoutSummary ? (
            <section className="rounded-2xl border border-line bg-card px-5 py-4" data-testid="customer-summary">
              <p className="flex items-center gap-2 text-[15px] font-semibold">
                <Printer className="size-4 text-muted" /> Slutunderlag
              </p>
              <p className="mt-1 text-[13px] text-soft">Sammanställning av uppdraget: vad som avtalats, godkänts och utförts.</p>
              <Link href={`/uppdrag-kund/${view.token}/slutunderlag` as never} className={`${buttonClasses("secondary", "sm")} mt-3`}>
                Öppna slutunderlaget
              </Link>
            </section>
          ) : null}
        </div>

        <PublicDocumentFooter sellerName={seller.name} sellerEmail={seller.email} className="mt-8" />
        <div className="h-10" />
      </main>
    </div>
  );
}

import { notFound } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { db } from "@/lib/store";
import { getInvoiceByToken, invoiceTotals, requireCustomer, isOverdue } from "@/lib/services/data";
import { kr, datumLang } from "@/lib/format";
import { InvoiceDocument } from "@/components/invoice-document";
import { resolveInvoiceView } from "@/lib/invoices/snapshot";
import { invoiceHeading } from "@/lib/invoices/display";
import { CompanyLogo } from "@/components/company-logo";
import { PrintButton } from "@/components/print-button";
import { ensurePublicPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/faktura/[token]">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("invoice", token))) return { title: "Faktura" };
  const invoice = getInvoiceByToken(token);
  // Utkast är inte publika – läck inte fakturanummer/avsändare via metadata.
  if (!invoice || invoice.status === "utkast") return { title: "Faktura" };
  const name = invoice.issuedSnapshot?.seller.name ?? db().settings.name;
  return { title: `${invoiceHeading(invoice)} – ${name}` };
}

export default async function PublicInvoicePage(props: PageProps<"/faktura/[token]">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("invoice", token))) notFound();
  const invoice = getInvoiceByToken(token);
  if (!invoice || invoice.status === "utkast") notFound();

  const data = db();
  const customer = requireCustomer(invoice.customerId);
  const view = resolveInvoiceView(invoice, { seller: data.settings, buyer: customer });
  const totals = invoiceTotals(view.invoice);

  return (
    <div className="min-h-dvh bg-canvas print:bg-white">
      <header className="border-b border-line bg-card/80 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <CompanyLogo company={view.seller} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold leading-tight">{view.seller.name}</p>
              <p className="truncate text-[12px] text-muted">
                {invoiceHeading(invoice)} till {view.buyer.name}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <p className="text-[15px] font-semibold tabular">{kr(totals.toPay)}</p>
            <PrintButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-5 print:max-w-none print:px-0 print:py-0">
        {invoice.status === "betald" ? (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-ok/25 bg-ok-soft/70 px-5 py-4">
            <BadgeCheck className="mt-0.5 size-5 shrink-0 text-ok" />
            <div>
              <p className="text-[15px] font-semibold text-ok">Fakturan är betald</p>
              <p className="text-[14px] text-soft">Tack för din betalning!</p>
            </div>
          </div>
        ) : isOverdue(invoice) ? (
          <div className="mb-6 rounded-2xl border border-danger/20 bg-danger-soft/50 px-5 py-4">
            <p className="text-[15px] font-semibold text-danger">Fakturan har förfallit</p>
            <p className="text-[14px] text-soft">
              Förfallodatum var {datumLang(view.invoice.dueDate)}. Betala {kr(totals.toPay)} till bankgiro{" "}
              {view.seller.bankgiro} med OCR {view.invoice.ocr}.
            </p>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-card print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
          <InvoiceDocument company={data.settings} customer={customer} invoice={invoice} />
        </div>

        <p className="mt-6 text-center text-[12px] text-muted print:hidden">
          Skickad med Driva · Frågor? Kontakta {view.seller.name} på {view.seller.email}
        </p>
      </main>
    </div>
  );
}

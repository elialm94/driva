import { notFound } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { db } from "@/lib/store";
import { getInvoiceByToken, invoiceTotals, requireCustomer, isOverdue } from "@/lib/services/data";
import { kr, datumLang } from "@/lib/format";
import { InvoiceDocument } from "@/components/invoice-document";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/faktura/[token]">) {
  const { token } = await props.params;
  const invoice = getInvoiceByToken(token);
  return { title: invoice ? `Faktura #${invoice.number} – ${db().settings.name}` : "Faktura" };
}

export default async function PublicInvoicePage(props: PageProps<"/faktura/[token]">) {
  const { token } = await props.params;
  const invoice = getInvoiceByToken(token);
  if (!invoice || invoice.status === "utkast") notFound();

  const data = db();
  const customer = requireCustomer(invoice.customerId);
  const totals = invoiceTotals(invoice);

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-accent text-[13px] font-bold text-white">
              {data.settings.logoInitials}
            </div>
            <div>
              <p className="text-[14px] font-semibold leading-tight">{data.settings.name}</p>
              <p className="text-[12px] text-muted">Faktura #{invoice.number} till {customer.name}</p>
            </div>
          </div>
          <p className="text-[15px] font-semibold tabular">{kr(totals.toPay)}</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-5">
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
              Förfallodatum var {datumLang(invoice.dueDate)}. Betala {kr(totals.toPay)} till bankgiro{" "}
              {data.settings.bankgiro} med OCR {invoice.ocr}.
            </p>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-card">
          <InvoiceDocument company={data.settings} customer={customer} invoice={invoice} />
        </div>

        <p className="mt-6 text-center text-[12px] text-muted">
          Skickad med Driva · Frågor? Kontakta {data.settings.name} på {data.settings.email}
        </p>
      </main>
    </div>
  );
}

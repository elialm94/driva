import { notFound } from "next/navigation";
import { db } from "@/lib/store";
import { getInvoiceByToken, requireCustomer } from "@/lib/services/data";
import { InvoiceDocument } from "@/components/invoice-document";
import { invoiceHeading } from "@/lib/invoices/display";
import { ensurePublicPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/faktura/[token]/pdf">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("invoice", token))) return { title: "Faktura" };
  const invoice = getInvoiceByToken(token);
  return { title: invoice ? `${invoiceHeading(invoice)} – utskrift` : "Faktura" };
}

/** Utskriftsvy. Snapshot + InvoiceDocument är den juridiska representationen (ingen sparad PDF-blob). */
export default async function InvoicePdfPage(props: PageProps<"/faktura/[token]/pdf">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("invoice", token))) notFound();
  const invoice = getInvoiceByToken(token);
  if (!invoice || invoice.status === "utkast") notFound();
  const data = db();
  const customer = requireCustomer(invoice.customerId);

  return (
    <div className="min-h-dvh bg-white print:bg-white">
      <InvoiceDocument company={data.settings} customer={customer} invoice={invoice} />
    </div>
  );
}

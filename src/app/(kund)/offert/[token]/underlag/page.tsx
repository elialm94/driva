import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { BackAnchor } from "@/components/back-link";
import { AcceptanceCertificate } from "@/components/acceptance-certificate";
import { buttonClasses } from "@/components/ui";
import {
  CERTIFICATE_PRINT_LABEL,
  CERTIFICATE_TITLE,
  getAcceptanceCertificateByToken,
} from "@/lib/quote-acceptance-certificate";
import { ensurePublicPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: CERTIFICATE_TITLE };

/**
 * Publikt intyg om offertgodkännandet: vem, vilken offert, belopp, tid och
 * hur det gick till. Tekniska hashar ligger bakom Teknisk kontroll.
 * IP och enhet visas bara för företagaren i appen.
 */
export default async function AcceptanceEvidencePage(props: PageProps<"/offert/[token]/underlag">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("quote", token))) notFound();
  const cert = getAcceptanceCertificateByToken(token);
  if (!cert) notFound();

  return (
    <div className="min-h-dvh bg-canvas">
      <main className="mx-auto max-w-2xl px-5 py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <BackAnchor href={`/offert/${cert.quoteToken}`} label={`Offert #${cert.quoteNumber}`} />
          <a
            href={`/offert/${cert.quoteToken}/underlag/pdf`}
            target="_blank"
            rel="noreferrer"
            className={buttonClasses("primary", "sm")}
          >
            <Printer className="size-3.5" />
            {CERTIFICATE_PRINT_LABEL}
          </a>
        </div>

        <div className="rounded-3xl border border-line bg-card px-7 py-8 shadow-card sm:px-9 sm:py-10">
          <AcceptanceCertificate cert={cert} variant="web" />
        </div>
      </main>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/auth-actions";
import { getSessionUser } from "@/lib/auth/session";
import { termsGateContent, termsGateStatus } from "@/lib/legal/acceptance";
import { formatSwedishDate } from "@/lib/legal/documents";
import { isSupabaseMode } from "@/lib/storage/config";
import { AcceptTermsForm } from "./accept-form";
import { FervaMark } from "@/components/ferva-mark";

export const metadata: Metadata = { title: "Godkänn villkoren – Ferva" };
export const dynamic = "force-dynamic";

function safeNext(raw: unknown): string {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/godkann-villkor") ? v : "/";
}

/**
 * Grinden för nytt aktivt godkännande efter väsentlig villkorsändring (ny
 * huvudversion). Ligger utanför appskalet: ingen företagsdata renderas innan
 * användaren godkänt. Redan godkänd version → vidare direkt.
 */
export default async function GodkannVillkorPage(props: { searchParams: Promise<{ next?: string }> }) {
  const params = await props.searchParams;
  const next = safeNext(params.next);
  if (!isSupabaseMode()) redirect(next);
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/godkann-villkor")}`);
  const status = await termsGateStatus();
  if (!status.required) redirect(next);
  const content = termsGateContent();

  return (
    <main className="min-h-dvh bg-canvas px-4 py-10 text-ink sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FervaMark size={24} />
            <span className="text-[15px] font-semibold tracking-tight">Ferva</span>
          </span>
          <span className="text-[13px] text-muted">{user.email}</span>
        </div>
        <h1 className="text-[26px] font-semibold tracking-tight">
          {status.acceptedVersion ? "Villkoren har uppdaterats" : "Godkänn villkoren"}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-soft">
          {status.acceptedVersion
            ? `Du godkände tidigare version ${status.acceptedVersion}. För att fortsätta använda Ferva behöver du godkänna version ${content.version}, som gäller från ${formatSwedishDate(content.effectiveFrom)}.`
            : `Innan du fortsätter behöver du godkänna Fervas villkor (version ${content.version}, gäller från ${formatSwedishDate(content.effectiveFrom)}).`}
        </p>

        <div className="card mt-6 space-y-5 p-5 sm:p-7">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Vad som ändrats</p>
            <p className="mt-1.5 text-[15px] leading-relaxed text-soft">{content.changeSummary}</p>
          </div>
          <ul className="space-y-1 text-[14px]">
            <li>
              <Link href={content.termsPath} target="_blank" className="font-medium text-accent underline">
                Läs de allmänna villkoren
              </Link>
            </li>
            <li>
              <Link href={content.privacyPath} target="_blank" className="font-medium text-accent underline">
                Läs integritetspolicyn
              </Link>
            </li>
            <li>
              <Link href={content.dpaPath} target="_blank" className="font-medium text-accent underline">
                Läs personuppgiftsbiträdesavtalet
              </Link>
            </li>
          </ul>
          <AcceptTermsForm next={next} version={content.version} />
        </div>

        <form action={logoutAction} className="mt-6 text-center">
          <button type="submit" className="text-[13px] text-muted underline hover:text-ink">
            Vill du inte godkänna? Logga ut
          </button>
        </form>
        <p className="mt-2 text-center text-[12.5px] text-muted">
          Utan godkännande kan du inte använda tjänsten, men dina uppgifter finns kvar och kan exporteras via supporten.
        </p>
      </div>
    </main>
  );
}

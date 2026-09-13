import { Suspense } from "react";
import Link from "next/link";
import { BookOpenCheck } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { SupportForm } from "@/components/support-form";
import { ensurePageBusiness } from "@/lib/auth/session";
import { VERDICT_TITLE, businessEligibility } from "@/lib/support/eligibility";
import { db } from "@/lib/store";

export const metadata = { title: "Hjälp & support" };

export default async function SupportPage() {
  await ensurePageBusiness();
  const eligibility = businessEligibility(db().settings);
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Hjälp & support" subtitle="Beskriv vad du behöver hjälp med." />
      <Link
        href="/omfattning"
        className="mb-5 flex items-start gap-3 rounded-xl border border-line bg-card px-4 py-3 text-[13px] text-ink transition-colors hover:border-muted/60"
        data-support-scope-link
      >
        <BookOpenCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <span>
          <span className="font-medium">Vad Ferva stödjer</span>
          <span className="block text-soft">
            Supportmatrisen: bolag, moms, ROT/RUT, lön, bokslut och vad som kräver konsult. För ditt företag just nu:{" "}
            {VERDICT_TITLE[eligibility.verdict].toLocaleLowerCase("sv")}.
          </span>
        </span>
      </Link>
      <Suspense fallback={null}>
        <SupportForm />
      </Suspense>
    </div>
  );
}

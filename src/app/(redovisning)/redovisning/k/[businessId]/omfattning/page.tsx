import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { EligibilityVerdict } from "@/components/scope-eligibility";
import { ScopeApprovalPanel } from "@/components/scope-approval-panel";
import { SupportMatrixLegend, SupportMatrixView } from "@/components/support-matrix-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";
import { wsCan } from "@/lib/accounting-workspace/shared";
import { businessEligibility, entryStatusFor, scopeApproval, SCOPE_QUESTIONS } from "@/lib/support/eligibility";
import { db } from "@/lib/store";

export const metadata = { title: "Produktomfattning" };

/**
 * Konsultvyn för supportmatrisen: vad klienten svarade, hur bolaget bedöms
 * och konsultens godkännanden av konsultfall. Bara redovisningskonsulten
 * (approve_scope) kan godkänna – revisorn ser status.
 */
export default async function AccountantOmfattningPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  const settings = db().settings;
  const eligibility = businessEligibility(settings);
  const canApprove = wsCan(ws, "approve_scope");
  const flags = settings.scope?.flags ?? [];
  const answered = SCOPE_QUESTIONS.filter((q) => flags.includes(q.flag));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Produktomfattning"
        subtitle={`Vad ${ws.businessName} svarade när bolaget skapades, hur Ferva bedömer det och vilka konsultfall du har godkänt.`}
      />

      <EligibilityVerdict eligibility={eligibility} />

      <section className="rounded-2xl border border-line bg-card px-4 py-3.5">
        <h2 className="text-[14px] font-semibold text-ink">Klientens svar</h2>
        {settings.scope ? (
          <>
            <p className="mt-1 text-[12px] text-muted">
              Matris {settings.scope.matrixVersion || "okänd"} · svarade {settings.scope.assessedAt.slice(0, 10) || "okänt datum"} ·
              företagsform {settings.companyForm === "enskild" ? "enskild firma" : "aktiebolag"}
            </p>
            {answered.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-soft">
                {answered.map((q) => (
                  <li key={q.flag}>{q.label}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-soft">Inget av konsult- eller undantagsfallen markerades.</p>
            )}
          </>
        ) : (
          <p className="mt-2 text-[13px] text-soft">
            Bolaget skapades innan omfattningsfrågorna fanns. Bedömningen bygger bara på företagsformen tills ägaren
            svarar under Inställningar → Företag.
          </p>
        )}
      </section>

      <div>
        <SupportMatrixLegend />
      </div>

      <SupportMatrixView
        showSources={false}
        statusFor={(entry) => entryStatusFor(settings, entry.id)}
        extra={(entry) =>
          entry.level === "consultant" ? (
            <ScopeApprovalPanel
              businessId={businessId}
              entry={entry}
              approval={scopeApproval(settings, entry.id)}
              canApprove={canApprove}
            />
          ) : null
        }
      />

      <p className="text-[13px] text-muted">
        Källor, giltighetsdatum och ägare för varje post finns på{" "}
        <Link href="/omfattning" className="font-medium text-accent hover:underline">
          Vad Ferva stödjer
        </Link>
        .
      </p>
    </div>
  );
}

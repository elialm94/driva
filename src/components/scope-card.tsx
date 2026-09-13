"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { updateScopeFlagsAction } from "@/app/omfattning-actions";
import { assessEligibility, scopeApproval } from "@/lib/support/eligibility";
import type { BusinessScope, CompanySettings, ScopeFlag } from "@/lib/types";
import { EligibilityVerdict, ScopeQuestions } from "./scope-eligibility";
import { buttonClasses, Card } from "./ui";

const labelCls = "mb-1 block text-[13px] font-medium text-soft";
const hintCls = "mt-1 text-[12px] text-muted";

/**
 * Inställningar → Företag → Vad Ferva stödjer. Ägaren ser bedömningen för
 * sitt bolag, kan ändra svaren och ser vilka konsultfall konsulten godkänt.
 * Godkännandet självt görs av konsulten i redovisningsytan – inte här.
 */
export function ScopeCard({
  companyForm,
  scope,
}: {
  companyForm: CompanySettings["companyForm"];
  scope: BusinessScope | undefined;
}) {
  const router = useRouter();
  const [flags, setFlags] = useState<ScopeFlag[]>(scope?.flags ?? []);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = companyForm ?? "ab";
  const eligibility = assessEligibility({ companyForm: form, flags });
  const settingsLike = { companyForm: form, scope };
  const dirty = (scope?.flags ?? []).join(",") !== flags.join(",");

  function submit() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateScopeFlagsAction(flags);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-4" data-scope-card>
      <div>
        <h3 className="text-[15px] font-semibold text-ink">Vad Ferva stödjer för ditt företag</h3>
        <p className={hintCls}>
          Samma frågor som när företaget skapades. Ändra om något inte stämmer längre – servern använder svaren för att
          stoppa fall Ferva inte har regler för.{" "}
          <Link href="/omfattning" className="font-medium text-accent hover:underline">
            Hela supportmatrisen
          </Link>
          .
        </p>
      </div>

      <EligibilityVerdict eligibility={eligibility} />

      {eligibility.consultant.length ? (
        <ul className="space-y-1.5 text-[13px]" data-scope-approvals>
          {eligibility.consultant.map((entry) => {
            const approval = scopeApproval(settingsLike, entry.id);
            return (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-xl bg-canvas px-3 py-2">
                <span className="font-medium text-ink">{entry.label}</span>
                {approval ? (
                  <span className="text-ok">
                    Godkänt av {approval.approvedBy.name || approval.approvedBy.email} {approval.approvedAt.slice(0, 10)}
                  </span>
                ) : (
                  <span className="text-soft">Väntar på konsultens godkännande</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <ScopeQuestions
        flags={flags}
        onChange={(next) => {
          setFlags(next);
          setSaved(false);
        }}
        legend="Stämmer något av det här in på företaget?"
        helper="Kryssa i det som gäller. Godkännanden från konsulten påverkas inte av att du ändrar svaren."
        legendClassName={labelCls}
        helperClassName={hintCls}
        disabled={pending}
      />

      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={pending || !dirty} className={buttonClasses("primary", "md")}>
          {pending ? "Sparar …" : "Spara svaren"}
        </button>
        {saved && !dirty ? (
          <span className="inline-flex items-center gap-1 text-[13px] text-ok">
            <Check className="size-4" aria-hidden /> Sparat
          </span>
        ) : null}
      </div>
    </Card>
  );
}

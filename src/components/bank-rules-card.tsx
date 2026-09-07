"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { Badge, buttonClasses, Card, cx } from "./ui";
import { useToast } from "./toast";
import { forgetBankCounterpartRuleAction } from "@/app/bokforing-actions";
import { datumKort } from "@/lib/format";
import type { BankCounterpartRuleView } from "@/lib/services/bank-booking";

/**
 * Det Driva lärt sig om motparterna i banken – synligt och ångringsbart.
 * En regel som bokför fel skulle annars göra det tyst varje månad.
 */
export function BankRulesCard({ rules }: { rules: BankCounterpartRuleView[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (rules.length === 0) return null;

  function forget(rule: BankCounterpartRuleView) {
    setError(null);
    startTransition(async () => {
      const result = await forgetBankCounterpartRuleAction(rule.counterpart);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: `Regeln för ${rule.counterpart} är borttagen`, text: "Nästa transaktion från motparten får du välja typ för själv.", tone: "ok" });
      router.refresh();
    });
  }

  return (
    <Card className="px-5 py-4" data-bank-rules>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" aria-hidden />
          <p className="text-[14px] font-medium text-ink">
            Driva har lärt sig {rules.length === 1 ? "1 motpart" : `${rules.length} motparter`}
          </p>
        </div>
        <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Dölj" : "Visa reglerna"}
        </button>
      </div>
      <p className="mt-1 text-[13px] text-muted">
        Första gången du bokför en motpart föreslås samma sak nästa gång; från andra gången bokförs den automatiskt. Ta
        bort en regel så får du välja själv igen.
      </p>
      {open ? (
        <ul className="mt-3 divide-y divide-line/70 rounded-2xl border border-line/80" aria-label="Lärda bankregler">
          {rules.map((rule) => (
            <li key={rule.key} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink">
                  {rule.counterpart} <span className="font-normal text-muted">→ {rule.kindLabel}</span>
                </p>
                <p className="text-muted">
                  {rule.count === 1 ? "1 gång" : `${rule.count} gånger`} · senast {datumKort(rule.lastUsedAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={rule.automatic ? "ok" : "info"}>{rule.automatic ? "Automatiskt" : "Förslag"}</Badge>
                <button
                  type="button"
                  className={cx(buttonClasses("ghost", "sm"), "px-2")}
                  disabled={pending}
                  onClick={() => forget(rule)}
                  aria-label={`Ta bort regeln för ${rule.counterpart}`}
                >
                  <X className="size-3.5" /> Ta bort
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="mt-2 text-[13px] font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

import { ReceiptText, ShieldCheck } from "lucide-react";
import { db } from "@/lib/store";
import { kr, datumKort, datumTid } from "@/lib/format";
import { BAS } from "@/lib/bas";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { UndoBookingButton } from "@/components/bokforing-widgets";
import { BokforingAdvancedTabs } from "@/components/bokforing-advanced-nav";
import { verificationLabel } from "@/lib/accounting/engine";
import type { Verification } from "@/lib/types";

export const metadata = { title: "Verifikationer" };

const SOURCE_LABEL: Record<string, string> = {
  kundfaktura: "kundfaktura",
  betalning: "inbetalning",
  utgift: "kvitto/utgift",
  leverantorsfaktura: "leverantörsfaktura",
  banktransaktion: "banktransaktion",
  rattelse: "rättelse",
  avskrivning: "avskrivning",
  periodisering: "periodisering",
  moms: "momsredovisning",
  bokslut: "bokslut",
  ingaende_balans: "ingående balans",
  manuell: "manuell",
};

function creatorLabel(v: Verification): string {
  return v.createdBy === "auto" ? "automatiskt av Driva" : v.createdBy === "assistent" ? "av assistenten" : "av dig";
}

export default function VerifikationerPage() {
  const data = db();
  const verifications = [...data.verifications].sort((a, b) => b.number - a.number);
  const byId = new Map(verifications.map((v) => [v.id, v]));

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<BackLink fallbackHref="/bokforing" fallbackLabel="Bokföring" />}
        title="Verifikationer"
        subtitle={`${verifications.length} bokförda händelser. Varje verifikation är låst när den bokförts – rättelser blir nya verifikationer.`}
      />
      <BokforingAdvancedTabs />

      {verifications.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="Inga verifikationer ännu"
          text="När du skickar fakturor eller får utgifter bokförs de automatiskt här."
        />
      ) : (
        <Card className="divide-y divide-line/70">
          {verifications.map((v) => {
            const total = v.entries.reduce((s, e) => s + e.debit, 0);
            const corrects = v.correctsVerificationId ? byId.get(v.correctsVerificationId) : undefined;
            const correctedBy = v.correctedByVerificationId ? byId.get(v.correctedByVerificationId) : undefined;
            const expense =
              v.source.type === "utgift" ? data.expenses.find((e) => e.id === (v.source as { id: string }).id) : undefined;
            const canUndo = expense && expense.status === "bokford" && expense.verificationId === v.id && !correctedBy;
            return (
              <details key={v.id} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-3.5 transition-colors hover:bg-canvas/60">
                  <span className="w-14 shrink-0 font-mono text-[12px] font-medium text-muted">{verificationLabel(v)}</span>
                  <span className="flex-1 truncate text-[14px] font-medium">
                    {v.description}
                    {correctedBy ? <span className="ml-2 text-[12px] font-normal text-warn">rättad av {verificationLabel(correctedBy)}</span> : null}
                  </span>
                  <span className="hidden text-[13px] text-muted sm:block">{datumKort(v.date)}</span>
                  <span className="w-24 text-right text-[14px] font-medium tabular">{kr(total)}</span>
                  <Badge tone={v.createdBy === "auto" ? "accent" : "neutral"} className="hidden sm:inline-flex">
                    {v.createdBy === "auto" ? "Auto" : v.createdBy === "assistent" ? "Assistent" : "Manuell"}
                  </Badge>
                </summary>
                <div className="border-t border-line/60 bg-canvas/50 px-5 py-3.5">
                  {v.explanation ? (
                    <p className="mb-3 rounded-xl bg-accent-soft/60 px-4 py-2.5 text-[13px] leading-relaxed text-ink">
                      <span className="font-semibold">Varför bokfördes detta? </span>
                      {v.explanation}
                    </p>
                  ) : null}
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                        <th className="pb-1.5 font-semibold">Konto</th>
                        <th className="pb-1.5 text-right font-semibold">Debet</th>
                        <th className="pb-1.5 text-right font-semibold">Kredit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.entries.map((e, i) => (
                        <tr key={i} className="border-t border-line/50">
                          <td className="py-1.5 pr-3">
                            <span className="font-mono text-[12px] text-muted">{e.account}</span>{" "}
                            <span className="text-soft">{BAS[e.account] ?? e.accountName}</span>
                          </td>
                          <td className="py-1.5 text-right tabular">{e.debit ? kr(e.debit) : ""}</td>
                          <td className="py-1.5 text-right tabular">{e.credit ? kr(e.credit) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] text-muted">
                      Bokförd {datumTid(v.postedAt ?? v.createdAt)} · {creatorLabel(v)} · underlag:{" "}
                      {SOURCE_LABEL[v.source.type] ?? v.source.type}
                      {corrects ? ` · rättar ${verificationLabel(corrects)}` : ""} · säkerhet: {v.confidence}
                    </p>
                    {canUndo ? <UndoBookingButton expenseId={expense.id} /> : null}
                  </div>
                </div>
              </details>
            );
          })}
        </Card>
      )}

      <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Bokförda verifikationer kan aldrig ändras eller tas bort. Om något blev fel skapas en rättelseverifikation som
          återför originalet – båda står kvar i historiken.{" "}
          <a href="/api/bokforing/export?typ=verifikationer" className="text-accent hover:underline">
            Exportera CSV
          </a>
        </span>
      </p>
    </div>
  );
}

import Link from "next/link";
import { BadgeCheck, CircleHelp, Landmark, ReceiptText, ShieldCheck, Sparkles } from "lucide-react";
import { db } from "@/lib/store";
import { momsForCurrentPeriod } from "@/lib/services/finance";
import { kr, datumKort, datumLang, datumTid } from "@/lib/format";
import { BAS } from "@/lib/bas";
import { Card, PageHeader, SectionTitle, Badge, EmptyState, cx } from "@/components/ui";
import { ExpenseQuestionButtons, UploadReceiptButton } from "@/components/money-widgets";

export const metadata = { title: "Bokföring" };

export default function BookkeepingPage() {
  const data = db();
  const moms = momsForCurrentPeriod();

  const questions = data.expenses.filter((e) => e.status === "behover_svar");
  const missingReceipts = data.expenses.filter((e) => e.status === "saknar_kvitto");
  const verifications = [...data.verifications].sort((a, b) => b.number - a.number);
  const unreconciled = data.bankTransactions.filter((t) => t.status !== "bokford").length;

  // Enkel resultaträkning ur verifikationerna (i år)
  const year = new Date().getFullYear();
  let revenue = 0;
  let costs = 0;
  for (const v of data.verifications) {
    if (!v.date.startsWith(String(year))) continue;
    for (const e of v.entries) {
      if (e.account >= 3000 && e.account <= 3799) revenue += e.credit - e.debit;
      if (e.account >= 4000 && e.account <= 7999) costs += e.debit - e.credit;
    }
  }
  const result = revenue - costs;

  const allGood = questions.length === 0 && missingReceipts.length === 0;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Bokföring"
        subtitle="Sköts automatiskt i bakgrunden – du behöver bara svara när något är oklart."
      />

      {/* Status */}
      <Card className={cx("mb-8 px-6 py-5", allGood ? "border-ok/20" : "border-warn/25")}>
        <div className="flex items-start gap-4">
          <div className={cx("flex size-11 shrink-0 items-center justify-center rounded-2xl", allGood ? "bg-ok-soft" : "bg-warn-soft")}>
            {allGood ? <BadgeCheck className="size-5.5 text-ok" /> : <CircleHelp className="size-5.5 text-warn" />}
          </div>
          <div className="flex-1">
            <h2 className="text-[17px] font-semibold tracking-tight">
              {allGood
                ? "Bokföringen är i ordning"
                : `${questions.length + missingReceipts.length} sak${questions.length + missingReceipts.length > 1 ? "er" : ""} behöver dig`}
            </h2>
            <p className="mt-0.5 text-[14px] text-soft">
              {verifications.length} verifikationer i år · {unreconciled === 0 ? "banken är avstämd" : `${unreconciled} banktransaktion${unreconciled > 1 ? "er" : ""} väntar på underlag`} ·
              allt bokförs enligt BAS-kontoplanen med full historik.
            </p>
          </div>
        </div>
      </Card>

      <div className="mb-10 grid gap-4 sm:grid-cols-2">
        {/* Moms */}
        <Card className="px-6 py-5">
          <div className="flex items-center gap-2.5">
            <Landmark className="size-4.5 text-muted" />
            <h3 className="text-[15px] font-semibold">Moms att betala</h3>
          </div>
          <p className="mt-3 text-[28px] font-semibold tracking-tight tabular">{kr(Math.max(0, moms.attBetala))}</p>
          <p className="text-[13px] text-soft">
            {moms.namn} · deklareras och betalas senast <span className="font-medium text-ink">{datumLang(moms.due)}</span>
          </p>
          <details className="group mt-4">
            <summary className="cursor-pointer list-none text-[13px] font-medium text-accent hover:underline">
              Vad ligger bakom siffran?
            </summary>
            <div className="mt-3 space-y-1.5 rounded-xl bg-canvas/70 px-4 py-3 text-[13px]">
              <div className="flex justify-between">
                <span className="text-soft">Utgående moms (på dina fakturor)</span>
                <span className="font-medium tabular">{kr(moms.utgaende)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-soft">Ingående moms (på dina inköp)</span>
                <span className="font-medium tabular">−{kr(moms.ingaende)}</span>
              </div>
              <div className="flex justify-between border-t border-line pt-1.5">
                <span className="font-medium">Att betala till Skatteverket</span>
                <span className="font-semibold tabular">{kr(Math.max(0, moms.attBetala))}</span>
              </div>
            </div>
          </details>
        </Card>

        {/* Resultat */}
        <Card className="px-6 py-5">
          <div className="flex items-center gap-2.5">
            <ReceiptText className="size-4.5 text-muted" />
            <h3 className="text-[15px] font-semibold">Resultat i år</h3>
          </div>
          <p className="mt-3 text-[28px] font-semibold tracking-tight tabular">{kr(result)}</p>
          <p className="text-[13px] text-soft">före skatt, enligt bokföringen</p>
          <div className="mt-4 space-y-1.5 rounded-xl bg-canvas/70 px-4 py-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-soft">Intäkter</span>
              <span className="font-medium tabular">{kr(revenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-soft">Kostnader</span>
              <span className="font-medium tabular">−{kr(costs)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5">
              <span className="font-medium">Resultat</span>
              <span className="font-semibold tabular">{kr(result)}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Frågor */}
      {questions.length > 0 || missingReceipts.length > 0 ? (
        <section className="mb-10">
          <SectionTitle
            right={
              <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                <Sparkles className="size-3.5" /> AI:n bokför resten automatiskt
              </span>
            }
          >
            Behöver ett svar från dig
          </SectionTitle>
          <div className="space-y-3">
            {questions.map((e) => (
              <Card key={e.id} className="px-5 py-4">
                <p className="text-[15px] font-medium">{e.question?.text ?? `Vad gällde köpet hos ${e.supplier}?`}</p>
                <p className="mt-0.5 text-[13px] text-soft">
                  {e.supplier} · {kr(e.amount)} · {datumKort(e.date)}
                </p>
                <div className="mt-3">
                  <ExpenseQuestionButtons expenseId={e.id} options={e.question?.options ?? []} />
                </div>
              </Card>
            ))}
            {missingReceipts.map((e) => (
              <Card key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="text-[15px] font-medium">
                    Vi hittar inget kvitto för köpet på {kr(e.amount)} hos {e.supplier}
                  </p>
                  <p className="mt-0.5 text-[13px] text-soft">
                    {datumKort(e.date)} · utan kvitto kan momsen ({kr(e.vatAmount)}) inte lyftas
                  </p>
                </div>
                <UploadReceiptButton expenseId={e.id} />
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* Verifikationer */}
      <section className="mb-10">
        <SectionTitle
          right={
            <span className="inline-flex items-center gap-1 text-[12px] text-muted">
              <ShieldCheck className="size-3.5" /> Fullständig audit trail
            </span>
          }
        >
          Verifikationer
        </SectionTitle>
        {verifications.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="Inga verifikationer ännu"
            text="När du skickar fakturor eller får utgifter bokförs de automatiskt här."
          />
        ) : (
          <Card className="divide-y divide-line/70">
            {verifications.slice(0, 30).map((v) => {
              const total = v.entries.reduce((s, e) => s + e.debit, 0);
              return (
                <details key={v.id} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-3.5 transition-colors hover:bg-canvas/60">
                    <span className="w-14 shrink-0 font-mono text-[12px] font-medium text-muted">V{v.number}</span>
                    <span className="flex-1 truncate text-[14px] font-medium">{v.description}</span>
                    <span className="hidden text-[13px] text-muted sm:block">{datumKort(v.date)}</span>
                    <span className="w-24 text-right text-[14px] font-medium tabular">{kr(total)}</span>
                    <Badge tone={v.createdBy === "auto" ? "accent" : "neutral"} className="hidden sm:inline-flex">
                      {v.createdBy === "auto" ? "Auto" : v.createdBy === "assistent" ? "Assistent" : "Manuell"}
                    </Badge>
                  </summary>
                  <div className="border-t border-line/60 bg-canvas/50 px-5 py-3.5">
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
                    <p className="mt-2 text-[11px] text-muted">
                      Skapad {datumTid(v.createdAt)} ·{" "}
                      {v.createdBy === "auto" ? "automatiskt av Driva" : v.createdBy === "assistent" ? "av assistenten" : "manuellt"}
                      {v.source.type !== "manuell" ? ` · underlag: ${v.source.type}` : ""} · säkerhet: {v.confidence}
                    </p>
                  </div>
                </details>
              );
            })}
          </Card>
        )}
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Du behöver aldrig röra kontona själv. Driva bokför enligt BAS-kontoplanen och sparar underlag för varje
          verifikation. Rättelser görs alltid som nya verifikationer – inget skrivs över.{" "}
          <Link href="/pengar?flik=bank" className="text-accent hover:underline">
            Se bankavstämningen
          </Link>
          .
        </p>
      </section>
    </div>
  );
}

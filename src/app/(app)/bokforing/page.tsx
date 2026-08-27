import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpenText,
  CalendarCheck2,
  CircleHelp,
  Landmark,
  Lock,
  ReceiptText,
  Scale,
  ShieldCheck,
  Sparkles,
  Table2,
} from "lucide-react";
import { db } from "@/lib/store";
import { kr, datumKort, datumLang } from "@/lib/format";
import { Card, PageHeader, SectionTitle, cx } from "@/components/ui";
import { ExpenseQuestionButtons, UploadReceiptButton } from "@/components/money-widgets";
import { bankReconciliation } from "@/lib/accounting/reconciliation";
import { currentVatPosition } from "@/lib/accounting/vat";
import { lockedThrough } from "@/lib/accounting/fiscal";
import { resultatrapport } from "@/lib/accounting/ledger";

export const metadata = { title: "Bokföring" };

const SUBVIEWS = [
  { href: "/bokforing/verifikationer", label: "Verifikationer", desc: "Varje bokförd händelse, med förklaring", icon: ReceiptText },
  { href: "/bokforing/huvudbok", label: "Huvudbok", desc: "Konto för konto med löpande saldo", icon: BookOpenText },
  { href: "/bokforing/saldobalans", label: "Saldobalans", desc: "Alla konton: IB, debet, kredit, UB", icon: Table2 },
  { href: "/bokforing/resultat", label: "Resultat", desc: "Omsättning, kostnader och resultat", icon: Sparkles },
  { href: "/bokforing/balans", label: "Balans", desc: "Tillgångar, eget kapital och skulder", icon: Scale },
  { href: "/bokforing/moms", label: "Moms", desc: "Momsperioder och deklarationsunderlag", icon: Landmark },
  { href: "/bokforing/bokslut", label: "Bokslut", desc: "Årsavslut, inventarier och årsredovisning", icon: CalendarCheck2 },
];

export default function BookkeepingPage() {
  const data = db();
  const moms = currentVatPosition();
  const momsDue = moms.dueDate;
  const recon = bankReconciliation();
  const lock = lockedThrough();
  const rr = resultatrapport();

  const questions = data.expenses.filter((e) => e.status === "behover_svar");
  const missingReceipts = data.expenses.filter((e) => e.status === "saknar_kvitto");
  const needsHelp = questions.length + missingReceipts.length + recon.unhandled.length;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const autoBooked = data.verifications.filter((v) => v.createdBy === "auto" && v.createdAt >= thirtyDaysAgo).length;

  const allGood = needsHelp === 0;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Bokföring"
        subtitle="Sköts automatiskt i bakgrunden – du behöver bara svara när något är oklart."
      />

      {/* Status: allt-i-ordning eller undantag */}
      <Card className={cx("mb-6 px-6 py-5", allGood ? "border-ok/20" : "border-warn/25")}>
        <div className="flex items-start gap-4">
          <div className={cx("flex size-11 shrink-0 items-center justify-center rounded-2xl", allGood ? "bg-ok-soft" : "bg-warn-soft")}>
            {allGood ? <BadgeCheck className="size-5.5 text-ok" /> : <CircleHelp className="size-5.5 text-warn" />}
          </div>
          <div className="flex-1">
            <h2 className="text-[17px] font-semibold tracking-tight">
              {allGood ? "Bokföringen är uppdaterad ✓" : `${needsHelp} sak${needsHelp > 1 ? "er" : ""} behöver din hjälp`}
            </h2>
            <p className="mt-0.5 text-[14px] text-soft">
              {autoBooked} händelser bokförda automatiskt senaste månaden
              {recon.ok && recon.reconciledThrough ? ` · banken avstämd till ${datumKort(recon.reconciledThrough)}` : ""}
              {" · nästa moms "}
              {datumKort(momsDue)}
            </p>
            {lock ? (
              <p className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] text-muted">
                <Lock className="size-3.5" /> Bokföringen är låst till och med {datumLang(lock)}.
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Behöver din hjälp */}
      {needsHelp > 0 ? (
        <section className="mb-8">
          <SectionTitle
            right={
              <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                <Sparkles className="size-3.5" /> Driva bokför resten automatiskt
              </span>
            }
          >
            Behöver din hjälp
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
            {recon.unhandled
              .filter((t) => !data.expenses.some((e) => e.bankTransactionId === t.id && e.status !== "bokford"))
              .map((t) => (
                <Card key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="text-[15px] font-medium">
                      {t.amount > 0 ? "Inbetalning" : "Betalning"} på {kr(Math.abs(t.amount))} – {t.counterpart}
                    </p>
                    <p className="mt-0.5 text-[13px] text-soft">
                      {datumKort(t.date)} · {t.description} · behöver matchas eller bokföras
                    </p>
                  </div>
                  <Link href="/pengar?flik=bank" className="text-[13px] font-medium text-accent hover:underline">
                    Hantera i banken
                  </Link>
                </Card>
              ))}
          </div>
        </section>
      ) : null}

      {/* Moms + Resultat */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Card className="px-6 py-5">
          <div className="flex items-center gap-2.5">
            <Landmark className="size-4.5 text-muted" />
            <h3 className="text-[15px] font-semibold">Moms {moms.attBetala >= 0 ? "att betala" : "att få tillbaka"}</h3>
          </div>
          <p className="mt-3 text-[28px] font-semibold tracking-tight tabular">{kr(Math.abs(moms.attBetala))}</p>
          <p className="text-[13px] text-soft">
            {moms.period.label} · deklareras senast <span className="font-medium text-ink">{datumLang(momsDue)}</span>
          </p>
          <div className="mt-4 space-y-1.5 rounded-xl bg-canvas/70 px-4 py-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-soft">Utgående moms (på dina fakturor)</span>
              <span className="font-medium tabular">{kr(moms.utgaende)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-soft">Ingående moms (på dina inköp)</span>
              <span className="font-medium tabular">−{kr(moms.ingaende)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5">
              <span className="font-medium">{moms.attBetala >= 0 ? "Att betala till Skatteverket" : "Att få tillbaka"}</span>
              <span className="font-semibold tabular">{kr(Math.abs(moms.attBetala))}</span>
            </div>
          </div>
          <Link href="/bokforing/moms" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
            Momsöversikt och deklaration <ArrowRight className="size-3.5" />
          </Link>
        </Card>

        <Card className="px-6 py-5">
          <div className="flex items-center gap-2.5">
            <ReceiptText className="size-4.5 text-muted" />
            <h3 className="text-[15px] font-semibold">Resultat i år</h3>
          </div>
          <p className="mt-3 text-[28px] font-semibold tracking-tight tabular">{kr(rr.resultatForeSkatt)}</p>
          <p className="text-[13px] text-soft">före skatt, enligt bokföringen</p>
          <div className="mt-4 space-y-1.5 rounded-xl bg-canvas/70 px-4 py-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-soft">Omsättning</span>
              <span className="font-medium tabular">{kr(rr.omsattning)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-soft">Kostnader</span>
              <span className="font-medium tabular">−{kr(rr.kostnaderSumma)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5">
              <span className="font-medium">Resultat</span>
              <span className="font-semibold tabular">{kr(rr.resultatForeSkatt)}</span>
            </div>
          </div>
          <Link href="/bokforing/resultat" className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
            Full resultatrapport <ArrowRight className="size-3.5" />
          </Link>
        </Card>
      </div>

      {/* Bankavstämning */}
      <Card className="mb-8 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold">Bankavstämning</h3>
            <p className="mt-0.5 text-[13px] text-soft">
              {recon.ok
                ? `✓ Avstämt${recon.reconciledThrough ? ` till ${datumLang(recon.reconciledThrough)}` : ""} – banken och bokföringen visar samma sak.`
                : recon.unhandled.length > 0
                  ? `${recon.unhandled.length} transaktion${recon.unhandled.length > 1 ? "er" : ""} behöver hanteras.`
                  : `Avvikelse ${kr(recon.unexplained)} som behöver granskas.`}
            </p>
          </div>
          <div className="flex items-center gap-6 text-[13px]">
            <div className="text-right">
              <p className="text-muted">Banken</p>
              <p className="font-semibold tabular">{kr(recon.bankBalance)}</p>
            </div>
            <div className="text-right">
              <p className="text-muted">Bokföringen (1930)</p>
              <p className="font-semibold tabular">{kr(recon.ledgerBalance)}</p>
            </div>
            <div className="text-right">
              <p className="text-muted">Skillnad</p>
              <p className={cx("font-semibold tabular", recon.difference === 0 ? "text-ok" : "text-warn")}>{kr(recon.difference)}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Visa bokföring */}
      <section>
        <SectionTitle
          right={
            <span className="inline-flex items-center gap-1 text-[12px] text-muted">
              <ShieldCheck className="size-3.5" /> Full historik, inget skrivs över
            </span>
          }
        >
          Visa bokföring
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SUBVIEWS.map((s) => (
            <Link key={s.href} href={s.href}>
              <Card className="group flex h-full items-start gap-3.5 px-5 py-4 transition-colors hover:border-accent/40">
                <s.icon className="mt-0.5 size-4.5 shrink-0 text-muted transition-colors group-hover:text-accent" />
                <div>
                  <p className="text-[14px] font-semibold">{s.label}</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-soft">{s.desc}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          Du behöver aldrig röra kontona själv. Driva bokför enligt BAS-kontoplanen och sparar underlag för varje
          verifikation. Rättelser görs alltid som nya verifikationer – inget skrivs över.{" "}
          <a href="/api/bokforing/export?typ=sie" className="text-accent hover:underline">
            Exportera SIE-fil
          </a>{" "}
          till din redovisningskonsult när du vill.
        </p>
      </section>
    </div>
  );
}

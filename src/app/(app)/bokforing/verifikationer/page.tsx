import Link from "next/link";
import { ChevronLeft, ChevronRight, ReceiptText, ShieldCheck } from "lucide-react";
import { db } from "@/lib/store";
import { kr, datumKort, datumTid } from "@/lib/format";
import { BAS } from "@/lib/bas";
import { Badge, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { UndoBookingButton } from "@/components/bokforing-widgets";
import { BokforingAdvancedTabs } from "@/components/bokforing-advanced-nav";
import { verificationLabel } from "@/lib/accounting/engine";
import type { Verification } from "@/lib/types";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Verifikationer" };

const PAGE_SIZE = 100;

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

export default async function VerifikationerPage({
  searchParams,
}: {
  searchParams: Promise<{ sida?: string }>;
}) {
  await ensurePageBusiness();
  const params = await searchParams;
  const data = db();
  const all = [...data.verifications].sort((a, b) => b.number - a.number);
  const byId = new Map(all.map((v) => [v.id, v]));

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(params.sida) || 1), totalPages);
  const verifications = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack />}
        title="Verifikationer"
        subtitle={`${all.length} bokförda händelser. Varje verifikation är låst när den bokförts – rättelser blir nya verifikationer.`}
      />
      <BokforingAdvancedTabs />

      {all.length === 0 ? (
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
                {/* Mobil: beskrivning + belopp på rad 1, nr/datum/typ på rad 2 – annars trunkeras beskrivningen till oigenkännlighet. */}
                <summary className="cursor-pointer list-none px-5 py-3.5 transition-colors hover:bg-canvas/60">
                  <span className="flex items-center gap-3 sm:gap-4">
                    <span className="hidden w-14 shrink-0 font-mono text-[12px] font-medium text-muted sm:block">
                      {verificationLabel(v)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                      {v.description}
                      {correctedBy ? <span className="ml-2 text-[12px] font-normal text-warn">rättad av {verificationLabel(correctedBy)}</span> : null}
                    </span>
                    <span className="hidden text-[13px] text-muted sm:block">{datumKort(v.date)}</span>
                    <span className="shrink-0 text-right text-[14px] font-medium tabular sm:w-24">{kr(total)}</span>
                    <Badge tone={v.createdBy === "auto" ? "accent" : "neutral"} className="hidden sm:inline-flex">
                      {v.createdBy === "auto" ? "Auto" : v.createdBy === "assistent" ? "Assistent" : "Manuell"}
                    </Badge>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted sm:hidden">
                    <span className="font-mono font-medium">{verificationLabel(v)}</span>
                    <span>· {datumKort(v.date)}</span>
                    <span>· {v.createdBy === "auto" ? "Auto" : v.createdBy === "assistent" ? "Assistent" : "Manuell"}</span>
                  </span>
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

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-muted">
          <p className="tabular">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, all.length)} av {all.length}
          </p>
          <div className="flex gap-1">
            <Link
              href={`/bokforing/verifikationer?sida=${page - 1}`}
              aria-disabled={page <= 1}
              className={cx(
                "inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 font-medium",
                page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-canvas"
              )}
            >
              <ChevronLeft className="size-3.5" /> Föregående
            </Link>
            <Link
              href={`/bokforing/verifikationer?sida=${page + 1}`}
              aria-disabled={page >= totalPages}
              className={cx(
                "inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 font-medium",
                page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-canvas"
              )}
            >
              Nästa <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </div>
      ) : null}

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

import Link from "next/link";
import { BookOpenText, ChevronLeft, ChevronRight } from "lucide-react";
import { kr } from "@/lib/format";
import { Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { huvudbok } from "@/lib/accounting/ledger";
import { PrintButton } from "@/components/bokforing-widgets";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Huvudbok" };

/** Radgräns per sida i kontodetaljen – huvudboken kan ha tiotusentals rader. */
const PAGE_SIZE = 200;

export default async function HuvudbokPage({
  searchParams,
}: {
  searchParams: Promise<{ konto?: string; sida?: string }>;
}) {
  await ensurePageBusiness();
  const params = await searchParams;
  const selected = params.konto ? Number(params.konto) : undefined;
  const accounts = huvudbok();
  const account = selected ? accounts.find((a) => a.account === selected) : undefined;

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Huvudbok"
        subtitle="Alla händelser konto för konto, med ingående saldo, rader och utgående saldo."
        actions={
          <div className="flex items-center gap-2">
            <a href="/api/bokforing/export?typ=huvudbok" className="text-[13px] font-medium text-accent hover:underline">
              Exportera CSV
            </a>
            <PrintButton />
          </div>
        }
      />

      {/* Kontoväljare */}
      <div className="mb-6 flex flex-wrap gap-1.5 print:hidden">
        <Link
          href="/bokforing/huvudbok"
          className={cx(
            "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
            !selected ? "bg-ink text-white" : "bg-canvas text-soft hover:bg-line/60"
          )}
        >
          Alla konton
        </Link>
        {accounts.map((a) => (
          <Link
            key={a.account}
            href={`/bokforing/huvudbok?konto=${a.account}`}
            className={cx(
              "rounded-full px-3 py-1 font-mono text-[12.5px] font-medium transition-colors",
              selected === a.account ? "bg-ink text-white" : "bg-canvas text-soft hover:bg-line/60"
            )}
          >
            {a.account}
          </Link>
        ))}
      </div>

      {accounts.length === 0 ? (
        <EmptyState icon={BookOpenText} title="Inget att visa" text="Det finns inga bokförda händelser på kontot i år." />
      ) : !selected ? (
        /* Översikt: en rad per konto – detaljrader visas per konto (skalar till stora huvudböcker). */
        <Card className="overflow-x-auto px-5 py-4">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="pb-1.5 font-semibold">Konto</th>
                <th className="pb-1.5 text-right font-semibold">Ingående</th>
                <th className="pb-1.5 text-right font-semibold">Debet</th>
                <th className="pb-1.5 text-right font-semibold">Kredit</th>
                <th className="pb-1.5 text-right font-semibold">Utgående</th>
                <th className="pb-1.5 text-right font-semibold">Rader</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const debit = a.rows.reduce((s, r) => s + r.debit, 0);
                const credit = a.rows.reduce((s, r) => s + r.credit, 0);
                return (
                  <tr key={a.account} className="border-t border-line/50">
                    <td className="py-1.5 pr-3">
                      <Link href={`/bokforing/huvudbok?konto=${a.account}`} className="hover:underline">
                        <span className="font-mono text-[12px] text-muted">{a.account}</span>{" "}
                        <span className="font-medium">{a.name}</span>
                      </Link>
                    </td>
                    <td className="py-1.5 text-right tabular">{kr(a.ib)}</td>
                    <td className="py-1.5 text-right tabular">{debit ? kr(debit) : ""}</td>
                    <td className="py-1.5 text-right tabular">{credit ? kr(credit) : ""}</td>
                    <td className="py-1.5 text-right tabular font-medium">{kr(a.ub)}</td>
                    <td className="py-1.5 text-right tabular text-muted">{a.rows.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : !account ? (
        <EmptyState icon={BookOpenText} title="Inget att visa" text="Det finns inga bokförda händelser på kontot i år." />
      ) : (
        (() => {
          const totalPages = Math.max(1, Math.ceil(account.rows.length / PAGE_SIZE));
          const page = Math.min(Math.max(1, Number(params.sida) || 1), totalPages);
          const rows = account.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          const pageHref = (p: number) => `/bokforing/huvudbok?konto=${account.account}&sida=${p}`;
          return (
            <div className="space-y-4">
              <Card className="overflow-x-auto px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-semibold">
                    <span className="font-mono text-[13px] text-muted">{account.account}</span> {account.name}
                  </h3>
                  <p className="text-[13px] text-soft">
                    UB <span className="font-semibold tabular text-ink">{kr(account.ub)}</span>
                  </p>
                </div>
                <table className="mt-3 w-full min-w-[540px] text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <th className="pb-1.5 font-semibold">Datum</th>
                      <th className="pb-1.5 font-semibold">Ver.</th>
                      <th className="pb-1.5 font-semibold">Beskrivning</th>
                      <th className="pb-1.5 text-right font-semibold">Debet</th>
                      <th className="pb-1.5 text-right font-semibold">Kredit</th>
                      <th className="pb-1.5 text-right font-semibold">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page === 1 ? (
                      <tr className="border-t border-line/50 text-muted">
                        <td className="py-1.5" colSpan={5}>
                          Ingående saldo
                        </td>
                        <td className="py-1.5 text-right tabular">{kr(account.ib)}</td>
                      </tr>
                    ) : null}
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-line/50">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{r.date}</td>
                        <td className="py-1.5 pr-3 font-mono text-[12px] text-muted">{r.verificationLabel}</td>
                        <td className="max-w-[260px] truncate py-1.5 pr-3">{r.description}</td>
                        <td className="py-1.5 text-right tabular">{r.debit ? kr(r.debit) : ""}</td>
                        <td className="py-1.5 text-right tabular">{r.credit ? kr(r.credit) : ""}</td>
                        <td className="py-1.5 text-right tabular">{kr(r.balance)}</td>
                      </tr>
                    ))}
                    {page === totalPages ? (
                      <tr className="border-t border-line font-medium">
                        <td className="py-1.5" colSpan={5}>
                          Utgående saldo
                        </td>
                        <td className="py-1.5 text-right tabular">{kr(account.ub)}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </Card>
              {totalPages > 1 ? (
                <div className="flex items-center justify-between gap-3 text-[13px] text-muted print:hidden">
                  <p className="tabular">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, account.rows.length)} av{" "}
                    {account.rows.length} rader
                  </p>
                  <div className="flex gap-1">
                    <Link
                      href={pageHref(page - 1)}
                      aria-disabled={page <= 1}
                      className={cx(
                        "inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 font-medium",
                        page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-canvas"
                      )}
                    >
                      <ChevronLeft className="size-3.5" /> Föregående
                    </Link>
                    <Link
                      href={pageHref(page + 1)}
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
            </div>
          );
        })()
      )}
    </div>
  );
}

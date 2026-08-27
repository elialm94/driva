import Link from "next/link";
import { ArrowRight, Banknote, CalendarDays, ChevronDown } from "lucide-react";
import { db } from "@/lib/store";
import { attentionItems } from "@/lib/services/attention";
import { homeSummary } from "@/lib/services/attention";
import { financeOverview } from "@/lib/services/finance";
import { recentActivity } from "@/lib/services/activity";
import { kr, halsning, datumUtanAr, veckodag, relativ, datumLang, isoNow } from "@/lib/format";
import { Card, SectionTitle, cx } from "@/components/ui";
import { JobStatusBadge } from "@/components/status";
import { AttentionList, type AttentionDTO } from "@/components/attention-list";

export const metadata = { title: "Hem" };

function buildAttentionDTOs(): AttentionDTO[] {
  return attentionItems().map((item): AttentionDTO => {
    switch (item.kind) {
      case "forsenad_faktura":
        return {
          id: item.id,
          icon: "alert",
          title: `Faktura #${item.invoice.number} är ${item.days} ${item.days === 1 ? "dag" : "dagar"} sen`,
          text: `${item.customer.name} har inte betalat ${kr(item.toPay)} ännu.`,
          href: `/pengar/fakturor/${item.invoice.id}`,
          action: { type: "remindInvoice", label: "Skicka påminnelse", invoiceId: item.invoice.id },
        };
      case "forfragan":
        return {
          id: item.id,
          icon: "inbox",
          title: `Ny förfrågan: ${item.customer.name} – ${item.request.title}`,
          text: `”${item.request.message.length > 110 ? item.request.message.slice(0, 107) + "…" : item.request.message}”`,
          href: `/kunder/${item.customer.id}`,
          action: {
            type: "link",
            label: "Skapa offert",
            href: `/pengar/offerter/ny?kund=${item.customer.id}&forfragan=${item.request.id}`,
          },
          secondary: { label: "Visa", href: `/kunder/${item.customer.id}` },
        };
      case "offert_uppfoljning":
        return {
          id: item.id,
          icon: "clock",
          title: `${item.customer.name} har inte svarat på offert #${item.quote.number}`,
          text: `Offerten på ${kr(item.toPay)} skickades för ${item.days} dagar sedan och väntar på BankID-godkännande.`,
          href: `/pengar/offerter/${item.quote.id}`,
          action: { type: "followUpQuote", label: "Följ upp", quoteId: item.quote.id },
        };
      case "kvitto_saknas":
        return {
          id: item.id,
          icon: "receipt",
          title: `Kvitto saknas: ${item.expense.supplier}, ${kr(item.expense.amount)}`,
          text: `Vi hittar inget kvitto för köpet ${datumLang(item.expense.date)}. Fota eller ladda upp det så bokförs det automatiskt.`,
          action: { type: "uploadReceipt", label: "Lägg till kvitto", expenseId: item.expense.id },
        };
      case "bokforingsfraga":
        return {
          id: item.id,
          icon: "question",
          title: item.expense.question?.text ?? `Vad gällde köpet hos ${item.expense.supplier}?`,
          text: "Svara med ett klick så sköter bokföringen sig själv.",
          action: {
            type: "answerQuestion",
            options: item.expense.question?.options ?? ["Material", "Annat"],
            expenseId: item.expense.id,
          },
        };
      case "fakturera_jobb":
        return {
          id: item.id,
          icon: "invoice",
          title: `${item.job.title} är klart – dags att fakturera`,
          text: `Vill du skapa slutfakturan på ${kr(item.amount)} till ${item.customer.name}?`,
          href: `/uppdrag/${item.job.id}`,
          action: { type: "createFinalInvoice", label: "Skapa faktura", jobId: item.job.id },
        };
    }
  });
}

export default function HomePage() {
  const data = db();
  const s = homeSummary();
  const f = financeOverview();
  const dtos = buildAttentionDTOs();
  const activity = recentActivity(6);

  const weekJobs = data.jobs
    .filter((j) => {
      if (j.status === "pagar") return true;
      if (j.status === "kommande" && j.startDate) {
        return (new Date(j.startDate).getTime() - Date.now()) / 86_400_000 <= 7;
      }
      return false;
    })
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));

  const chips: { label: string; href: string; tone?: "danger" | "warn" }[] = [];
  if (s.newRequests > 0) chips.push({ label: `${s.newRequests} nya förfrågningar`, href: "/kunder" });
  if (s.waitingQuotes > 0) chips.push({ label: `${s.waitingQuotes} offerter väntar på BankID`, href: "/pengar?flik=offerter", tone: "warn" });
  if (s.jobsThisWeek > 0) chips.push({ label: `${s.jobsThisWeek} uppdrag den här veckan`, href: "/uppdrag" });
  if (s.unpaidSum > 0) chips.push({ label: `${kr(s.unpaidSum)} väntar på betalning`, href: "/pengar?flik=fakturor" });
  if (s.overdueCount > 0) chips.push({ label: `${s.overdueCount} försenad${s.overdueCount > 1 ? "e" : ""} faktur${s.overdueCount > 1 ? "or" : "a"}`, href: "/pengar?flik=fakturor", tone: "danger" });
  if (s.missingReceipts > 0) chips.push({ label: `${s.missingReceipts} köp saknar kvitto`, href: "/pengar?flik=utgifter", tone: "warn" });

  const now = isoNow();

  return (
    <div className="animate-fade-up">
      <p className="text-sm font-medium text-muted">
        {veckodag(now)} {datumUtanAr(now)}
      </p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{halsning()}</h1>

      {chips.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <Link
              key={chip.label}
              href={chip.href as never}
              className={cx(
                "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                chip.tone === "danger"
                  ? "border-danger/20 bg-danger-soft text-danger hover:border-danger/40"
                  : chip.tone === "warn"
                    ? "border-warn/20 bg-warn-soft text-warn hover:border-warn/40"
                    : "border-line bg-card text-soft hover:border-line-strong hover:text-ink"
              )}
            >
              {chip.label}
            </Link>
          ))}
        </div>
      ) : null}

      {/* Finansiell överblick */}
      <Card className="mt-8 overflow-hidden">
        <div className="grid grid-cols-2 divide-line/70 max-sm:gap-y-5 sm:grid-cols-4 sm:divide-x">
          {[
            { label: "På banken", value: kr(f.bank) },
            { label: "Reserverat för moms & skatt", value: `−${kr(f.reserved)}` },
            { label: "Kommande utgifter", value: `−${kr(f.upcoming)}` },
            { label: "Ungefär tillgängligt", value: kr(f.available), highlight: true },
          ].map((col) => (
            <div key={col.label} className="px-6 py-5">
              <p className="text-[13px] font-medium text-muted">{col.label}</p>
              <p
                className={cx(
                  "mt-1 text-[21px] font-semibold tracking-tight tabular",
                  col.highlight ? "text-accent-deep" : "text-ink"
                )}
              >
                {col.value}
              </p>
            </div>
          ))}
        </div>
        <details className="group border-t border-line/70">
          <summary className="flex cursor-pointer items-center justify-between px-6 py-3 text-[13px] font-medium text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
            Vad ingår i beräkningen?
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-x-10 gap-y-1.5 px-6 pb-5 text-[13px] sm:grid-cols-2">
            <div className="flex justify-between text-soft">
              <span>Moms för perioden (betalas {datumLang(f.momsDue)})</span>
              <span className="tabular">{kr(f.moms)}</span>
            </div>
            <div className="flex justify-between text-soft">
              <span>F-skatt, kommande två månader</span>
              <span className="tabular">{kr(f.fSkatt)}</span>
            </div>
            <div className="flex justify-between text-soft">
              <span>Arbetsgivaravgifter & personalskatt</span>
              <span className="tabular">{kr(f.payrollReserve)}</span>
            </div>
            {f.upcomingRows.map((r) => (
              <div key={r.label + r.due} className="flex justify-between text-soft">
                <span>
                  {r.label} (förfaller {relativ(r.due)})
                </span>
                <span className="tabular">{kr(r.amount)}</span>
              </div>
            ))}
          </div>
        </details>
      </Card>

      {/* Behöver din uppmärksamhet */}
      <div className="mt-10">
        <SectionTitle>Behöver din uppmärksamhet</SectionTitle>
        {dtos.length > 0 ? (
          <AttentionList items={dtos} />
        ) : (
          <Card className="flex items-center gap-3 px-6 py-5">
            <Banknote className="size-5 text-accent" />
            <p className="text-[15px] text-soft">Allt är omhändertaget. Njut av dagen!</p>
          </Card>
        )}
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {/* Veckans jobb */}
        <div>
          <SectionTitle
            right={
              <Link href="/uppdrag" className="flex items-center gap-1 text-[13px] font-medium text-soft hover:text-ink">
                Alla uppdrag <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            Den här veckan
          </SectionTitle>
          {weekJobs.length > 0 ? (
            <Card className="divide-y divide-line/70">
              {weekJobs.map((job) => {
                const customer = data.customers.find((c) => c.id === job.customerId);
                return (
                  <Link
                    key={job.id}
                    href={`/uppdrag/${job.id}` as never}
                    className="flex items-center gap-4 px-5 py-4 transition-colors first:rounded-t-[calc(1.25rem-1px)] last:rounded-b-[calc(1.25rem-1px)] hover:bg-canvas/60"
                  >
                    <div className="flex size-9 items-center justify-center rounded-xl bg-accent-soft">
                      <CalendarDays className="size-4.5 text-accent" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{job.title}</p>
                      <p className="text-[13px] text-muted">
                        {customer?.name}
                        {job.startDate ? ` · ${job.status === "pagar" ? "startade" : "startar"} ${relativ(job.startDate)}` : ""}
                      </p>
                    </div>
                    <JobStatusBadge status={job.status} />
                  </Link>
                );
              })}
            </Card>
          ) : (
            <Card className="px-6 py-5 text-[15px] text-soft">Inga uppdrag planerade den här veckan.</Card>
          )}
        </div>

        {/* Senaste aktivitet */}
        <div>
          <SectionTitle>Nyligen hänt</SectionTitle>
          <Card className="px-5 py-2">
            {activity.map((a, i) => (
              <div key={a.id} className={cx("flex gap-3 py-3", i > 0 && "border-t border-line/60")}>
                <div className="mt-[7px] size-1.5 shrink-0 rounded-full bg-line-strong" />
                <div className="min-w-0">
                  <p className="text-[14px] leading-snug text-soft">{a.text}</p>
                  <p className="mt-0.5 text-[12px] text-muted">{relativ(a.at)}</p>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

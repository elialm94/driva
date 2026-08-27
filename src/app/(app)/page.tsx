import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { db } from "@/lib/store";
import {
  attentionItems,
  HOME_ATTENTION_VISIBLE,
  homeNextSteps,
} from "@/lib/services/attention";
import { financeOverview } from "@/lib/services/finance";
import { kr, halsning, datumUtanAr, veckodag, relativ, datumLang, isoNow } from "@/lib/format";
import { Card, SectionTitle, cx } from "@/components/ui";
import { AttentionList, type AttentionDTO } from "@/components/attention-list";
import { HomeAiBar } from "@/components/home-ai-bar";
import { HomeNextSteps, type NextStepDTO } from "@/components/home-next-steps";
import { invoiceHref, inquiryHref, newQuoteHref, quoteHref } from "@/lib/nav";

export const metadata = { title: "Hem" };

function buildAttentionDTOs(): AttentionDTO[] {
  return attentionItems().map((item): AttentionDTO => {
    switch (item.kind) {
      case "forsenad_faktura":
        return {
          id: item.id,
          icon: "alert",
          title: `Faktura ${item.invoice.number != null ? `#${item.invoice.number}` : "(utkast)"} är ${item.days} ${item.days === 1 ? "dag" : "dagar"} sen`,
          text: `${item.customer.name} har inte betalat ${kr(item.toPay)} ännu.`,
          href: invoiceHref(item.invoice.id),
          action: { type: "remindInvoice", label: "Skicka påminnelse", invoiceId: item.invoice.id },
        };
      case "betalningsbeslut":
        return item.source === "inbetalning"
          ? {
              id: item.id,
              icon: "bank",
              title: `Inbetalning från ${item.tx.counterpart} kunde inte matchas`,
              text: `${kr(item.amount)} behöver kopplas till en faktura.`,
              href: "/ekonomi?flik=bank",
              action: { type: "link", label: "Visa", href: "/ekonomi?flik=bank" },
            }
          : {
              id: item.id,
              icon: "bank",
              title: `${item.supplierInvoice.supplier} ${item.supplierInvoice.invoiceNumber} är förfallen`,
              text: `${kr(item.amount)} ska betalas.`,
              href: "/ekonomi?flik=utgifter",
              action: { type: "link", label: "Visa", href: "/ekonomi?flik=utgifter" },
            };
      case "forfragan":
        return {
          id: item.id,
          icon: "inbox",
          title: `Ny förfrågan: ${item.customer.name} – ${item.request.title}`,
          text: `”${item.request.message.length > 110 ? item.request.message.slice(0, 107) + "…" : item.request.message}”`,
          href: inquiryHref(item.request.id),
          action: {
            type: "link",
            label: "Skapa offert",
            href: newQuoteHref({
              kund: item.customer.id,
              forfragan: item.request.id,
              from: { href: inquiryHref(item.request.id), label: item.request.title },
            }),
          },
          secondary: { label: "Visa", href: inquiryHref(item.request.id) },
        };
      case "offert_uppfoljning":
        return {
          id: item.id,
          icon: "clock",
          title: `${item.customer.name} har inte svarat på offert #${item.quote.number}`,
          text: `Offerten på ${kr(item.toPay)} skickades för ${item.days} dagar sedan och väntar på BankID-godkännande.`,
          href: quoteHref(item.quote.id),
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
    }
  });
}

function buildNextStepDTOs(): NextStepDTO[] {
  return homeNextSteps().map((step): NextStepDTO => {
    switch (step.kind) {
      case "forsta_faktura":
        return {
          id: step.id,
          title: `Skapa första fakturan till ${step.customer.name}`,
          text: `Offerten är godkänd med BankID. ${step.percent} % ${step.partLabel.toLowerCase()} · ${kr(step.amount)}.`,
          href: `/uppdrag/${step.job.id}`,
          action: {
            type: "createJobInvoice",
            label: "Skapa faktura",
            jobId: step.job.id,
            jobTitle: step.job.title,
          },
        };
      case "kan_fakturera":
        return {
          id: step.id,
          title: `Fakturera ${kr(step.amount)} till ${step.customer.name}`,
          text: `Enligt den BankID-godkända offerten för ${step.job.title}.`,
          href: `/uppdrag/${step.job.id}`,
          action: {
            type: "createJobInvoice",
            label: "Skapa faktura",
            jobId: step.job.id,
            jobTitle: step.job.title,
          },
        };
      case "resterande":
        return {
          id: step.id,
          title: step.isFinal
            ? `${kr(step.amount)} återstår – slutfaktura till ${step.customer.name}`
            : `${kr(step.amount)} kan faktureras till ${step.customer.name}`,
          text: `Enligt den godkända offerten för ${step.job.title}.`,
          href: `/uppdrag/${step.job.id}`,
          action: {
            type: "createJobInvoice",
            label: step.isFinal ? "Skapa slutfaktura" : "Skapa faktura",
            jobId: step.job.id,
            jobTitle: step.job.title,
          },
        };
      case "rot_ansok":
        return {
          id: step.id,
          title: step.label,
          text: `${step.job.title} hos ${step.customer.name}.`,
          href: `/uppdrag/${step.job.id}`,
          action: { type: "link", label: "Öppna", href: `/uppdrag/${step.job.id}` },
        };
    }
  });
}

export default function HomePage() {
  const data = db();
  const f = financeOverview();
  const dtos = buildAttentionDTOs();
  const nextSteps = buildNextStepDTOs();
  const bankConnected = data.bankAccounts.length > 0;
  const now = isoNow();

  return (
    <div className="animate-fade-up">
      <p className="text-sm font-medium text-muted">
        {veckodag(now)} {datumUtanAr(now)}
      </p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{halsning()}</h1>

      <HomeAiBar
        messages={data.assistantMessages.slice(-6)}
        hasUserTurn={data.assistantMessages.some((m) => m.role === "user")}
      />

      <div className="mt-10">
        <SectionTitle>Behöver din uppmärksamhet</SectionTitle>
        {dtos.length > 0 ? (
          <AttentionList items={dtos} initialVisible={HOME_ATTENTION_VISIBLE} />
        ) : (
          <p className="text-[15px] text-soft">Allt ser bra ut ✓</p>
        )}
      </div>

      <div className="mt-10">
        <SectionTitle>Pengar</SectionTitle>
        {bankConnected ? (
          <Card className="overflow-hidden">
            <div className="grid gap-5 px-6 py-5 sm:grid-cols-2">
              <div>
                <p className="text-[13px] font-medium text-muted">På banken</p>
                <p className="mt-1 text-[21px] font-semibold tracking-tight tabular">{kr(f.bank)}</p>
              </div>
              <div>
                <p className="text-[13px] font-medium text-muted">Ungefär tillgängligt</p>
                <p className="mt-1 text-[21px] font-semibold tracking-tight tabular text-accent-deep">
                  {kr(f.available)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-6 py-3">
              <Link href="/ekonomi" className="text-[13px] font-medium text-soft hover:text-ink">
                Visa ekonomi →
              </Link>
            </div>
            <details className="group border-t border-line/70">
              <summary className="flex cursor-pointer items-center justify-between px-6 py-3 text-[13px] font-medium text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                Hur räknas detta?
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-1.5 px-6 pb-5 text-[13px]">
                <p className="pb-2 text-soft">
                  På banken minus reserverat för moms och skatt minus kommande utgifter blir ungefär tillgängligt.
                </p>
                <div className="flex justify-between text-soft">
                  <span>På banken</span>
                  <span className="tabular">{kr(f.bank)}</span>
                </div>
                <div className="flex justify-between text-soft">
                  <span>Reserverat för moms & skatt</span>
                  <span className="tabular">−{kr(f.reserved)}</span>
                </div>
                <div className="flex justify-between text-soft">
                  <span>Kommande utgifter</span>
                  <span className="tabular">−{kr(f.upcoming)}</span>
                </div>
                <div className="flex justify-between border-t border-line/60 pt-1.5 font-medium text-ink">
                  <span>Ungefär tillgängligt</span>
                  <span className="tabular">{kr(f.available)}</span>
                </div>
                <div className={cx("grid gap-x-10 gap-y-1.5 pt-3 sm:grid-cols-2")}>
                  <div className="flex justify-between text-muted">
                    <span>Moms för perioden (betalas {datumLang(f.momsDue)})</span>
                    <span className="tabular">{kr(f.moms)}</span>
                  </div>
                  <div className="flex justify-between text-muted">
                    <span>F-skatt, kommande två månader</span>
                    <span className="tabular">{kr(f.fSkatt)}</span>
                  </div>
                  <div className="flex justify-between text-muted">
                    <span>Arbetsgivaravgifter & personalskatt</span>
                    <span className="tabular">{kr(f.payrollReserve)}</span>
                  </div>
                  {f.upcomingRows.map((r) => (
                    <div key={r.label + r.due} className="flex justify-between text-muted">
                      <span>
                        {r.label} (förfaller {relativ(r.due)})
                      </span>
                      <span className="tabular">{kr(r.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          </Card>
        ) : (
          <Card className="px-6 py-5">
            <p className="text-[15px] text-soft">Koppla bankkonto för att se vad som finns på kontot.</p>
            <Link href="/ekonomi?flik=bank" className="mt-2 inline-block text-[13px] font-medium text-soft hover:text-ink">
              Koppla bank →
            </Link>
          </Card>
        )}
      </div>

      {nextSteps.length > 0 ? (
        <div className="mt-10">
          <SectionTitle>Nästa steg</SectionTitle>
          <HomeNextSteps items={nextSteps} />
        </div>
      ) : null}
    </div>
  );
}

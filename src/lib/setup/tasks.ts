/**
 * Kom igång-centret: uppgifter vars status HÄRLEDS ur verklig data. Bara
 * "gör senare" och "behövs inte" lagras (onboarding.taskOverrides).
 *
 *   klar        – datat finns (bankkonto anslutet, kund skapad, import bekräftad …)
 *   inte påbörjad / pågår – återstår
 *   gör senare  – användaren sköt upp den (kan återaktiveras)
 *   behövs inte – användaren valde bort den (kan återaktiveras)
 *
 * Branschen och bokföringssituationen påverkar bara ordning och om en
 * uppgift rekommenderas – aldrig behörighet.
 */
import { db } from "../store";
import type { OnboardingState, SetupTaskId } from "../types";
import { settingsBillingReadiness } from "../billing-readiness";
import { bankConnectionView } from "../banking/connection-state";
import { hasCollaborationUsage, resolveOwnerBusinessId, wholesalersEnabled } from "../features";
import { OPTIONAL_FEATURE_HREF } from "../optional-features";
import { SETTINGS_HREF } from "../settings-routes";

export type SetupTaskStatus = "todo" | "in_progress" | "done" | "later" | "not_needed";
export type SetupTaskRelevance = "recommended" | "optional" | "hidden";

export interface SetupTask {
  id: SetupTaskId;
  title: string;
  /** En mening om varför/vad – enkel svenska. */
  description: string;
  status: SetupTaskStatus;
  relevance: SetupTaskRelevance;
  /** Vart uppgiften öppnas. */
  href: string;
  /** Knapptext, t.ex. "Ladda upp filer". */
  cta: string;
  /** Kort läge när klar, t.ex. "Swedbank ···· 4512". */
  doneDetail?: string;
  /** Får användaren markera "Behövs inte"? (Bank/betalning: nej – de behövs för att fakturera/bokföra.) */
  canDismiss: boolean;
}

export const IMPORT_HREF = "/kom-igang/importera";

export function setupTasks(): SetupTask[] {
  const data = db();
  const onboarding = data.onboarding ?? null;
  const overrides = onboarding?.taskOverrides ?? {};
  const bookkeeping = onboarding?.bookkeeping ?? null;
  const industries = onboarding?.industries ?? [];
  const electricOrPlumbing = industries.includes("el") || industries.includes("vvs");
  const businessId = resolveOwnerBusinessId();

  const imports = data.dataImports ?? [];
  const bookkeepingImported = imports.some((i) => i.kind === "bokforing" && i.status === "imported");
  const bank = bankConnectionView();
  const readiness = settingsBillingReadiness(data.settings);
  const paymentMissing = readiness.items.some((item) => item.id === "payment");
  const customers = data.customers.length;
  const jobs = data.jobs.filter((j) => !j.archivedAt).length;
  const consultant = hasCollaborationUsage(data, businessId);
  const hasPriceList = (data.wholesalerPriceImports ?? []).some((i) => i.status === "active");
  const hasInvoicing = data.invoices.length > 0 || data.quotes.length > 0;

  const withOverride = (id: SetupTaskId, derived: SetupTaskStatus): SetupTaskStatus => {
    if (derived === "done") return "done";
    const o = overrides[id];
    return o ? o.state : derived;
  };

  const tasks: SetupTask[] = [
    {
      id: "move_bookkeeping",
      title: "Flytta in bokföringen",
      description: "Ladda upp filerna från ditt tidigare bokföringsprogram. Du ser exakt vad som tas med innan något sparas.",
      status: withOverride("move_bookkeeping", bookkeepingImported ? "done" : "todo"),
      relevance: bookkeeping === "existing" ? "recommended" : bookkeeping === "new" ? "hidden" : "optional",
      href: IMPORT_HREF,
      cta: "Ladda upp filer",
      doneDetail: bookkeepingImported ? latestImportSummary("bokforing") : undefined,
      canDismiss: true,
    },
    {
      id: "invite_consultant",
      title: "Bjud in din redovisningskonsult",
      description: "Konsulten arbetar i samma bokföring – utan att skicka filer fram och tillbaka.",
      status: withOverride("invite_consultant", consultant ? "done" : "todo"),
      relevance: bookkeeping === "consultant" ? "recommended" : "optional",
      href: OPTIONAL_FEATURE_HREF.collaboration,
      cta: "Bjud in",
      canDismiss: true,
    },
    {
      id: "first_customer",
      title: "Lägg till första kunden",
      description: "Kunder behövs för offerter, uppdrag och fakturor. Har du ett register kan du ladda upp det.",
      status: withOverride("first_customer", customers > 0 ? "done" : "todo"),
      relevance: "recommended",
      href: "/kunder",
      cta: "Lägg till kund",
      doneDetail: customers > 0 ? `${customers} ${customers === 1 ? "kund" : "kunder"}` : undefined,
      canDismiss: false,
    },
    {
      id: "first_job",
      title: "Skapa första uppdraget",
      description: "Uppdraget håller ihop offert, arbete, material och faktura.",
      status: withOverride("first_job", jobs > 0 ? "done" : "todo"),
      relevance: "recommended",
      href: "/uppdrag",
      cta: "Skapa uppdrag",
      doneDetail: jobs > 0 ? `${jobs} ${jobs === 1 ? "uppdrag" : "uppdrag"}` : undefined,
      canDismiss: true,
    },
    {
      id: "payment_details",
      title: "Lägg till betalningsuppgifter",
      description: "Bankgiro, plusgiro eller bankkonto behövs innan du kan skicka en faktura.",
      status: withOverride("payment_details", paymentMissing ? "todo" : "done"),
      relevance: "recommended",
      href: SETTINGS_HREF.fakturering,
      cta: "Lägg till",
      doneDetail: paymentMissing ? undefined : paymentSummary(),
      canDismiss: false,
    },
    {
      id: "connect_bank",
      title: "Koppla banken",
      description: "Med banken kopplad matchas betalningar mot fakturor och utgifter automatiskt.",
      status: withOverride("connect_bank", bank.status === "connected" ? "done" : bank.status === "pending" ? "in_progress" : "todo"),
      relevance: "recommended",
      href: "/ekonomi?flik=bank",
      cta: "Koppla bank",
      doneDetail:
        bank.status === "connected" ? [bank.bankName, bank.maskedAccount].filter(Boolean).join(" · ") || "Ansluten" : undefined,
      canDismiss: false,
    },
    {
      id: "articles_prices",
      title: "Lägg in artiklar och priser",
      description: "Ladda upp grossistens prislista så kan du söka material med dina egna priser och beställa direkt från uppdraget.",
      status: withOverride("articles_prices", hasPriceList ? "done" : "todo"),
      relevance: electricOrPlumbing ? "recommended" : "optional",
      href: wholesalersEnabled(data) ? SETTINGS_HREF.grossister : `${SETTINGS_HREF.funktioner}&aktivera=wholesalers`,
      cta: hasPriceList ? "Visa" : wholesalersEnabled(data) ? "Ladda upp prislista" : "Kom igång",
      doneDetail: hasPriceList ? priceListSummary() : undefined,
      canDismiss: true,
    },
    {
      // Lön finns inte i Ferva ännu – behovet sparas i profilen och visas
      // ärligt där, men blir ingen uppgift med en död knapp.
      id: "payroll",
      title: "Ställ in lön",
      description: "Lön finns inte i Ferva ännu.",
      status: "todo",
      relevance: "hidden",
      href: SETTINGS_HREF.funktioner,
      cta: "",
      canDismiss: false,
    },
  ];

  const visible = tasks.filter((t) => t.relevance !== "hidden");
  return visible.sort((a, b) => priority(a, { bookkeeping, hasInvoicing }) - priority(b, { bookkeeping, hasInvoicing }));
}

/** Lägre = viktigare. Situationen styr vad som är mest värdefullt just nu. */
function priority(task: SetupTask, ctx: { bookkeeping: OnboardingState["bookkeeping"]; hasInvoicing: boolean }): number {
  const base: Record<SetupTaskId, number> = {
    move_bookkeeping: 40,
    invite_consultant: 45,
    first_customer: 20,
    first_job: 25,
    payment_details: ctx.hasInvoicing ? 5 : 50,
    connect_bank: 60,
    articles_prices: 55,
    payroll: 90,
  };
  let score = base[task.id];
  if (ctx.bookkeeping === "existing" && task.id === "move_bookkeeping") score = 1;
  if (ctx.bookkeeping === "consultant" && task.id === "invite_consultant") score = 1;
  if (ctx.bookkeeping === "consultant" && task.id === "move_bookkeeping") score = 30;
  if (task.relevance === "optional") score += 100;
  if (task.status === "done") score += 200;
  if (task.status === "later" || task.status === "not_needed") score += 300;
  return score;
}

export interface SetupSummary {
  tasks: SetupTask[];
  /** Rekommenderade uppgifter som återstår (todo/pågår). */
  open: SetupTask[];
  /** Den mest värdefulla nästa uppgiften. */
  next: SetupTask | null;
  done: SetupTask[];
  deferred: SetupTask[];
  dismissed: SetupTask[];
  optional: SetupTask[];
  /** Hem-kortet visas bara när rekommenderade uppgifter återstår. */
  showHomeCard: boolean;
}

export function setupSummary(): SetupSummary {
  const tasks = setupTasks();
  const open = tasks.filter((t) => t.relevance === "recommended" && (t.status === "todo" || t.status === "in_progress"));
  const optional = tasks.filter((t) => t.relevance === "optional" && (t.status === "todo" || t.status === "in_progress"));
  return {
    tasks,
    open,
    next: open[0] ?? null,
    done: tasks.filter((t) => t.status === "done"),
    deferred: tasks.filter((t) => t.status === "later"),
    dismissed: tasks.filter((t) => t.status === "not_needed"),
    optional,
    showHomeCard: open.length > 0,
  };
}

function latestImportSummary(kind: "bokforing" | "kunder" | "leverantorer" | "artiklar"): string | undefined {
  const imports = (db().dataImports ?? []).filter((i) => i.kind === kind && i.status === "imported");
  const latest = imports.sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt))[0];
  return latest?.summary;
}

function paymentSummary(): string {
  const s = db().settings;
  if (s.bankgiro) return `Bankgiro ${s.bankgiro}`;
  if (s.plusgiro) return `Plusgiro ${s.plusgiro}`;
  if (s.bankAccount) return `Bankkonto ${s.bankAccount}`;
  if (s.iban) return `IBAN ${s.iban}`;
  return "Klart";
}

function priceListSummary(): string {
  const imports = (db().wholesalerPriceImports ?? []).filter((i) => i.status === "active");
  const products = imports.reduce((n, i) => n + i.productCount, 0);
  return `${products.toLocaleString("sv-SE")} artiklar`;
}

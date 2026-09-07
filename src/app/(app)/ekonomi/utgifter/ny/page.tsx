import { db } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { ManualExpenseForm, type ManualExpensePreset } from "@/components/manual-expense-form";
import { manualExpenseCategories } from "@/lib/services/manual-expense";
import { MANUAL_EXPENSE_ACCOUNTS } from "@/lib/expenses/manual-expense";
import { accountName } from "@/lib/accounting/chart";
import { lockedThrough } from "@/lib/accounting/fiscal";
import { nextDay, todayDate } from "@/lib/accounting/dates";
import { ensurePageBusiness } from "@/lib/auth/session";
import { labelForHref, sanitizeReturnLabel, sanitizeReturnTo } from "@/lib/nav";

export const metadata = { title: "Ny utgift" };

const PRESETS: readonly ManualExpensePreset[] = ["kop", "utlagg", "milersattning", "traktamente", "representation"];

function presetParam(value: unknown): ManualExpensePreset {
  return typeof value === "string" && (PRESETS as readonly string[]).includes(value) ? (value as ManualExpensePreset) : "kop";
}

export default async function NewExpensePage(props: PageProps<"/ekonomi/utgifter/ny">) {
  await ensurePageBusiness();
  const searchParams = await props.searchParams;
  const preset = presetParam(searchParams.typ);
  const requestedJobId =
    typeof searchParams.uppdrag === "string" ? searchParams.uppdrag : typeof searchParams.job === "string" ? searchParams.job : undefined;
  const tillbaka = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : null;
  const tillbakaNamn =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) : null;
  const cancelHref = tillbaka ?? "/ekonomi?flik=utgifter";
  const cancelLabel = tillbaka ? (tillbakaNamn ?? labelForHref(tillbaka)) : "Utgifter";

  const data = db();
  const lock = lockedThrough();
  const today = todayDate();
  const firstOpen = lock ? nextDay(lock) : undefined;
  const categories = manualExpenseCategories();
  const accountNames: Record<number, string> = {};
  for (const account of [...MANUAL_EXPENSE_ACCOUNTS, ...categories.map((c) => c.account)]) {
    accountNames[account] = accountName(account);
  }
  const customers = new Map(data.customers.map((c) => [c.id, c.name]));
  const jobs = data.jobs
    .filter((j) => j.status !== "klart" || j.id === requestedJobId)
    .map((j) => ({ id: j.id, title: j.title, customerName: customers.get(j.customerId) ?? "" }))
    .sort((a, b) => a.title.localeCompare(b.title, "sv"));

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack fallbackHref={cancelHref} fallbackLabel={cancelLabel} />}
        title="Ny utgift"
        subtitle="Köp utan kvitto i banken, privata utlägg, milersättning, traktamente och representation. Driva räknar schablonerna och konterar."
      />
      <ManualExpenseForm
        categories={categories}
        jobs={jobs}
        accountNames={accountNames}
        today={firstOpen && firstOpen > today ? firstOpen : today}
        firstOpenDate={firstOpen}
        initialPreset={preset}
        initialJobId={requestedJobId && jobs.some((j) => j.id === requestedJobId) ? requestedJobId : undefined}
        cancelHref={cancelHref}
      />
    </div>
  );
}

import { db } from "../store";
import type { Job } from "../types";
import {
  compareJobsDefault,
  derivedJobStatus,
  jobEconomyLine,
  jobWhenLabel,
  type DerivedJobStatus,
  type JobEconomyKind,
} from "./job-lifecycle";
import { jobMoneyForAll, type JobMoney } from "./job-economy";
import type { PagedResult } from "./customers";

export const JOB_PAGE_SIZE = 50;

// Klientsäkra delar (filtertyper + avstämning) bor i job-list-filters –
// den här modulen drar in store/fs och får inte nå klientbundlar.
export {
  reconcileJobListFilters,
  type JobEconomyFilter,
  type JobLifecycleFilter,
  type JobSort,
} from "./job-list-filters";
import type { JobEconomyFilter, JobLifecycleFilter, JobSort } from "./job-list-filters";

export interface JobListRow {
  id: string;
  title: string;
  address?: string;
  customerId: string;
  customerName: string;
  customerKind: "privat" | "foretag";
  whenLabel: string;
  whenSort: string;
  economyLabel: string;
  economyKind: JobEconomyKind;
  quoteAmount: number;
  remaining: number;
  unpaid: number;
  lifecycle: DerivedJobStatus;
  startDate?: string;
  completedAt?: string;
}

function paginate<T>(items: T[], page: number, pageSize: number): PagedResult<T> {
  const size = Math.max(1, pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * size;
  return {
    rows: items.slice(start, start + size),
    page: current,
    pageSize: size,
    total,
    totalPages: total === 0 ? 1 : totalPages,
  };
}

function toRow(job: Job, money: JobMoney, customer: { name: string; kind: "privat" | "foretag" }): JobListRow {
  const lifecycle = derivedJobStatus(job);
  const economy = jobEconomyLine(money);
  return {
    id: job.id,
    title: job.title,
    address: job.address,
    customerId: job.customerId,
    customerName: customer.name,
    customerKind: customer.kind,
    whenLabel: jobWhenLabel(job),
    whenSort: (lifecycle === "klart" ? job.completedAt : job.startDate) ?? "",
    economyLabel: economy.label,
    economyKind: economy.kind,
    quoteAmount: money.quoteAmount,
    remaining: money.remaining,
    unpaid: money.unpaid,
    lifecycle,
    startDate: job.startDate,
    completedAt: job.completedAt,
  };
}

function matchesQuery(
  row: JobListRow,
  job: Job,
  customer: { name: string; kind: "privat" | "foretag"; contactPerson?: string },
  q: string
): boolean {
  if (!q) return true;
  const hay = [job.title, customer.name, customer.contactPerson, job.address, customer.kind === "foretag" ? customer.name : ""]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function listJobsForTable(input: {
  q?: string;
  lifecycle?: JobLifecycleFilter;
  economy?: JobEconomyFilter;
  sort?: JobSort;
  page?: number;
  pageSize?: number;
} = {}): PagedResult<JobListRow> {
  const data = db();
  // Delad uppdragsekonomi (job-economy.ts) – samma siffror som uppdragssidan
  // och actionmotorn, en genomläsning för hela listan.
  const money = jobMoneyForAll();
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  const q = (input.q ?? "").trim().toLowerCase();
  const lifecycleFilter = input.lifecycle ?? "aktiva";
  const economyFilter = input.economy ?? "alla";
  const sort = input.sort ?? "standard";

  const rows: JobListRow[] = [];
  for (const job of data.jobs) {
    const customer = customers.get(job.customerId);
    if (!customer) continue;
    const jm = money.get(job.id);
    if (!jm) continue; // jobMoneyForAll täcker alla jobb – saknas den är datat trasigt
    const archived = Boolean(job.archivedAt);
    if (lifecycleFilter === "arkiverade" && !archived) continue;
    if (lifecycleFilter !== "arkiverade" && lifecycleFilter !== "alla" && archived) continue;
    const row = toRow(job, jm, customer);
    if (lifecycleFilter === "aktiva" && row.lifecycle === "klart") continue;
    if (lifecycleFilter === "planerade" && row.lifecycle !== "planerat") continue;
    if (lifecycleFilter === "klart" && row.lifecycle !== "klart") continue;
    if (economyFilter !== "alla" && row.economyKind !== economyFilter) continue;
    if (!matchesQuery(row, job, customer, q)) continue;
    rows.push(row);
  }

  rows.sort((a, b) => {
    if (sort === "kund") return a.customerName.localeCompare(b.customerName, "sv");
    if (sort === "belopp") return b.quoteAmount - a.quoteAmount;
    if (sort === "datum") return (a.whenSort || "9").localeCompare(b.whenSort || "9");
    return compareJobsDefault(a, b);
  });

  return paginate(rows, input.page ?? 1, input.pageSize ?? JOB_PAGE_SIZE);
}

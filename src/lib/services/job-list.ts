import { db } from "../store";
import type { Invoice, Job, Quote } from "../types";
import { docTotals } from "../calc";
import { invoiceTotals } from "./data";
import {
  compareJobsDefault,
  derivedJobStatus,
  jobEconomyLine,
  jobWhenLabel,
  type DerivedJobStatus,
  type JobEconomyKind,
} from "./job-lifecycle";
import type { PagedResult } from "./customers";

export const JOB_PAGE_SIZE = 50;

export type JobLifecycleFilter = "aktiva" | "planerade" | "klart" | "alla";
export type JobEconomyFilter = "alla" | "kvar" | "vantar" | "betalt";
export type JobSort = "standard" | "datum" | "kund" | "belopp";

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

interface JobMoney {
  quoteAmount: number;
  remaining: number;
  unpaid: number;
  paid: number;
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

/** En genomläsning: uppdrag + kund + offert/fakturasummor. Ingen N+1 per rad. */
function jobMoneyById(): Map<string, JobMoney> {
  const data = db();
  const versionById = new Map(data.quoteVersions.map((v) => [v.id, v]));
  const quoteById = new Map(data.quotes.map((q) => [q.id, q]));
  const quoteByJobId = new Map<string, Quote>();
  for (const q of data.quotes) {
    if (q.jobId) quoteByJobId.set(q.jobId, q);
  }

  const invoicesByJob = new Map<string, Invoice[]>();
  for (const inv of data.invoices) {
    if (!inv.jobId || inv.status === "krediterad") continue;
    const list = invoicesByJob.get(inv.jobId);
    if (list) list.push(inv);
    else invoicesByJob.set(inv.jobId, [inv]);
  }

  const money = new Map<string, JobMoney>();
  for (const job of data.jobs) {
    const quote = (job.quoteId ? quoteById.get(job.quoteId) : undefined) ?? quoteByJobId.get(job.id);
    const version = quote ? versionById.get(quote.currentVersionId) : undefined;
    const quoteTotals = version ? docTotals(version.lines, version.rot) : undefined;
    const quoteAmount = quoteTotals?.toPay ?? 0;
    const invoices = invoicesByJob.get(job.id) ?? [];
    let invoiced = 0;
    let unpaid = 0;
    let paid = 0;
    for (const inv of invoices) {
      const t = invoiceTotals(inv);
      invoiced += t.total;
      if (inv.status === "skickad" || inv.status === "utkast") unpaid += t.toPay;
      if (inv.status === "betald") paid += t.toPay;
    }
    const remaining = quote?.status === "godkand" && quoteTotals ? Math.max(0, quoteTotals.total - invoiced) : 0;
    money.set(job.id, { quoteAmount, remaining, unpaid, paid });
  }
  return money;
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
  const money = jobMoneyById();
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  const q = (input.q ?? "").trim().toLowerCase();
  const lifecycleFilter = input.lifecycle ?? "aktiva";
  const economyFilter = input.economy ?? "alla";
  const sort = input.sort ?? "standard";

  const rows: JobListRow[] = [];
  for (const job of data.jobs) {
    const customer = customers.get(job.customerId);
    if (!customer) continue;
    const row = toRow(job, money.get(job.id) ?? { quoteAmount: 0, remaining: 0, unpaid: 0, paid: 0 }, customer);
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

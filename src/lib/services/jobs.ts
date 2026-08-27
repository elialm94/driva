import { db, save } from "../store";
import { uid } from "../ids";
import type { Job, Quote } from "../types";
import { currentVersion, requireCustomer } from "./data";
import { logActivity } from "./activity";

export function createJobFromQuote(quote: Quote): Job {
  const data = db();
  const existing =
    (quote.jobId ? data.jobs.find((j) => j.id === quote.jobId) : undefined) ??
    data.jobs.find((j) => j.quoteId === quote.id);
  if (existing) {
    existing.quoteId = quote.id;
    quote.jobId = existing.id;
    save();
    return existing;
  }

  const version = currentVersion(quote);
  const customer = requireCustomer(quote.customerId);
  const job: Job = {
    id: uid(),
    customerId: quote.customerId,
    quoteId: quote.id,
    title: version.title,
    description: `${version.intro}\n\nEnligt BankID-godkänd offert #${quote.number}.`,
    status: "kommande",
    address: customer.address ? `${customer.address}, ${customer.city ?? ""}`.replace(/, $/, "") : undefined,
    checklist: [],
    notes: "",
    createdAt: new Date().toISOString(),
  };
  data.jobs.push(job);
  quote.jobId = job.id;
  save();
  return job;
}

export function createJob(input: {
  customerId: string;
  title: string;
  description?: string;
  startDate?: string;
}): Job {
  const data = db();
  const customer = requireCustomer(input.customerId);
  const job: Job = {
    id: uid(),
    customerId: input.customerId,
    title: input.title,
    description: input.description ?? "",
    status: "kommande",
    startDate: input.startDate,
    address: customer.address ? `${customer.address}, ${customer.city ?? ""}`.replace(/, $/, "") : undefined,
    checklist: [],
    notes: "",
    createdAt: new Date().toISOString(),
  };
  data.jobs.push(job);
  logActivity(`Uppdraget ${job.title} skapades för ${customer.name}.`, {
    customerId: customer.id,
    entity: { type: "jobb", id: job.id },
  });
  save();
  return job;
}

export function setJobStatus(jobId: string, status: Job["status"]): Job {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const customer = requireCustomer(job.customerId);
  job.status = status;
  if (status === "klart") {
    job.completedAt = new Date().toISOString();
    logActivity(`Uppdraget ${job.title} hos ${customer.name} markerades som klart.`, {
      customerId: customer.id,
      entity: { type: "jobb", id: jobId },
    });
  } else if (status === "pagar") {
    if (!job.startDate) job.startDate = new Date().toISOString();
    logActivity(`Uppdraget ${job.title} hos ${customer.name} startades.`, {
      customerId: customer.id,
      entity: { type: "jobb", id: jobId },
    });
  }
  save();
  return job;
}

export function toggleChecklistItem(jobId: string, itemId: string): void {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) return;
  const item = job.checklist.find((c) => c.id === itemId);
  if (item) {
    item.done = !item.done;
    save();
  }
}

export function addChecklistItem(jobId: string, text: string): void {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job || !text.trim()) return;
  job.checklist.push({ id: uid(), text: text.trim(), done: false });
  save();
}

export function updateJobNotes(jobId: string, notes: string): void {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) return;
  job.notes = notes;
  save();
}

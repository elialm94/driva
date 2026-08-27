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

export interface JobNoteEntry {
  at?: string;
  text: string;
}

const NOTE_SEP = "\n\n---\n";

export function parseJobNotes(notes: string): JobNoteEntry[] {
  if (!notes.trim()) return [];
  return notes
    .split(NOTE_SEP)
    .map((part) => {
      const m = part.match(/^(\d{4}-\d{2}-\d{2}T[^\n]*)\n([\s\S]*)$/);
      if (m) return { at: m[1], text: m[2].trim() };
      return { text: part.trim() };
    })
    .filter((n) => n.text);
}

export function appendJobNote(jobId: string, text: string): void {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  const entry = `${new Date().toISOString()}\n${trimmed}`;
  job.notes = job.notes.trim() ? `${job.notes.trim()}${NOTE_SEP}${entry}` : entry;
  save();
}

export function updateJob(
  jobId: string,
  input: {
    title?: string;
    description?: string;
    address?: string;
    startDate?: string;
    endDate?: string;
    housing?: Job["housing"];
  }
): Job {
  const job = db().jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("Uppdraget finns inte");
  const customer = requireCustomer(job.customerId);
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new Error("Uppdraget behöver en titel");
    job.title = title;
  }
  if (input.description !== undefined) job.description = input.description;
  if (input.address !== undefined) job.address = input.address.trim() || undefined;
  if (input.startDate !== undefined) job.startDate = input.startDate || undefined;
  if (input.endDate !== undefined) job.endDate = input.endDate || undefined;
  if (input.housing !== undefined) job.housing = input.housing;
  logActivity(`Uppdraget ${job.title} hos ${customer.name} uppdaterades.`, {
    customerId: customer.id,
    entity: { type: "jobb", id: job.id },
  });
  save();
  return job;
}

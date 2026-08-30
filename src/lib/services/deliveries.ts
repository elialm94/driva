import { datumTid } from "../format";
import type { DocumentDelivery, Invoice, Quote } from "../types";

export function appendDelivery(
  doc: { deliveries?: DocumentDelivery[] },
  delivery: DocumentDelivery
): DocumentDelivery[] {
  const next = [...(doc.deliveries ?? []), delivery];
  doc.deliveries = next;
  return next;
}

export function deliveryTimelineLabel(d: DocumentDelivery): string {
  const via = d.channel === "SMS" ? "SMS" : "e-post";
  if (d.kind === "reminder") {
    return d.status === "sent" ? `Påminnelse skickad via ${via}` : `Påminnelse via ${via} misslyckades`;
  }
  return d.status === "sent" ? `Skickad via ${via}` : `Utskick via ${via} misslyckades`;
}

export type TimelineStep = { label: string; at?: string; done: boolean };

export function sendDeliverySteps(
  doc: { deliveries?: DocumentDelivery[]; sentAt?: string },
  fallbackLabel: string
): TimelineStep[] {
  const sends = (doc.deliveries ?? []).filter((d) => d.kind === "send");
  if (sends.length) {
    return sends.map((d) => ({
      label: deliveryTimelineLabel(d),
      at: d.sentAt ?? d.failedAt,
      done: d.status === "sent",
    }));
  }
  return [{ label: fallbackLabel, at: doc.sentAt, done: !!doc.sentAt }];
}

export function reminderDeliverySteps(
  invoice: Pick<Invoice, "deliveries" | "reminders">
): TimelineStep[] {
  const reminders = (invoice.deliveries ?? []).filter((d) => d.kind === "reminder");
  if (reminders.length) {
    return reminders.map((d) => ({
      label: deliveryTimelineLabel(d),
      at: d.sentAt ?? d.failedAt,
      done: d.status === "sent",
    }));
  }
  return invoice.reminders.map((r, i) => ({
    label: `Påminnelse ${i + 1}`,
    at: r,
    done: true,
  }));
}

export function quoteDeliverySteps(quote: Quote): TimelineStep[] {
  return sendDeliverySteps(quote, "Skickad");
}

export function invoiceDeliverySteps(invoice: Invoice): TimelineStep[] {
  const sends = sendDeliverySteps(invoice, "Skickad");
  const again =
    invoice.lastSentAt && invoice.sentAt && invoice.lastSentAt !== invoice.sentAt && !(invoice.deliveries ?? []).length
      ? [{ label: "Skickad igen", at: invoice.lastSentAt, done: true }]
      : [];
  return [...sends, ...again, ...reminderDeliverySteps(invoice)];
}

export function lastSendWarning(doc: { deliveries?: DocumentDelivery[] }): string | undefined {
  const sends = (doc.deliveries ?? []).filter((d) => d.kind === "send");
  if (!sends.length) return undefined;
  const email = [...sends].reverse().find((d) => d.channel === "EMAIL");
  const sms = [...sends].reverse().find((d) => d.channel === "SMS");
  if (email?.status === "sent" && sms?.status === "failed") return "E-post skickades, men SMS kunde inte skickas.";
  if (sms?.status === "sent" && email?.status === "failed") return "SMS skickades, men e-post kunde inte skickas.";
  return undefined;
}

export function formatDeliveryTime(at?: string): string {
  return at ? datumTid(at) : "";
}

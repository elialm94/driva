/**
 * Dela kundlänk utan ny integration: web share, sms: och urklipp.
 * Inget WhatsApp, ingen SMS-leverantör.
 */

export type CustomerShareKind = "offert" | "faktura" | "andring" | "uppdrag";

export function customerShareText(kind: CustomerShareKind, number: string | number | undefined): string {
  if (kind === "andring") return `Ändring${number != null ? ` ${number}` : ""} att godkänna`;
  if (kind === "uppdrag") return "Ditt uppdrag hos oss";
  const label = kind === "offert" ? "Offert" : "Faktura";
  const nr = number != null ? ` #${number}` : "";
  return `${label}${nr} från oss`;
}

export function smsShareHref(url: string, phone?: string, text?: string): string {
  const body = encodeURIComponent([text, url].filter(Boolean).join("\n"));
  const number = (phone ?? "").replace(/[^\d+]/g, "");
  return number ? `sms:${number}?body=${body}` : `sms:?body=${body}`;
}

export function canUseWebShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

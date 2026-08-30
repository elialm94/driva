/**
 * Säkra, läsbara PDF-filnamn: Offert-116-Sara-Nilsson.pdf
 * Svenska tecken translittereras så att mejlklienter och OS inte korrumperar namnet.
 */

const SWE: Record<string, string> = {
  å: "a",
  ä: "a",
  ö: "o",
  Å: "A",
  Ä: "A",
  Ö: "O",
  é: "e",
  É: "E",
  ü: "u",
  Ü: "U",
};

export function documentPdfFilename(kind: "offert" | "faktura", number: number | null | undefined, customerName: string): string {
  const prefix = kind === "offert" ? "Offert" : "Faktura";
  const num = number != null && Number.isFinite(number) ? String(number) : "utkast";
  const who = slugName(customerName) || "kund";
  return `${prefix}-${num}-${who}.pdf`;
}

export function slugName(name: string): string {
  const mapped = [...name.trim()].map((ch) => SWE[ch] ?? ch).join("");
  return mapped
    .replace(/['’]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

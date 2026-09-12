import { db } from "../store";
import { generateSie, encodeSieToPc8 } from "../accounting/sie";
import { fiscalYears, resolveViewFiscalYear } from "../accounting/fiscal";
import { verificationLabel } from "../accounting/engine";
import { bokforingsdatum } from "../accounting/dates";
import { buildZip } from "../archive/zip";
import { mailFromAddress, mailProviderAvailable, sendMail } from "../mail";

/**
 * SIE plus underlagsregister för ett räkenskapsår, att skicka till
 * redovisningskonsulten. Utan Resend-nyckel får användaren ladda ner paketet.
 */

export function accountantPackFilename(fiscalYearId?: string): string {
  const fy = fiscalYearId ? fiscalYears().find((f) => f.id === fiscalYearId) : resolveViewFiscalYear();
  const slug = db().settings.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "foretag";
  return `${slug}-${fy?.label ?? "bokforing"}-konsult.zip`;
}

export function buildAccountantPack(fiscalYearId?: string): { filename: string; bytes: Buffer } {
  const fy = fiscalYearId ? fiscalYears().find((f) => f.id === fiscalYearId) : resolveViewFiscalYear();
  if (!fy) throw new Error("Räkenskapsåret finns inte.");
  const sie = encodeSieToPc8(generateSie(fy.id));
  const register = underlagsregisterCsv(fy.startDate, fy.endDate);
  const bytes = buildZip([
    { path: `${fy.label}.se`, bytes: Buffer.from(sie) },
    { path: `underlagsregister-${fy.label}.csv`, bytes: Buffer.from(register, "utf8") },
  ]);
  return { filename: accountantPackFilename(fy.id), bytes };
}

function underlagsregisterCsv(from: string, to: string): string {
  const rows = [["Verifikation", "Datum", "Beskrivning", "Belopp", "Underlag"]];
  for (const v of db().verifications) {
    const d = bokforingsdatum(v.date);
    if (d < from || d > to) continue;
    const amount = v.entries.reduce((s, e) => s + e.debit, 0);
    rows.push([
      verificationLabel(v),
      d,
      v.description.replace(/;/g, ","),
      String(amount),
      v.attachment ? v.attachment.filename : "",
    ]);
  }
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
}

export async function emailAccountantPack(input: {
  to: string;
  fiscalYearId?: string;
}): Promise<{ ok: true; mode: "sent" | "download"; filename?: string; bytesBase64?: string } | { ok: false; error: string }> {
  const pack = buildAccountantPack(input.fiscalYearId);
  const fy = input.fiscalYearId ? fiscalYears().find((f) => f.id === input.fiscalYearId) : resolveViewFiscalYear();
  const name = db().settings.name;
  if (!mailProviderAvailable()) {
    return {
      ok: true,
      mode: "download",
      filename: pack.filename,
      bytesBase64: pack.bytes.toString("base64"),
    };
  }
  const result = await sendMail({
    to: input.to.trim(),
    from: mailFromAddress(),
    subject: `Bokföring ${fy?.label ?? ""} – ${name}`,
    text: `Här är SIE-filen och underlagsregistret för ${name}, räkenskapsår ${fy?.label ?? ""}.`,
    html: `<p>Här är SIE-filen och underlagsregistret för ${name}, räkenskapsår ${fy?.label ?? ""}.</p>`,
    attachments: [
      {
        filename: pack.filename,
        content: pack.bytes,
        contentType: "application/zip",
      },
    ],
  }, { kind: "accountant_pack" });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, mode: "sent" };
}

export function packSummary(fiscalYearId?: string): { year: string; verifications: number; withAttachment: number } {
  const fy = fiscalYearId ? fiscalYears().find((f) => f.id === fiscalYearId) : resolveViewFiscalYear();
  if (!fy) return { year: "", verifications: 0, withAttachment: 0 };
  let verifications = 0;
  let withAttachment = 0;
  for (const v of db().verifications) {
    const d = bokforingsdatum(v.date);
    if (d < fy.startDate || d > fy.endDate) continue;
    verifications++;
    if (v.attachment) withAttachment++;
  }
  return { year: fy.label, verifications, withAttachment };
}

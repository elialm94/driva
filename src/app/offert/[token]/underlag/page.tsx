import { notFound } from "next/navigation";
import { FileLock2, ShieldCheck } from "lucide-react";
import { BackAnchor } from "@/components/back-link";
import { db } from "@/lib/store";
import { getQuoteByToken, quoteAcceptance } from "@/lib/services/data";
import { quoteVersionHash } from "@/lib/hash";
import { datumTid } from "@/lib/format";
import { Badge, DemoTag } from "@/components/ui";
import { resolveQuoteCompany } from "@/lib/invoices/snapshot";
import { QUOTE_ACCEPT_METHOD } from "@/lib/status-labels";
import { ensurePublicPage } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Underlag för godkännandet" };

/**
 * Publikt underlag för kundens godkännande: vad som godkändes (låst version +
 * SHA-256), av vem (namnet kunden skrev), när, och att dokumentet är oförändrat.
 * IP-adress och enhet visas bara för företagaren i appen – inte på den
 * publika länken.
 */
export default async function AcceptanceEvidencePage(props: PageProps<"/offert/[token]/underlag">) {
  const { token } = await props.params;
  if (!(await ensurePublicPage("quote", token))) notFound();
  const quote = getQuoteByToken(token);
  if (!quote) notFound();
  const acceptance = quoteAcceptance(quote.id);
  if (!acceptance) notFound();

  const data = db();
  const version = data.quoteVersions.find((v) => v.id === acceptance.quoteVersionId);
  if (!version) notFound();
  const recomputed = quoteVersionHash(version);
  const intact = recomputed === acceptance.contentHash;
  // Avsändaren i underlaget ska spegla den godkända versionen, inte dagens inställningar.
  const seller = resolveQuoteCompany(version, data.settings);
  const legacyBankid = acceptance.bankid;

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "Dokument", value: `Offert #${quote.number} – ${version.title}` },
    {
      label: "Offertversion",
      value: `Version ${version.version} (låst ${version.lockedAt ? datumTid(version.lockedAt) : "–"})`,
    },
    { label: "Avsändare", value: `${seller.name} (org.nr ${seller.orgNumber})` },
    { label: "Godkänd av", value: acceptance.acceptedByName },
    { label: "Kund", value: acceptance.customerNameAtAccept },
    ...(acceptance.acceptedByEmail ? [{ label: "E-post", value: acceptance.acceptedByEmail }] : []),
    ...(acceptance.linkSentTo ? [{ label: "Offertlänken skickades till", value: acceptance.linkSentTo }] : []),
    { label: "Tidpunkt", value: datumTid(acceptance.acceptedAt) },
    { label: "Sätt", value: QUOTE_ACCEPT_METHOD[acceptance.method] },
    ...(legacyBankid ? [{ label: "Ordernummer", value: legacyBankid.orderRef, mono: true }] : []),
    { label: "Dokument-hash (SHA-256)", value: acceptance.contentHash, mono: true },
    { label: "Hash vid kontroll nu", value: recomputed, mono: true },
  ];

  if (version.taxReductionTerms) {
    rows.splice(3, 0,
      { label: "ROT/RUT", value: version.taxReductionTerms.type === "rot" ? "ROT" : "RUT" },
      { label: "ROT/RUT-villkor", value: `Version ${version.taxReductionTerms.version}` },
    );
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <main className="mx-auto max-w-2xl px-5 py-10">
        <div className="mb-6">
          <BackAnchor href={`/offert/${quote.token}`} label={`Offert #${quote.number}`} />
        </div>

        <div className="overflow-hidden rounded-3xl border border-line bg-card shadow-card">
          <div className="border-b border-line bg-ok-soft/40 px-7 py-6">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-ink text-white">
                <FileLock2 className="size-5" />
              </div>
              <div>
                <h1 className="text-[20px] font-semibold tracking-tight">Underlag för godkännandet</h1>
                <p className="text-[13px] text-soft">Vad som godkändes, av vem och när</p>
              </div>
            </div>
          </div>

          <div className="px-7 py-6">
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {intact ? (
                <Badge tone="ok">
                  <ShieldCheck className="size-3.5" /> Dokumentet är oförändrat sedan godkännandet
                </Badge>
              ) : (
                <Badge tone="danger">Dokumentet matchar inte den godkända versionen</Badge>
              )}
              {legacyBankid ? <DemoTag>Demo-signering</DemoTag> : null}
            </div>

            <dl className="divide-y divide-line/70">
              {rows.map((r) => (
                <div key={r.label} className="grid gap-1 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
                  <dt className="text-[13px] font-medium text-muted">{r.label}</dt>
                  <dd className={r.mono ? "break-all font-mono text-[12px] leading-relaxed text-soft" : "text-[14px] text-ink"}>
                    {r.value}
                  </dd>
                </div>
              ))}
            </dl>

            {acceptance.statement ? (
              <div className="mt-5 rounded-2xl border border-line bg-canvas/50 px-4 py-3.5">
                <p className="text-[13px] font-semibold text-ink">Det kunden godkände</p>
                <p className="mt-1 text-[13px] leading-relaxed text-soft">{acceptance.statement}</p>
              </div>
            ) : null}

            {version.taxReductionTerms ? (
              <div className="mt-5 rounded-2xl border border-line bg-canvas/50 px-4 py-3.5">
                <p className="text-[13px] font-semibold text-ink">{version.taxReductionTerms.heading}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-soft">{version.taxReductionTerms.body}</p>
                <p className="mt-2 text-[12px] text-muted">
                  Den här texten ingick i den godkända versionen och ingår i dokument-hashen.
                </p>
              </div>
            ) : null}

            <div className="mt-5 rounded-2xl bg-canvas/70 px-4 py-3.5 text-[13px] leading-relaxed text-soft">
              <p className="font-medium text-ink">Så fungerar verifieringen</p>
              <p className="mt-1">
                Vid godkännandet låstes offertversionen och en kontrollsumma (SHA-256) av hela innehållet sparades
                tillsammans med namnet kunden skrev, tidpunkten, adressen offertlänken skickades till och den mening
                kunden godkände. Genom att räkna om kontrollsumman kan man när som helst styrka att dokumentet inte
                ändrats efter godkännandet.
              </p>
              <p className="mt-2">
                Godkännandet är en enkel elektronisk underskrift: det bygger på namnet kunden angav och på att
                offertlänken skickades till kundens e-postadress. Ingen elektronisk legitimering har gjorts.
              </p>
              {legacyBankid ? (
                <p className="mt-2 text-warn">
                  Detta är en äldre demo-signering – ingen legitimering har skett och inga personuppgifter har hämtats.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

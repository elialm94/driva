import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileLock2, ShieldCheck } from "lucide-react";
import { db } from "@/lib/store";
import { getQuoteByToken, quoteSignature } from "@/lib/services/data";
import { quoteVersionHash } from "@/lib/hash";
import { datumTid } from "@/lib/format";
import { Badge, DemoTag } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signeringsunderlag" };

export default async function SigningEvidencePage(props: PageProps<"/offert/[token]/underlag">) {
  const { token } = await props.params;
  const quote = getQuoteByToken(token);
  if (!quote) notFound();
  const signature = quoteSignature(quote.id);
  if (!signature) notFound();

  const data = db();
  const version = data.quoteVersions.find((v) => v.id === signature.quoteVersionId);
  if (!version) notFound();
  const recomputed = quoteVersionHash(version);
  const intact = recomputed === signature.evidence.contentHash;

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "Dokument", value: `Offert #${quote.number} – ${version.title}` },
    { label: "Offertversion", value: `Version ${version.version} (låst ${version.lockedAt ? datumTid(version.lockedAt) : "–"})` },
    { label: "Avsändare", value: `${data.settings.name} (org.nr ${data.settings.orgNumber})` },
    { label: "Undertecknare", value: `${signature.signerName} (${signature.signerPersonalNumberMasked})` },
    { label: "Tidpunkt", value: datumTid(signature.signedAt) },
    { label: "Ordernummer (orderRef)", value: signature.orderRef, mono: true },
    { label: "Dokument-hash (SHA-256)", value: signature.evidence.contentHash, mono: true },
    { label: "Hash vid kontroll nu", value: recomputed, mono: true },
  ];

  return (
    <div className="min-h-dvh bg-canvas">
      <main className="mx-auto max-w-2xl px-5 py-10">
        <Link
          href={`/offert/${quote.token}` as never}
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" /> Tillbaka till offerten
        </Link>

        <div className="overflow-hidden rounded-3xl border border-line bg-card shadow-card">
          <div className="border-b border-line bg-bankid-soft/50 px-7 py-6">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-bankid text-white">
                <FileLock2 className="size-5" />
              </div>
              <div>
                <h1 className="text-[20px] font-semibold tracking-tight">Signeringsunderlag</h1>
                <p className="text-[13px] text-soft">Verifierbart underlag för BankID-godkännandet</p>
              </div>
            </div>
          </div>

          <div className="px-7 py-6">
            <div className="mb-5 flex items-center gap-2">
              {intact ? (
                <Badge tone="ok">
                  <ShieldCheck className="size-3.5" /> Dokumentet är oförändrat sedan signeringen
                </Badge>
              ) : (
                <Badge tone="danger">Varning: dokumentet matchar inte signerad version</Badge>
              )}
              {signature.environment === "mock" ? <DemoTag>Demo-signatur</DemoTag> : null}
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

            <div className="mt-5 rounded-2xl bg-canvas/70 px-4 py-3.5 text-[13px] leading-relaxed text-soft">
              <p className="font-medium text-ink">Så fungerar verifieringen</p>
              <p className="mt-1">
                Vid signeringen låstes offertversionen och en kryptografisk kontrollsumma (SHA-256) av hela innehållet
                sparades tillsammans med BankID-signaturen. Genom att räkna om kontrollsumman kan man när som helst styrka
                att dokumentet inte ändrats efter godkännandet. I produktion sparas även BankID:s fullständiga
                signaturbevis (XML-DSig) och OCSP-svar, som knyter signeringen till undertecknarens identitet.
              </p>
              {signature.environment === "mock" ? (
                <p className="mt-2 text-warn">
                  Detta är en demo-signering – ingen riktig BankID-legitimering har skett och inga personuppgifter har
                  hämtats.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

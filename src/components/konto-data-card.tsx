import Link from "next/link";
import { Download } from "lucide-react";
import { Card, buttonClasses } from "./ui";

export interface KontoDataCardProps {
  demo: boolean;
  /** Senast godkänd villkorsversion och när. */
  terms: { acceptedVersion: string | null; acceptedAt: string | null; currentVersion: string };
  /** Avtalspart – null när miljön saknar LEGAL_*-uppgifter. */
  legalEntity: { name: string; orgNumber: string } | null;
}

/**
 * Dina uppgifter och kontoavslut (spec §7): export av registrerades uppgifter,
 * godkänd villkorsversion, och en ärlig beskrivning av vad som händer vid
 * kontoavslut (bokföringslagens bevarandetid). Ingen radering utlovas som
 * inte kan hållas.
 */
export function KontoDataCard({ demo, terms, legalEntity }: KontoDataCardProps) {
  return (
    <Card className="space-y-3 p-6" data-konto-data>
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Dina uppgifter och avtal</p>
      <dl className="grid gap-x-6 gap-y-1.5 text-[14px] sm:grid-cols-[160px_1fr]">
        <dt className="text-muted">Avtalspart</dt>
        <dd className="text-soft">
          {legalEntity ? `${legalEntity.name} (org.nr ${legalEntity.orgNumber})` : "Ej konfigurerad i den här miljön"}
        </dd>
        <dt className="text-muted">Godkända villkor</dt>
        <dd className="text-soft" data-konto-terms-version={terms.acceptedVersion ?? ""}>
          {demo
            ? "Demon har inget avtal."
            : terms.acceptedVersion
              ? `Version ${terms.acceptedVersion}${terms.acceptedAt ? ` · ${terms.acceptedAt.slice(0, 10)}` : ""}`
              : "Inget godkännande registrerat"}
          {" · "}
          <Link href="/villkor" className="underline hover:text-ink">
            villkor
          </Link>
          {" · "}
          <Link href="/integritet" className="underline hover:text-ink">
            integritetspolicy
          </Link>
          {" · "}
          <Link href="/bitradesavtal" className="underline hover:text-ink">
            biträdesavtal
          </Link>
        </dd>
      </dl>
      <p className="text-[14px] leading-relaxed text-soft">
        Du kan ladda ner de uppgifter Ferva behandlar om dig som användare (konto, medlemskap, godkända villkor,
        supportärenden). Företagets bokföring exporteras som SIE och arkiv under Bokföring.
      </p>
      {demo ? (
        <p className="text-[13px] text-muted">Exporten finns för riktiga konton – demon har inga personuppgifter att exportera.</p>
      ) : (
        <a href="/api/konto/export" className={buttonClasses("secondary", "sm")} data-konto-export download>
          <Download className="size-3.5 shrink-0" />
          Ladda ner mina uppgifter (JSON)
        </a>
      )}
      <div className="border-t border-line pt-3">
        <p className="text-[13px] font-medium text-ink">Avsluta kontot</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
          Begär kontoavslut via{" "}
          <Link href="/support" className="underline hover:text-ink">
            supporten
          </Link>
          . Vi inaktiverar företaget, raderar eller anonymiserar uppgifter som inte behöver bevaras och håller
          räkenskapsinformationen (verifikationer, utfärdade fakturor, bokslut) skrivskyddad i sju år enligt
          bokföringslagen innan den raderas. Exportera det du vill behålla först.
        </p>
      </div>
    </Card>
  );
}

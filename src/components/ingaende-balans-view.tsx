import { Check, Lock } from "lucide-react";
import { db } from "@/lib/store";
import { kr } from "@/lib/format";
import { fiscalYears } from "@/lib/accounting/fiscal";
import { Badge, Card, SectionTitle, cx } from "./ui";
import { SieImportPanel } from "./sie-import";

/**
 * Ingående balanser: att ta över en bokföring som redan finns.
 *
 * En byrå får sällan börja på tomt papper. Klienten kommer från Fortnox eller
 * Visma, och det som måste följa med är kontoplanen och balansräkningen – utan
 * dem utgår varje rapport från noll och bokföringen ljuger.
 *
 * Sidan finns på båda ytorna, för både byrån och en ägare som byter program gör
 * samma sak. Den är avsiktligt inte en flik: övertagandet görs en gång, och en
 * permanent knapp för att skriva om ingående balanser är en risk utan nytta.
 */

export interface IngaendeBalansViewProps {
  /** Klienten importen gäller. Konsultytan skickar den. */
  businessId?: string;
  /** Revisorn läser balanserna men sätter dem inte. */
  readOnly?: boolean;
}

export function IngaendeBalansView({ businessId, readOnly }: IngaendeBalansViewProps) {
  const years = fiscalYears();
  const open = years.filter((f) => f.status === "oppet");
  // Det äldsta öppna året är det som ska ha ingående balans: senare år får sin
  // ur bokslutet.
  const target = open[0];

  return (
    <>
      {target ? (
        <>
          <SectionTitle>Ingående balans {target.label}</SectionTitle>
          <Card className="mb-6 px-6 py-5">
            <SourceSummary fiscalYearId={target.id} />
            {readOnly ? (
              <p className="mt-4 border-t border-line/60 pt-4 text-[13px] text-soft">
                Endast läsning – en revisor sätter inte ingående balanser.
              </p>
            ) : (
              <div className="mt-4 border-t border-line/60 pt-4">
                <SieImportPanel
                  fiscalYearId={target.id}
                  fiscalYearLabel={target.label}
                  businessId={businessId}
                />
              </div>
            )}
          </Card>
        </>
      ) : (
        <Card className="mb-6 px-6 py-5">
          <p className="text-[14px] text-soft">
            Alla räkenskapsår är stängda. Ett nytt år öppnas automatiskt vid nästa bokförda händelse, och då kan
            ingående balanser sättas.
          </p>
        </Card>
      )}

      <p className="text-[12px] leading-relaxed text-muted">
        SIE är standardformatet som Fortnox, Visma, Björn Lundén och Drivas egen export talar. Filen som behövs är en
        SIE 1 (balanser) eller SIE 4 (balanser och verifikationer) – Driva läser båda och tar med kontoplanen och
        balanserna. Verifikationerna importeras inte: bokföring i Driva är oföränderlig och numrerad av motorn, och att
        skriva in en främmande historik i den vore att påstå att Driva bokförde den.
      </p>
    </>
  );
}

/** Var kommer dagens ingående balans ifrån, och vad står den på? */
function SourceSummary({ fiscalYearId }: { fiscalYearId: string }) {
  const fy = db().fiscalYears.find((f) => f.id === fiscalYearId);
  if (!fy) return null;
  const rows = Object.entries(fy.openingBalances)
    .map(([account, amount]) => ({ account: Number(account), amount }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.account - b.account);
  const booked = db().verifications.filter((v) => v.fiscalYearId === fy.id).length;

  if (fy.openingSource === "foregaende_ar") {
    return (
      <div className="flex items-start gap-2.5">
        <Lock className="mt-0.5 size-4.5 shrink-0 text-muted" />
        <p className="text-[13.5px] leading-relaxed text-soft">
          {fy.label} har ingående balanser från bokslutet för {Number(fy.label) - 1}. De är räknade ur en stängd
          bokföring och går inte att skriva över med en fil – ska de ändras görs det genom att öppna {Number(fy.label) - 1}{" "}
          igen.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-[13.5px] leading-relaxed text-soft">
        {fy.label} börjar på noll. Är det bolagets första år är det rätt. Kommer bokföringen från ett annat program ska
        balansräkningen därifrån in här först – annars saknar {fy.label} sin historia.
        {booked > 0
          ? ` Observera att det redan finns ${booked} verifikation${booked === 1 ? "" : "er"} bokförd${booked === 1 ? "" : "a"} i året; ingående balanser måste vara på plats innan bokföringen börjar.`
          : ""}
      </p>
    );
  }

  const sum = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13.5px] font-medium">
          <Check className="size-4 text-ok" />
          {fy.label} har ingående balanser
        </p>
        <Badge tone="neutral">
          {fy.openingSource === "migrering" ? "Importerade från SIE" : "Satta för hand"}
        </Badge>
      </div>
      <table className="mt-3 w-full text-[13px]">
        <tbody>
          {rows.map((row) => (
            <tr key={row.account} className="border-t border-line/50">
              <td className="py-1.5 pr-3">
                <span className="font-mono text-muted">{row.account}</span>
              </td>
              <td className="py-1.5 text-right tabular">{kr(row.amount)}</td>
            </tr>
          ))}
          <tr className="border-t border-line">
            <td className="py-1.5 pr-3 font-medium">Summa</td>
            <td className={cx("py-1.5 text-right font-semibold tabular", sum !== 0 && "text-warn")}>{kr(sum)}</td>
          </tr>
        </tbody>
      </table>
      {booked > 0 ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          Det finns {booked} verifikation{booked === 1 ? "" : "er"} bokförd{booked === 1 ? "" : "a"} i {fy.label}, så
          balanserna går inte att importera om. En rättelse bokförs som verifikation.
        </p>
      ) : null}
    </div>
  );
}

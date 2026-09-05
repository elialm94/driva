import { notFound } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { Badge, Card, PageHeader, cx } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { kr, procent } from "@/lib/format";
import { ensurePageBusiness } from "@/lib/auth/session";
import { getFiscalYear } from "@/lib/accounting/fiscal";
import { computeTaxCalculation, ink2Rows } from "@/lib/accounting/tax";
import { DEPRECIATION_RULE_LABEL, schablonranta } from "@/lib/accounting/ink2-model";
import { sruForFiscalYear, type SruFiling } from "@/lib/accounting/sru";
import { InlamningPanel } from "@/components/inlamning";
import { filingPanelData } from "@/lib/filing/view";
import { db } from "@/lib/store";

export const metadata = { title: "INK2" };

/**
 * INK2S: skattemässiga justeringar.
 *
 * Sidan visar varför bokföringens resultat och skattens resultat är olika tal.
 * Skillnaden är inte ett fel att rätta – den är avsiktlig, en post i taget, och
 * varje post hör till en numrerad ruta på Skatteverkets blankett. Rutnumren står
 * kvar i vyn just därför: den som ska fylla i eller granska deklarationen läser
 * dem, och utan dem är en justering bara ett tal.
 */
export default async function Ink2Page(props: { params: Promise<{ fiscalYearId: string }> }) {
  await ensurePageBusiness();
  const { fiscalYearId } = await props.params;
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) notFound();

  if ((db().settings.companyForm ?? "ab") !== "ab") {
    return (
      <div>
        <PageHeader back={<SmartBack />} title={`INK2 ${fy.label}`} subtitle="Skattemässiga justeringar." />
        <Card className="px-6 py-5">
          <p className="text-[14px] leading-relaxed text-soft">
            INK2 är aktiebolagets deklaration. En enskild firma deklareras hos ägaren på NE-bilagan, med egenavgifter och
            räntefördelning i stället för bolagsskatt – det stöder Driva inte automatiskt ännu.
          </p>
        </Card>
      </div>
    );
  }

  const tax = computeTaxCalculation(fy);
  const rows = ink2Rows(tax);
  const depreciation = tax.depreciation;
  const rate = schablonranta(Number(fy.endDate.slice(0, 4)));
  // Blanketten har ett fält per ruta, men flera poster kan hamna i samma ruta.
  // Då måste alla posterna synas – annars står ett summerat belopp intill en
  // enda förklaring och de andra posterna blir osynliga.
  const byField = new Map<string, typeof tax.adjustments>();
  for (const a of tax.adjustments) byField.set(a.field, [...(byField.get(a.field) ?? []), a]);

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title={`INK2 ${fy.label}`}
        subtitle="Varför skattens resultat inte är bokföringens."
        actions={<PrintButton />}
      />

      <Card className="mb-6 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Skattemässiga justeringar (INK2S)</h2>
          <Badge tone="neutral">Uppskattad/preliminär</Badge>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
          Blanketten börjar i årets resultat efter skatt och lägger tillbaka skatten, eftersom bolagsskatten inte är en
          avdragsgill kostnad. Därefter kommer en rad per skillnad mellan god redovisningssed och skattelagen.
        </p>

        <table className="mt-4 w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="pb-1.5 font-semibold">Ruta</th>
              <th className="pb-1.5 font-semibold">Post</th>
              <th className="pb-1.5 text-right font-semibold">Belopp</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const last = row.field === "4.15" || row.field === "4.16";
              const parts = byField.get(row.field) ?? [];
              const single = parts.length === 1 ? parts[0] : undefined;
              return (
                <tr key={row.field} className={cx("border-t border-line/50", last && "border-ink/20")}>
                  <td className="py-2 pr-3 align-top font-medium tabular text-muted">{row.field}</td>
                  <td className="py-2 pr-3 align-top">
                    <span className={cx(last && "font-semibold")}>{single?.label ?? row.label}</span>
                    {single ? (
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{single.explanation}</span>
                    ) : null}
                    {parts.length > 1 ? (
                      <ul className="mt-1 space-y-1">
                        {parts.map((p, i) => (
                          <li key={i} className="text-[12px] leading-relaxed text-muted">
                            <span className="flex justify-between gap-3">
                              <span className="font-medium text-soft">{p.label}</span>
                              <span className="tabular text-soft">{kr(p.amount)}</span>
                            </span>
                            {p.explanation}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className={cx("py-2 text-right align-top tabular", last && "font-semibold")}>{kr(row.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 space-y-1.5 rounded-xl bg-canvas/70 px-4 py-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-soft">Resultat före skatt enligt bokföringen</span>
            <span className="font-medium tabular">{kr(tax.redovisningsresultat)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-soft">Beskattningsbart resultat</span>
            <span className="font-medium tabular">{kr(tax.beskattningsbartResultat)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-1.5">
            <span className="font-medium">Beräknad bolagsskatt (20,6 %)</span>
            <span className="font-semibold tabular">{kr(tax.beraknadSkatt)}</span>
          </div>
          {tax.bokfordSkatt !== 0 ? (
            <div className="flex justify-between">
              <span className="text-soft">Varav redan bokförd</span>
              <span className="font-medium tabular">{kr(tax.bokfordSkatt)}</span>
            </div>
          ) : null}
        </div>
      </Card>

      {tax.utnyttjatUnderskott > 0 || tax.kvarvarandeUnderskott > 0 ? (
        <Card className="mb-6 px-6 py-5">
          <h3 className="text-[15px] font-semibold">Underskott från tidigare år</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
            Ett skattemässigt underskott rullar framåt utan tidsgräns och dras av mot senare vinster. Beloppet står inte i
            bokföringen – eget kapital bär redovisningens förlust, inte skattens – utan räknas fram ur de avslutade årens
            deklarationer.
          </p>
          <div className="mt-3 space-y-1.5 rounded-xl bg-canvas/70 px-4 py-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-soft">Resultat före underskottsavdrag</span>
              <span className="font-medium tabular">{kr(tax.resultatForeUnderskott)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-soft">Utnyttjat i år (ruta 4.14a)</span>
              <span className="font-medium tabular">{kr(-tax.utnyttjatUnderskott)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5">
              <span className="font-medium">Kvar att spara till kommande år</span>
              <span className="font-semibold tabular">{kr(tax.kvarvarandeUnderskott)}</span>
            </div>
          </div>
          {tax.kvarvarandeUnderskott > 0 ? (
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Rätten till underskottsavdrag kan begränsas vid ägarförändringar. Byter bolaget ägare behöver
              beloppsspärren och koncernbidragsspärren bedömas för hand.
            </p>
          ) : null}
        </Card>
      ) : null}

      {depreciation ? (
        <Card className="mb-6 px-6 py-5">
          <h3 className="text-[15px] font-semibold">Inventarieavskrivningar</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
            Bokföringen skriver av över nyttjandetiden, månad för månad. Skattereglerna räknar på hela året och på hela
            beståndet, och bolaget får välja den regel som ger störst avdrag. Talen är därför sällan lika – det är
            meningen.
          </p>
          <div className="mt-3 space-y-1.5 rounded-xl bg-canvas/70 px-4 py-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-soft">Avskrivningsunderlag</span>
              <span className="font-medium tabular">{kr(depreciation.limits.basis)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-soft">Lägsta värde enligt huvudregeln (30 %)</span>
              <span className="font-medium tabular">{kr(depreciation.limits.lowestValueHuvudregeln)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-soft">Lägsta värde enligt kompletteringsregeln (20 %)</span>
              <span className="font-medium tabular">{kr(depreciation.limits.lowestValueKompletteringsregeln)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5">
              <span className="font-medium">Högsta avdrag i år · {DEPRECIATION_RULE_LABEL[depreciation.limits.rule]}</span>
              <span className="font-semibold tabular">{kr(depreciation.limits.maxDepreciation)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-soft">Bokförd avskrivning enligt plan</span>
              <span className="font-medium tabular">{kr(depreciation.bookedDepreciation)}</span>
            </div>
            {depreciation.bookedOverDepreciation !== 0 ? (
              <div className="flex justify-between">
                <span className="text-soft">Bokförd överavskrivning</span>
                <span className="font-medium tabular">{kr(depreciation.bookedOverDepreciation)}</span>
              </div>
            ) : null}
            {depreciation.unusedHeadroom > 0 ? (
              <div className="flex justify-between border-t border-line pt-1.5">
                <span className="font-medium">Outnyttjat utrymme kvar i år</span>
                <span className="font-semibold tabular">{kr(depreciation.unusedHeadroom)}</span>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <SruCard fiscalYearId={fy.id} label={fy.label} />

      {tax.manualReviewNotes.length > 0 ? (
        <Card className="mb-6 border-warn/40 px-6 py-5">
          <div className="flex items-start gap-2.5">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-warn" />
            <div>
              <h3 className="text-[15px] font-semibold">Behöver granskas för hand</h3>
              <ul className="mt-2 space-y-1.5">
                {tax.manualReviewNotes.map((note, i) => (
                  <li key={i} className="text-[13px] leading-relaxed text-soft">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      <p className="text-[12px] leading-relaxed text-muted">
        Beräkningen är preliminär tills deklarationen är lämnad. Driva lämnar inte in något till Skatteverket.
        {rate !== undefined
          ? ` Schablonräntan på periodiseringsfonder för beskattningsår ${fy.endDate.slice(0, 4)} är ${procent(rate)}.`
          : ""}{" "}
        Blanketten har fler rutor än de här – koncernbidrag, andelsförsäljningar och ackord kräver bedömningar som Driva
        inte gör, och de saknas hellre än att fyllas i på en gissning.
      </p>
    </div>
  );
}

/**
 * Filerna till Skatteverkets e-tjänst Filöverföring. Kortet visar vad filen
 * innehåller innan den hämtas – granskningsperiod, rutor och de konton som
 * saknar koppling till räkenskapsschemat – för ett fel i filen märks annars
 * först vid uppladdningen, och då utan att säga vilket konto det gäller.
 */
function SruCard({ fiscalYearId, label }: { fiscalYearId: string; label: string }) {
  let filing: SruFiling;
  try {
    filing = sruForFiscalYear(fiscalYearId);
  } catch (e) {
    return (
      <Card className="mb-6 border-warn/40 px-6 py-5">
        <h3 className="text-[15px] font-semibold">Deklarationsfil (SRU)</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
          {e instanceof Error ? e.message : "Filen kunde inte skapas."}
        </p>
      </Card>
    );
  }

  const rutor = filing.blocks.reduce((n, b) => n + b.uppgifter.length, 0);
  return (
    <Card className="mb-6 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold">Deklarationsfil (SRU)</h3>
        <Badge tone="neutral">{filing.period}</Badge>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-soft">
        Två filer med samma innehåll som blanketten: INFO.SRU säger vem som lämnar uppgifterna, BLANKETTER.SRU bär INK2,
        räkenskapsschemat (INK2R) och de skattemässiga justeringarna (INK2S) – {rutor} ifyllda rutor. Lägg båda filerna i
        Skatteverkets e-tjänst Filöverföring.
      </p>
      <div className="mt-3 flex flex-wrap gap-4">
        <a
          href={`/api/bokforing/deklaration?typ=ink2&fil=blanketter&rakenskapsar=${fiscalYearId}`}
          className="text-[13px] font-medium text-accent hover:underline"
        >
          Hämta BLANKETTER.SRU
        </a>
        <a
          href={`/api/bokforing/deklaration?typ=ink2&fil=info&rakenskapsar=${fiscalYearId}`}
          className="text-[13px] font-medium text-accent hover:underline"
        >
          Hämta INFO.SRU
        </a>
      </div>
      {filing.unmappedAccounts.length > 0 ? (
        <div className="mt-4 rounded-xl border border-warn/40 bg-warn/5 px-4 py-3">
          <p className="text-[13px] font-medium">Konton som inte kom med i filen</p>
          <ul className="mt-1.5 space-y-1">
            {filing.unmappedAccounts.map((u) => (
              <li key={u.account} className="flex justify-between gap-4 text-[13px] text-soft">
                <span>
                  {u.account} {u.name}
                </span>
                <span className="tabular">{kr(u.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            Räkenskapsschemat har ingen ruta för de här kontona. Beloppen måste fyllas i för hand i e-tjänsten, annars
            stämmer inte filen mot bokslutet – {label} är inte komplett förrän de är med.
          </p>
        </div>
      ) : null}
      <InlamningPanel {...filingPanelData("ink2", fiscalYearId)} className="mt-4" />
    </Card>
  );
}

import { ArrowDownLeft, ArrowUpRight, Landmark } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import {
  BookFSkattButton,
  BookTaxAccountDepositButton,
  BookVatOnTaxAccountButton,
  TaxAccountReconcileForm,
} from "@/components/skattekonto-widgets";
import { kr, datumKort, datumLang } from "@/lib/format";
import { db } from "@/lib/store";
import { ensurePageBusiness } from "@/lib/auth/session";
import {
  fSkattMonthsAwaitingBooking,
  taxAccountDepositCandidates,
  taxAccountLedger,
  vatReportsAwaitingTaxAccount,
  TAX_ACCOUNT_KIND_LABEL,
} from "@/lib/accounting/tax-account";

export const metadata = { title: "Skattekonto" };

export default async function SkattekontoPage() {
  await ensurePageBusiness();
  const ledger = taxAccountLedger();
  const awaitingVat = vatReportsAwaitingTaxAccount();
  const awaitingFSkatt = fSkattMonthsAwaitingBooking();
  const deposits = taxAccountDepositCandidates();
  const fSkattPerMonth = db().settings.fSkattPerMonth;
  const todo = awaitingVat.length + awaitingFSkatt.length + deposits.length;

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Skattekonto"
        subtitle="Bolagets konto hos Skatteverket. Moms, F-skatt och arbetsgivaravgifter dras härifrån, och du fyller på det från banken."
        actions={<PrintButton />}
      />

      <Card className="mb-8 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Landmark className="size-4.5 text-muted" />
              <h2 className="text-[15px] font-semibold">Saldo enligt bokföringen</h2>
              <Badge tone={ledger.balance < 0 ? "warn" : "ok"}>{ledger.balance < 0 ? "Skuld" : "Tillgodo"}</Badge>
            </div>
            <p className="mt-1 text-[13px] text-soft">
              Konto 1630. {ledger.balance < 0
                ? "Skatteverket har en fordran på bolaget – fyll på kontot innan förfallodagen."
                : "Pengarna är kvar i bolaget, de står bara hos Skatteverket."}
            </p>
          </div>
          <p className="text-[26px] font-semibold tracking-tight tabular">{kr(ledger.balance)}</p>
        </div>
        {ledger.opening !== 0 ? (
          <p className="mt-3 border-t border-line/60 pt-3 text-[12px] text-muted">
            Ingående balans för året: <span className="tabular">{kr(ledger.opening)}</span>
          </p>
        ) : null}
      </Card>

      {todo > 0 ? (
        <div className="mb-8">
          <SectionTitle>Att bokföra ({todo})</SectionTitle>
          <div className="space-y-4">
            {awaitingVat.map((r) => (
              <Card key={r.id} className="px-6 py-5">
                <p className="text-[15px] font-semibold">Moms {r.label}</p>
                <p className="mt-1 text-[13px] text-soft">
                  Deklarerad {r.declaredAt ? datumLang(r.declaredAt) : "nyligen"}. Momsen står kvar på
                  redovisningskontot till den förs över till skattekontot.
                </p>
                <div className="mt-3">
                  <BookVatOnTaxAccountButton reportId={r.id} label={r.label} attBetala={r.attBetala} />
                </div>
              </Card>
            ))}
            {awaitingFSkatt.map((m) => (
              <Card key={m} className="px-6 py-5">
                <p className="text-[15px] font-semibold">F-skatt {m}</p>
                <p className="mt-1 text-[13px] text-soft">
                  Preliminärskatten dras varje månad enligt Skatteverkets beslut. Bokför den så att skattekontots saldo
                  stämmer.
                </p>
                <div className="mt-3">
                  <BookFSkattButton month={m} amount={fSkattPerMonth} />
                </div>
              </Card>
            ))}
            {deposits.map((t) => (
              <Card key={t.id} className="px-6 py-5">
                <p className="text-[15px] font-semibold">{t.description || "Överföring till Skatteverket"}</p>
                <p className="mt-1 text-[13px] text-soft">
                  Banktransaktion {datumKort(t.date)} på {kr(Math.abs(t.amount))}. Ser ut som en inbetalning till
                  skattekontot – pengarna lämnar företagskontot men stannar i bolaget.
                </p>
                <div className="mt-3">
                  <BookTaxAccountDepositButton txId={t.id} amount={Math.abs(t.amount)} />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-8">
        <SectionTitle>Rörelser på kontot</SectionTitle>
        {ledger.rows.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="Inga rörelser på skattekontot ännu"
            text="Så snart moms deklareras eller F-skatt bokförs syns rörelserna här, med löpande saldo."
          />
        ) : (
          <Card className="overflow-x-auto px-6 py-5">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="pb-2 font-semibold">Datum</th>
                  <th className="pb-2 font-semibold">Ver</th>
                  <th className="pb-2 font-semibold">Händelse</th>
                  <th className="pb-2 font-semibold">Typ</th>
                  <th className="pb-2 text-right font-semibold">Belopp</th>
                  <th className="pb-2 text-right font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((r) => (
                  <tr key={r.verificationId} className="border-t border-line/50">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted">{datumKort(r.date)}</td>
                    <td className="py-2 pr-3 font-mono text-[12px] text-muted">{r.label}</td>
                    <td className="py-2 pr-3">{r.description}</td>
                    <td className="py-2 pr-3 text-soft">{TAX_ACCOUNT_KIND_LABEL[r.kind]}</td>
                    <td className="py-2 pr-3 text-right tabular">
                      <span className="inline-flex items-center gap-1">
                        {r.amount >= 0 ? (
                          <ArrowDownLeft className="size-3.5 text-ok" />
                        ) : (
                          <ArrowUpRight className="size-3.5 text-muted" />
                        )}
                        {kr(r.amount)}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular font-medium">{kr(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <TaxAccountReconcileForm />

      <p className="mt-6 text-[12px] leading-relaxed text-muted">
        Driva skickar aldrig något till Skatteverket. Skattekontot i bokföringen är bolagets egen bild av vad myndigheten
        anser – avstämningen mot utdraget är det som visar att bilden stämmer.
      </p>
    </div>
  );
}

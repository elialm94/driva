"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, Check, CircleAlert, Landmark, Scale } from "lucide-react";
import { buttonClasses, Card, cx } from "./ui";
import { kr, datumKort } from "@/lib/format";
import {
  bookFSkattAction,
  bookTaxAccountDepositAction,
  bookVatOnTaxAccountAction,
  reconcileTaxAccountAction,
} from "@/app/bokforing-actions";
import { TAX_ACCOUNT_KIND_LABEL, type TaxAccountReconciliation } from "@/lib/accounting/tax-account-model";

/** Klientwidgets för skattekontot. All logik ligger i domänlagret. */

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-2 text-[13px] font-medium text-danger">{error}</p>;
}

export function BookVatOnTaxAccountButton({ reportId, label, attBetala }: { reportId: string; label: string; attBetala: number }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={buttonClasses("secondary", "sm")}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await bookVatOnTaxAccountAction(reportId);
            setError(res.ok ? null : res.error);
          })
        }
      >
        <ArrowRightLeft className="size-3.5" />
        {isPending ? "Bokför …" : `För ${label} till skattekontot`}
      </button>
      <p className="mt-1.5 text-[12px] text-muted">
        {attBetala > 0
          ? `${kr(attBetala)} flyttas från momsredovisningskontot (2650) till skattekontot (1630), där Skatteverket har skulden.`
          : `${kr(Math.abs(attBetala))} tillgodoförs skattekontot (1630).`}
      </p>
      <ErrorNote error={error} />
    </div>
  );
}

export function BookFSkattButton({ month, amount }: { month: string; amount: number }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={buttonClasses("secondary", "sm")}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await bookFSkattAction(month);
            setError(res.ok ? null : res.error);
          })
        }
      >
        <Landmark className="size-3.5" />
        {isPending ? "Bokför …" : `Bokför F-skatt ${month}`}
      </button>
      <p className="mt-1.5 text-[12px] text-muted">
        {kr(amount)} enligt Skatteverkets beslut. Dras från skattekontot och kvittas mot den slutliga skatten i bokslutet.
      </p>
      <ErrorNote error={error} />
    </div>
  );
}

export function BookTaxAccountDepositButton({ txId, amount }: { txId: string; amount: number }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={buttonClasses("secondary", "sm")}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await bookTaxAccountDepositAction(txId);
            setError(res.ok ? null : res.error);
          })
        }
      >
        <ArrowRightLeft className="size-3.5" />
        {isPending ? "Bokför …" : `Bokför som inbetalning (${kr(amount)})`}
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

/**
 * Avstämning mot skattekontoutdraget. Utdraget klistras in och används direkt –
 * det lagras aldrig, precis som bankavstämningen härleds i stället för att
 * sparas.
 */
export function TaxAccountReconcileForm() {
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TaxAccountReconciliation | null>(null);

  return (
    <Card className="px-6 py-5">
      <div className="flex items-center gap-2.5">
        <Scale className="size-4.5 text-muted" />
        <h3 className="text-[15px] font-semibold">Stäm av mot skattekontoutdraget</h3>
      </div>
      <p className="mt-1 text-[13px] text-soft">
        Kopiera raderna från Mina sidor hos Skatteverket och klistra in dem här. Varje rad ska börja med datum och sluta
        med belopp – insättningar positiva, uttag negativa. Utdraget sparas inte.
      </p>
      <textarea
        className="mt-3 h-36 w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent/30"
        placeholder={"2026-02-12\tInbetalning\t25000\n2026-02-12\tMoms kvartal 4 2025\t-18400"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className={buttonClasses("primary", "sm")}
          disabled={isPending || text.trim() === ""}
          onClick={() =>
            startTransition(async () => {
              const res = await reconcileTaxAccountAction(text);
              if (res.ok) {
                setResult(res.result);
                setError(null);
              } else {
                setResult(null);
                setError(res.error);
              }
            })
          }
        >
          {isPending ? "Stämmer av …" : "Stäm av"}
        </button>
        {result || error ? (
          <button
            className={buttonClasses("ghost", "sm")}
            disabled={isPending}
            onClick={() => {
              setText("");
              setResult(null);
              setError(null);
            }}
          >
            Rensa
          </button>
        ) : null}
      </div>
      <ErrorNote error={error} />
      {result ? <ReconciliationResult result={result} /> : null}
    </Card>
  );
}

function ReconciliationResult({ result }: { result: TaxAccountReconciliation }) {
  return (
    <div className="mt-4 border-t border-line/60 pt-4">
      <p className={cx("flex items-center gap-1.5 text-[13px] font-semibold", result.ok ? "text-ok" : "text-warn")}>
        {result.ok ? <Check className="size-4" /> : <CircleAlert className="size-4" />}
        {result.ok
          ? `Avstämt – ${result.statementRows} rader i utdraget stämmer med bokföringen.`
          : `Differens ${kr(result.difference)} mellan utdraget och bokföringen.`}
      </p>
      <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="text-[12px] text-muted">Enligt utdraget</dt>
          <dd className="tabular font-semibold">{kr(result.statementBalance)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted">Enligt bokföringen</dt>
          <dd className="tabular font-semibold">{kr(result.ledgerBalance)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted">Differens</dt>
          <dd className={cx("tabular font-semibold", result.difference !== 0 && "text-warn")}>{kr(result.difference)}</dd>
        </div>
      </dl>

      {result.missingInLedger.length > 0 ? (
        <div className="mt-4">
          <p className="text-[13px] font-semibold">Finns hos Skatteverket men inte i bokföringen</p>
          <p className="mb-2 text-[12px] text-muted">
            Ofta ränta eller avgift som Skatteverket lagt på kontot. Bokför den med ett manuellt verifikat.
          </p>
          <ul className="space-y-1">
            {result.missingInLedger.map((r, i) => (
              <li key={`${r.date}-${i}`} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span>
                  <span className="text-muted">{datumKort(r.date)}</span> {r.text}
                </span>
                <span className="tabular shrink-0">{kr(r.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.missingInStatement.length > 0 ? (
        <div className="mt-4">
          <p className="text-[13px] font-semibold">Bokfört men syns inte i utdraget</p>
          <p className="mb-2 text-[12px] text-muted">
            Kan vara i tid – Skatteverket registrerar på förfallodagen. Annars är beloppet eller datumet fel.
          </p>
          <ul className="space-y-1">
            {result.missingInStatement.map((r) => (
              <li key={r.verificationId} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span>
                  <span className="text-muted">{datumKort(r.date)}</span> {r.description}{" "}
                  <span className="text-muted">({TAX_ACCOUNT_KIND_LABEL[r.kind]})</span>
                </span>
                <span className="tabular shrink-0">{kr(r.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

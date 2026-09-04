"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { acceptQuoteByTokenAction, type AcceptQuoteActionResult } from "@/app/actions";
import { datumLang, datumTid, kr } from "@/lib/format";
import { ACCEPTANCE_FOOTNOTE } from "@/lib/quote-acceptance";
import { buttonClasses, cx } from "./ui-classes";
import { DeclineQuoteButton } from "./quote-public-actions";

export const QUOTE_ACCEPT_SECTION_ID = "godkann-offert";
export const QUOTE_ACCEPT_NAME_ID = "godkann-namn";
const QUOTE_ACCEPT_NAME_BAR_ID = "godkann-namn-bar";

/**
 * Kundens godkännande under offertdokumentet: namn + en knapp som verkligen
 * skickar (ingen hopplänk, ingen chevron). En valfri mobilbar upprepar samma
 * submit – samma state, samma acceptQuote-anrop.
 */
export function QuoteAcceptForm({
  token,
  statement,
  prefillName,
  contentHash,
  validUntil,
}: {
  token: string;
  statement: string;
  prefillName: string;
  contentHash: string;
  validUntil: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(prefillName);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<AcceptQuoteActionResult, { ok: true }> | null>(null);
  const [pending, startTransition] = useTransition();
  const submittedRef = useRef(false);
  const errorId = useId();
  const canSubmit = name.trim().length > 0 && !pending && !done;
  const nameEmpty = name.trim().length === 0;

  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  function submit() {
    // Dubbeltryck: knappen är disabled under pending, och servern är
    // idempotent – men släpp aldrig iväg två anrop från samma sidvy.
    if (!canSubmit || submittedRef.current) return;
    submittedRef.current = true;
    setError(null);
    startTransition(async () => {
      const result = await acceptQuoteByTokenAction(token, name, contentHash);
      if (result.ok) {
        setDone(result);
        return;
      }
      submittedRef.current = false;
      setError(result.error);
      if (result.code === "changed" || result.code === "not_acceptable" || result.code === "declined" || result.code === "expired") {
        router.refresh();
      }
    });
  }

  if (done) {
    return (
      <div
        id={QUOTE_ACCEPT_SECTION_ID}
        data-quote-accepted=""
        className="mt-8 rounded-2xl border border-ok/25 bg-ok-soft/70 p-5 animate-fade-up"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-ok" />
          <div>
            <p className="text-[17px] font-semibold text-ok">Offerten är godkänd</p>
            <p className="mt-1 text-[14px] text-soft">
              Godkänd {datumTid(done.acceptedAt)} av {done.acceptedByName} · {kr(done.amount)}
            </p>
            <p className="mt-2 text-[13px] text-muted">{ACCEPTANCE_FOOTNOTE}</p>
          </div>
        </div>
      </div>
    );
  }

  const nameField = (id: string, opts?: { testId?: string; submitOnEnter?: boolean; autoFocus?: boolean }) => (
    <>
      <label htmlFor={id} className="block text-[13px] font-medium text-soft">
        Ditt namn
      </label>
      <input
        id={id}
        name="name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={
          opts?.submitOnEnter
            ? (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }
            : undefined
        }
        autoFocus={opts?.autoFocus}
        autoComplete="name"
        autoCapitalize="words"
        enterKeyHint="done"
        maxLength={120}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder="För- och efternamn"
        data-testid={opts?.testId}
        className="mt-1.5 h-12 w-full rounded-xl border border-line-strong bg-white px-3.5 text-[16px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />
    </>
  );

  return (
    <>
      <form
        id={QUOTE_ACCEPT_SECTION_ID}
        data-quote-accept-form=""
        className="mt-8 scroll-mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-[14px] text-soft">Offerten är giltig till {datumLang(validUntil)}.</p>
        <div className="mt-5">{nameField(QUOTE_ACCEPT_NAME_ID, { autoFocus: !prefillName })}</div>
        <p className="mt-4 text-[14px] leading-relaxed text-ink">{statement}</p>
        {error ? (
          <p id={errorId} role="alert" className="mt-3 text-[13px] font-medium text-danger">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          data-testid="public-quote-accept"
          disabled={!canSubmit}
          className={cx(buttonClasses("primary", "lg"), "mt-4 w-full sm:w-auto")}
        >
          {pending ? "Godkänner …" : "Godkänn offert"}
        </button>
        <p className="mt-3 text-[12px] text-muted">{ACCEPTANCE_FOOTNOTE}</p>
        <div className="mt-4">
          <DeclineQuoteButton token={token} />
        </div>
      </form>

      {/* Mobil: samma godkännande, ingen andra fullständig blankett och ingen chevron. */}
      <div
        data-quote-accept-bar=""
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2.5 px-4 py-3">
          {nameEmpty ? nameField(QUOTE_ACCEPT_NAME_BAR_ID, { testId: "public-quote-accept-name-bar", submitOnEnter: true }) : null}
          <button
            type="button"
            data-testid="public-quote-accept-bar"
            disabled={!canSubmit}
            onClick={submit}
            className={cx(buttonClasses("primary", "lg"), "w-full")}
          >
            {pending ? "Godkänner …" : "Godkänn offert"}
          </button>
          <div className="text-center">
            <DeclineQuoteButton token={token} />
          </div>
        </div>
      </div>
    </>
  );
}

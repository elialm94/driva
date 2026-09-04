"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { acceptQuoteByTokenAction, type AcceptQuoteActionResult } from "@/app/actions";
import { datumTid, kr } from "@/lib/format";
import { ACCEPTANCE_FOOTNOTE } from "@/lib/quote-acceptance";
import { buttonClasses, cx } from "./ui-classes";

export const QUOTE_ACCEPT_SECTION_ID = "godkann-offert";
export const QUOTE_ACCEPT_NAME_ID = "godkann-namn";

/**
 * Kundens godkännande: namn + en knapp. Formuläret ligger i dokumentets
 * avslutning (inte i en popover) så att det fungerar med tangentbordet uppe
 * på mobil. Efter lyckat godkännande visas kvittot direkt och sidan laddas
 * om till det låsta, godkända läget – företagaren ser statusen utan att
 * kunden behöver klicka mer.
 */
export function QuoteAcceptForm({
  token,
  statement,
  prefillName,
  contentHash,
}: {
  token: string;
  statement: string;
  prefillName: string;
  contentHash: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(prefillName);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<AcceptQuoteActionResult, { ok: true }> | null>(null);
  const [pending, startTransition] = useTransition();
  const submittedRef = useRef(false);
  const errorId = useId();
  const canSubmit = name.trim().length > 0 && !pending && !done;

  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);

  function submit() {
    // Dubbeltryck: knappen är disabled under pending, och servern är
    // idempotent – men släpp aldrig iväg två anrop från samma formulär.
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
        className="rounded-2xl border border-ok/25 bg-ok-soft/70 p-5 animate-fade-up"
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

  return (
    <form
      id={QUOTE_ACCEPT_SECTION_ID}
      data-quote-accept-form=""
      className="scroll-mt-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={QUOTE_ACCEPT_NAME_ID} className="block text-[13px] font-medium text-soft">
        Ditt namn
      </label>
      <input
        id={QUOTE_ACCEPT_NAME_ID}
        name="name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        // Autofokus bara när fältet är tomt – ett förifyllt namn ska inte
        // dra upp tangentbordet över dokumentet.
        autoFocus={!prefillName}
        autoComplete="name"
        autoCapitalize="words"
        enterKeyHint="done"
        maxLength={120}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder="För- och efternamn"
        className="mt-1.5 h-12 w-full rounded-xl border border-line-strong bg-white px-3.5 text-[16px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
      />
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
    </form>
  );
}

/** Bottenlistens knapp: hoppa till formuläret och fokusera namnfältet. */
export function AcceptJumpButton() {
  return (
    <a
      href={`#${QUOTE_ACCEPT_SECTION_ID}`}
      className={cx(buttonClasses("primary", "lg"), "w-full sm:w-auto")}
      onClick={(e) => {
        const section = document.getElementById(QUOTE_ACCEPT_SECTION_ID);
        if (!section) return;
        e.preventDefault();
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        const input = document.getElementById(QUOTE_ACCEPT_NAME_ID) as HTMLInputElement | null;
        if (input && !input.value.trim()) {
          window.setTimeout(() => input.focus({ preventScroll: true }), 350);
        }
      }}
    >
      Godkänn offert
      <ChevronDown className="size-4" />
    </a>
  );
}

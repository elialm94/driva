"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Check, Mail, Send } from "lucide-react";
import { sendOwnerNoticeTestAction, updateOwnerNoticeSettingsAction } from "@/app/actions";
import { OWNER_NOTICE_COPY, OWNER_NOTICE_KINDS } from "@/lib/notices/owner-notices";
import { isEmailFormat } from "@/lib/settings-validation";
import type { OwnerNoticeKind } from "@/lib/types";
import { buttonClasses, Card, cx } from "./ui";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";

export interface OwnerNoticeSettingsProps {
  companyEmail: string;
  /** Sparad egen mottagare ("" = företagets e-post). */
  email: string;
  off: OwnerNoticeKind[];
  /** Hemsidans egen mottagare (Hemsida → Webbformulär) – vinner för förfrågningar. */
  websiteRecipientOverride?: string;
  mailLive: boolean;
  demo: boolean;
}

/**
 * Inställningar → Notiser. Varje ändring sparas direkt (som Funktioner) –
 * inget "Spara ändringar" att glömma. Allt är på tills man stänger av.
 */
export function OwnerNoticeSettings(props: OwnerNoticeSettingsProps) {
  const router = useRouter();
  const [email, setEmail] = useState(props.email);
  const [off, setOff] = useState<Set<OwnerNoticeKind>>(() => new Set(props.off));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [testState, setTestState] = useState<{ kind: "idle" } | { kind: "sent"; to: string } | { kind: "error"; error: string }>({
    kind: "idle",
  });
  const [testing, startTest] = useTransition();

  const recipient = email.trim() || props.companyEmail.trim();
  const recipientValid = Boolean(recipient) && isEmailFormat(recipient);
  const emailError = email.trim() && !isEmailFormat(email) ? "Ange en giltig e-postadress." : null;

  function persist(next: { email: string; off: Set<OwnerNoticeKind> }) {
    setError(null);
    startTransition(async () => {
      const result = await updateOwnerNoticeSettingsAction({ email: next.email, off: Array.from(next.off) });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  function toggle(kind: OwnerNoticeKind, on: boolean) {
    const next = new Set(off);
    if (on) next.delete(kind);
    else next.add(kind);
    setOff(next);
    persist({ email, off: next });
  }

  function commitEmail() {
    if (emailError) return;
    if (email.trim() === props.email.trim()) return;
    persist({ email, off });
  }

  function sendTest() {
    setTestState({ kind: "idle" });
    startTest(async () => {
      const result = await sendOwnerNoticeTestAction();
      setTestState(result.ok ? { kind: "sent", to: result.to } : { kind: "error", error: result.error });
    });
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-info-soft">
            <Mail className="size-4.5 text-info" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Mottagare</p>
            <p className="mt-1 text-[14px] leading-relaxed text-soft">
              Notiser mejlas till{" "}
              <span className="font-medium text-ink">{recipientValid ? recipient : "– ingen giltig adress ännu"}</span>.
              {!email.trim() ? " Det är företagets e-post från fliken Företag." : ""}
            </p>
          </div>
        </div>
        <div className="max-w-md">
          <label className="mb-1 block text-[13px] font-medium text-soft" htmlFor="notiser-email">
            Egen adress för notiser <span className="font-normal text-muted">(valfritt)</span>
          </label>
          <input
            id="notiser-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            placeholder={props.companyEmail || "namn@företaget.se"}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={commitEmail}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitEmail();
              }
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "notiser-email-fel" : "notiser-email-hint"}
            className={cx(inputCls, emailError && "border-danger")}
          />
          {emailError ? (
            <p id="notiser-email-fel" className="mt-1 text-[12px] text-danger">
              {emailError}
            </p>
          ) : (
            <p id="notiser-email-hint" className="mt-1 text-[12px] text-muted">
              Lämna tomt för att använda företagets e-post. Kundmejl påverkas inte – de svarar alltid till företagets adress.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={buttonClasses("secondary", "sm")}
            onClick={sendTest}
            disabled={testing || props.demo || !recipientValid}
            title={props.demo ? "Demon skickar inga riktiga mejl." : undefined}
          >
            <Send className="size-3.5" /> {testing ? "Skickar …" : "Skicka testmejl"}
          </button>
          {testState.kind === "sent" ? (
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ok">
              <Check className="size-4" /> Skickat till {testState.to}
            </p>
          ) : testState.kind === "error" ? (
            <p className="text-[13px] font-medium text-danger">{testState.error}</p>
          ) : props.demo ? (
            <p className="text-[13px] text-muted">Demon skickar inga riktiga mejl.</p>
          ) : !props.mailLive ? (
            <p className="text-[13px] text-muted">E-posttjänsten är inte konfigurerad i den här miljön.</p>
          ) : null}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft">
            <BellRing className="size-4.5 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Händelser</p>
            <p className="mt-1 text-[14px] leading-relaxed text-soft">
              Du får mejl om det som händer när du inte är i appen. Det du gör själv i Driva notifieras aldrig.
            </p>
          </div>
        </div>
        <ul className="mt-4 divide-y divide-line">
          {OWNER_NOTICE_KINDS.map((kind) => {
            const copy = OWNER_NOTICE_COPY[kind];
            const on = !off.has(kind);
            const websiteNote =
              kind === "forfragan" && props.websiteRecipientOverride
                ? `Skickas till ${props.websiteRecipientOverride} (ändras under Hemsida → Webbformulär).`
                : null;
            return (
              <li key={kind} className="flex items-start justify-between gap-4 py-3.5" data-notice={kind}>
                <div className="min-w-0">
                  <p className={cx("text-[14px] font-medium", on ? "text-ink" : "text-muted")}>{copy.label}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{copy.description}</p>
                  {websiteNote ? <p className="mt-0.5 text-[12px] text-muted">{websiteNote}</p> : null}
                </div>
                <NoticeSwitch on={on} label={copy.label} disabled={pending} onChange={(next) => toggle(kind, next)} />
              </li>
            );
          })}
        </ul>
        <div className="mt-3 min-h-5 text-[13px]">
          {error ? (
            <p className="font-medium text-danger">Kunde inte spara just nu. Inget har gått förlorat. {error}</p>
          ) : pending ? (
            <p className="text-muted">Sparar …</p>
          ) : savedAt ? (
            <p className="flex items-center gap-1.5 font-medium text-ok">
              <Check className="size-4" /> Sparat
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function NoticeSwitch({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label} – ${on ? "på" : "av"}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="inline-flex h-8 w-11 shrink-0 items-center justify-center rounded-lg p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={cx("flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors", on ? "bg-ok" : "bg-line-strong")}
      >
        <span
          className={cx(
            "size-4 shrink-0 rounded-full bg-white shadow-sm transition-transform duration-200",
            on ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

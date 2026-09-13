"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileDown, Mail, Send } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";
import { kr } from "@/lib/format";
import { QUOTE_EXCESS_WARN_AMOUNT, QUOTE_EXCESS_WARN_PERCENT } from "@/lib/quote-excess";
import { FieldError, invalidFieldCls } from "./form-validation";
import { ShareCustomerLink } from "./share-customer-link";
import { RotCustomerShareCallout } from "./rot-customer-share";
import { DisabledSendWrap } from "./disabled-send-button";
import { EMAIL_SAVE_FAILED, emailInputError } from "@/lib/missing-requirements";
import { issueInvoiceForDownloadAction, markInvoiceSentManuallyAction, resolveCustomerEmailAction } from "@/app/actions";

function withFlag(href: string, key: string, value: string) {
  const url = new URL(href, "https://driva.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

/** Ett av tre sätt att lämna fakturan till kunden. */
type Choice = "mejl" | "pdf" | "manuell";

/**
 * Ett val i utskicksdialogen. Prickmarkeringen bär valet, inte ramfärgen:
 * tangentbordsfokus ritar en egen accentram, och två ramar i samma färg
 * skulle läsa som två valda alternativ.
 */
function ChoiceButton({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={cx(
        "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition",
        active ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong"
      )}
    >
      <span
        aria-hidden
        className={cx(
          "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border",
          active ? "border-accent-deep" : "border-line-strong"
        )}
      >
        {active ? <span className="size-2 rounded-full bg-accent-deep" /> : null}
      </span>
      <span className={cx("mt-0.5 shrink-0", active ? "text-accent-deep" : "text-muted")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-medium text-ink">{title}</span>
        <span className="block text-[13px] leading-snug text-soft">{description}</span>
      </span>
    </button>
  );
}

/**
 * Utskicket av ett fakturautkast.
 *
 * Alla tre vägarna utfärdar fakturan – nummer, fryst dokument och verifikation
 * – så bekräftelsen säger det en gång, överst. Skillnaden är bara hur kunden
 * får den: mejl, papper eller ett utskick användaren gör själv.
 *
 * E-postadressen är ett krav för mejl-valet, aldrig för att utfärda. Saknas
 * den skrivs den in här och sparas på kundkortet, så att nästa faktura till
 * samma kund är förifylld.
 */
export function InvoiceDraftSend({
  documentId,
  customerId,
  customerName,
  amount,
  dueDateLabel,
  sendAction,
  detailHref,
  recipientEmail,
  canSend = true,
  mailConfigured: _mailConfigured = true,
  excessAmount,
  tillaggHref,
  publicPath,
  customerPhone,
  invoiceNumber,
  deduction,
  rotType,
}: {
  documentId: string;
  customerId: string;
  customerName: string;
  amount: number;
  dueDateLabel: string;
  sendAction: () => Promise<void | { ok: boolean; errors?: string[]; issued?: boolean; mailed?: boolean; demo?: boolean }>;
  detailHref: string;
  recipientEmail?: string;
  /** Samma källa som checklistan: canSend = validateInvoiceForIssue().length === 0. */
  canSend?: boolean;
  /** Om e-postutskick är konfigurerat på servern – styr ärlig text i dialogen. */
  mailConfigured?: boolean;
  /** Positivt belopp om fakturan överstiger tröskeln; annars utelämnas varningen. */
  excessAmount?: number;
  tillaggHref?: string;
  publicPath?: string;
  customerPhone?: string;
  invoiceNumber?: number | null;
  deduction?: number;
  rotType?: "rot" | "rut";
}) {
  const router = useRouter();
  const [warnOpen, setWarnOpen] = useState(false);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>("mejl");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();
  const knownEmail = recipientEmail?.trim() ?? "";
  const [email, setEmail] = useState(knownEmail);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savedEmailFor, setSavedEmailFor] = useState<string | null>(null);
  const needsWarning = (excessAmount ?? 0) > 0 && !!tillaggHref;

  function openChoice() {
    setSendError(null);
    setEmailError(null);
    setEmail(knownEmail);
    setChoice("mejl");
    setChoiceOpen(true);
  }

  function requestSend() {
    if (!canSend || isSending) return;
    if (needsWarning) setWarnOpen(true);
    else openChoice();
  }

  function afterExcessContinue() {
    setWarnOpen(false);
    openChoice();
  }

  function finish(flag: "skickad" | "leveransfel", value = "1") {
    router.replace(withFlag(detailHref, flag, value));
    router.refresh();
  }

  /** Mejla: spara en nyinskriven adress på kunden först, skicka sedan. */
  function confirmEmail() {
    const invalid = emailInputError(email);
    if (invalid) {
      setEmailError(invalid);
      return;
    }
    startSending(async () => {
      setSendError(null);
      if (!knownEmail) {
        // Kunden saknade adress: den vandrar till kundkortet så att den bara
        // behöver skrivas en gång. En befintlig adress skrivs aldrig över –
        // resolveCustomerEmail vägrar det utan uttryckligt överskrivningsval.
        const saved = await resolveCustomerEmailAction(customerId, email);
        if (!saved.ok) {
          setEmailError(EMAIL_SAVE_FAILED);
          return;
        }
        setSavedEmailFor(customerName);
      }
      const result = await sendAction();
      if (result && result.ok === false) {
        setSendError((result.errors ?? []).join(" ") || "Fakturan kunde inte skickas. Försök igen.");
        if (result.issued) finish("leveransfel");
        return;
      }
      // "demo": demoföretaget – notisen berättar att mejlet simulerades.
      finish("skickad", result && result.demo ? "demo" : "1");
    });
  }

  /** Ladda ner PDF: samma utfärdandeväg som mejl, därefter A4-vyn. */
  function confirmDownload() {
    startSending(async () => {
      setSendError(null);
      const result = await issueInvoiceForDownloadAction(documentId);
      if (!result.ok) {
        setSendError(result.errors.join(" ") || "Fakturan kunde inte utfärdas. Försök igen.");
        return;
      }
      router.push(result.pdfHref);
      router.refresh();
    });
  }

  function confirmManual() {
    startSending(async () => {
      setSendError(null);
      const result = await markInvoiceSentManuallyAction(documentId);
      if (!result.ok) {
        setSendError(result.errors.join(" ") || "Fakturan kunde inte utfärdas. Försök igen.");
        return;
      }
      finish("skickad", "manuell");
    });
  }

  const confirmLabel =
    choice === "mejl"
      ? isSending
        ? "Skickar ..."
        : sendError
          ? "Försök igen"
          : "Mejla fakturan"
      : choice === "pdf"
        ? isSending
          ? "Utfärdar ..."
          : "Utfärda och ladda ner"
        : isSending
          ? "Markerar ..."
          : "Utfärda och markera som skickad";

  return (
    <>
      {canSend ? (
        <button type="button" className={buttonClasses("primary")} onClick={requestSend} disabled={isSending}>
          <Send className="size-4" />
          Skicka faktura
        </button>
      ) : (
        <DisabledSendWrap title="Komplettera uppgifterna ovan innan fakturan kan utfärdas.">
          <button type="button" className={buttonClasses("primary")} disabled aria-disabled>
            <Send className="size-4" />
            Skicka faktura
          </button>
        </DisabledSendWrap>
      )}

      <Modal
        open={choiceOpen}
        onClose={() => !isSending && setChoiceOpen(false)}
        size="sm"
        title="Skicka faktura"
        // Knapparna ligger i footern: dialogen är hög och på en 375-skärm
        // skulle de annars hamna nedanför det som syns.
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} disabled={isSending} onClick={() => setChoiceOpen(false)}>
              Avbryt
            </button>
            <button
              className={buttonClasses("primary")}
              disabled={isSending}
              onClick={choice === "mejl" ? confirmEmail : choice === "pdf" ? confirmDownload : confirmManual}
            >
              {choice === "mejl" ? (
                <Mail className="size-4" />
              ) : choice === "pdf" ? (
                <FileDown className="size-4" />
              ) : (
                <Check className="size-4" />
              )}
              {confirmLabel}
            </button>
          </div>
        }
      >
        <div className="px-6 py-5">
          <p className="text-[17px] font-semibold tracking-tight text-ink">{customerName}</p>
          <p className="mt-1 text-[15px] text-soft">{kr(amount)}</p>
          <p className="mt-1 text-[14px] text-muted">Förfaller {dueDateLabel}</p>
          {rotType && deduction ? (
            <RotCustomerShareCallout type={rotType} toPay={amount} deduction={deduction} />
          ) : null}

          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            Fakturan utfärdas och bokförs oavsett hur du lämnar den till kunden. Den får ett fakturanummer och kan
            inte ändras efteråt - bara krediteras.
          </p>

          <div className="mt-4 space-y-2" role="radiogroup" aria-label="Så lämnar du fakturan till kunden">
            <ChoiceButton
              active={choice === "mejl"}
              icon={<Mail className="size-4" />}
              title="Mejla"
              description={knownEmail ? `Skickas till ${knownEmail}` : "Skriv in kundens e-postadress"}
              onClick={() => {
                setChoice("mejl");
                setSendError(null);
              }}
            />
            {choice === "mejl" && !knownEmail ? (
              // Fältet visas bara när kunden saknar adress. Har kunden redan
              // en går mejlet till den, och ett redigerbart fält här skulle
              // ljuga: adressen på kundkortet skrivs aldrig över härifrån.
              <div className="pl-1">
                <label className="mb-1 block text-[13px] font-medium text-soft" htmlFor="faktura-utskick-epost">
                  Kundens e-post
                </label>
                <input
                  id="faktura-utskick-epost"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError(null);
                  }}
                  placeholder="namn@exempel.se"
                  className={cx(inputCls, emailError && invalidFieldCls)}
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={emailError ? "faktura-utskick-epost-fel" : undefined}
                />
                <FieldError id="faktura-utskick-epost-fel">{emailError}</FieldError>
                <p className="mt-1 text-[12px] text-muted">Adressen sparas på {customerName} efter utskicket.</p>
              </div>
            ) : null}
            <ChoiceButton
              active={choice === "pdf"}
              icon={<FileDown className="size-4" />}
              title="Ladda ner PDF"
              description="För dig som skriver ut och lämnar fakturan på papper"
              onClick={() => {
                setChoice("pdf");
                setSendError(null);
              }}
            />
            <ChoiceButton
              active={choice === "manuell"}
              icon={<Check className="size-4" />}
              title="Markera som skickad"
              description="Du har redan skickat fakturan på annat sätt"
              onClick={() => {
                setChoice("manuell");
                setSendError(null);
              }}
            />
          </div>

          {publicPath ? (
            <div className="mt-4">
              <ShareCustomerLink
                path={publicPath}
                kind="faktura"
                number={invoiceNumber ?? undefined}
                phone={customerPhone}
              />
            </div>
          ) : null}
          {savedEmailFor ? (
            <p className="mt-3 text-[13px] text-ok">Sparade e-postadressen på {savedEmailFor}.</p>
          ) : null}
          {sendError ? <p className="mt-3 text-[13px] font-medium text-danger">{sendError}</p> : null}
        </div>
      </Modal>

      <Modal open={warnOpen} onClose={() => setWarnOpen(false)} size="sm" title="Högre än den godkända offerten">
        <div className="px-6 py-5">
          <p className="text-[15px] leading-relaxed text-soft">
            Den här fakturan är <span className="font-semibold text-ink">{kr(excessAmount ?? 0)}</span> högre än den
            offert kunden godkände.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            Vi varnar när beloppet är mer än {kr(QUOTE_EXCESS_WARN_AMOUNT)} eller {QUOTE_EXCESS_WARN_PERCENT} % högre än
            offerten. Du kan skicka ändå, eller skapa en tilläggsoffert som kunden kan godkänna.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} onClick={() => tillaggHref && router.push(tillaggHref)}>
              Skapa tilläggsoffert
            </button>
            <button className={buttonClasses("primary")} onClick={afterExcessContinue}>
              Fortsätt
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

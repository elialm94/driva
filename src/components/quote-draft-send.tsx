"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, MessageSquare, Send } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";
import { kr } from "@/lib/format";
import { ShareCustomerLink } from "./share-customer-link";
import { RotCustomerShareCallout } from "./rot-customer-share";
import { DisabledSendWrap } from "./disabled-send-button";
import { FieldError, invalidFieldCls } from "./form-validation";
import { customerShareText, smsShareHref } from "@/lib/customer-link-share";
import { EMAIL_SAVE_FAILED, PHONE_SAVE_FAILED, emailInputError, phoneInputError } from "@/lib/missing-requirements";
import {
  channelsFromChoice,
  defaultQuoteSendChoice,
  quoteChannelEnabled,
  quoteSendButtonEnabled,
  type QuoteSendChannel,
} from "@/lib/quote-send-contact";
import { updateCustomerDetailsAction } from "@/app/actions";

function withFlag(href: string, key: string, value: string) {
  const url = new URL(href, "https://driva.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

const headerBtnCls = "max-[28rem]:h-9 max-[28rem]:px-2.5 max-[28rem]:text-[13px] max-[28rem]:gap-1";

type ChannelChoice = "email" | "sms" | "both";

function ChannelButton({
  active,
  enabled,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  enabled: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => enabled && onClick()}
      disabled={!enabled}
      role="radio"
      aria-checked={active}
      aria-disabled={!enabled}
      className={cx(
        "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition",
        !enabled
          ? "cursor-not-allowed border-line bg-canvas/60 opacity-60"
          : active
            ? "border-accent bg-accent-soft/40"
            : "border-line hover:border-line-strong"
      )}
    >
      <span
        aria-hidden
        className={cx(
          "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border",
          active && enabled ? "border-accent-deep" : "border-line-strong"
        )}
      >
        {active && enabled ? <span className="size-2 rounded-full bg-accent-deep" /> : null}
      </span>
      <span className={cx("mt-0.5 shrink-0", active && enabled ? "text-accent-deep" : "text-muted")}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-medium text-ink">{title}</span>
        <span className="block text-[13px] leading-snug text-soft">{description}</span>
      </span>
    </button>
  );
}

export function QuoteDraftSend({
  documentId,
  customerId,
  customerName,
  amount,
  validUntilLabel,
  sendAction,
  detailHref,
  recipientEmail,
  canSend = true,
  mailConfigured = true,
  publicPath,
  customerPhone,
  quoteNumber,
  deduction,
  rotType,
}: {
  documentId: string;
  customerId: string;
  customerName: string;
  amount: number;
  validUntilLabel: string;
  sendAction: (input?: {
    message?: string;
    channels?: QuoteSendChannel[];
    email?: string;
    phone?: string;
  }) => Promise<void | { ok: boolean; errors?: string[]; mailed?: boolean; demo?: boolean }>;
  detailHref: string;
  recipientEmail?: string;
  /** Hard-blockers borta - e-post/telefon räknas inte hit. */
  canSend?: boolean;
  /** Om e-postutskick är konfigurerat på servern - styr ärlig text i dialogen. */
  mailConfigured?: boolean;
  publicPath?: string;
  customerPhone?: string;
  quoteNumber?: number;
  deduction?: number;
  rotType?: "rot" | "rut";
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [email, setEmail] = useState(recipientEmail?.trim() ?? "");
  const [phone, setPhone] = useState(customerPhone?.trim() ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [choice, setChoice] = useState<ChannelChoice>(() =>
    defaultQuoteSendChoice({ email: recipientEmail, phone: customerPhone })
  );

  const emailOn = quoteChannelEnabled("email", { email, phone });
  const smsOn = quoteChannelEnabled("sms", { email, phone });
  const confirmEnabled = quoteSendButtonEnabled({
    hardBlockers: 0,
    email,
    phone,
  });
  const selectedChannels = channelsFromChoice(choice);
  const selectedReady = selectedChannels.length > 0 && selectedChannels.every((ch) => quoteChannelEnabled(ch, { email, phone }));

  function applyContact(nextEmail: string, nextPhone: string) {
    const emailOk = quoteChannelEnabled("email", { email: nextEmail, phone: nextPhone });
    const smsOk = quoteChannelEnabled("sms", { email: nextEmail, phone: nextPhone });
    if (choice === "both" && !(emailOk && smsOk)) {
      setChoice(defaultQuoteSendChoice({ email: nextEmail, phone: nextPhone }));
    } else if (choice === "email" && !emailOk) {
      setChoice(defaultQuoteSendChoice({ email: nextEmail, phone: nextPhone }));
    } else if (choice === "sms" && !smsOk) {
      setChoice(defaultQuoteSendChoice({ email: nextEmail, phone: nextPhone }));
    }
  }

  function requestSend() {
    setSendError(null);
    if (!canSend || isSending) return;
    setChoice(defaultQuoteSendChoice({ email, phone }));
    setConfirmOpen(true);
  }

  function finish(flag: "1" | "manuell" | "demo" = "1") {
    router.replace(withFlag(detailHref, "skickad", flag));
    router.refresh();
  }

  function openSms() {
    if (!publicPath || !phone.trim()) return;
    const url = `${window.location.origin}${publicPath}`;
    const href = smsShareHref(url, phone, customerShareText("offert", quoteNumber));
    const a = document.createElement("a");
    a.href = href;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function persistEmail() {
    const next = email.trim();
    if (!next || next === (recipientEmail?.trim() ?? "")) return;
    const invalid = emailInputError(next);
    if (invalid) {
      setEmailError(invalid);
      return;
    }
    startSaving(async () => {
      const saved = await updateCustomerDetailsAction(customerId, { email: next });
      if (!saved.ok) setEmailError(saved.error || EMAIL_SAVE_FAILED);
    });
  }

  function persistPhone() {
    const next = phone.trim();
    if (!next || next === (customerPhone?.trim() ?? "")) return;
    const invalid = phoneInputError(next);
    if (invalid) {
      setPhoneError(invalid);
      return;
    }
    startSaving(async () => {
      const saved = await updateCustomerDetailsAction(customerId, { phone: next });
      if (!saved.ok) setPhoneError(saved.error || PHONE_SAVE_FAILED);
    });
  }

  function confirmSend() {
    if (isSending || !confirmEnabled || !selectedReady) return;
    const channels = selectedChannels;
    if (channels.includes("email")) {
      const invalid = emailInputError(email);
      if (invalid) {
        setEmailError(invalid);
        return;
      }
    }
    if (channels.includes("sms")) {
      const invalid = phoneInputError(phone);
      if (invalid) {
        setPhoneError(invalid);
        return;
      }
    }
    startSending(async () => {
      setSendError(null);
      const result = await sendAction({
        message: message.trim() || undefined,
        channels,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      if (result && result.ok === false) {
        setSendError((result.errors ?? []).join(" ") || "Offerten kunde inte skickas just nu.");
        return;
      }
      if (channels.includes("sms")) openSms();
      if (result && result.demo) {
        finish("demo");
        return;
      }
      const mailed = !result || result.mailed !== false;
      finish(mailed ? "1" : "manuell");
    });
  }

  const sendTrigger = canSend ? (
    <button
      type="button"
      className={buttonClasses("primary", "md", headerBtnCls)}
      onClick={requestSend}
      disabled={isSending || isSaving}
    >
      <Send className="size-4 max-[28rem]:hidden" />
      Skicka offert
    </button>
  ) : (
    <DisabledSendWrap title="Komplettera uppgifterna ovan innan offerten kan skickas.">
      <button type="button" className={buttonClasses("primary", "md", headerBtnCls)} disabled aria-disabled>
        <Send className="size-4 max-[28rem]:hidden" />
        Skicka offert
      </button>
    </DisabledSendWrap>
  );

  return (
    <>
      {sendTrigger}

      <Modal open={confirmOpen} onClose={() => !isSending && setConfirmOpen(false)} size="sm" title="Skicka offert">
        <div className="px-6 py-5">
          <p className="text-[17px] font-semibold tracking-tight text-ink">{customerName}</p>
          <p className="mt-1 text-[15px] text-soft">{kr(amount)}</p>
          <p className="mt-1 text-[14px] text-muted">Giltig till {validUntilLabel}</p>
          {rotType && deduction ? (
            <RotCustomerShareCallout type={rotType} toPay={amount} deduction={deduction} />
          ) : null}

          <div className="mt-4">
            <label className="mb-1 block text-[13px] font-medium text-soft" htmlFor={`offert-skicka-epost-${documentId}`}>
              E-post
            </label>
            <input
              id={`offert-skicka-epost-${documentId}`}
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              value={email}
              onChange={(e) => {
                const next = e.target.value;
                setEmail(next);
                setEmailError(null);
                applyContact(next, phone);
              }}
              onBlur={persistEmail}
              placeholder="namn@exempel.se"
              className={cx(inputCls, emailError && invalidFieldCls)}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? `offert-skicka-epost-fel-${documentId}` : undefined}
            />
            <FieldError id={`offert-skicka-epost-fel-${documentId}`}>{emailError}</FieldError>

            <label className="mb-1 mt-3 block text-[13px] font-medium text-soft" htmlFor={`offert-skicka-telefon-${documentId}`}>
              Telefon
            </label>
            <input
              id={`offert-skicka-telefon-${documentId}`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                const next = e.target.value;
                setPhone(next);
                setPhoneError(null);
                applyContact(email, next);
              }}
              onBlur={persistPhone}
              placeholder="070-123 45 67"
              className={cx(inputCls, phoneError && invalidFieldCls)}
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? `offert-skicka-telefon-fel-${documentId}` : undefined}
            />
            <FieldError id={`offert-skicka-telefon-fel-${documentId}`}>{phoneError}</FieldError>
            <p className="mt-2 text-[12px] text-muted">Uppgifterna sparas på {customerName}.</p>
          </div>

          <div className="mt-4 space-y-2" role="radiogroup" aria-label="Hur ska offerten skickas">
            <ChannelButton
              active={choice === "email"}
              enabled={emailOn}
              icon={<Mail className="size-4" />}
              title="E-post"
              description={
                emailOn
                  ? mailConfigured
                    ? `Skickas till ${email.trim()}`
                    : "E-post är inte konfigurerad i den här miljön - offerten markeras som skickad."
                  : "Fyll i e-post ovan först"
              }
              onClick={() => {
                setChoice("email");
                setSendError(null);
              }}
            />
            <ChannelButton
              active={choice === "sms"}
              enabled={smsOn}
              icon={<MessageSquare className="size-4" />}
              title="SMS"
              description={smsOn ? `Öppnar SMS till ${phone.trim()}` : "Fyll i telefon ovan först"}
              onClick={() => {
                setChoice("sms");
                setSendError(null);
              }}
            />
            <ChannelButton
              active={choice === "both"}
              enabled={emailOn && smsOn}
              icon={<Send className="size-4" />}
              title="E-post och SMS"
              description={emailOn && smsOn ? "Skickar mejl och öppnar SMS med kundlänken" : "Fyll i både e-post och telefon"}
              onClick={() => {
                setChoice("both");
                setSendError(null);
              }}
            />
          </div>

          {choice !== "sms" ? (
            <label className="mt-4 block text-[13px] font-medium text-ink">
              Personligt meddelande
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Valfritt - syns överst i mejlet."
                className="mt-1.5 w-full rounded-xl border border-line bg-card px-3 py-2 text-[14px] font-normal text-ink placeholder:text-muted focus:border-accent"
              />
            </label>
          ) : null}

          {publicPath ? (
            <div className="mt-4">
              <p className="mb-2 text-[12px] font-medium text-muted">Förhandsgranska och dela</p>
              <ShareCustomerLink path={publicPath} kind="offert" number={quoteNumber} phone={phone} />
            </div>
          ) : null}
          {sendError ? <p className="mt-3 text-[13px] font-medium text-danger">{sendError}</p> : null}
          {!confirmEnabled ? (
            <p className="mt-3 text-[13px] text-soft">Fyll i e-post eller telefon för att skicka.</p>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button className={buttonClasses("secondary")} disabled={isSending} onClick={() => setConfirmOpen(false)}>
              Avbryt
            </button>
            {confirmEnabled && selectedReady ? (
              <button className={buttonClasses("primary")} disabled={isSending} onClick={confirmSend}>
                <Send className="size-4" />
                {isSending ? "Skickar ..." : sendError ? "Försök igen" : "Skicka offert"}
              </button>
            ) : (
              <DisabledSendWrap title="Fyll i e-post eller telefon för att skicka.">
                <button type="button" className={buttonClasses("primary")} disabled aria-disabled>
                  <Send className="size-4" />
                  Skicka offert
                </button>
              </DisabledSendWrap>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

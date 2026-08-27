"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Monitor, Smartphone, FileText, CheckCircle2, ExternalLink, Send, Eye } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";
import { CopyLinkButton } from "./copy-button";

type Device = "desktop" | "mobil" | "pdf";

/**
 * Preview före skickning – kärnprincipen är att inget kunddokument någonsin
 * skickas utan att användaren först sett exakt hur mottagaren ser det.
 */
export function PreviewModal({
  triggerLabel,
  triggerVariant = "primary",
  title,
  document,
  mode,
  sendAction,
  sendLabel = "Skicka",
  sentTitle = "Skickat!",
  sentText,
  publicPath,
  recipientEmail,
}: {
  triggerLabel: string;
  triggerVariant?: "primary" | "accent" | "secondary" | "ghost";
  title: string;
  document: ReactNode;
  mode: "send" | "view";
  sendAction?: () => Promise<void>;
  sendLabel?: string;
  sentTitle?: string;
  sentText?: string;
  publicPath: string;
  recipientEmail?: string;
}) {
  const [open, setOpen] = useState(false);
  const [device, setDevice] = useState<Device>("desktop");
  const [sent, setSent] = useState(false);
  const [isSending, startSending] = useTransition();

  const deviceTabs: { key: Device; label: string; icon: typeof Monitor }[] = [
    { key: "desktop", label: "Desktop", icon: Monitor },
    { key: "mobil", label: "Mobil", icon: Smartphone },
    { key: "pdf", label: "PDF", icon: FileText },
  ];

  function close() {
    setOpen(false);
    setSent(false);
    setDevice("desktop");
  }

  return (
    <>
      <button className={buttonClasses(triggerVariant)} onClick={() => setOpen(true)}>
        {mode === "send" ? <Send className="size-4" /> : <Eye className="size-4" />}
        {triggerLabel}
      </button>

      <Modal open={open} onClose={close} size="xl" title={sent ? undefined : title}>
        {sent ? (
          <div className="flex flex-col items-center px-8 py-16 text-center animate-fade-up">
            <div className="flex size-16 items-center justify-center rounded-full bg-ok-soft">
              <CheckCircle2 className="size-8 text-ok" />
            </div>
            <p className="mt-5 text-[20px] font-semibold tracking-tight">{sentTitle}</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-soft">
              {sentText}
              {recipientEmail ? (
                <>
                  {" "}
                  I demoläget skickas ingen riktig e-post till <span className="font-medium text-ink">{recipientEmail}</span> –
                  öppna kundlänken själv för att se och testa kundens upplevelse.
                </>
              ) : null}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <a href={publicPath} target="_blank" rel="noreferrer" className={buttonClasses("primary", "sm")}>
                <ExternalLink className="size-3.5" />
                Öppna kundvyn
              </a>
              <CopyLinkButton path={publicPath} />
              <button className={buttonClasses("ghost", "sm")} onClick={close}>
                Stäng
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 flex justify-center border-b border-line bg-card/95 px-6 py-3 backdrop-blur">
              <div className="flex rounded-xl bg-canvas p-1">
                {deviceTabs.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setDevice(key)}
                    className={cx(
                      "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all",
                      device === key ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
                    )}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-canvas px-4 py-8 sm:px-8">
              {device === "desktop" ? (
                <div className="mx-auto max-w-[760px] overflow-hidden rounded-2xl border border-line shadow-card">
                  {document}
                </div>
              ) : null}
              {device === "mobil" ? (
                <div className="mx-auto w-[400px] max-w-full">
                  <div className="overflow-hidden rounded-[2.4rem] border-[10px] border-ink/90 bg-white shadow-pop">
                    <div className="max-h-[58dvh] overflow-y-auto text-[90%]">{document}</div>
                  </div>
                </div>
              ) : null}
              {device === "pdf" ? (
                <div className="mx-auto max-w-[720px]">
                  <div className="mb-3 flex items-center justify-between text-[13px] text-muted">
                    <span>A4 · genereras vid skickning och bifogas e-postmeddelandet</span>
                    <a href={`${publicPath}/pdf`} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-medium text-ink hover:underline">
                      Öppna utskriftsvy <ExternalLink className="size-3" />
                    </a>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-line bg-white shadow-pop">{document}</div>
                </div>
              ) : null}
            </div>
          </>
        )}

        {!sent ? (
          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line bg-card px-6 py-4">
            <button className={buttonClasses("ghost")} onClick={close}>
              {mode === "send" ? "Tillbaka och redigera" : "Stäng"}
            </button>
            {mode === "send" && sendAction ? (
              <button
                className={buttonClasses("accent")}
                disabled={isSending}
                onClick={() =>
                  startSending(async () => {
                    await sendAction();
                    setSent(true);
                  })
                }
              >
                <Send className="size-4" />
                {isSending ? "Skickar …" : sendLabel}
              </button>
            ) : (
              <CopyLinkButton path={publicPath} />
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

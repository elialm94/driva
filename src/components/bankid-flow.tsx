"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Fingerprint,
  QrCode,
  Smartphone,
  CheckCircle2,
  XCircle,
  Clock,
  MessageCircleQuestion,
  X,
} from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses, cx, DemoTag } from "./ui";
import { askQuoteQuestionByTokenAction, declineQuoteByTokenAction } from "@/app/actions";

type Step = "choose" | "pending" | "done" | "failed";

interface CollectResponse {
  status: "pending" | "complete" | "failed";
  hintCode: string;
}

/** Deterministisk pseudo-QR (demo). En riktig integration visar BankID:s animerade QR-kod. */
function PseudoQR({ seed }: { seed: string }) {
  const size = 21;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const cells: boolean[] = [];
  for (let i = 0; i < size * size; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    cells.push((h & 4) === 0);
  }
  const finder = (x: number, y: number, cx: number, cy: number) =>
    (x >= cx && x < cx + 7 && (y === cy || y === cy + 6)) ||
    (y >= cy && y < cy + 7 && (x === cx || x === cx + 6)) ||
    (x >= cx + 2 && x < cx + 5 && y >= cy + 2 && y < cy + 5);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="size-44 rounded-lg bg-white p-1.5 shadow-card">
      {cells.map((on, i) => {
        const x = i % size;
        const y = Math.floor(i / size);
        const isFinder = finder(x, y, 0, 0) || finder(x, y, size - 7, 0) || finder(x, y, 0, size - 7);
        const inFinderZone =
          (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
        const fill = isFinder || (on && !inFinderZone);
        return fill ? <rect key={i} x={x} y={y} width={1} height={1} fill="#1d1c19" /> : null;
      })}
    </svg>
  );
}

export function BankIDApproval({
  token,
  quoteNumber,
  toPay,
  companyName,
}: {
  token: string;
  quoteNumber: number;
  toPay: string;
  companyName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [method, setMethod] = useState<"same_device" | "qr">("qr");
  const [orderRef, setOrderRef] = useState<string | null>(null);
  const [signText, setSignText] = useState<string>("");
  const [hint, setHint] = useState<string>("outstandingTransaction");
  const [failReason, setFailReason] = useState<string>("");
  const [qrTick, setQrTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimers = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (qrRef.current) clearInterval(qrRef.current);
    pollRef.current = null;
    qrRef.current = null;
  }, []);

  useEffect(() => () => stopTimers(), [stopTimers]);

  const start = useCallback(
    async (chosen: "same_device" | "qr") => {
      // Stoppa ev. pågående poll/QR-intervaller så att ett snabbt andra klick
      // inte lämnar föräldralösa intervaller kvar.
      stopTimers();
      setMethod(chosen);
      const res = await fetch("/api/bankid/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, method: chosen }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          router.refresh();
          return;
        }
        setFailReason("Det gick inte att starta BankID-signeringen. Försök igen.");
        setStep("failed");
        return;
      }
      const data = (await res.json()) as { orderRef: string; signText: string };
      setOrderRef(data.orderRef);
      setSignText(data.signText);
      setStep("pending");
      setHint("outstandingTransaction");

      qrRef.current = setInterval(() => setQrTick((t) => t + 1), 1000);
      pollRef.current = setInterval(async () => {
        const collect = await fetch(`/api/bankid/collect?orderRef=${encodeURIComponent(data.orderRef)}`);
        if (!collect.ok) return;
        const c = (await collect.json()) as CollectResponse;
        setHint(c.hintCode);
        if (c.status === "complete") {
          stopTimers();
          setStep("done");
          // Sidan uppdateras när kunden stänger bekräftelsen – så att
          // "Offerten är godkänd"-vyn inte rycker undan modalen.
        } else if (c.status === "failed") {
          stopTimers();
          setFailReason(
            c.hintCode === "userCancel"
              ? "Signeringen avbröts i BankID-appen."
              : c.hintCode === "expiredTransaction"
                ? "Tiden gick ut innan signeringen slutfördes."
                : "Ett tekniskt fel uppstod under signeringen."
          );
          setStep("failed");
        }
      }, 1200);
    },
    [router, stopTimers, token]
  );

  async function demoEvent(event: "open_app" | "complete" | "cancel" | "timeout") {
    if (!orderRef) return;
    await fetch("/api/bankid/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderRef, event }),
    });
  }

  function close() {
    stopTimers();
    if (step === "pending" && orderRef) {
      void fetch("/api/bankid/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderRef }),
      });
    }
    setOpen(false);
    setStep("choose");
    setOrderRef(null);
    if (step === "done") router.refresh();
  }

  return (
    <>
      <button className={cx(buttonClasses("bankid", "lg"), "w-full sm:w-auto")} onClick={() => setOpen(true)}>
        <Fingerprint className="size-5" />
        Godkänn med BankID
      </button>

      <Modal open={open} onClose={close} size="md" title={step === "done" ? undefined : "Godkänn med BankID"}>
        <div className="px-6 py-6">
          {/* Vad kunden signerar – alltid synligt under processen */}
          {step !== "done" ? (
            <div className="mb-5 rounded-2xl border border-line bg-canvas/60 px-4 py-3.5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Du signerar</p>
              <p className="mt-1 text-[14px] leading-relaxed text-ink">
                {signText || `Jag godkänner offert #${quoteNumber} från ${companyName}.`}
              </p>
              <p className="mt-1 text-[13px] text-soft">Att betala: {toPay}</p>
            </div>
          ) : null}

          {step === "choose" ? (
            <div className="space-y-2.5">
              <button
                onClick={() => start("same_device")}
                className="flex w-full items-center gap-4 rounded-2xl border border-line-strong px-5 py-4 text-left transition-all hover:border-bankid hover:bg-bankid-soft/40"
              >
                <Smartphone className="size-6 text-bankid" />
                <div>
                  <p className="text-[15px] font-semibold">Öppna BankID på den här enheten</p>
                  <p className="text-[13px] text-soft">Om du har BankID på den här mobilen eller datorn</p>
                </div>
              </button>
              <button
                onClick={() => start("qr")}
                className="flex w-full items-center gap-4 rounded-2xl border border-line-strong px-5 py-4 text-left transition-all hover:border-bankid hover:bg-bankid-soft/40"
              >
                <QrCode className="size-6 text-bankid" />
                <div>
                  <p className="text-[15px] font-semibold">Använd BankID på en annan enhet</p>
                  <p className="text-[13px] text-soft">Skanna en QR-kod med BankID-appen</p>
                </div>
              </button>
            </div>
          ) : null}

          {step === "pending" ? (
            <div className="flex flex-col items-center py-2 text-center">
              {method === "qr" ? (
                <>
                  <PseudoQR seed={`${orderRef}-${qrTick}`} />
                  <p className="mt-4 text-[15px] font-medium">Skanna QR-koden med BankID-appen</p>
                  <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-soft">
                    Öppna BankID-appen på din andra enhet, tryck på QR-ikonen och rikta kameran mot koden.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex size-20 items-center justify-center rounded-full bg-bankid-soft">
                    <Fingerprint className="size-10 animate-pulse text-bankid" />
                  </div>
                  <p className="mt-4 text-[15px] font-medium">
                    {hint === "userSign" ? "Skriv in din säkerhetskod i BankID-appen" : "Öppnar BankID …"}
                  </p>
                  <p className="mt-1 text-[13px] text-soft">
                    {hint === "userSign"
                      ? "Bekräfta signeringen med din säkerhetskod eller biometri."
                      : "Starta BankID-appen om den inte öppnas automatiskt."}
                  </p>
                </>
              )}

              <button onClick={close} className="mt-5 text-[13px] font-medium text-muted hover:text-ink">
                Avbryt signeringen
              </button>

              {/* Demo-panel: tydligt separerad från det riktiga flödet */}
              <div className="mt-6 w-full rounded-2xl border border-warn/25 bg-warn-soft/50 p-4 text-left">
                <div className="flex items-center gap-2">
                  <DemoTag>Demo-läge</DemoTag>
                  <p className="text-[12px] font-medium text-warn">Ingen riktig BankID-app anropas</p>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-soft">
                  I produktion styrs stegen av BankID:s collect-svar. Här simulerar du kundens handlingar:
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {hint !== "userSign" ? (
                    <button className={buttonClasses("secondary", "sm")} onClick={() => demoEvent("open_app")}>
                      Kunden öppnar appen
                    </button>
                  ) : null}
                  <button className={buttonClasses("primary", "sm")} onClick={() => demoEvent("complete")}>
                    Slutför signering
                  </button>
                  <button className={buttonClasses("secondary", "sm")} onClick={() => demoEvent("cancel")}>
                    Avbryt i appen
                  </button>
                  <button className={buttonClasses("secondary", "sm")} onClick={() => demoEvent("timeout")}>
                    Timeout
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {step === "done" ? (
            <div className="flex flex-col items-center py-8 text-center animate-fade-up">
              <div className="flex size-16 items-center justify-center rounded-full bg-ok-soft">
                <CheckCircle2 className="size-8 text-ok" />
              </div>
              <p className="mt-5 text-[20px] font-semibold tracking-tight">Offerten är godkänd</p>
              <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-soft">
                Tack! Din BankID-signering är registrerad. {companyName} har fått besked och återkommer om nästa steg.
              </p>
              <button className={cx(buttonClasses("primary"), "mt-6")} onClick={close}>
                Klart
              </button>
            </div>
          ) : null}

          {step === "failed" ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-danger-soft">
                {failReason.includes("Tiden") ? <Clock className="size-7 text-danger" /> : <XCircle className="size-7 text-danger" />}
              </div>
              <p className="mt-4 text-[17px] font-semibold">BankID ej slutfört</p>
              <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-soft">
                {failReason} Offerten är inte godkänd.
              </p>
              <div className="mt-5 flex gap-2">
                <button className={buttonClasses("ghost")} onClick={close}>
                  Stäng
                </button>
                <button
                  className={buttonClasses("bankid")}
                  onClick={() => {
                    setStep("choose");
                    setFailReason("");
                  }}
                >
                  <Fingerprint className="size-4" /> Försök igen
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

export function QuoteQuestionButton({ token, companyName }: { token: string; companyName: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [text, setText] = useState("");
  return (
    <>
      <button className={cx(buttonClasses("secondary", "lg"), "w-full sm:w-auto")} onClick={() => setOpen(true)}>
        <MessageCircleQuestion className="size-4.5" />
        Ställ en fråga
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Ställ en fråga" size="sm">
        {sent ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <CheckCircle2 className="size-9 text-ok" />
            <p className="mt-3 text-[16px] font-semibold">Frågan är skickad</p>
            <p className="mt-1 text-[14px] text-soft">{companyName} återkommer till dig så snart som möjligt.</p>
            <button className={cx(buttonClasses("primary", "sm"), "mt-5")} onClick={() => setOpen(false)}>
              Stäng
            </button>
          </div>
        ) : (
          <form
            className="space-y-4 px-6 py-5"
            action={async () => {
              if (!text.trim()) return;
              await askQuoteQuestionByTokenAction(token, text.trim());
              setSent(true);
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="Skriv din fråga om offerten …"
              className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] placeholder:text-muted focus:border-accent"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
                Avbryt
              </button>
              <button type="submit" className={buttonClasses("primary")} disabled={!text.trim()}>
                Skicka fråga
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

export function DeclineQuoteButton({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();
  return (
    <>
      <button className="text-[14px] font-medium text-muted underline-offset-2 hover:text-danger hover:underline" onClick={() => setOpen(true)}>
        Avböj offerten
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Avböj offerten" size="sm">
        <form
          className="space-y-4 px-6 py-5"
          action={async () => {
            await declineQuoteByTokenAction(token, reason.trim() || undefined);
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[14px] leading-relaxed text-soft">
            Tråkigt att det inte passade den här gången. Vill du berätta varför? (frivilligt)
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="T.ex. priset, tidplanen …"
            className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] placeholder:text-muted focus:border-accent"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
              <X className="size-4" /> Avbryt
            </button>
            <button type="submit" className={buttonClasses("danger")}>
              Avböj offerten
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

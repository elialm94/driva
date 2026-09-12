"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Landmark, RefreshCw, Unlink } from "lucide-react";
import {
  cancelBankConnectAction,
  connectBankAction,
  disconnectBankAction,
  refreshBankAction,
  type BankActionResult,
} from "@/app/bank-actions";
import { buttonClasses, cx, DemoTag } from "./ui";
import { Modal } from "./modal";

/**
 * Bankkoppling – klientknappar. Live-flödet är en HELSIDES-navigering till
 * Tink Link (window.location.assign), aldrig en iframe: mobila banker och
 * BankID-appen kräver toppnivåfönstret. Mocken kopplar direkt.
 */

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-[13px] font-medium text-danger">
      {text}
    </p>
  );
}

export function ConnectBankButton({
  demo,
  label = "Koppla företagskonto",
  variant = "primary",
}: {
  demo: boolean;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        className={cx(buttonClasses(variant), "max-lg:min-h-11")}
        disabled={isPending || leaving}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result: BankActionResult = await connectBankAction();
            if (!result.ok) {
              setError(result.error);
              return;
            }
            if (result.redirectTo?.startsWith("http")) {
              setLeaving(true);
              window.location.assign(result.redirectTo);
              return;
            }
            router.push((result.redirectTo ?? "/bokforing/bank") as never);
            router.refresh();
          });
        }}
      >
        <Landmark className="size-4 shrink-0" />
        {leaving ? "Skickar dig till banken …" : isPending ? "Kopplar …" : label}
        {demo ? <DemoTag /> : null}
      </button>
      <ErrorLine text={error} />
    </div>
  );
}

export function RefreshBankButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={cx(buttonClasses("secondary", "sm"), "max-lg:min-h-11")}
        disabled={isPending}
        onClick={() => {
          setError(null);
          setNote(null);
          startTransition(async () => {
            const result = await refreshBankAction();
            if (!result.ok) {
              setError(result.error);
              return;
            }
            const n = result.imported ?? 0;
            setNote(n === 0 ? "Inga nya transaktioner" : n === 1 ? "1 ny transaktion" : `${n} nya transaktioner`);
            router.refresh();
          });
        }}
      >
        <RefreshCw className={cx("size-3.5 shrink-0", isPending && "animate-spin")} />
        {isPending ? "Hämtar …" : "Uppdatera"}
      </button>
      {note ? (
        <p role="status" className="text-[12px] text-muted">
          {note}
        </p>
      ) : null}
      <ErrorLine text={error} />
    </div>
  );
}

export function DisconnectBankButton({ bankName }: { bankName?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")}
        disabled={isPending}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Unlink className="size-3.5 shrink-0" />
        Koppla från
      </button>
      <Modal
        open={open}
        onClose={() => !isPending && setOpen(false)}
        title={bankName ? `Koppla från ${bankName}?` : "Koppla från banken?"}
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")}
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              Avbryt
            </button>
            <button
              type="button"
              className={cx(buttonClasses("danger", "sm"), "max-lg:min-h-11")}
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await disconnectBankAction();
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {isPending ? "Kopplar från …" : "Koppla från"}
            </button>
          </div>
        }
      >
        <div className="space-y-2 text-[14px] text-soft">
          <p>Driva slutar hämta saldo och transaktioner och bankens medgivande återkallas hos Tink.</p>
          <p>Transaktioner som redan hämtats och verifikationer som bokförts finns kvar.</p>
          <ErrorLine text={error} />
        </div>
      </Modal>
    </>
  );
}

export function CancelPendingBankButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className={cx(buttonClasses("ghost", "sm"), "max-lg:min-h-11")}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await cancelBankConnectAction();
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          })
        }
      >
        {isPending ? "Avbryter …" : "Avbryt kopplingen"}
      </button>
      <ErrorLine text={error} />
    </div>
  );
}

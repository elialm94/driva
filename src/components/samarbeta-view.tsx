"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { Badge, ButtonLink, Card, buttonClasses, cx } from "./ui";
import { FieldError, invalidFieldCls } from "./form-validation";
import { Modal } from "./modal";
import {
  enterLocalAccountantDemoAction,
  inviteCollaboratorAction,
  resendCollaboratorInviteAction,
  revokeCollaboratorAction,
  type InviteState,
} from "@/app/collaboration-actions";
import type { SamarbetaPerson } from "@/lib/collaboration/service";

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function SamarbetaView({
  people,
  localDemo = false,
  demoSession = false,
}: {
  people: SamarbetaPerson[];
  localDemo?: boolean;
  /** Publika demosessionen: konsultbytet öppnas som vy på samma session. */
  demoSession?: boolean;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirm, setConfirm] = useState<SamarbetaPerson | null>(null);
  const [inviteState, inviteAction, invitePending] = useActionState(inviteCollaboratorAction, {} as InviteState);
  const [revokeState, setRevokeState] = useState<InviteState>({});
  const [resendState, setResendState] = useState<InviteState>({});
  const [resendPendingId, setResendPendingId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [tried, setTried] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const connected = people.filter((p) => p.status === "active");
  const pending = people.filter((p) => p.status === "pending");
  const empty = connected.length === 0 && pending.length === 0;
  const emailError =
    tried && !looksLikeEmail(email)
      ? "Ange en giltig e-postadress."
      : inviteOpen && inviteState.error && /e-post/i.test(inviteState.error)
        ? inviteState.error
        : undefined;

  useEffect(() => {
    if (inviteState.notice) {
      setInviteOpen(false);
      setEmail("");
      setTried(false);
    }
  }, [inviteState.notice]);

  useEffect(() => {
    if (!inviteOpen) return;
    const t = window.setTimeout(() => emailRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [inviteOpen]);

  function openInvite() {
    setTried(false);
    setInviteOpen(true);
  }

  return (
    <div className="space-y-6">
      {inviteState.error && !inviteOpen && !/e-post/i.test(inviteState.error) ? (
        <p role="alert" className="text-[14px] text-danger">
          {inviteState.error}
        </p>
      ) : null}
      {resendState.notice ? (
        <p role="status" className="text-[14px] text-ok">
          {resendState.notice}
        </p>
      ) : null}
      {resendState.error ? (
        <p role="alert" className="text-[14px] text-danger">
          {resendState.error}
        </p>
      ) : null}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Redovisningskonsult</h2>
            <p className="mt-1 text-[14px] text-soft">
              {empty
                ? "Ingen ansluten ännu."
                : `${connected.length} ansluten${connected.length === 1 ? "" : "a"}${pending.length ? ` · ${pending.length} inbjudan skickad` : ""}`}
            </p>
          </div>
          <button type="button" className={buttonClasses("primary", "md")} onClick={openInvite}>
            <UserPlus className="size-4" />
            Bjud in
          </button>
        </div>

        {connected.length + pending.length > 0 ? (
          <ul className="mt-5 divide-y divide-line">
            {people.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  {p.status === "pending" ? (
                    <>
                      <p className="font-medium text-ink">{p.email}</p>
                      <p className="text-[13px] text-soft">Inbjudan skickad · {p.roleLabel}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-ink">
                        {p.name}
                        {p.lastActiveToday ? (
                          <span className="ml-2 text-[12px] font-normal text-ok">Aktiv idag</span>
                        ) : null}
                      </p>
                      <p className="truncate text-[13px] text-soft">
                        {p.email} · {p.roleLabel}
                      </p>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {p.status === "pending" ? (
                    <>
                      <Badge tone="warn">Inbjudan skickad</Badge>
                      <form
                        action={async (fd) => {
                          setResendPendingId(p.invitationId);
                          const res = await resendCollaboratorInviteAction(fd);
                          setResendState(res);
                          setResendPendingId(null);
                        }}
                      >
                        <input type="hidden" name="invitationId" value={p.invitationId} />
                        <button
                          type="submit"
                          className={buttonClasses("ghost", "sm")}
                          disabled={resendPendingId === p.invitationId}
                        >
                          {resendPendingId === p.invitationId ? "Skickar …" : "Skicka igen"}
                        </button>
                      </form>
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] font-medium text-soft hover:bg-danger-soft hover:text-danger"
                        onClick={() => setConfirm(p)}
                      >
                        Ta tillbaka inbjudan
                      </button>
                    </>
                  ) : (
                    <>
                      <Badge tone="ok">Kopplad</Badge>
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] font-medium text-soft hover:bg-danger-soft hover:text-danger"
                        onClick={() => setConfirm(p)}
                      >
                        Ta bort
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <p className="text-[13px] text-muted">Du kan ta bort åtkomsten när som helst.</p>

      {localDemo || demoSession ? (
        <p className="text-[13px] text-soft">
          <button
            type="button"
            className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
            onClick={() => void enterLocalAccountantDemoAction()}
          >
            Öppna redovisningsytan som Anna Svensson
          </button>
          <span className="text-muted"> · {demoSession ? "demo" : "lokal förhandsvisning"}</span>
        </p>
      ) : null}

      <Modal
        open={inviteOpen}
        onClose={() => !invitePending && setInviteOpen(false)}
        title="Bjud in till Driva"
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className={buttonClasses("ghost")}
              disabled={invitePending}
              onClick={() => setInviteOpen(false)}
            >
              Avbryt
            </button>
            <button
              type="submit"
              form="invite-form"
              disabled={invitePending || (tried && !looksLikeEmail(email))}
              className={buttonClasses("primary")}
            >
              {invitePending ? "Skickar…" : "Skicka inbjudan"}
            </button>
          </div>
        }
      >
        <form
          id="invite-form"
          action={inviteAction}
          className="space-y-5 px-6 py-5"
          onSubmit={(e) => {
            setTried(true);
            if (!looksLikeEmail(email)) {
              e.preventDefault();
              emailRef.current?.focus();
            }
          }}
        >
          <div>
            <label htmlFor="invite-email" className="block text-[13px] font-medium text-ink">
              E-post
            </label>
            <input
              ref={emailRef}
              id="invite-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cx(
                "mt-1.5 h-11 w-full rounded-xl border border-line bg-card px-3 text-[15px] text-ink outline-none placeholder:text-muted focus:border-ink",
                emailError && invalidFieldCls
              )}
              placeholder="namn@byra.se"
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "invite-email-error" : undefined}
            />
            <FieldError id="invite-email-error">{emailError}</FieldError>
          </div>

          <p className="text-[13px] leading-relaxed text-soft">
            Personen får tillgång till företagets bokföring och kan hjälpa dig hantera den. Du kan
            ta bort åtkomsten när som helst.
          </p>

          {inviteState.error && !emailError ? (
            <p role="alert" className="text-[13px] text-danger">
              {inviteState.error}
            </p>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm?.status === "pending" ? "Ta tillbaka inbjudan?" : "Ta bort åtkomst?"}
        size="sm"
      >
        {confirm ? (
          <div className="space-y-4 px-6 py-5">
            {confirm.status === "pending" ? (
              <p className="text-[15px] leading-relaxed text-soft">
                Inbjudan till <span className="font-medium text-ink">{confirm.email}</span> tas tillbaka.
                Personen har inte fått åtkomst.
              </p>
            ) : (
              <>
                <p className="text-[15px] leading-relaxed text-ink">
                  {confirm.name} kommer inte längre kunna öppna företagets bokföring.
                </p>
                <p className="text-[13px] leading-relaxed text-soft">
                  Bokföring och rättelser som redan gjorts ligger kvar.
                </p>
              </>
            )}
            {revokeState.error ? <p className="text-sm text-danger">{revokeState.error}</p> : null}
            <form
              action={async (fd) => {
                const res = await revokeCollaboratorAction(fd);
                setRevokeState(res);
                if (!res.error) setConfirm(null);
              }}
            >
              {confirm.userId ? <input type="hidden" name="userId" value={confirm.userId} /> : null}
              {confirm.invitationId ? <input type="hidden" name="invitationId" value={confirm.invitationId} /> : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" className={buttonClasses("ghost")} onClick={() => setConfirm(null)}>
                  Avbryt
                </button>
                <button type="submit" className={buttonClasses("danger")}>
                  {confirm.status === "pending" ? "Ta tillbaka inbjudan" : "Ta bort åtkomst"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export function SamarbetaEmptyCta() {
  return <ButtonLink href="/samarbeta">Bjud in</ButtonLink>;
}

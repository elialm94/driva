"use client";

/**
 * Klientdelar för /admin/mfa. All verifiering sker i server actions mot den
 * egna Supabase-sessionen – komponenterna visar bara QR/kodfält och svar.
 */
import { useActionState, useState } from "react";
import { ActionButton, PendingButton, StateForm, adminInputClass } from "@/components/admin/forms";
import { AdminBadge } from "@/components/admin/ui";
import type { AdminActionState } from "@/app/admin/actions";
import {
  beginMfaEnrollmentAction,
  completeMfaEnrollmentAction,
  unenrollMfaFactorAction,
  verifyMfaChallengeAction,
  type MfaEnrollState,
} from "@/app/admin/mfa-actions";
import type { MfaFactorInfo, OwnMfaState } from "@/lib/platform/mfa";

const codeInputClass = `${adminInputClass} tracking-[0.3em] text-center text-[16px] tabular-nums`;

export function MfaEnrollment() {
  const [state, formAction] = useActionState<MfaEnrollState, FormData>(beginMfaEnrollmentAction, {});
  if (!state.factorId) {
    return (
      <form action={formAction} className="space-y-2" data-mfa-enroll-start>
        <label className="flex flex-col gap-1 text-[12.5px] text-neutral-400">
          Namn på enheten (valfritt)
          <input name="friendlyName" placeholder="T.ex. Telefon" className={adminInputClass} maxLength={60} />
        </label>
        <PendingButton variant="primary">Visa QR-kod</PendingButton>
        {state.error ? <p className="text-[12.5px] text-red-400">{state.error}</p> : null}
      </form>
    );
  }
  return <EnrollmentConfirm enrollment={state} />;
}

function EnrollmentConfirm({ enrollment }: { enrollment: MfaEnrollState }) {
  const [state, formAction] = useActionState<MfaEnrollState, FormData>(completeMfaEnrollmentAction, enrollment);
  const [showSecret, setShowSecret] = useState(false);
  const svg = enrollment.qrCodeSvg ?? "";
  const src = svg.startsWith("data:") ? svg : `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return (
    <div className="space-y-3" data-mfa-enroll-confirm>
      <ol className="list-decimal space-y-1 pl-5 text-[13px]">
        <li>Öppna din autentiseringsapp (t.ex. 1Password, Bitwarden, Google Authenticator).</li>
        <li>Skanna QR-koden eller skriv in reservnyckeln manuellt.</li>
        <li>Ange den sexsiffriga koden appen visar.</li>
      </ol>
      <div className="flex justify-center rounded-lg bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- QR-koden är en engångs-SVG från Supabase, ingen extern bild */}
        <img src={src} alt="QR-kod för autentiseringsapp" width={180} height={180} />
      </div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-[12.5px]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-neutral-200">Reservnyckel</span>
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            className="text-[12px] text-amber-300 hover:underline"
          >
            {showSecret ? "Dölj" : "Visa"}
          </button>
        </div>
        {showSecret ? (
          <code className="mt-1 block break-all font-mono text-[12px] text-neutral-100" data-mfa-secret>
            {enrollment.secret}
          </code>
        ) : (
          <p className="mt-1 text-neutral-500">
            Spara nyckeln i en lösenordshanterare. Den visas bara nu – Ferva lagrar den aldrig och
            kan inte visa den igen. Förlorar du både enhet och nyckel måste en superadmin
            återställa din MFA.
          </p>
        )}
      </div>
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="factorId" value={enrollment.factorId} />
        <label className="flex flex-col gap-1 text-[12.5px] text-neutral-400">
          Kod från appen
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            required
            autoFocus
            className={codeInputClass}
          />
        </label>
        <PendingButton variant="primary" className="w-full">
          Aktivera tvåfaktorsautentisering
        </PendingButton>
        {state.error ? <p className="text-[12.5px] text-red-400">{state.error}</p> : null}
      </form>
    </div>
  );
}

export function MfaChallenge({ factors, next }: { factors: MfaFactorInfo[]; next: string }) {
  const [state, formAction] = useActionState<AdminActionState, FormData>(verifyMfaChallengeAction, {});
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  return (
    <form action={formAction} className="space-y-2" data-mfa-challenge>
      <input type="hidden" name="next" value={next} />
      {factors.length > 1 ? (
        <label className="flex flex-col gap-1 text-[12.5px] text-neutral-400">
          Enhet
          <select
            name="factorId"
            value={factorId}
            onChange={(e) => setFactorId(e.target.value)}
            className={adminInputClass}
          >
            {factors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.friendlyName}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="factorId" value={factorId} />
      )}
      <label className="flex flex-col gap-1 text-[12.5px] text-neutral-400">
        Kod från autentiseringsappen
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          autoFocus
          className={codeInputClass}
        />
      </label>
      <PendingButton variant="primary" className="w-full">
        Verifiera
      </PendingButton>
      {state.error ? <p className="text-[12.5px] text-red-400">{state.error}</p> : null}
      <p className="text-[12px] text-neutral-600">
        Förlorat enheten? En superadmin kan återställa din MFA under Admins – med skäl och
        auditlogg.
      </p>
    </form>
  );
}

export function MfaManage({ state, required }: { state: OwnMfaState; required: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3" data-mfa-manage>
      <p>
        Sessionen är verifierad med andra faktorn (
        <AdminBadge tone="ok">AAL2</AdminBadge>
        ). {required ? "MFA krävs för alla admins i den här miljön." : "MFA-kravet är avstängt i den här miljön."}
      </p>
      <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
        {state.verified.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
            <span>
              <span className="text-neutral-100">{f.friendlyName}</span>
              <span className="ml-2 text-[11.5px] text-neutral-500">
                registrerad {f.createdAt.slice(0, 10)}
              </span>
            </span>
            <ActionButton
              action={unenrollMfaFactorAction}
              fields={{ factorId: f.id }}
              variant="danger"
              confirmText={
                state.verified.length === 1
                  ? "Detta är din enda faktor. Tar du bort den måste du registrera en ny innan du kan använda Ferva Admin igen. Fortsätt?"
                  : `Ta bort ${f.friendlyName}?`
              }
            >
              Ta bort
            </ActionButton>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="rounded-lg border border-neutral-800 p-3">
          <MfaEnrollment />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-8 items-center rounded-lg border border-neutral-700 px-3 text-[12.5px] font-medium text-neutral-200 hover:bg-neutral-800"
        >
          Lägg till ytterligare enhet
        </button>
      )}
    </div>
  );
}

/** super_admin-formulär i teamvyn: återställ en annan admins MFA. */
export function ResetMfaForm({
  adminId,
  action,
}: {
  adminId: string;
  action: (prev: AdminActionState, formData: FormData) => Promise<AdminActionState>;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center rounded-lg border border-neutral-700 px-3 text-[12.5px] font-medium text-neutral-200 hover:bg-neutral-800"
      >
        Återställ MFA
      </button>
    );
  }
  return (
    <StateForm action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="adminId" value={adminId} />
      <input
        name="reason"
        required
        minLength={5}
        placeholder="Skäl (loggas), t.ex. förlorad telefon"
        className={`${adminInputClass} min-w-56`}
      />
      <div className="flex gap-1.5">
        <PendingButton variant="danger">Ta bort alla faktorer</PendingButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] text-neutral-400 hover:text-neutral-100"
        >
          Avbryt
        </button>
      </div>
    </StateForm>
  );
}

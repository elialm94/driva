"use client";

import { useState } from "react";
import { dataSubjectRequestAction } from "@/app/admin/actions";
import { PendingButton, StateForm, adminInputClass, adminTextareaClass } from "@/components/admin/forms";

/**
 * Registrerades begäran: typ, grund och – för radering/anonymisering – ett
 * bekräftelsefält. Servern gör om policykontrollen oavsett vad som visas.
 */
export function DataSubjectRequestForm({
  userId,
  email,
  isSuper,
  deletionBlockers,
  anonymizationBlockers,
  retainedBusinesses,
}: {
  userId: string;
  email: string;
  isSuper: boolean;
  deletionBlockers: string[];
  anonymizationBlockers: string[];
  retainedBusinesses: string[];
}) {
  const [kind, setKind] = useState<"rattelse" | "radering" | "anonymisering">("rattelse");
  const destructive = kind !== "rattelse";
  const blockers = kind === "radering" ? deletionBlockers : kind === "anonymisering" ? anonymizationBlockers : [];
  const blocked = destructive && (!isSuper || blockers.length > 0);

  return (
    <StateForm action={dataSubjectRequestAction} className="space-y-3 px-4 py-3 text-[12.5px]">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="email" value={email} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-neutral-400">Typ av begäran</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className={adminInputClass}
            data-dsr-kind
          >
            <option value="rattelse">Rättelse (loggas)</option>
            <option value="radering">Radering (enligt raderingspolicy)</option>
            <option value="anonymisering">Anonymisering (när bokföring måste bevaras)</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-neutral-400">Grund / referens (ingen känslig data)</span>
          <textarea name="reason" required minLength={5} maxLength={500} rows={2} className={adminTextareaClass} />
        </label>
      </div>

      {kind === "radering" ? (
        <p className="text-neutral-400">
          Raderar auth-kontot, tomma egna företag och återkallar medlemskap. Företag med bokföring blockerar – välj
          anonymisering.
        </p>
      ) : null}
      {kind === "anonymisering" ? (
        <div className="space-y-1 text-neutral-400">
          <p>
            Kontot stängs permanent, e-post och telefon ersätts med platshållare i auth och supportärenden, medlemskap
            återkallas. Räkenskaper i företag med bevarandeplikt bevaras skrivskyddade (företaget inaktiveras).
          </p>
          {retainedBusinesses.length > 0 ? <p>Behålls inaktiverade: {retainedBusinesses.join(", ")}.</p> : null}
        </div>
      ) : null}
      {destructive && !isSuper ? (
        <p className="text-amber-300">Bara super_admin kan utföra radering eller anonymisering.</p>
      ) : null}
      {destructive && blockers.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-red-300">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      {destructive && !blocked ? (
        <label className="block">
          <span className="mb-1 block text-neutral-400">Skriv användarens e-postadress för att bekräfta</span>
          <input name="confirmEmail" type="email" required autoComplete="off" className={adminInputClass} />
        </label>
      ) : null}
      <PendingButton variant={destructive ? "danger" : "primary"} disabled={blocked} data-dsr-submit>
        {kind === "rattelse" ? "Logga begäran" : kind === "radering" ? "Radera på begäran" : "Anonymisera på begäran"}
      </PendingButton>
    </StateForm>
  );
}

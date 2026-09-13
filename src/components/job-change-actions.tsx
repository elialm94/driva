"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { createJobChangeVersionAction } from "@/app/closeout-actions";
import { ShareCustomerLink } from "./share-customer-link";
import { buttonClasses } from "./ui";

/**
 * Åtgärder för en skickad ändring: dela kundlänken och skapa ny version.
 * Inget skickas automatiskt – företagaren väljer kanal.
 */
export function JobChangeActions({
  changeId,
  jobHref,
  token,
  number,
  phone,
  canCreateVersion,
}: {
  changeId: string;
  jobHref: string;
  token: string;
  number: number;
  phone?: string;
  canCreateVersion: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function newVersion() {
    start(async () => {
      const r = await createJobChangeVersionAction(changeId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`${jobHref}/andringar/${r.changeId}` as never);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2" data-testid="job-change-actions">
      <div className="flex flex-wrap items-center gap-2">
        <ShareCustomerLink path={`/andring/${token}`} kind="andring" number={number} phone={phone} />
        {canCreateVersion ? (
          <button type="button" onClick={newVersion} disabled={pending} className={buttonClasses("secondary", "sm")} data-testid="job-change-new-version">
            <FilePlus2 className="size-3.5" /> Ny version
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

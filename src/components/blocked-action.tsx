"use client";

import { useRef, useState } from "react";
import {
  nextAfterResolve,
  type MissingRequirementCode,
  type PendingAction,
} from "@/lib/missing-requirements";

/**
 * Delad klienthalva av resolveMissingRequirements → resumePendingAction.
 * Vet vilken åtgärd som stoppades; efter lyckad komplettering anropas
 * onResume med den persistade kunden – inte en dokumentskopia.
 */
export function useBlockedAction(opts: {
  action: PendingAction;
  customerEmail?: string | null;
  customerPhone?: string | null;
  onResume: (resolved: { email: string }) => void;
}) {
  const onResumeRef = useRef(opts.onResume);
  onResumeRef.current = opts.onResume;

  const [collecting, setCollecting] = useState<MissingRequirementCode | null>(null);
  const [emailOverride, setEmailOverride] = useState<string | null>(null);
  const email = emailOverride ?? opts.customerEmail?.trim() ?? "";

  function requestAction() {
    const next = nextAfterResolve(opts.action, { email, phone: opts.customerPhone });
    if (next.type === "collect") {
      setCollecting(next.field);
      return;
    }
    onResumeRef.current({ email });
  }

  function resumeAfterResolve(resolved: { email: string }) {
    setEmailOverride(resolved.email);
    setCollecting(null);
    onResumeRef.current({ email: resolved.email });
  }

  function cancelCollect() {
    setCollecting(null);
  }

  return { email, collecting, requestAction, resumeAfterResolve, cancelCollect };
}

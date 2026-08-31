"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { activateOptionalFeatureAction } from "@/app/actions";
import {
  OPTIONAL_FEATURE_COPY,
  OPTIONAL_FEATURE_IDS,
  type OptionalFeatureId,
  type ResolvedOptionalFeatures,
} from "@/lib/optional-features";
import { buttonClasses } from "./ui";

export function FeatureSettingsList({ features }: { features: ResolvedOptionalFeatures }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Funktioner</p>
        <p className="mt-1 text-[14px] leading-relaxed text-soft">
          Grundfunktionerna syns alltid i menyn. De här slår du på när du behöver dem.
        </p>
      </div>
      {OPTIONAL_FEATURE_IDS.map((id) => (
        <FeatureRow key={id} id={id} active={features[id]} />
      ))}
    </div>
  );
}

function FeatureRow({ id, active }: { id: OptionalFeatureId; active: boolean }) {
  const copy = OPTIONAL_FEATURE_COPY[id];
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function activate() {
    setError(null);
    startTransition(async () => {
      const result = await activateOptionalFeatureAction(id);
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      router.push(result.href as never);
      router.refresh();
    });
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-line px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-ink">{copy.title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-soft">{copy.description}</p>
        {error ? <p className="mt-1.5 text-[13px] font-medium text-danger">{error}</p> : null}
      </div>
      {active ? (
        <span className="shrink-0 rounded-full bg-ok-soft px-2.5 py-1 text-[12px] font-medium text-ok">Aktiv</span>
      ) : (
        <button
          type="button"
          className={buttonClasses("secondary", "sm")}
          disabled={pending}
          onClick={activate}
        >
          {pending ? "Aktiverar …" : copy.activate}
        </button>
      )}
    </div>
  );
}

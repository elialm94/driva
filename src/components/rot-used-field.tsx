"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { kr } from "@/lib/format";
import { setCustomerTaxReductionUsedAction } from "@/app/actions";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";

export function RotUsedField({
  customerId,
  year,
  rot,
  rut,
  remainingRot,
}: {
  customerId: string;
  year: number;
  rot: number;
  rut: number;
  remainingRot: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(rot ? String(rot) : "");
  const [isPending, start] = useTransition();

  function save() {
    const n = Math.max(0, Math.round(Number(String(value).replace(",", ".")) || 0));
    start(async () => {
      await setCustomerTaxReductionUsedAction(customerId, { year, rot: n, rut });
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-line/80 px-4 py-3">
      <p className="text-[13px] font-medium text-ink">ROT använt {year}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
        Det kunden redan fått i ROT hos andra. Driva räknar egna fakturor själv. Kvar att lova: {kr(remainingRot)}.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          className={inputCls}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          aria-label={`ROT använt ${year} i kronor`}
        />
        <span className="self-center text-[13px] text-muted">kr</span>
      </div>
      {isPending ? <p className="mt-1 text-[12px] text-muted">Sparar …</p> : null}
    </div>
  );
}

import { ROT_TAK, RUT_TAK } from "@/lib/calc";
import { kr } from "@/lib/format";

/**
 * Fervas egna ROT/RUT-fakturor i år mot lagens tak. Inget inmatningsfält
 * för tredje parts användning – ett tomt sådant värde är okänt, inte noll.
 */
export function RotUsedField({
  year,
  rot,
  rut,
}: {
  year: number;
  rot: number;
  rut: number;
}) {
  return (
    <div className="rounded-2xl border border-line/80 px-4 py-3">
      <p className="text-[13px] font-medium text-ink">Ferva i {year}</p>
      <p className="mt-1.5 text-[14px] tabular text-ink">
        ROT {kr(rot)} av {kr(ROT_TAK)}
      </p>
      <p className="text-[14px] tabular text-ink">
        RUT {kr(rut)} av {kr(RUT_TAK)}
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
        Fervas fakturor mot det lagstadgade taket. Det här är inte Skatteverkets saldo.
      </p>
    </div>
  );
}

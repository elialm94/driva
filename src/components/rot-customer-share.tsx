import { kr } from "@/lib/format";

export function RotCustomerShareCallout({
  type,
  toPay,
  deduction,
}: {
  type: "rot" | "rut";
  toPay: number;
  deduction: number;
}) {
  if (deduction <= 0) return null;
  const kind = type === "rot" ? "ROT" : "RUT";
  return (
    <p className="mt-3 rounded-xl bg-canvas px-3 py-2 text-[13px] leading-relaxed text-soft" data-rot-share="">
      Kunden betalar <span className="font-semibold text-ink">{kr(toPay)}</span>. {kind}{" "}
      <span className="font-semibold text-ink">{kr(deduction)}</span> begärs hos Skatteverket när arbetet är klart och
      kundens del är betald.
    </p>
  );
}

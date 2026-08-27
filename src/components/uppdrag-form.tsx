"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { createJobAction } from "@/app/actions";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

export function NewUppdragButton({
  customers,
  defaultCustomerId,
  size = "md",
  variant = "primary",
}: {
  customers: { id: string; name: string }[];
  defaultCustomerId?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const lockedCustomer = Boolean(defaultCustomerId);

  function submit(formData: FormData) {
    const customerId = String(formData.get("customerId") ?? defaultCustomerId ?? "");
    const title = String(formData.get("title") ?? "").trim();
    if (!customerId || !title) return;
    startTransition(async () => {
      const id = await createJobAction({
        customerId,
        title,
        description: String(formData.get("description") ?? "") || undefined,
        startDate: String(formData.get("startDate") ?? "")
          ? new Date(`${formData.get("startDate")}T09:00:00`).toISOString()
          : undefined,
      });
      setOpen(false);
      router.push(`/uppdrag/${id}`);
    });
  }

  return (
    <>
      <button className={buttonClasses(variant, size)} onClick={() => setOpen(true)}>
        <Plus className={size === "sm" ? "size-3.5" : "size-4"} />
        Skapa uppdrag
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nytt uppdrag" size="md">
        <form action={submit} className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Kund</label>
            <select
              name="customerId"
              required
              defaultValue={defaultCustomerId ?? customers[0]?.id ?? ""}
              disabled={lockedCustomer}
              className={inputCls}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {lockedCustomer ? <input type="hidden" name="customerId" value={defaultCustomerId} /> : null}
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Vad gäller det?</label>
            <input name="title" required className={inputCls} placeholder="T.ex. Köksrenovering" />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Beskrivning</label>
            <textarea
              name="description"
              rows={3}
              className={inputCls}
              placeholder="Kort vad som ska göras, så du känner igen uppdraget …"
            />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Planerad start</label>
            <input name="startDate" type="date" className={inputCls} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
              Avbryt
            </button>
            <button type="submit" className={buttonClasses("primary")} disabled={isPending}>
              {isPending ? "Skapar …" : "Skapa uppdrag"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

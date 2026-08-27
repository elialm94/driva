"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { DateField } from "./date-field";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { createJobAction } from "@/app/actions";
import { addCustomerOption, CustomerPicker, type CustomerOption } from "./customer-picker";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

export function NewUppdragButton({
  customers,
  defaultCustomerId,
  size = "md",
  variant = "primary",
}: {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? customers[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const lockedCustomer = Boolean(defaultCustomerId);

  function submit(formData: FormData) {
    const selectedId = String(formData.get("customerId") ?? customerId ?? defaultCustomerId ?? "");
    const title = String(formData.get("title") ?? "").trim();
    if (!selectedId || !title) return;
    startTransition(async () => {
      const id = await createJobAction({
        customerId: selectedId,
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
            <CustomerPicker
              name="customerId"
              customers={customerOptions}
              value={customerId}
              onChange={setCustomerId}
              allowCreateCustomer={!lockedCustomer}
              disabled={lockedCustomer}
              className={inputCls}
              onCreated={(customer) => setCustomerOptions((prev) => addCustomerOption(prev, customer))}
            />
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
            <DateField name="startDate" className={inputCls} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className={buttonClasses("ghost")} onClick={() => setOpen(false)}>
              Avbryt
            </button>
            <button type="submit" className={buttonClasses("primary")} disabled={isPending || !customerId}>
              {isPending ? "Skapar …" : "Skapa uppdrag"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

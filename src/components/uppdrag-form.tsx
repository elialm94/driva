"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { DateField } from "./date-field";
import { Modal } from "./modal";
import { buttonClasses } from "./ui";
import { createJobAction, updateJobAction } from "@/app/actions";
import { addCustomerOption, CustomerPicker, type CustomerOption } from "./customer-picker";
import { swedishFormProps } from "@/lib/swedish-validity";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

export function NewUppdragButton({
  customers,
  defaultCustomerId,
  defaultTitle,
  defaultDescription,
  size = "md",
  variant = "primary",
}: {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  defaultTitle?: string;
  defaultDescription?: string;
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
        <form action={submit} className="space-y-4 px-6 py-5" {...swedishFormProps()}>
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
            <input
              name="title"
              required
              defaultValue={defaultTitle}
              className={inputCls}
              placeholder="T.ex. Köksrenovering"
            />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Beskrivning</label>
            <textarea
              name="description"
              rows={3}
              className={inputCls}
              defaultValue={defaultDescription}
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

function isoDate(iso?: string) {
  return iso ? iso.slice(0, 10) : "";
}

export function EditUppdragModal({
  open,
  onClose,
  jobId,
  customerId,
  customerName,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  customerId: string;
  customerName: string;
  initial: { title: string; description: string; address?: string; startDate?: string; endDate?: string };
}) {
  const [isPending, startTransition] = useTransition();

  function submit(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    startTransition(async () => {
      await updateJobAction(jobId, {
        title,
        description: String(formData.get("description") ?? ""),
        address: String(formData.get("address") ?? ""),
        startDate: String(formData.get("startDate") ?? "")
          ? new Date(`${formData.get("startDate")}T09:00:00`).toISOString()
          : "",
        endDate: String(formData.get("endDate") ?? "")
          ? new Date(`${formData.get("endDate")}T17:00:00`).toISOString()
          : "",
      });
      onClose();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Redigera uppdrag" size="md">
      <form action={submit} className="space-y-4 px-6 py-5">
        <input type="hidden" name="customerId" value={customerId} />
        <div>
          <label className="mb-1 block text-[13px] font-medium text-soft">Kund</label>
          <p className="text-[15px] text-ink">{customerName}</p>
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-soft">Vad gäller det?</label>
          <input name="title" required defaultValue={initial.title} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-soft">Beskrivning</label>
          <textarea name="description" rows={3} defaultValue={initial.description} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-soft">Adress</label>
          <input name="address" defaultValue={initial.address ?? ""} className={inputCls} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Planerad start</label>
            <DateField name="startDate" defaultValue={isoDate(initial.startDate)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Planerat klart</label>
            <DateField name="endDate" defaultValue={isoDate(initial.endDate)} className={inputCls} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Avbryt
          </button>
          <button type="submit" className={buttonClasses("primary")} disabled={isPending}>
            {isPending ? "Sparar …" : "Spara"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

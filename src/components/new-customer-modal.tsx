"use client";

import { useEffect, useState, useTransition } from "react";
import { buttonClasses } from "./ui";
import { Modal } from "./modal";
import { AddressFields } from "./address-input";
import { createCustomerAction } from "@/app/actions";
import { swedishFormProps } from "@/lib/swedish-validity";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

export interface CreatedCustomer {
  id: string;
  name: string;
  kind: "privat" | "foretag";
}

export function NewCustomerModal({
  open,
  onClose,
  onCreated,
  initialName = "",
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (customer: CreatedCustomer) => void;
  initialName?: string;
}) {
  const [kind, setKind] = useState<"privat" | "foretag">("privat");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setKind("privat");
  }, [open]);

  function submit(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    const createdKind = kind;
    startTransition(async () => {
      const id = await createCustomerAction({
        kind: createdKind,
        name,
        contactPerson: String(formData.get("contactPerson") ?? "") || undefined,
        orgNumber: String(formData.get("orgNumber") ?? "") || undefined,
        email: String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        address: String(formData.get("address") ?? "") || undefined,
        postalCode: String(formData.get("postalCode") ?? "") || undefined,
        city: String(formData.get("city") ?? "") || undefined,
      });
      onClose();
      onCreated?.({ id, name, kind: createdKind });
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Ny kund" size="md">
      <form action={submit} className="space-y-4 px-6 py-5" {...swedishFormProps()}>
        <div className="flex rounded-xl bg-canvas p-1">
          {(["privat", "foretag"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-all ${
                kind === k ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {k === "privat" ? "Privatperson" : "Företag"}
            </button>
          ))}
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-soft">
            {kind === "privat" ? "Namn" : "Företagsnamn"}
          </label>
          <input
            name="name"
            required
            key={`${open}-${initialName}`}
            defaultValue={initialName}
            className={inputCls}
            placeholder={kind === "privat" ? "Anna Andersson" : "Exempel AB"}
          />
        </div>
        {kind === "foretag" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-soft">Kontaktperson</label>
              <input name="contactPerson" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-[13px] font-medium text-soft">Org.nummer</label>
              <input name="orgNumber" className={inputCls} placeholder="556000-0000" />
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">E-post</label>
            <input name="email" type="email" required className={inputCls} placeholder="namn@exempel.se" />
          </div>
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft">Telefon</label>
            <input name="phone" className={inputCls} placeholder="070-123 45 67" />
          </div>
        </div>
        <AddressFields />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Avbryt
          </button>
          <button type="submit" className={buttonClasses("primary")} disabled={isPending}>
            {isPending ? "Sparar …" : "Spara kund"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClasses } from "./ui";
import { updateCustomerDetailsAction } from "@/app/actions";
import type { Customer } from "@/lib/types";
import { AddressFields } from "./address-input";
import { swedishFormProps } from "@/lib/swedish-validity";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export function CustomerDetailsForm({ customer }: { customer: Customer }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setSaved(false);
    startTransition(async () => {
      await updateCustomerDetailsAction(customer.id, {
        email: String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        address: String(formData.get("address") ?? ""),
        postalCode: String(formData.get("postalCode") ?? ""),
        city: String(formData.get("city") ?? ""),
        orgNumber: String(formData.get("orgNumber") ?? ""),
        contactPerson: String(formData.get("contactPerson") ?? ""),
      });
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form action={submit} className="space-y-3" {...swedishFormProps()}>
      {customer.kind === "foretag" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Kontaktperson</label>
            <input name="contactPerson" defaultValue={customer.contactPerson ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Org.nr</label>
            <input name="orgNumber" defaultValue={customer.orgNumber ?? ""} className={inputCls} />
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>E-post</label>
          <input name="email" type="email" defaultValue={customer.email} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Telefon</label>
          <input name="phone" defaultValue={customer.phone} className={inputCls} />
        </div>
      </div>
      <AddressFields
        defaults={{
          address: customer.address ?? "",
          postalCode: customer.postalCode ?? "",
          city: customer.city ?? "",
        }}
      />
      <div className="flex items-center justify-end gap-3">
        {saved ? <p className="text-[13px] font-medium text-ok">Sparat.</p> : null}
        <button className={buttonClasses("secondary", "sm")} disabled={isPending}>
          {isPending ? "Sparar …" : "Spara uppgifter"}
        </button>
      </div>
    </form>
  );
}

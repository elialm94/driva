"use client";

import { useState, useTransition } from "react";
import { useAppNavigate } from "./app-link";
import { Plus } from "lucide-react";
import { DateField } from "./date-field";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";
import { actionMenuItemClassName, useActionMenu, type ActionAppearance } from "./action-menu";
import { createJobAction, updateJobAction } from "@/app/actions";
import { addCustomerOption, CustomerPicker, type CustomerOption } from "./customer-picker";
import { FieldError, focusField, invalidFieldCls, useNativeFieldErrors } from "./form-validation";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

export type JobWorkLocationOption = { id: string; label: string; city?: string };

export function NewUppdragButton({
  customers,
  defaultCustomerId,
  defaultTitle,
  defaultDescription,
  workLocations = [],
  defaultWorkLocationId,
  size = "md",
  variant = "primary",
  appearance = "button",
  label = "Skapa uppdrag",
}: {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  defaultTitle?: string;
  defaultDescription?: string;
  workLocations?: JobWorkLocationOption[];
  defaultWorkLocationId?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
  appearance?: ActionAppearance;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? customers[0]?.id ?? "");
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [workLocationId, setWorkLocationId] = useState(
    workLocations.length === 1 ? workLocations[0].id : (defaultWorkLocationId ?? "")
  );
  const [newAddress, setNewAddress] = useState(false);
  const [isPending, startTransition] = useTransition();
  const navigate = useAppNavigate();
  const menu = useActionMenu();
  const inMenu = appearance === "menu";
  const lockedCustomer = Boolean(defaultCustomerId);
  const { errors, formProps, fieldProps, reset } = useNativeFieldErrors({
    title: "Ange vad uppdraget gäller.",
  });

  function submit(formData: FormData) {
    const selectedId = String(formData.get("customerId") ?? customerId ?? defaultCustomerId ?? "");
    const title = String(formData.get("title") ?? "").trim();
    if (!selectedId) {
      setCustomerError("Välj kund först.");
      focusField("nytt-uppdrag-kund");
      return;
    }
    if (!title) return;
    startTransition(async () => {
      const newStreet = String(formData.get("newAddress") ?? "").trim();
      const id = await createJobAction({
        customerId: selectedId,
        title,
        description: String(formData.get("description") ?? "") || undefined,
        startDate: String(formData.get("startDate") ?? "")
          ? new Date(`${formData.get("startDate")}T09:00:00`).toISOString()
          : undefined,
        workLocationId: !newAddress && workLocationId ? workLocationId : undefined,
        newWorkLocation: newAddress && newStreet
          ? {
              label: String(formData.get("newLabel") ?? "").trim() || "Ny adress",
              address: newStreet,
              postalCode: String(formData.get("newPostalCode") ?? ""),
              city: String(formData.get("newCity") ?? ""),
            }
          : undefined,
      });
      setOpen(false);
      navigate(`/uppdrag/${id}`);
    });
  }

  return (
    <>
      <button
        type="button"
        role={inMenu ? "menuitem" : undefined}
        aria-label={label}
        className={inMenu ? actionMenuItemClassName() : buttonClasses(variant, size)}
        onClick={() => {
          menu?.close();
          setCustomerError(null);
          reset();
          setOpen(true);
        }}
      >
        <Plus className={cx("shrink-0", inMenu || size !== "sm" ? "size-4" : "size-3.5")} />
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nytt uppdrag" size="md">
        <form action={submit} className="space-y-4 px-6 py-5" {...formProps()}>
          <div id="nytt-uppdrag-kund">
            <label className="mb-1 block text-[13px] font-medium text-soft">Kund</label>
            <CustomerPicker
              name="customerId"
              customers={customerOptions}
              value={customerId}
              onChange={(id) => {
                setCustomerId(id);
                if (id) setCustomerError(null);
              }}
              allowCreateCustomer={!lockedCustomer}
              disabled={lockedCustomer}
              className={inputCls}
              onCreated={(customer) => setCustomerOptions((prev) => addCustomerOption(prev, customer))}
            />
            <FieldError>{customerError}</FieldError>
          </div>
          {lockedCustomer && workLocations.length > 1 ? (
            <div>
              <label className="mb-1 block text-[13px] font-medium text-soft">Var ska jobbet göras?</label>
              <div className="space-y-1">
                {workLocations.map((loc) => (
                  // py ger radioraderna en rimlig träffyta på touch.
                  <label key={loc.id} className="flex items-center gap-2.5 py-1.5 text-[14px] text-ink">
                    <input
                      type="radio"
                      name="workLocation"
                      className="size-4 accent-ink"
                      checked={!newAddress && workLocationId === loc.id}
                      onChange={() => {
                        setNewAddress(false);
                        setWorkLocationId(loc.id);
                      }}
                    />
                    {loc.label}
                    {loc.city ? <span className="text-muted">· {loc.city}</span> : null}
                  </label>
                ))}
                <label className="flex items-center gap-2.5 py-1.5 text-[14px] text-ink">
                  <input
                    type="radio"
                    name="workLocation"
                    className="size-4 accent-ink"
                    checked={newAddress}
                    onChange={() => setNewAddress(true)}
                  />
                  Ny adress
                </label>
              </div>
              {newAddress ? (
                <div className="mt-3 space-y-2">
                  <input name="newLabel" aria-label="Namn på adressen (valfritt)" placeholder="T.ex. Fritidshus" className={inputCls} />
                  <input
                    name="newAddress"
                    aria-label="Gatuadress"
                    autoComplete="street-address"
                    placeholder="Gatuadress"
                    className={inputCls}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      name="newPostalCode"
                      aria-label="Postnummer"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      placeholder="Postnummer"
                      className={inputCls}
                    />
                    <input name="newCity" aria-label="Ort" autoComplete="address-level2" placeholder="Ort" className={inputCls} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-[13px] font-medium text-soft" htmlFor="nytt-uppdrag-titel">
              Vad gäller det?
            </label>
            <input
              id="nytt-uppdrag-titel"
              name="title"
              required
              defaultValue={defaultTitle}
              className={cx(inputCls, errors.title && invalidFieldCls)}
              placeholder="T.ex. Köksrenovering"
              {...fieldProps("title", "nytt-uppdrag-titel-fel")}
            />
            <FieldError id="nytt-uppdrag-titel-fel">{errors.title}</FieldError>
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
            <button type="submit" className={buttonClasses("primary")} disabled={isPending}>
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
  const { errors, formProps, fieldProps } = useNativeFieldErrors({
    title: "Ange vad uppdraget gäller.",
  });

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
      <form action={submit} className="space-y-4 px-6 py-5" {...formProps()}>
        <input type="hidden" name="customerId" value={customerId} />
        <div>
          <label className="mb-1 block text-[13px] font-medium text-soft">Kund</label>
          <p className="text-[15px] text-ink">{customerName}</p>
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-soft" htmlFor="uppdrag-titel">
            Vad gäller det?
          </label>
          <input
            id="uppdrag-titel"
            name="title"
            required
            defaultValue={initial.title}
            className={cx(inputCls, errors.title && invalidFieldCls)}
            {...fieldProps("title", "uppdrag-titel-fel")}
          />
          <FieldError id="uppdrag-titel-fel">{errors.title}</FieldError>
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

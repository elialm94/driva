"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { buttonClasses, cx } from "./ui";
import { Modal } from "./modal";
import { AddressFields } from "./address-input";
import { createCustomerAction } from "@/app/actions";
import { FieldError, focusField, invalidFieldCls, useNativeFieldErrors } from "./form-validation";
import { formatPersonnummer } from "@/lib/personnummer";
import {
  formatSwedishOrganizationNumber,
  swedishOrgnrInputProps,
  swedishPersonnummerInputProps,
  validateSwedishOrganizationNumber,
} from "@/lib/validation";
import { PropertyDesignationFields, type PropertyDesignationDraft } from "./property-designation-fields";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";
const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export interface CreatedCustomer {
  id: string;
  name: string;
  kind: "privat" | "foretag";
}

/**
 * Ny kund: bara namnet krävs – "Erik" → Skapa kund → klart. E-post, telefon,
 * adress och personnummer är frivilliga. Personnummer syns alltid för
 * privatperson (behövs först vid ROT/RUT). Företagsfälten bor under
 * "+ Fler uppgifter"; fastigheter under "+ Lägg till fastighet".
 */
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
  const [personnummer, setPersonnummer] = useState("");
  const [properties, setProperties] = useState<PropertyDesignationDraft[]>([]);
  const [showProperties, setShowProperties] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { errors, formProps, fieldProps, reset, setFieldError } = useNativeFieldErrors({
    name: kind === "privat" ? "Ange kundens namn." : "Ange företagsnamnet.",
  });

  useEffect(() => {
    if (open) {
      setKind("privat");
      setPersonnummer("");
      setProperties([]);
      setShowProperties(false);
      setMoreOpen(false);
      reset();
    }
  }, [open, reset]);

  /** Fält under hopfällda sektioner måste synas innan de kan fokuseras. */
  function revealAndFocus(fieldId: string, reveal?: () => void) {
    reveal?.();
    window.setTimeout(() => focusField(fieldId), 50);
  }

  function submit(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    if (!name.trim()) {
      setFieldError("name", kind === "privat" ? "Ange kundens namn." : "Ange företagsnamnet.");
      focusField("ny-kund-namn");
      return;
    }
    const createdKind = kind;
    startTransition(async () => {
      const result = await createCustomerAction({
        kind: createdKind,
        name,
        contactPerson: String(formData.get("contactPerson") ?? "") || undefined,
        orgNumber: String(formData.get("orgNumber") ?? "") || undefined,
        email: String(formData.get("email") ?? "") || undefined,
        phone: String(formData.get("phone") ?? "") || undefined,
        address: String(formData.get("address") ?? "") || undefined,
        postalCode: String(formData.get("postalCode") ?? "") || undefined,
        city: String(formData.get("city") ?? "") || undefined,
        personalIdentityNumber: createdKind === "privat" ? personnummer : undefined,
        propertyDesignations: properties.map((row) => row.designation),
      });
      if (!result.ok) {
        if (result.field) setFieldError(result.field, result.error);
        if (result.field === "personalIdentityNumber") {
          focusField("ny-kund-personnummer");
        } else if (result.field === "orgNumber") {
          revealAndFocus("ny-kund-orgnr", () => setMoreOpen(true));
        } else if (result.field === "propertyDesignation") {
          revealAndFocus("fastighetsbeteckning", () => setShowProperties(true));
        } else if (result.field === "name") {
          focusField("ny-kund-namn");
        } else if (result.field === "email") {
          focusField("ny-kund-epost");
        }
        return;
      }
      onClose();
      onCreated?.({ id: result.id, name, kind: createdKind });
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Ny kund" size="md">
      <form action={submit} noValidate className="space-y-4 px-6 py-5" {...formProps()}>
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
          <label className={labelCls} htmlFor="ny-kund-namn">
            {kind === "privat" ? "Namn" : "Företagsnamn"}
            <span aria-hidden className="text-muted">
              {" "}
              *
            </span>
          </label>
          <input
            id="ny-kund-namn"
            name="name"
            required
            key={`${open}-${initialName}`}
            defaultValue={initialName}
            className={cx(inputCls, errors.name && invalidFieldCls)}
            placeholder={kind === "privat" ? "Anna Andersson" : "Exempel AB"}
            {...fieldProps("name", "ny-kund-namn-fel")}
          />
          <FieldError id="ny-kund-namn-fel">{errors.name}</FieldError>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="ny-kund-epost">
              E-post
            </label>
            <input
              id="ny-kund-epost"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              className={cx(inputCls, errors.email && invalidFieldCls)}
              placeholder="namn@exempel.se"
              {...fieldProps("email", "ny-kund-epost-fel")}
            />
            <FieldError id="ny-kund-epost-fel">{errors.email}</FieldError>
          </div>
          <div>
            <label className={labelCls} htmlFor="ny-kund-telefon">
              Telefon
            </label>
            <input
              id="ny-kund-telefon"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className={cx(inputCls, errors.phone && invalidFieldCls)}
              placeholder="070-123 45 67"
              {...fieldProps("phone", "ny-kund-telefon-fel")}
            />
            <FieldError id="ny-kund-telefon-fel">{errors.phone}</FieldError>
          </div>
        </div>
        <AddressFields />

        {showProperties ? (
          <PropertyDesignationFields
            values={properties}
            onChange={setProperties}
            error={errors.propertyDesignation}
            inputClassName={inputCls}
          />
        ) : (
          <button
            type="button"
            className="block text-[13px] font-medium text-muted hover:text-ink"
            onClick={() => {
              setShowProperties(true);
              setProperties([{ designation: "" }]);
            }}
          >
            <Plus className="mr-1 inline size-3.5" />
            Lägg till fastighet
          </button>
        )}

        {kind === "privat" ? (
          <div>
            <label className={labelCls} htmlFor="ny-kund-personnummer">
              Personnummer
            </label>
            <input
              id="ny-kund-personnummer"
              name="personalIdentityNumber"
              value={personnummer}
              onChange={(e) => setPersonnummer(formatPersonnummer(e.target.value))}
              {...swedishPersonnummerInputProps}
              className={cx(inputCls, errors.personalIdentityNumber && invalidFieldCls)}
              {...fieldProps("personalIdentityNumber", "ny-kund-personnummer-fel")}
            />
            <FieldError id="ny-kund-personnummer-fel">{errors.personalIdentityNumber}</FieldError>
            <p className="mt-1 text-[12px] text-muted">Behövs först vid ROT/RUT – går att lägga till då.</p>
          </div>
        ) : moreOpen ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="ny-kund-kontaktperson">
                Kontaktperson
              </label>
              <input id="ny-kund-kontaktperson" name="contactPerson" autoComplete="name" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="ny-kund-orgnr">
                Org.nummer
              </label>
              <input
                id="ny-kund-orgnr"
                name="orgNumber"
                {...swedishOrgnrInputProps}
                className={cx(inputCls, errors.orgNumber && invalidFieldCls)}
                onBlur={(e) => {
                  const r = validateSwedishOrganizationNumber(e.target.value);
                  if (r.ok && r.normalized) e.target.value = formatSwedishOrganizationNumber(r.normalized);
                }}
                {...fieldProps("orgNumber", "ny-kund-orgnr-fel")}
              />
              <FieldError id="ny-kund-orgnr-fel">{errors.orgNumber}</FieldError>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="block text-[13px] font-medium text-muted hover:text-ink"
            onClick={() => setMoreOpen(true)}
          >
            <Plus className="mr-1 inline size-3.5" />
            Fler uppgifter
          </button>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Avbryt
          </button>
          <button type="submit" className={buttonClasses("primary")} disabled={isPending}>
            {isPending ? "Skapar …" : "Skapa kund"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

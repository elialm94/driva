"use client";

import { useRef, useState } from "react";
import { formatSwedishPostalCode, isSwedishPostalCode } from "@/lib/validation";
import { DEFAULT_ADDRESS_COUNTRY, type AddressParts } from "@/lib/address-autocomplete";
import { AddressAutocompleteInput } from "./address-autocomplete";

/**
 * Adressblocket: gatuadress med Google Places-förslag plus postnummer och ort.
 *
 * Ett förslag fyller alla fälten på en gång. Manuell inmatning fungerar
 * alltid – Google är en genväg, inte ett krav. Utan nyckel eller vid fel
 * blir gatuadressen ett vanligt textfält.
 *
 * Fältnamnen (address, postalCode, city) är oförändrade så formulär som
 * läser FormData fortsätter fungera.
 */

const inputCls =
  "w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent";

const labelCls = "mb-1 block text-[13px] font-medium text-soft";

export type { AddressParts };

export function AddressFields({
  defaults,
  onChange,
  onBlur,
  showCountry = false,
  inputClassName,
  labelClassName,
}: {
  defaults?: Partial<AddressParts>;
  onChange?: (parts: AddressParts) => void;
  onBlur?: () => void;
  /** Visa landsfält. Bara för scheman som faktiskt lagrar land. */
  showCountry?: boolean;
  inputClassName?: string;
  labelClassName?: string;
}) {
  const [address, setAddress] = useState(defaults?.address ?? "");
  const [postalCode, setPostalCode] = useState(defaults?.postalCode ?? "");
  const [city, setCity] = useState(defaults?.city ?? "");
  const [country, setCountry] = useState(defaults?.country ?? "");

  // Senaste värdena i en ref så emit alltid skickar hela adressen.
  const latest = useRef({ address, postalCode, city, country });
  latest.current = { address, postalCode, city, country };

  const input = inputClassName ?? inputCls;
  const label = labelClassName ?? labelCls;

  function emit(patch: Partial<AddressParts>) {
    const next = {
      address: patch.address ?? latest.current.address,
      postalCode: patch.postalCode ?? latest.current.postalCode,
      city: patch.city ?? latest.current.city,
      country: patch.country ?? latest.current.country,
    };
    latest.current = next;
    onChange?.(showCountry ? next : { address: next.address, postalCode: next.postalCode, city: next.city });
  }

  function applySelected(parts: AddressParts) {
    setAddress(parts.address);
    if (parts.postalCode) setPostalCode(parts.postalCode);
    if (parts.city) setCity(parts.city);
    const nextCountry = parts.country || DEFAULT_ADDRESS_COUNTRY;
    if (showCountry) setCountry(nextCountry);
    emit({
      address: parts.address,
      postalCode: parts.postalCode || latest.current.postalCode,
      city: parts.city || latest.current.city,
      ...(showCountry ? { country: nextCountry } : {}),
    });
  }

  return (
    <div className="space-y-4">
      <AddressAutocompleteInput
        label="Adress"
        value={address}
        onValueChange={(next) => {
          setAddress(next);
          emit({ address: next });
        }}
        onAddressSelected={applySelected}
        onBlur={onBlur}
        inputClassName={input}
        labelClassName={label}
      />

      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <div>
          <label className={label} htmlFor="adress-postnummer">
            Postnummer
          </label>
          <input
            id="adress-postnummer"
            name="postalCode"
            value={postalCode}
            onChange={(e) => {
              setPostalCode(e.target.value);
              emit({ postalCode: e.target.value });
            }}
            onBlur={() => {
              if (isSwedishPostalCode(postalCode)) {
                const formatted = formatSwedishPostalCode(postalCode);
                setPostalCode(formatted);
                emit({ postalCode: formatted });
              }
              onBlur?.();
            }}
            className={input}
            placeholder="116 24"
            autoComplete="postal-code"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={label} htmlFor="adress-ort">
            Ort
          </label>
          <input
            id="adress-ort"
            name="city"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              emit({ city: e.target.value });
            }}
            onBlur={onBlur}
            className={input}
            placeholder="Fylls i från adressen"
            autoComplete="address-level2"
          />
        </div>
      </div>

      {showCountry ? (
        <div>
          <label className={label} htmlFor="adress-land">
            Land
          </label>
          <input
            id="adress-land"
            name="country"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              emit({ country: e.target.value });
            }}
            onBlur={onBlur}
            className={input}
            placeholder={DEFAULT_ADDRESS_COUNTRY}
            autoComplete="country"
          />
        </div>
      ) : null}
    </div>
  );
}

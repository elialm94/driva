"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Car, Coffee, Minus, Paperclip, Plus, Receipt, ShoppingBag, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, buttonClasses, cx } from "./ui";
import { FileDropzone } from "./file-dropzone";
import { DateField } from "./date-field";
import { AddressAutocomplete, type AddressParts } from "./address-input";
import { useToast } from "./toast";
import { kr } from "@/lib/format";
import { RECEIPT_MAX_BYTES, manualExpenseReceiptForm } from "@/lib/receipts/read-file";
import { createManualExpenseAction } from "@/app/actions";
import type { ExpenseKind, ExpensePaidBy, RepresentationKind, VehicleKind } from "@/lib/types";
import {
  FREE_MEALS_LABELS,
  VEHICLE_LABELS,
  mileageRatePerMil,
  perDiemRatesFor,
  type FreeMeals,
} from "@/lib/accounting/allowances";
import { previousDay } from "@/lib/accounting/dates";
import { yearOf } from "@/lib/accounting/prisbasbelopp";
import { TRIP_PRIMARY_TYPES, TRIP_REGION_CODES, demoTripSuggestions } from "@/lib/address-autocomplete";
import {
  REPRESENTATION_LABELS,
  REPRESENTATION_RULES,
  isMeal,
  perDiemTripDays,
  paidByForPreset,
  planManualExpense,
  showsPaidByChoice,
  type CategoryContext,
  type ManualExpenseDraft,
  type ManualExpensePreset,
} from "@/lib/expenses/manual-expense";

/**
 * Ny utgift för hand. Fem förval som byter formulärets fält: Köp, Utlägg,
 * Milersättning, Traktamente och Representation. Under fälten visas alltid
 * "Så bokförs det" – konteringen räknas av samma rena modul som servern
 * bokför med, så det man ser är det som sparas.
 *
 * Traktamente är en reseräkning enligt Skatteverket: vem, resmål, avresa och
 * hemkomst med klockslag, anledning, fri kost, land och 50 km-villkoret.
 * Inget kvitto – schablonen är underlaget.
 */

export type { ManualExpensePreset };

export interface ManualExpenseJobOption {
  id: string;
  title: string;
  customerName: string;
  /** Uppdragets adress – förifyller resmålet på en reseräkning. */
  address?: string;
}

const PRESETS: { key: ManualExpensePreset; label: string; hint: string; icon: LucideIcon }[] = [
  { key: "kop", label: "Köp", hint: "Betalt med företagets kort eller konto", icon: ShoppingBag },
  { key: "utlagg", label: "Utlägg", hint: "Du betalade privat och ska få tillbaka", icon: Wallet },
  { key: "milersattning", label: "Milersättning", hint: "Körning i tjänsten, skattefri schablon", icon: Car },
  { key: "traktamente", label: "Traktamente", hint: "Tjänsteresa med övernattning", icon: Receipt },
  { key: "representation", label: "Representation", hint: "Måltid eller fika med kund eller personal", icon: Coffee },
];

const VAT_QUICK_RATES = [25, 12, 6, 0] as const;

const fieldCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent disabled:opacity-60";
const labelCls = "mb-1.5 block text-[13px] font-medium text-soft";
const hintCls = "mt-1 block text-[12px] text-muted";

/** Hela kronor ur fri text: "1 250", "1250,50" och "1.250" blir 1 250 / 1 251. */
function parseKronor(value: string): number | undefined {
  const cleaned = value.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed);
}

function parseDecimal(value: string): number | undefined {
  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCount(value: string): number {
  const parsed = Number(value.replace(/\s/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function vatFromGross(gross: number, rate: number): number {
  return Math.round(gross - gross / (1 + rate / 100));
}

function Stepper({
  label,
  value,
  onChange,
  hint,
  min = 0,
  max = 99,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  min?: number;
  max?: number;
}) {
  const n = parseCount(value);
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          onClick={() => onChange(String(Math.max(min, n - 1)))}
          className="flex w-10 items-center justify-center rounded-xl border border-line text-muted hover:text-ink disabled:opacity-40"
          disabled={n <= min}
          aria-label={`Minska ${label.toLowerCase()}`}
        >
          <Minus className="size-4" />
        </button>
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cx(fieldCls, "text-center tabular")}
          aria-label={label}
        />
        <button
          type="button"
          onClick={() => onChange(String(Math.min(max, n + 1)))}
          className="flex w-10 items-center justify-center rounded-xl border border-line text-muted hover:text-ink disabled:opacity-40"
          disabled={n >= max}
          aria-label={`Öka ${label.toLowerCase()}`}
        >
          <Plus className="size-4" />
        </button>
      </div>
      {hint ? <span className={hintCls}>{hint}</span> : null}
    </div>
  );
}

export function ManualExpenseForm({
  categories,
  jobs,
  accountNames,
  today,
  firstOpenDate,
  initialPreset = "kop",
  initialJobId,
  cancelHref = "/ekonomi?flik=utgifter",
  travellerName = "Du",
}: {
  categories: CategoryContext[];
  jobs: ManualExpenseJobOption[];
  /** Kontonamn för konteringen i förhandsvisningen – registret bor på servern. */
  accountNames: Record<number, string>;
  today: string;
  /** Första bokföringsbara dagen när tidigare perioder är låsta. */
  firstOpenDate?: string;
  initialPreset?: ManualExpensePreset;
  initialJobId?: string;
  cancelHref?: string;
  /** Vem reseräkningen gäller: den inloggade personen. */
  travellerName?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  /** Avresedagen är i går: en traktamenteresa har alltid en övernattning bakom sig. */
  const tripStart = !firstOpenDate || previousDay(today) >= firstOpenDate ? previousDay(today) : today;

  const [preset, setPreset] = useState<ManualExpensePreset>(initialPreset);
  const [date, setDate] = useState(initialPreset === "traktamente" ? tripStart : today);
  const [paidBy, setPaidBy] = useState<ExpensePaidBy>(paidByForPreset(initialPreset));
  const [supplier, setSupplier] = useState("");
  const [amount, setAmount] = useState("");
  const [vat, setVat] = useState("");
  /** Momssats som beloppet räknas om med, eller "manuell" när användaren skrivit själv. */
  const [vatMode, setVatMode] = useState<number | "manuell" | "auto">("auto");
  const [category, setCategory] = useState(categories[0]?.key ?? "");
  const [description, setDescription] = useState("");
  const [jobId, setJobId] = useState(initialJobId ?? "");
  const [km, setKm] = useState("");
  const [vehicle, setVehicle] = useState<VehicleKind>("egen");
  const [route, setRoute] = useState("");
  const [destination, setDestination] = useState("");
  const [destinationEdited, setDestinationEdited] = useState(false);
  const [departureTime, setDepartureTime] = useState("08:00");
  const [returnDate, setReturnDate] = useState(today);
  const [returnTime, setReturnTime] = useState("17:00");
  const [freeMeals, setFreeMeals] = useState<FreeMeals>("inga");
  const [abroad, setAbroad] = useState(false);
  const [countryCode, setCountryCode] = useState("SE");
  const [countryName, setCountryName] = useState("Sverige");
  const [paidLodging, setPaidLodging] = useState(false);
  const [reason, setReason] = useState("");
  const [perDiemConfirmed, setPerDiemConfirmed] = useState(false);
  const [reprKind, setReprKind] = useState<RepresentationKind>("kundmaltid");
  const [persons, setPersons] = useState("2");
  const [alcohol, setAlcohol] = useState(false);
  const [participants, setParticipants] = useState("");
  const [purpose, setPurpose] = useState("");
  const [receipt, setReceipt] = useState<{ name: string; form: FormData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPlanError, setShowPlanError] = useState(false);

  const kind: ExpenseKind = preset === "utlagg" ? "kop" : preset;
  const selectedCategory = categories.find((c) => c.key === category);
  const grossAmount = parseKronor(amount);

  const categoryVatFree = Boolean(selectedCategory?.vatFree || selectedCategory?.reverseChargeRate);

  // Momsen räknas ur beloppet tills användaren skriver själv: 25 % för vanliga
  // köp, 12 % för mat (representation), 0 för momsfria kategorier. Snabbknapparna
  // byter sats och följer sedan beloppet.
  const defaultVatRate = kind === "representation" ? 12 : 25;
  const activeVatRate = vatMode === "auto" ? defaultVatRate : vatMode === "manuell" ? null : vatMode;
  const vatValue =
    vatMode === "manuell"
      ? vat
      : grossAmount == null || grossAmount <= 0
        ? ""
        : kind === "kop" && categoryVatFree
          ? "0"
          : String(vatFromGross(grossAmount, activeVatRate ?? defaultVatRate));

  function choosePreset(next: ManualExpensePreset) {
    setPreset(next);
    setError(null);
    setShowPlanError(false);
    setPaidBy(paidByForPreset(next, next === "kop" ? "foretagskonto" : paidBy));
    if (next === "traktamente" && date === today) {
      setDate(tripStart);
      setReturnDate(today);
    }
    setVatMode("auto");
  }

  const selectedJob = jobs.find((j) => j.id === jobId);

  /** Resmål: uppdragets adress tills användaren skriver eller väljer själv. */
  const tripDestination = destinationEdited ? destination : selectedJob?.address?.trim() || destination;

  /** Anledning: uppdragets titel om inget skrivits. */
  const tripReason = reason.trim() || selectedJob?.title?.trim() || "";

  function pickDestination(parts: AddressParts) {
    setDestination(parts.address);
    setDestinationEdited(true);
    const code = parts.countryCode?.toUpperCase();
    if (!code) return;
    setCountryCode(code);
    setAbroad(code !== "SE");
    setCountryName(code === "SE" ? "Sverige" : (parts.country?.trim() || code));
  }

  function chooseCountry(value: string) {
    const foreign = value === "utland";
    setAbroad(foreign);
    setCountryCode(foreign ? (countryCode === "SE" ? "" : countryCode) : "SE");
    setCountryName(foreign ? (countryName === "Sverige" ? "" : countryName) : "Sverige");
  }

  const draft = useMemo<ManualExpenseDraft>(
    () => ({
      kind,
      date,
      paidBy: paidByForPreset(preset, paidBy),
      supplier,
      amount: grossAmount,
      vatAmount: parseKronor(vatValue) ?? 0,
      category,
      description,
      jobId: jobId || undefined,
      mileage: { km: parseDecimal(km) ?? 0, vehicle, route },
      perDiem: {
        // Hel dag, halv dag och natt räknas ur tiderna – inga räknare att fylla i.
        fullDays: 0,
        halfDays: 0,
        nights: 0,
        destination: tripDestination,
        departure: `${date}T${departureTime}`,
        arrival: `${returnDate}T${returnTime}`,
        freeMeals,
        // Okänt land ("ZZ") får inte falla tillbaka på den svenska schablonen.
        countryCode: abroad ? countryCode || "ZZ" : "SE",
        countryName: abroad ? countryName : "Sverige",
        paidLodging,
        reason: tripReason,
      },
      representation: { kind: reprKind, persons: parseCount(persons), alcohol, participants, purpose },
    }),
    [preset, kind, date, paidBy, supplier, grossAmount, vatValue, category, description, jobId, km, vehicle, route, tripDestination, departureTime, returnDate, returnTime, freeMeals, abroad, countryCode, countryName, paidLodging, tripReason, reprKind, persons, alcohol, participants, purpose]
  );

  const planned = useMemo(() => planManualExpense(draft, { category: selectedCategory }), [draft, selectedCategory]);
  const futureDate = date > today;
  const perDiemBlocked = kind === "traktamente" && !perDiemConfirmed;
  const canSubmit = planned.ok && !futureDate && !perDiemBlocked && !pending;

  const year = yearOf(date);
  const mileageRate = mileageRatePerMil(date, vehicle);
  const perDiemRates = perDiemRatesFor(year);
  const tripDays = kind === "traktamente" ? perDiemTripDays(draft.perDiem!) : null;
  const tripDayText = tripDays
    ? [
        tripDays.fullDays ? `${tripDays.fullDays} ${tripDays.fullDays === 1 ? "heldag" : "heldagar"}` : "",
        tripDays.halfDays ? `${tripDays.halfDays} ${tripDays.halfDays === 1 ? "halvdag" : "halvdagar"}` : "",
        tripDays.nights ? `${tripDays.nights} ${tripDays.nights === 1 ? "natt" : "nätter"}` : "",
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  const fmt = (n: number) => new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(n);

  function submit() {
    setShowPlanError(true);
    if (!planned.ok) {
      setError(planned.error);
      return;
    }
    if (futureDate) {
      setError("Datumet kan inte ligga i framtiden.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createManualExpenseAction(draft, receipt?.form).catch(() => ({
        ok: false as const,
        error: "Utgiften kunde inte sparas. Försök igen.",
      }));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.askedAssetQuestion) {
        toast({
          title: `${result.title} är registrerat`,
          text: "Köpet ser ut som en inventarie – svara på frågan på Hem så bokförs det.",
          tone: "ok",
          action: { label: "Till Hem", href: "/" },
        });
      } else {
        toast({
          title: `${result.title} är bokförd`,
          text:
            result.paidBy === "privat"
              ? `${kr(result.amount)} att föra över från företagskontot till dig. Överföringen känns igen i banken.`
              : `${kr(result.amount)} bokfört. Dyker betalningen upp i banken kopplas den automatiskt.`,
          tone: "ok",
        });
      }
      router.push(`/ekonomi?flik=utgifter&atgard=${encodeURIComponent(`utgift-${result.expenseId}`)}` as never);
    });
  }

  const showPaidBy = showsPaidByChoice(preset);
  const showAmount = kind === "kop" || kind === "representation";

  return (
    <div className="space-y-4">
      {/* Förval */}
      <div role="radiogroup" aria-label="Typ av utgift" className="grid gap-2 sm:grid-cols-5">
        {PRESETS.map((p) => {
          const active = preset === p.key;
          const Icon = p.icon;
          return (
            <button
              key={p.key}
              id={`expense-kind-${p.key}`}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choosePreset(p.key)}
              className={cx(
                "flex flex-col items-start gap-1 rounded-2xl border px-3.5 py-3 text-left transition-colors",
                active ? "border-accent bg-accent-soft/60 text-ink" : "border-line bg-card text-soft hover:border-line-strong hover:text-ink"
              )}
            >
              <span className="flex items-center gap-2 text-[14px] font-semibold">
                <Icon className={cx("size-4 shrink-0", active ? "text-accent" : "text-muted")} />
                {p.label}
              </span>
              <span className="text-[12px] leading-snug text-muted">{p.hint}</span>
            </button>
          );
        })}
      </div>

      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Traktamente har avresan med klockslag i stället – samma datum, ett fält. */}
          {kind === "traktamente" ? null : (
            <label className="block">
              <span className={labelCls}>{kind === "milersattning" ? "Resdatum" : "Datum"}</span>
              <DateField value={date} onChange={setDate} className={fieldCls} min={firstOpenDate} />
              {futureDate ? (
                <span className="mt-1 block text-[12px] text-warn">Datumet kan inte ligga i framtiden.</span>
              ) : firstOpenDate ? (
                <span className={hintCls}>Perioder före {firstOpenDate} är låsta.</span>
              ) : null}
            </label>
          )}

          {jobs.length > 0 ? (
            <label className="block">
              <span className={labelCls}>
                Uppdrag <span className="font-normal text-muted">(valfritt)</span>
              </span>
              <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={fieldCls}>
                <option value="">Inget uppdrag</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} · {j.customerName}
                  </option>
                ))}
              </select>
              <span className={hintCls}>Kopplas till uppdragets kostnader och lönsamhet.</span>
            </label>
          ) : null}
        </div>

        {/* Köp / utlägg */}
        {kind === "kop" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Vem köpte du av?</span>
                <input
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="T.ex. Bauhaus, Circle K"
                  className={fieldCls}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className={labelCls}>Vad gällde köpet?</span>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setVatMode("auto");
                  }}
                  className={fieldCls}
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {selectedCategory ? (
                  <span className={hintCls}>
                    Konto {selectedCategory.account} · {accountNames[selectedCategory.account] ?? selectedCategory.label}
                    {selectedCategory.vatFree ? " · momsfritt" : ""}
                    {selectedCategory.reverseChargeRate ? " · omvänd byggmoms" : ""}
                  </span>
                ) : null}
              </label>
            </div>
            <label className="block">
              <span className={labelCls}>
                Beskrivning <span className="font-normal text-muted">(valfritt)</span>
              </span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="T.ex. Gipsskivor till badrummet"
                className={fieldCls}
              />
            </label>
          </>
        ) : null}

        {/* Milersättning */}
        {kind === "milersattning" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Sträcka</span>
                <div className="relative">
                  <input
                    value={km}
                    inputMode="decimal"
                    onChange={(e) => setKm(e.target.value)}
                    placeholder="0"
                    className={cx(fieldCls, "pr-12 text-right tabular")}
                    autoFocus
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-muted">km</span>
                </div>
                <span className={hintCls}>
                  Schablon {year}: {fmt(mileageRate)} kr per mil ({fmt(mileageRate / 10)} kr per km) skattefritt.
                </span>
              </label>
              <label className="block">
                <span className={labelCls}>Vilken bil?</span>
                <select value={vehicle} onChange={(e) => setVehicle(e.target.value as VehicleKind)} className={fieldCls}>
                  {(Object.keys(VEHICLE_LABELS) as VehicleKind[]).map((v) => (
                    <option key={v} value={v}>
                      {VEHICLE_LABELS[v]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className={labelCls}>
                Vart och varför <span className="font-normal text-muted">(körjournal)</span>
              </span>
              <input
                value={route}
                onChange={(e) => setRoute(e.target.value)}
                placeholder="T.ex. Verkstaden – Andersson, Täby – materialhämtning Bauhaus"
                className={fieldCls}
              />
            </label>
          </>
        ) : null}

        {/* Traktamente – reseräkning */}
        {kind === "traktamente" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className={labelCls}>Vem</span>
                <p data-traktamente-vem className="rounded-xl border border-line bg-ink/4 px-3.5 py-2.5 text-[14px] text-ink">
                  {travellerName}
                </p>
                <span className={hintCls}>Reseräkningen gäller dig som är inloggad.</span>
              </div>
              <label className="block">
                <span className={labelCls}>Land</span>
                <select
                  id="traktamente-land"
                  value={abroad ? "utland" : "SE"}
                  onChange={(e) => chooseCountry(e.target.value)}
                  className={fieldCls}
                >
                  <option value="SE">Sverige</option>
                  <option value="utland">Annat land</option>
                </select>
                {abroad ? (
                  <>
                    <input
                      id="traktamente-landnamn"
                      value={countryName}
                      onChange={(e) => setCountryName(e.target.value)}
                      placeholder="T.ex. Norge"
                      className={cx(fieldCls, "mt-2")}
                      aria-label="Vilket land"
                    />
                    <span className={hintCls}>Utlandsresor kräver Skatteverkets normalbelopp för landet.</span>
                  </>
                ) : (
                  <span className={hintCls}>
                    Schablon {year}: {kr(perDiemRates.heldag)} hel dag, {kr(perDiemRates.halvdag)} halv dag,{" "}
                    {kr(perDiemRates.natt)} natt.
                  </span>
                )}
              </label>
            </div>

            <div>
              <AddressAutocomplete
                id="traktamente-resmal"
                name="resmal"
                label="Resmål eller arbetsort"
                value={tripDestination}
                onChange={(next) => {
                  setDestination(next);
                  setDestinationEdited(true);
                }}
                onSelect={pickDestination}
                composeSelected="trip"
                primaryTypes={TRIP_PRIMARY_TYPES}
                regionCodes={TRIP_REGION_CODES}
                demoSuggestions={demoTripSuggestions}
                placeholder="T.ex. Göteborg eller Vasagatan 33"
                inputClassName={fieldCls}
                labelClassName={labelCls}
              />
              <span className={hintCls}>Ort eller gatuadress, i vilket land som helst. Förifylls från uppdragets adress.</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className={labelCls}>Avresa</span>
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
                  <DateField value={date} onChange={setDate} className={fieldCls} min={firstOpenDate} />
                  <input
                    id="traktamente-avresetid"
                    type="time"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className={cx(fieldCls, "tabular")}
                    aria-label="Avresetid"
                  />
                </div>
                {futureDate ? (
                  <span className="mt-1 block text-[12px] text-warn">Datumet kan inte ligga i framtiden.</span>
                ) : firstOpenDate ? (
                  <span className={hintCls}>Perioder före {firstOpenDate} är låsta.</span>
                ) : (
                  <span className={hintCls}>Före kl 12 är avresedagen en hel dag.</span>
                )}
              </div>
              <div>
                <span className={labelCls}>Hemkomst</span>
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
                  <DateField value={returnDate} onChange={setReturnDate} className={fieldCls} min={date} />
                  <input
                    id="traktamente-hemkomsttid"
                    type="time"
                    value={returnTime}
                    onChange={(e) => setReturnTime(e.target.value)}
                    className={cx(fieldCls, "tabular")}
                    aria-label="Hemkomsttid"
                  />
                </div>
                <span className={hintCls}>Efter kl 19 är hemkomstdagen en hel dag.</span>
              </div>
            </div>

            <label className="block">
              <span className={labelCls}>Anledning</span>
              <input
                id="traktamente-anledning"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={selectedJob?.title ?? "T.ex. montage hos kund"}
                className={fieldCls}
              />
              {selectedJob && !reason.trim() ? (
                <span className={hintCls}>Uppdragets titel används: {selectedJob.title}</span>
              ) : null}
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Fri kost</span>
                <select
                  id="traktamente-frikost"
                  value={freeMeals}
                  onChange={(e) => setFreeMeals(e.target.value as FreeMeals)}
                  className={fieldCls}
                >
                  {(Object.keys(FREE_MEALS_LABELS) as FreeMeals[]).map((level) => (
                    <option key={level} value={level}>
                      {FREE_MEALS_LABELS[level]}
                    </option>
                  ))}
                </select>
                <span className={hintCls}>Måltider som någon annan bjöd på minskar schablonen.</span>
              </label>
              <div>
                <span className={labelCls}>Logi</span>
                <label className="flex items-start gap-2.5 rounded-xl border border-line px-3.5 py-2.5 text-[13px] text-soft">
                  <input
                    id="traktamente-fri-logi"
                    type="checkbox"
                    checked={paidLodging}
                    onChange={(e) => setPaidLodging(e.target.checked)}
                    className="mt-0.5 size-4 accent-[var(--color-accent)]"
                  />
                  <span>
                    Bolaget betalade hotellet
                    <span className="block text-[12px] text-muted">Då betalas inget nattraktamente ut.</span>
                  </span>
                </label>
              </div>
            </div>

            <p data-traktamente-dagar className="rounded-xl bg-ink/4 px-3.5 py-3 text-[13px] text-soft">
              {tripDayText ? (
                <>
                  Resan räknas som {tripDayText}.
                  <span className="block text-[12px] text-muted">
                    Räknat ur avresa och hemkomst: hel dag vid avresa före kl 12 och hemkomst efter kl 19, natt för varje
                    dygnsbyte.
                  </span>
                </>
              ) : (
                "Fyll i avresa och hemkomst - hemkomsten måste ligga ett senare dygn, traktamente kräver övernattning."
              )}
            </p>

            <label className="flex items-start gap-2.5 rounded-xl bg-ink/4 px-3.5 py-3 text-[13px] text-soft">
              <input
                id="traktamente-50km"
                type="checkbox"
                checked={perDiemConfirmed}
                onChange={(e) => setPerDiemConfirmed(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--color-accent)]"
              />
              <span>Resmålet låg mer än 50 km från både bostaden och den vanliga arbetsplatsen.</span>
            </label>
          </>
        ) : null}

        {/* Representation */}
        {kind === "representation" ? (
          <>
            <div role="radiogroup" aria-label="Sorts representation" className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(REPRESENTATION_LABELS) as RepresentationKind[]).map((k) => {
                const active = reprKind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setReprKind(k)}
                    className={cx(
                      "rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                      active ? "border-accent bg-accent-soft/60" : "border-line hover:border-line-strong"
                    )}
                  >
                    <span className="block text-[14px] font-medium text-ink">{REPRESENTATION_LABELS[k].label}</span>
                    <span className="block text-[12px] text-muted">{REPRESENTATION_LABELS[k].hint}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Var var ni?</span>
                <input
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="T.ex. Restaurang Prinsen"
                  className={fieldCls}
                />
              </label>
              <Stepper
                label="Antal personer"
                value={persons}
                onChange={setPersons}
                min={1}
                hint={
                  isMeal(reprKind)
                    ? `Momsen får lyftas med ${alcohol ? REPRESENTATION_RULES.vatSchablonAlcohol : REPRESENTATION_RULES.vatSchablonFood} kr per person`
                    : `${REPRESENTATION_RULES.simpleRefreshmentPerPerson} kr per person exkl. moms är avdragsgillt`
                }
              />
            </div>
            {isMeal(reprKind) ? (
              <label className="flex items-center gap-2.5 text-[13px] text-soft">
                <input
                  type="checkbox"
                  checked={alcohol}
                  onChange={(e) => setAlcohol(e.target.checked)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                Alkohol ingick i måltiden
              </label>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Vem deltog?</span>
                <input
                  value={participants}
                  onChange={(e) => setParticipants(e.target.value)}
                  placeholder="T.ex. Anna Berg (Bergs Bygg), jag"
                  className={fieldCls}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Syfte</span>
                <input
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="T.ex. genomgång av offert Villa Ek"
                  className={fieldCls}
                />
              </label>
            </div>
          </>
        ) : null}

        {/* Belopp + moms */}
        {showAmount ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>Belopp inkl. moms</span>
              <div className="relative">
                <input
                  value={amount}
                  inputMode="decimal"
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className={cx(fieldCls, "pr-10 text-right tabular")}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-muted">kr</span>
              </div>
            </label>
            <div>
              <span className={labelCls}>Varav moms</span>
              <div className="relative">
                <input
                  value={vatValue}
                  inputMode="numeric"
                  onChange={(e) => {
                    setVatMode("manuell");
                    setVat(e.target.value);
                  }}
                  placeholder="0"
                  className={cx(fieldCls, "pr-10 text-right tabular")}
                  disabled={kind === "kop" && categoryVatFree}
                  aria-label="Varav moms"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-muted">kr</span>
              </div>
              {!(kind === "kop" && categoryVatFree) ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {VAT_QUICK_RATES.map((rate) => {
                    const active = activeVatRate === rate;
                    return (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setVatMode(rate)}
                        aria-pressed={active}
                        className={cx(
                          "rounded-full border px-2.5 py-0.5 text-[12px]",
                          active ? "border-accent bg-accent-soft/60 text-ink" : "border-line text-soft hover:border-line-strong hover:text-ink"
                        )}
                      >
                        {rate} %
                      </button>
                    );
                  })}
                  <span className="text-[12px] text-muted">Momsen står på kvittot.</span>
                </div>
              ) : (
                <span className={hintCls}>
                  {selectedCategory?.reverseChargeRate ? "Omvänd byggmoms – Ferva räknar momsen." : "Kategorin är momsfri."}
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* Vem betalade */}
        {showPaidBy ? (
          <div>
            <span className={labelCls}>Vem betalade?</span>
            <div role="radiogroup" aria-label="Vem betalade" className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { key: "foretagskonto", label: "Företagets kort eller konto", hint: "Dras från företagskontot (1930)" },
                  { key: "privat", label: "Jag betalade privat", hint: "Bolaget blir skyldigt dig pengarna (2893)" },
                ] as { key: ExpensePaidBy; label: string; hint: string }[]
              ).map((o) => {
                const active = paidBy === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPaidBy(o.key)}
                    className={cx(
                      "rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                      active ? "border-accent bg-accent-soft/60" : "border-line hover:border-line-strong"
                    )}
                  >
                    <span className="block text-[14px] font-medium text-ink">{o.label}</span>
                    <span className="block text-[12px] text-muted">{o.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : kind === "milersattning" ? (
          <p className="rounded-xl bg-ink/4 px-3.5 py-3 text-[13px] text-soft">
            Bokförs som skuld till dig (2893). För över pengarna från företagskontot när det passar – överföringen känns
            igen i banken och bockar av skulden.
          </p>
        ) : null}
      </Card>

      {/* Traktamente: beloppet och en rad om konteringen – inte hela uppsatsen. */}
      {kind === "traktamente" ? (
        <Card className="p-5">
          {planned.ok ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[15px] font-semibold text-ink">Skattefritt traktamente</h2>
                <span data-traktamente-belopp className="text-[17px] font-semibold tabular text-ink">
                  {kr(planned.plan.amount)}
                </span>
              </div>
              <p className="mt-2 text-[13px] text-soft">
                Hur bokförs det? Skattefritt traktamente (7321) mot skuld till dig (2893), ingen moms.
              </p>
            </>
          ) : (
            <p role={showPlanError ? "alert" : undefined} className={cx("text-[13px]", showPlanError ? "text-warn" : "text-muted")}>
              {planned.error}
            </p>
          )}
        </Card>
      ) : (
      /* Så bokförs det */
      <Card className="p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Så bokförs det</h2>
          {planned.ok ? <span className="text-[13px] tabular text-soft">{planned.plan.title}</span> : null}
        </div>
        {planned.ok ? (
          <>
            <table className="w-full text-[13px]">
              <tbody>
                {planned.plan.lines.map((l, i) => (
                  <tr key={`${l.account}-${i}`} className="border-t border-line first:border-t-0">
                    <td className="py-1.5 pr-3 tabular text-muted">{l.account}</td>
                    <td className="py-1.5 pr-3 text-ink">{accountNames[l.account] ?? `Konto ${l.account}`}</td>
                    <td className="py-1.5 pr-3 text-right tabular text-soft">{l.debit ? kr(l.debit) : ""}</td>
                    <td className="py-1.5 text-right tabular text-soft">{l.credit ? kr(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[13px] leading-relaxed text-soft">{planned.plan.explanation}</p>
            {planned.plan.notes.length ? (
              <ul className="mt-2 space-y-1 text-[12px] text-muted">
                {planned.plan.notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className={cx("text-[13px]", showPlanError ? "text-warn" : "text-muted")}>{planned.error}</p>
        )}
      </Card>
      )}

      {/* Kvitto – traktamente har inget kvitto, schablonen och reseräkningen är underlaget. */}
      {kind === "traktamente" ? null : (
      <Card className="p-5">
        <span className={labelCls}>
          Kvitto{" "}
          <span className="font-normal text-muted">
            {kind === "milersattning" ? "(valfritt – t.ex. körjournal)" : "(rekommenderas)"}
          </span>
        </span>
        <FileDropzone
          variant="inline"
          accept="image/*,.pdf,.heic,.heif"
          icon={Paperclip}
          camera
          maxBytes={RECEIPT_MAX_BYTES}
          title="Släpp kvittot här"
          subtitle="Fota, klistra in eller välj en fil."
          formats="PDF, JPG, PNG, HEIC · max 8 MB"
          fileName={receipt?.name}
          onClear={() => setReceipt(null)}
          onFiles={(files) => {
            const file = files[0];
            if (!file) return;
            try {
              setReceipt({ name: file.name, form: manualExpenseReceiptForm(file) });
              setError(null);
            } catch (err) {
              setReceipt(null);
              setError(err instanceof Error ? err.message : "Filen kunde inte läsas.");
            }
          }}
        />
      </Card>
      )}

      {error ? (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          id="expense-submit"
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={buttonClasses("primary", "md")}
        >
          {pending ? "Bokför …" : planned.ok ? `Bokför ${kr(planned.plan.amount)}` : "Bokför utgiften"}
        </button>
        <a href={cancelHref} className={buttonClasses("ghost", "md")}>
          Avbryt
        </a>
        {perDiemBlocked && planned.ok ? (
          <span className="text-[13px] text-muted">Bekräfta villkoren för traktamente ovan.</span>
        ) : null}
      </div>
    </div>
  );
}

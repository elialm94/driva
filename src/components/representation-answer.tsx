"use client";

import { useState, useTransition } from "react";
import { Modal } from "./modal";
import { buttonClasses, cx } from "./ui";
import { answerRepresentationQuestionAction } from "@/app/actions";
import {
  REPRESENTATION_ANSWER,
  REPRESENTATION_LABELS,
  REPRESENTATION_RULES,
  isMeal,
} from "@/lib/expenses/manual-expense";
import type { RepresentationKind } from "@/lib/types";

/**
 * Bekräftelsesteget för representation.
 *
 * En banktransaktion vet vad notan kostade, men aldrig hur många som satt vid
 * bordet eller om det fanns vin på den - och just de uppgifterna avgör både
 * avdraget och hur mycket moms som får lyftas. Därför frågar vi i stället för
 * att gissa, och svaret körs genom samma motor som Ny utgift (`representationSplit`).
 * Stängs dialogen bokförs ingenting: frågan ligger kvar.
 */

const KINDS = Object.keys(REPRESENTATION_LABELS) as RepresentationKind[];

/** Är svaret starten på representationsfrågan, eller ett av de fyra slagen? */
export function isRepresentationOption(option: string): boolean {
  return option === REPRESENTATION_ANSWER || KINDS.some((k) => REPRESENTATION_LABELS[k].label === option);
}

/** Slaget bakom ett svar, när användaren redan valt ett i knappraden. */
export function representationKindFromOption(option: string): RepresentationKind | undefined {
  return KINDS.find((k) => REPRESENTATION_LABELS[k].label === option);
}

const fieldCls =
  "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-accent";

export function RepresentationAnswerDialog({
  expenseId,
  open,
  initialKind,
  onClose,
  onBooked,
}: {
  expenseId: string;
  open: boolean;
  /** Förvalt slag när användaren redan tryckt på ett av dem. */
  initialKind?: RepresentationKind;
  onClose: () => void;
  onBooked?: () => void;
}) {
  const [kind, setKind] = useState<RepresentationKind>(initialKind ?? "kundmaltid");
  const [persons, setPersons] = useState("2");
  const [alcohol, setAlcohol] = useState(false);
  const [participants, setParticipants] = useState("");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const personCount = Number.parseInt(persons, 10);
  const personsValid = Number.isFinite(personCount) && personCount >= 1;

  function submit() {
    if (!personsValid) {
      setError("Ange hur många personer som deltog.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await answerRepresentationQuestionAction(expenseId, {
        kind,
        persons: personCount,
        alcohol: isMeal(kind) ? alcohol : false,
        participants,
        purpose,
      });
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      onBooked?.();
      onClose();
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Vilka deltog, och ingick alkohol?"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={buttonClasses("secondary", "sm")} onClick={onClose} disabled={isPending}>
            Avbryt
          </button>
          <button type="button" className={buttonClasses("primary", "sm")} onClick={submit} disabled={isPending}>
            {isPending ? "Bokför …" : "Bokför representationen"}
          </button>
        </div>
      }
    >
      <div className="space-y-4" data-representation-answer>
        <p className="text-[13px] text-soft">
          Uppgifterna avgör konteringen: måltider är inte avdragsgilla men momsen får lyftas med en schablon per person,
          och enklare förtäring är avdragsgill upp till {REPRESENTATION_RULES.simpleRefreshmentPerPerson} kr per person.
          Ferva räknar samma uppdelning som när du registrerar representation för hand.
        </p>

        <div role="radiogroup" aria-label="Sorts representation" className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => {
            const active = kind === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKind(k)}
                className={cx(
                  "rounded-xl border px-3 py-2 text-left transition-colors",
                  active ? "border-accent bg-accent-soft/60" : "border-line hover:border-line-strong"
                )}
              >
                <span className="block text-[14px] font-medium text-ink">{REPRESENTATION_LABELS[k].label}</span>
                <span className="block text-[12px] text-muted">{REPRESENTATION_LABELS[k].hint}</span>
              </button>
            );
          })}
        </div>

        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink">Antal personer</span>
          <input
            data-autofocus
            value={persons}
            inputMode="numeric"
            onChange={(e) => setPersons(e.target.value)}
            aria-label="Antal personer"
            className={cx(fieldCls, "max-w-32 text-right tabular")}
          />
          <span className="mt-1 block text-[12px] text-muted">
            {isMeal(kind)
              ? `Momsen får lyftas med ${alcohol ? REPRESENTATION_RULES.vatSchablonAlcohol : REPRESENTATION_RULES.vatSchablonFood} kr per person.`
              : `${REPRESENTATION_RULES.simpleRefreshmentPerPerson} kr per person exkl. moms är avdragsgillt.`}
          </span>
        </label>

        {isMeal(kind) ? (
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

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Vem deltog?</span>
            <input
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
              placeholder="T.ex. Anna Berg (Bergs Bygg), jag"
              className={fieldCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Syfte</span>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="T.ex. genomgång av offert Villa Ek"
              className={fieldCls}
            />
          </label>
        </div>
        <p className="text-[12px] text-muted">
          Anteckna deltagare och syfte - Skatteverket kan begära dem i efterhand.
        </p>

        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}

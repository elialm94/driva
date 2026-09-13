"use client";

import type { ReactNode } from "react";
import { Camera, PackagePlus, Search } from "lucide-react";
import { buttonClasses } from "./ui";
import { Modal } from "./modal";

export type AddMaterialChoice = "search" | "receipt" | "manual";

export function AddMaterialSheet({
  open,
  onClose,
  onChoose,
  wholesalersEnabled,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (choice: AddMaterialChoice) => void;
  wholesalersEnabled: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Lägg till material" size="sm">
      <div className="space-y-2 px-6 py-5">
        {wholesalersEnabled ? (
          <ChoiceButton
            icon={<Search className="size-5" />}
            label="Sök och beställ"
            hint="Grossistens sortiment och din varukorg"
            onClick={() => onChoose("search")}
          />
        ) : null}
        <ChoiceButton
          icon={<Camera className="size-5" />}
          label="Fota kvitto"
          hint="Byggmax, Jula eller annan handel"
          onClick={() => onChoose("receipt")}
        />
        <ChoiceButton
          icon={<PackagePlus className="size-5" />}
          label="Lägg till manuellt"
          hint="En rad du skriver själv"
          onClick={() => onChoose("manual")}
        />
      </div>
    </Modal>
  );
}

function ChoiceButton({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-add-material-choice={label}
      className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-line-strong bg-card px-4 py-3 text-left transition-colors hover:bg-canvas sm:min-h-11"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-canvas text-ink">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-ink">{label}</span>
        <span className="block text-[13px] text-muted">{hint}</span>
      </span>
    </button>
  );
}

export function JobReceiptUpload({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone: (inboxItemId: string) => void;
}) {
  return (
    <form
      className="px-6 py-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        data.set("startedFromJobId", jobId);
        const { uploadInboxDocumentAction } = await import("@/app/actions");
        const result = await uploadInboxDocumentAction(data);
        if (result.ok) onDone(result.id);
      }}
    >
      <label className="block">
        <span className="mb-2 block text-[13px] text-muted">Ferva läser kvittot</span>
        <input
          type="file"
          name="file"
          accept="image/*,application/pdf"
          capture="environment"
          required
          className="block w-full text-[14px]"
        />
      </label>
      <button type="submit" className={`${buttonClasses("primary")} mt-4 min-h-11`}>
        Läs kvittot
      </button>
    </form>
  );
}

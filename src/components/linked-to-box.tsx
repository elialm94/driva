"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Hammer, Plus } from "lucide-react";
import {
  createJobAndLinkDocumentAction,
  linkDocumentToJobAction,
  unlinkDocumentFromJobAction,
} from "@/app/actions";
import type { DocumentLinkJob, DocumentLinkView } from "@/lib/document-job-link-model";
import { Card, SectionTitle, buttonClasses, cx } from "./ui";
import { Modal } from "./modal";

export function LinkedToBox({ view }: { view: DocumentLinkView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [optimistic, setOptimistic] = useState<DocumentLinkJob | null | undefined>(undefined);
  const job = optimistic === undefined ? view.job : optimistic;
  const canAct =
    view.canChange || (view.canLink && !job) || (view.canUnlink && Boolean(job));

  function afterLink(next: DocumentLinkJob) {
    setOptimistic(next);
    setOpen(false);
    router.refresh();
  }

  function afterUnlink() {
    setOptimistic(null);
    setOpen(false);
    router.refresh();
  }

  return (
    <div>
      <SectionTitle>Kopplat till</SectionTitle>
      <Card className="divide-y divide-line/70">
        {job ? (
          <Link
            href={job.href as never}
            className="block px-4 py-3 text-[14px] font-medium transition-colors hover:bg-canvas/60"
          >
            {job.title}
            <span className="block text-[12px] font-normal text-muted">Uppdrag · {job.statusLabel}</span>
          </Link>
        ) : (
          <p className="px-4 py-3 text-[13px] text-muted">Inte kopplat till något uppdrag</p>
        )}
        {view.quote ? (
          <Link
            href={view.quote.href as never}
            className="block px-4 py-3 text-[13px] text-soft transition-colors hover:bg-canvas/60"
          >
            Offert #{view.quote.number}
          </Link>
        ) : null}
        {canAct ? (
          <div className="px-4 py-2.5">
            <button
              type="button"
              className={buttonClasses("ghost", "sm", "-ml-2 text-[13px]")}
              onClick={() => setOpen(true)}
            >
              {job ? "Ändra koppling" : "Koppla till uppdrag"}
            </button>
          </div>
        ) : null}
      </Card>
      {canAct ? (
        <LinkToJobDialog
          view={view}
          open={open}
          onClose={() => setOpen(false)}
          onLinked={afterLink}
          onUnlinked={afterUnlink}
        />
      ) : null}
    </div>
  );
}

function LinkToJobDialog({
  view,
  open,
  onClose,
  onLinked,
  onUnlinked,
}: {
  view: DocumentLinkView;
  open: boolean;
  onClose: () => void;
  onLinked: (job: DocumentLinkJob) => void;
  onUnlinked: () => void;
}) {
  const [creating, setCreating] = useState(view.jobs.length === 0);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setCreating(view.jobs.length === 0);
    setTitle("");
    setError(null);
  }, [open, view.jobs.length]);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Något gick fel");
      }
    });
  }

  function applyLink(result: { ok: true; jobId: string; jobTitle: string; statusLabel: string } | { ok: false; error: string }) {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onLinked({
      id: result.jobId,
      title: result.jobTitle,
      href: `/uppdrag/${result.jobId}`,
      statusLabel: result.statusLabel,
    });
  }

  function pick(jobId: string) {
    run(async () => {
      applyLink(await linkDocumentToJobAction(view.kind, view.documentId, jobId));
    });
  }

  function createAndLink() {
    run(async () => {
      applyLink(await createJobAndLinkDocumentAction(view.kind, view.documentId, title));
    });
  }

  function unlink() {
    run(async () => {
      const result = await unlinkDocumentFromJobAction(view.kind, view.documentId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onUnlinked();
    });
  }

  const empty = view.jobs.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Koppla till uppdrag"
      footer={
        creating ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {view.jobs.length > 0 ? (
              <button
                type="button"
                className={buttonClasses("ghost", "sm")}
                disabled={isPending}
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
              >
                Avbryt
              </button>
            ) : null}
            <button
              type="button"
              className={buttonClasses("primary", "sm")}
              disabled={isPending || !title.trim()}
              onClick={createAndLink}
            >
              {isPending ? "…" : "Skapa och koppla"}
            </button>
          </div>
        ) : null
      }
    >
      <div className="px-6 py-4">
        {empty && !creating ? (
          <p className="text-[14px] text-soft">Inga uppdrag för {view.customerName}.</p>
        ) : null}

        {!creating ? (
          <ul className="space-y-1">
            {view.jobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => pick(job.id)}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-canvas",
                    view.job?.id === job.id && "bg-canvas"
                  )}
                >
                  <Hammer className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-ink">{job.title}</span>
                    <span className="block text-[12px] text-muted">{job.statusLabel}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div>
            {empty ? (
              <p className="mb-3 text-[14px] text-soft">Inga uppdrag för {view.customerName}.</p>
            ) : (
              <p className="mb-3 text-[14px] text-soft">Nytt uppdrag för {view.customerName}.</p>
            )}
            <label className="mb-1 block text-[13px] font-medium text-soft" htmlFor="link-job-title">
              Titel
            </label>
            <input
              id="link-job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Till exempel Altanbygge"
              autoFocus
              className="w-full rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) {
                  e.preventDefault();
                  createAndLink();
                }
              }}
            />
          </div>
        )}

        {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}

        {!creating ? (
          <div className="mt-3 flex flex-col gap-1">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setCreating(true);
                setError(null);
              }}
              className={cx(buttonClasses("ghost", "sm"), "justify-start")}
            >
              <Plus className="size-4" /> {empty ? "Skapa uppdrag" : "Skapa nytt uppdrag"}
            </button>
            {view.canUnlink && view.job ? (
              <button
                type="button"
                disabled={isPending}
                onClick={unlink}
                className={cx(buttonClasses("ghost", "sm"), "justify-start text-muted")}
              >
                Ta bort koppling
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

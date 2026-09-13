"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { buttonClasses } from "./ui";
import { Modal } from "./modal";
import { useToast } from "./toast";
import { addJobPhotoAction, deleteJobPhotoAction } from "@/app/actions";
import type { JobPhoto } from "@/lib/types";

/**
 * Foton hör inte till uppdragets ekonomilogg - de bor bakom "…"-menyn.
 * Bilderna ligger kvar på uppdraget och följer med till kundvyn som förut.
 */
export function JobPhotosModal({
  open,
  onClose,
  jobId,
  photos,
  onPhotosChange,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string;
  photos: JobPhoto[];
  onPhotosChange?: (photos: JobPhoto[]) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState(photos);
  const [isPending, start] = useTransition();

  useEffect(() => {
    setItems(photos);
  }, [photos]);

  function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0]!;
    const reader = new FileReader();
    reader.onerror = () => {
      toast({ title: "Kunde inte läsa bilden.", tone: "danger" });
    };
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      start(async () => {
        const result = await addJobPhotoAction(jobId, dataUrl);
        if (!result.ok) {
          toast({ title: result.error, tone: "danger" });
          return;
        }
        setItems((list) => {
          const next = [...list, result.photo];
          onPhotosChange?.(next);
          return next;
        });
        toast({ title: "Foto tillagt", tone: "ok" });
        router.refresh();
      });
    };
    reader.readAsDataURL(file);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Foton"
      size="sm"
      footer={
        <div className="flex justify-between gap-2">
          <button type="button" className={buttonClasses("secondary")} onClick={() => inputRef.current?.click()}>
            <Camera className="size-4" /> Lägg till foto
          </button>
          <button type="button" className={buttonClasses("ghost")} onClick={onClose}>
            Stäng
          </button>
        </div>
      }
    >
      <div className="px-6 py-5" data-testid="job-photos">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {items.length === 0 ? (
          <p className="text-[14px] text-muted">Inga foton ännu. Ta ett när jobbet är gjort - bevis om kunden ifrågasätter.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {items.map((p) => (
              <li key={p.id} className="relative overflow-hidden rounded-xl border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element -- data-URL från kameran */}
                <img src={p.dataUrl} alt="Foto från uppdraget" className="aspect-[4/3] w-full object-cover" />
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 rounded-lg bg-card/90 p-1.5 text-muted hover:text-danger"
                  disabled={isPending}
                  aria-label="Ta bort foto"
                  onClick={() =>
                    start(async () => {
                      await deleteJobPhotoAction(jobId, p.id);
                      setItems((list) => {
                        const next = list.filter((x) => x.id !== p.id);
                        onPhotosChange?.(next);
                        return next;
                      });
                      router.refresh();
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

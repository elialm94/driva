"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { buttonClasses, SectionTitle } from "./ui";
import { addJobPhotoAction, deleteJobPhotoAction } from "@/app/actions";
import type { JobPhoto } from "@/lib/types";

export function JobPhotosSection({ jobId, photos }: { jobId: string; photos: JobPhoto[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0]!;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      start(async () => {
        setError(null);
        const result = await addJobPhotoAction(jobId, dataUrl);
        if (!result.ok) setError(result.error);
        else router.refresh();
      });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="mb-8">
      <SectionTitle
        right={
          <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => inputRef.current?.click()}>
            <Camera className="size-3.5" />
            Foto
          </button>
        }
      >
        Foton
      </SectionTitle>
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
      {photos.length === 0 ? (
        <p className="text-[14px] text-muted">Inga foton ännu. Ta ett när jobbet är gjort – bevis om kunden ifrågasätter.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id} className="relative overflow-hidden rounded-xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- data-URL från kameran */}
              <img src={p.dataUrl} alt={p.caption || "Foto från uppdraget"} className="aspect-[4/3] w-full object-cover" />
              <button
                type="button"
                className="absolute right-1.5 top-1.5 rounded-lg bg-card/90 p-1.5 text-muted hover:text-danger"
                disabled={isPending}
                aria-label="Ta bort foto"
                onClick={() =>
                  start(async () => {
                    await deleteJobPhotoAction(jobId, p.id);
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
      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}

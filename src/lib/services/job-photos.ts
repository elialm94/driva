import { db, save } from "../store";
import { uid } from "../ids";
import type { JobPhoto } from "../types";
import { getJob } from "./data";

const MAX_PHOTOS = 24;
const MAX_DATA_URL = 1_800_000;

export function listJobPhotos(jobId: string): JobPhoto[] {
  return [...(getJob(jobId)?.photos ?? [])];
}

export function addJobPhoto(jobId: string, input: { dataUrl: string; caption?: string }): JobPhoto {
  const job = getJob(jobId);
  if (!job) throw new Error("Uppdraget finns inte.");
  if (!input.dataUrl.startsWith("data:image/")) throw new Error("Bara bilder kan sparas.");
  if (input.dataUrl.length > MAX_DATA_URL) throw new Error("Bilden är för stor. Ta en ny i lägre upplösning.");
  job.photos ??= [];
  if (job.photos.length >= MAX_PHOTOS) throw new Error("Max 24 foton per uppdrag.");
  const photo: JobPhoto = {
    id: uid(),
    createdAt: new Date().toISOString(),
    dataUrl: input.dataUrl,
    caption: input.caption?.trim() || undefined,
  };
  job.photos.push(photo);
  save();
  return photo;
}

export function deleteJobPhoto(jobId: string, photoId: string): void {
  const job = getJob(jobId);
  if (!job?.photos) return;
  job.photos = job.photos.filter((p) => p.id !== photoId);
  save();
}

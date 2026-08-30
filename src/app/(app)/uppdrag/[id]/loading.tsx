import { DetailSkeleton } from "@/components/skeletons";

/** Uppdragsdetalj: tillbaka-rad + rubrik + arbetskort. */
export default function Loading() {
  return <DetailSkeleton cards={3} />;
}

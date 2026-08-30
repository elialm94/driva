import { DetailSkeleton } from "@/components/skeletons";

/** Kunddetalj: tillbaka-rad + rubrik + innehållskort. */
export default function Loading() {
  return <DetailSkeleton cards={3} />;
}

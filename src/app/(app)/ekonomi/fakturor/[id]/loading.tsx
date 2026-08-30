import { DetailSkeleton } from "@/components/skeletons";

/** Fakturadetalj: dokumentet tar ett ögonblick – visa formen direkt. */
export default function Loading() {
  return <DetailSkeleton cards={2} />;
}

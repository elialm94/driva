import { DetailSkeleton } from "@/components/skeletons";

/** Inbox-dokument: tillbaka-rad + rubrik + dokumentkort. */
export default function Loading() {
  return <DetailSkeleton cards={2} />;
}

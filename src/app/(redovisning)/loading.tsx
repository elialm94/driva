import { OverviewSkeleton } from "@/components/skeletons";

/** Redovisningsytan: portfölj-/kövyer får omedelbar laddyta. */
export default function Loading() {
  return <OverviewSkeleton cards={3} />;
}

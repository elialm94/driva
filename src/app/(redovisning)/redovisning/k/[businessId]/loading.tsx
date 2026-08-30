import { DetailSkeleton } from "@/components/skeletons";

/** Klientvy i redovisningsytan (inkl. undervyer: bank/moms/verifikationer). */
export default function Loading() {
  return <DetailSkeleton cards={3} />;
}

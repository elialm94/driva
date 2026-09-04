import { RegisterSkeleton } from "@/components/skeletons";

/** Uppdrag: rubrik + sök/filter + tabell – samma form som färdiga sidan. */
export default function Loading() {
  return <RegisterSkeleton actions={2} rows={8} />;
}

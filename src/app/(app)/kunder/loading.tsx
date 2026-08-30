import { RegisterSkeleton } from "@/components/skeletons";

/** Kunder: rubrik + flikar + sök + tabell – samma form som färdiga sidan. */
export default function Loading() {
  return <RegisterSkeleton tabs={2} actions={2} rows={8} />;
}

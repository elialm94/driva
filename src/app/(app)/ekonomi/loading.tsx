import { RegisterSkeleton } from "@/components/skeletons";

/** Ekonomi: rubrik + fyra flikar + sök + register. */
export default function Loading() {
  return <RegisterSkeleton tabs={4} actions={2} rows={8} />;
}

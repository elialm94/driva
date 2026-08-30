import { OverviewSkeleton } from "@/components/skeletons";

/** Bokföring (nav + undervyer): statuskort i väntan på siffrorna. */
export default function Loading() {
  return <OverviewSkeleton cards={4} />;
}

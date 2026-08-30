import { OverviewSkeleton } from "@/components/skeletons";

/**
 * Gruppens standardskelett: visas OMEDELBART vid navigering till rutter i
 * (app) som saknar eget loading.tsx. Sidoskalet ligger kvar – bara innehålls-
 * ytan pulserar. Gör dessutom att dynamiska rutter kan partial-prefetchas.
 */
export default function Loading() {
  return <OverviewSkeleton cards={3} />;
}

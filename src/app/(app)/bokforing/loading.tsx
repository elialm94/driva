import { DetailSkeleton } from "@/components/skeletons";

/**
 * Suspense-gräns UNDER flikraden i bokforing/layout.tsx.
 *
 * Två saker följer av att gränsen ligger här och inte i (app):
 *   * Flikbytet byter bara innehållsytan – flikraden, toggeln och appskalet
 *     ligger kvar monterade. (app)/loading.tsx skulle i stället ersätta hela
 *     bokföringsytan, flikraden inkluderad, och det ser ut som en omladdning.
 *   * De dynamiska flikvyerna kan partial-prefetchas ner till den här gränsen,
 *     så ett klick visar rätt chrome direkt utan att servern behöver rendera
 *     varje flikvy i förväg.
 */
export default function Loading() {
  return <DetailSkeleton cards={2} />;
}

"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PrivacyPolicyState, WebsiteDesign, WebsiteFooter } from "@/lib/types";
import type { WebsitePublishInput, WebsiteSectionPublishUpdate } from "@/lib/website-publish";

type EditorSync = {
  publishing: boolean;
  bumpRevision: () => number;
  noteDesign: (design: WebsiteDesign) => void;
  noteFooter: (footer: WebsiteFooter) => void;
  notePrivacy: (privacy: PrivacyPolicyState) => void;
  noteSectionOrder: (ids: string[]) => void;
  noteSectionVisibility: (rows: { id: string; visible: boolean }[]) => void;
  noteSectionUpdate: (update: WebsiteSectionPublishUpdate) => void;
  notePrimaryCta: (label: string) => void;
  trackMutation: <T>(promise: Promise<T>) => Promise<T>;
  flushMutations: () => Promise<void>;
  getSnapshot: () => WebsitePublishInput;
  beginPublish: () => boolean;
  endPublish: () => void;
};

const WebsiteEditorSyncContext = createContext<EditorSync | null>(null);

export function WebsiteEditorSyncProvider({
  initialRevision,
  initialDesign,
  initialFooter,
  initialPrivacy,
  initialSectionOrder,
  initialSectionVisibility,
  initialPrimaryCtaLabel,
  children,
}: {
  initialRevision: number;
  initialDesign: WebsiteDesign;
  initialFooter: WebsiteFooter;
  initialPrivacy: PrivacyPolicyState;
  initialSectionOrder: string[];
  initialSectionVisibility: { id: string; visible: boolean }[];
  initialPrimaryCtaLabel?: string;
  children: ReactNode;
}) {
  const revisionRef = useRef(initialRevision);
  const designRef = useRef(initialDesign);
  const footerRef = useRef(initialFooter);
  const privacyRef = useRef(initialPrivacy);
  const sectionOrderRef = useRef(initialSectionOrder);
  const sectionVisibilityRef = useRef(initialSectionVisibility);
  const sectionUpdatesRef = useRef(new Map<string, WebsiteSectionPublishUpdate>());
  const primaryCtaRef = useRef(initialPrimaryCtaLabel);
  const pendingRef = useRef(new Set<Promise<unknown>>());
  const publishingRef = useRef(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (publishingRef.current) return;
    if (initialRevision >= revisionRef.current) {
      revisionRef.current = initialRevision;
      designRef.current = initialDesign;
      footerRef.current = initialFooter;
      privacyRef.current = initialPrivacy;
      sectionOrderRef.current = initialSectionOrder;
      sectionVisibilityRef.current = initialSectionVisibility;
      primaryCtaRef.current = initialPrimaryCtaLabel;
      sectionUpdatesRef.current.clear();
    }
  }, [
    initialRevision,
    initialDesign,
    initialFooter,
    initialPrivacy,
    initialSectionOrder,
    initialSectionVisibility,
    initialPrimaryCtaLabel,
  ]);

  const api = useMemo<Omit<EditorSync, "publishing">>(
    () => ({
      bumpRevision() {
        revisionRef.current += 1;
        return revisionRef.current;
      },
      noteDesign(design) {
        designRef.current = design;
      },
      noteFooter(footer) {
        footerRef.current = footer;
      },
      notePrivacy(privacy) {
        privacyRef.current = privacy;
      },
      noteSectionOrder(ids) {
        sectionOrderRef.current = ids;
      },
      noteSectionVisibility(rows) {
        sectionVisibilityRef.current = rows;
      },
      noteSectionUpdate(update) {
        sectionUpdatesRef.current.set(update.id, {
          ...sectionUpdatesRef.current.get(update.id),
          ...update,
        });
      },
      notePrimaryCta(label) {
        primaryCtaRef.current = label;
      },
      trackMutation(promise) {
        pendingRef.current.add(promise);
        void promise.finally(() => pendingRef.current.delete(promise));
        return promise;
      },
      async flushMutations() {
        const pending = [...pendingRef.current];
        if (pending.length === 0) return;
        await Promise.allSettled(pending);
      },
      getSnapshot() {
        return {
          revision: revisionRef.current,
          design: designRef.current,
          footer: footerRef.current,
          privacyPolicy: privacyRef.current,
          sectionOrder: sectionOrderRef.current,
          sectionVisibility: sectionVisibilityRef.current,
          sectionUpdates: [...sectionUpdatesRef.current.values()],
          ...(primaryCtaRef.current !== undefined ? { primaryCtaLabel: primaryCtaRef.current } : {}),
        };
      },
      beginPublish() {
        if (publishingRef.current) return false;
        publishingRef.current = true;
        setPublishing(true);
        return true;
      },
      endPublish() {
        publishingRef.current = false;
        setPublishing(false);
      },
    }),
    [],
  );

  const value = useMemo<EditorSync>(() => ({ ...api, publishing }), [api, publishing]);

  return <WebsiteEditorSyncContext.Provider value={value}>{children}</WebsiteEditorSyncContext.Provider>;
}

export function useWebsiteEditorSync(): EditorSync {
  const ctx = useContext(WebsiteEditorSyncContext);
  if (!ctx) throw new Error("useWebsiteEditorSync kräver WebsiteEditorSyncProvider.");
  return ctx;
}

export function useWebsiteEditorSyncOptional(): EditorSync | null {
  return useContext(WebsiteEditorSyncContext);
}

/** Bump revision, notera ev. snapshot och spåra den asynkrona skrivningen. */
export function enqueueWebsiteMutation<T>(
  sync: EditorSync | null,
  action: (revision: number) => Promise<T>,
  note?: (revision: number) => void,
): Promise<T> {
  const revision = sync?.bumpRevision() ?? 0;
  note?.(revision);
  const promise = action(revision);
  sync?.trackMutation(promise);
  return promise;
}

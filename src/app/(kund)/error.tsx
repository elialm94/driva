"use client";

import { PublicDocumentError } from "@/components/public-document-error";

export default function PublicCustomerError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <PublicDocumentError error={error} retry={retry} />;
}

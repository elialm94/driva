import { Suspense } from "react";
import { PageHeader } from "@/components/ui";
import { SupportForm } from "@/components/support-form";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Hjälp & support" };

export default async function SupportPage() {
  await ensurePageBusiness();
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Hjälp & support"
        subtitle="Beskriv vad du behöver hjälp med så hör vi av oss via mejl."
      />
      <Suspense fallback={null}>
        <SupportForm />
      </Suspense>
    </div>
  );
}

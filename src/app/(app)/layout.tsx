import type { ReactNode } from "react";
import { Sidebar, BottomNav } from "@/components/nav";
import { db } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: ReactNode }) {
  const settings = db().settings;
  return (
    <div className="min-h-dvh">
      <Sidebar companyName={settings.name} />
      <main className="pb-28 lg:pb-16 lg:pl-60">
        <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-8 lg:pt-10">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}

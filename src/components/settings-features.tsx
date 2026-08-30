"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Globe } from "lucide-react";
import { activateWebsiteModuleAction, hideWebsiteFromNavAction } from "@/app/actions";
import { buttonClasses, Card } from "./ui";

export function SettingsFeaturesCard({
  navVisible,
  published,
}: {
  navVisible: boolean;
  published: boolean;
}) {
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function hide() {
    startTransition(async () => {
      await hideWebsiteFromNavAction();
      setManageOpen(false);
      router.refresh();
    });
  }

  function activate() {
    startTransition(async () => {
      await activateWebsiteModuleAction();
    });
  }

  return (
    <Card className="space-y-4 p-6">
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Funktioner</p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink/5 text-muted">
            <Globe className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-ink">Hemsida</p>
            <p className="mt-1 text-[14px] leading-relaxed text-soft">
              Skapa och publicera en enkel hemsida för företaget.
            </p>
            {published && !navVisible ? (
              <p className="mt-2 text-[13px] text-muted">
                Din publicerade hemsida är fortfarande live. Dölj påverkar bara menyn.
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {navVisible ? (
            <>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-ok-soft px-2.5 py-1 text-[12px] font-medium text-ok">Aktiv</span>
                <button
                  type="button"
                  className={buttonClasses("secondary", "sm")}
                  onClick={() => setManageOpen((v) => !v)}
                  aria-expanded={manageOpen}
                >
                  Hantera
                </button>
              </div>
              {manageOpen ? (
                <div className="w-full min-w-52 rounded-xl border border-line bg-canvas p-3 sm:w-auto">
                  <Link
                    href="/hemsida"
                    className="block rounded-lg px-2 py-1.5 text-[14px] font-medium text-ink hover:bg-ink/5"
                  >
                    Öppna Hemsida
                  </Link>
                  <button
                    type="button"
                    onClick={hide}
                    disabled={pending}
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-[14px] text-ink hover:bg-ink/5 disabled:opacity-60"
                  >
                    {pending ? "Döljer …" : "Dölj från meny"}
                  </button>
                  {published ? (
                    <p className="mt-1.5 px-2 text-[12px] leading-relaxed text-muted">
                      Den publicerade hemsidan fortsätter vara live. Avpublicera gör du från Hemsida.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className={buttonClasses("primary", "sm")}
              onClick={activate}
              disabled={pending}
            >
              {pending ? "Aktiverar …" : "Aktivera"}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

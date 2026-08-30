import { endSupportSessionAction } from "@/app/admin/actions";
import { activeSupportContext } from "@/lib/platform/auth";

/**
 * SUPPORTLÄGE-banner i kundappen: ständigt synlig när en plattformsadmin
 * arbetar i ett kundföretag via en aktiv supportsession. Det ska aldrig vara
 * tvetydigt vilken tenant som ändras. Renderar ingenting för vanliga kunder.
 */
export async function SupportModeBanner({ companyName }: { companyName: string }) {
  const support = await activeSupportContext().catch(() => null);
  if (!support) return null;
  const minutesLeft = Math.max(
    0,
    Math.round((new Date(support.session.expiresAt).getTime() - Date.now()) / 60_000)
  );
  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-500/50 bg-amber-400 px-4 py-2 text-[13px] font-medium text-neutral-950">
      <span className="font-bold uppercase tracking-wide">Supportläge</span>
      <span>
        Du arbetar med {companyName} · session går ut om {minutesLeft} min · allt du ändrar loggas
        på ditt namn
      </span>
      <form action={endSupportSessionAction}>
        <button
          type="submit"
          className="rounded-md border border-neutral-950/30 px-2.5 py-0.5 text-[12.5px] font-semibold hover:bg-neutral-950 hover:text-amber-300"
        >
          Avsluta
        </button>
      </form>
    </div>
  );
}

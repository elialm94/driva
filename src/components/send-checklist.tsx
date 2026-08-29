import { AppLink } from "./app-link";
import { Card } from "./ui";

export interface SendBlocker {
  code: string;
  message: string;
  href?: string;
  actionLabel?: string;
}

/** "Innan X kan skickas"-checklista med länkar till det som behöver kompletteras. */
export function SendChecklist({ id, title, blockers }: { id: string; title: string; blockers: SendBlocker[] }) {
  if (blockers.length === 0) return null;
  return (
    <div id={id}>
      <Card className="mb-6 border-warn/30 bg-warn-soft/40 px-5 py-4">
        <p className="text-[15px] font-semibold text-ink">{title}</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] text-soft">
          {blockers.map((b) => (
            <li key={b.code}>
              {b.message}
              {b.href ? (
                <>
                  {" "}
                  <AppLink href={b.href} className="font-medium text-ink underline-offset-2 hover:underline">
                    {b.actionLabel ?? "Komplettera"}
                  </AppLink>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

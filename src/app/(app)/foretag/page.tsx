import { redirect } from "next/navigation";
import { SETTINGS_HREF } from "@/lib/settings-routes";
import { sanitizeReturnLabel, sanitizeReturnTo, withReturnTo } from "@/lib/nav";

export const metadata = { title: "Företagsuppgifter" };

export default async function CompanySettingsRedirect(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const tillbaka = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : null;
  const tillbakaNamn =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) : null;
  redirect(withReturnTo(SETTINGS_HREF.foretag, tillbaka, tillbakaNamn));
}

import { redirect } from "next/navigation";

/** Kvar som redirect i minst två releaser – mejl och gamla länkar landar här. */
export default async function InboxRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value) qs.set(key, value);
  }
  const suffix = qs.toString();
  redirect(suffix ? `/bokforing/underlag?${suffix}` : "/bokforing/underlag");
}

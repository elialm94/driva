import { redirect } from "next/navigation";

export default async function AttGoraRedirect({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; klient?: string }>;
}) {
  const { filter, klient } = await searchParams;
  if (klient) {
    const q = filter && filter !== "alla" ? `?filter=${encodeURIComponent(filter)}` : "";
    redirect(`/redovisning/k/${klient}${q}`);
  }
  if (filter && filter !== "alla") redirect(`/redovisning?filter=${encodeURIComponent(filter)}`);
  redirect("/redovisning");
}

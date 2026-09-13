import { redirect } from "next/navigation";

/** Äldre adress: rapportfliken börjar i resultatrapporten, som på ägarytan. */
export default async function AccountantRapporterPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ ar?: string }>;
}) {
  const [{ businessId }, { ar }] = await Promise.all([params, searchParams]);
  redirect(`/redovisning/k/${businessId}/resultat${ar ? `?ar=${encodeURIComponent(ar)}` : ""}`);
}

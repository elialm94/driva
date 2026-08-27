import { redirect } from "next/navigation";
import { BOKFORING_FLIK_HREF } from "@/lib/nav";

export const metadata = { title: "Bokföringsdetaljer" };

/**
 * En ingång till den avancerade bokföringsvyn. Befintliga undersidor
 * (`/bokforing/verifikationer` m.fl.) ligger kvar och nås via flikar.
 */
export default async function BokforingDetaljerPage({
  searchParams,
}: {
  searchParams: Promise<{ flik?: string }>;
}) {
  const params = await searchParams;
  const href = (params.flik && BOKFORING_FLIK_HREF[params.flik]) || "/bokforing/verifikationer";
  redirect(href);
}

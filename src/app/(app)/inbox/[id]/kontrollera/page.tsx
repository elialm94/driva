import { redirect } from "next/navigation";

/** Kvar som redirect i minst två releaser. */
export default async function InboxKontrolleraRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/bokforing/underlag/${id}/kontrollera`);
}

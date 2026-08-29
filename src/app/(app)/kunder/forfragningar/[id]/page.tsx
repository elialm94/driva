import { redirect } from "next/navigation";

export const metadata = { title: "Förfrågan" };

export default async function OldInquiryRedirect(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/inbox/${id}`);
}

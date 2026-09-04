import { redirect } from "next/navigation";
import { getJob } from "@/lib/services/data";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Uppdrag" };

export default async function OldInquiryRedirect(props: { params: Promise<{ id: string }> }) {
  await ensurePageBusiness();
  const { id } = await props.params;
  const job = getJob(id);
  redirect(job ? `/uppdrag/${job.id}` : "/uppdrag");
}

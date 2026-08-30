import { redirect } from "next/navigation";

export default async function KlienterRedirect({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  redirect(q ? `/redovisning?q=${encodeURIComponent(q)}` : "/redovisning");
}

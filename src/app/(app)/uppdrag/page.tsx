import { redirect } from "next/navigation";

export const metadata = { title: "Uppdrag" };

function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function UppdragPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const q = new URLSearchParams();
  q.set("flik", "uppdrag");
  for (const key of ["q", "visning", "ekonomi", "sortering", "sida"] as const) {
    const value = str(searchParams[key]);
    if (value) q.set(key, value);
  }
  redirect(`/kunder?${q.toString()}`);
}

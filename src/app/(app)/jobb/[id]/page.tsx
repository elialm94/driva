import { redirect } from "next/navigation";

export default async function JobbIdRedirect(props: PageProps<"/jobb/[id]">) {
  const { id } = await props.params;
  redirect(`/uppdrag/${id}`);
}

import { FileDown } from "lucide-react";
import { buttonClasses } from "./ui";

export function DownloadPdfButton({
  href,
  label = "Ladda ner PDF",
}: {
  href: string;
  label?: string;
}) {
  return (
    <a href={href} className={buttonClasses("secondary")} download>
      <FileDown className="size-4" />
      {label}
    </a>
  );
}

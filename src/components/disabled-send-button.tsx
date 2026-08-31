import type { ReactNode } from "react";
import { cx } from "./ui";

/** Native title on the wrapper so a disabled button still has a desktop tooltip. */
export function DisabledSendWrap({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <span className={cx("inline-flex cursor-not-allowed")} title={title}>
      {children}
    </span>
  );
}

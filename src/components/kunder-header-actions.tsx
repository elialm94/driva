"use client";

import { NewCustomerButton } from "./customer-list";
import { NewUppdragButton } from "./uppdrag-form";
import { ButtonLink, PageHeaderCreateActions } from "./ui";
import type { CustomerOption } from "./customer-picker";

export function KunderHeaderActions({ customers, fieldMode = false }: { customers: CustomerOption[]; fieldMode?: boolean }) {
  return (
    <PageHeaderCreateActions>
      {fieldMode ? (
        <ButtonLink href="/falt" variant="ghost">
          Fältläge
        </ButtonLink>
      ) : null}
      <NewCustomerButton variant="secondary" />
      <NewUppdragButton customers={customers} label="Uppdrag" />
    </PageHeaderCreateActions>
  );
}

"use client";

import { NewCustomerButton } from "./customer-list";
import { NewUppdragButton } from "./uppdrag-form";
import { PageHeaderCreateActions } from "./ui";
import type { CustomerOption } from "./customer-picker";

export function KunderHeaderActions({ customers }: { customers: CustomerOption[] }) {
  return (
    <PageHeaderCreateActions>
      <NewCustomerButton variant="secondary" />
      <NewUppdragButton customers={customers} label="Uppdrag" />
    </PageHeaderCreateActions>
  );
}

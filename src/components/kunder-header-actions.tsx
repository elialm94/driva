"use client";

import { NewCustomerButton } from "./customer-list";
import { NewUppdragButton } from "./uppdrag-form";
import { CreateMenu, PageActions } from "./action-menu";
import type { CustomerOption } from "./customer-picker";

export function KunderHeaderActions({ customers }: { customers: CustomerOption[] }) {
  return (
    <PageActions>
      <div className="hidden md:contents">
        <NewCustomerButton variant="secondary" />
        <NewUppdragButton customers={customers} />
      </div>
      <div className="md:hidden">
        <CreateMenu>
          <NewCustomerButton appearance="menu" />
          <NewUppdragButton appearance="menu" customers={customers} />
        </CreateMenu>
      </div>
    </PageActions>
  );
}

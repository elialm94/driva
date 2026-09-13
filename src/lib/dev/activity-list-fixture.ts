import { resetDemoData } from "../store";
import { customerActivityFeed } from "../services/customer-activity";
import { createCustomer } from "../services/customers";
import { createQuote } from "../services/quotes";

/** Företagskund utan ROT - 21 fristående offerter, inga betalningar. */
export const ACTIVITY_LIST_FIXTURE_NAME = "Aktivitetslistan AB";

export function seedActivityListFixture(): { customerId: string; rows: number } {
  resetDemoData();
  const customer = createCustomer({
    kind: "foretag",
    name: ACTIVITY_LIST_FIXTURE_NAME,
    email: "aktivitet@example.se",
    phone: "08-123 45 67",
    address: "Testgatan 1",
    postalCode: "116 30",
    city: "Stockholm",
  });
  for (let i = 1; i <= 21; i++) {
    createQuote({
      customerId: customer.id,
      title: `Händelse ${i}`,
      lines: [
        {
          id: `act-fix-l${i}`,
          kind: "arbete",
          description: "Snickeri",
          qty: 1,
          unit: "tim",
          unitPrice: 500 + i,
          vatRate: 25,
        },
      ],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: 30,
      validUntil: `2026-12-${String(Math.min(i, 28)).padStart(2, "0")}`,
      terms: "",
    });
  }
  return { customerId: customer.id, rows: customerActivityFeed(customer.id).length };
}

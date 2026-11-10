// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated invoices handlers.
// You own this file: OSL never rewrites it.

import type { Invoice, NewInvoice } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/invoices";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewInvoice, _ctx: HookContext): Promise<NewInvoice> {
    return input;
  },
  async afterCreate(_row: Invoice, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Invoice, patch: Partial<NewInvoice>, _ctx: HookContext): Promise<Partial<NewInvoice>> {
    return patch;
  },
  async afterUpdate(_row: Invoice, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Invoice, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Invoice, _ctx: HookContext): Promise<void> {}
};

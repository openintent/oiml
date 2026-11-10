// Created once by OSL (@osl/backend-hono-trpc-vite). Hooks around the generated invoices procedures.
// You own this file: OSL never rewrites it.

import type { Invoice, NewInvoice } from "@generated/db/schema";
import type { HookContext } from "@generated/server/resources/invoices";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
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

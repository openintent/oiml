// Created once by OSL (@osl/backend-drizzle-next). Hooks around the generated announcements handlers.
// You own this file: OSL never rewrites it.

import type { Announcement, NewAnnouncement } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/announcements";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: NewAnnouncement, _ctx: HookContext): Promise<NewAnnouncement> {
    return input;
  },
  async afterCreate(_row: Announcement, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: Announcement, patch: Partial<NewAnnouncement>, _ctx: HookContext): Promise<Partial<NewAnnouncement>> {
    return patch;
  },
  async afterUpdate(_row: Announcement, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: Announcement, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: Announcement, _ctx: HookContext): Promise<void> {}
};

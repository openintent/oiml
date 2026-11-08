// Created once by OSL (@osl/backend-hono-trpc-vite). The TanStack Router instance. routeTree.gen.ts is written by the Vite plugin from src/routes.
// You own this file: OSL never rewrites it.

import { createRouter } from "@tanstack/react-router";
import { queryClient } from "@generated/app/client";
import { routeTree } from "./routeTree.gen";

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

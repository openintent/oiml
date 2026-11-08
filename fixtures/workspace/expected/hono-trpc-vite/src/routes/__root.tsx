// Created once by OSL (@osl/backend-hono-trpc-vite). The root route: every page renders inside the app shell.
// You own this file: OSL never rewrites it.

import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout
});

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

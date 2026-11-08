/**
 * The Vite app's own scaffolds: the entry point, the router and the root route. The shell, the pages
 * and the client come from the shared web generators in @osl/ts-common.
 */
import type { GeneratedFile, IR } from "@osl/core";
import { SCAFFOLD_HEADER, VITE } from "./util.js";

export function viteScaffolds(ir: IR): GeneratedFile[] {
  void ir;
  const client = VITE.generated("app/client");
  return [
    {
      path: "src/main.tsx",
      mode: "scaffold",
      content: `${SCAFFOLD_HEADER("The web entry point: providers around the router.")}
import "./index.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "${client}";
import { router } from "./router";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
`
    },
    {
      path: "src/router.ts",
      mode: "scaffold",
      content: `${SCAFFOLD_HEADER("The TanStack Router instance. routeTree.gen.ts is written by the Vite plugin from src/routes.")}
import { createRouter } from "@tanstack/react-router";
import { queryClient } from "${client}";
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
`
    },
    {
      path: "src/routes/__root.tsx",
      mode: "scaffold",
      content: `${SCAFFOLD_HEADER("The root route: every page renders inside the app shell.")}
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
`
    }
  ];
}

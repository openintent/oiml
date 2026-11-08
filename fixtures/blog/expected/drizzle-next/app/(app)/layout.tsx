// Created once by OSL (@osl/backend-drizzle-next). Every page under this group renders inside the app shell with the sidebar.
// You own this file: OSL never rewrites it.

import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/app/providers";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}

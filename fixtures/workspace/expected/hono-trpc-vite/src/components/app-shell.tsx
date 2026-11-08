// Created once by OSL (@osl/backend-hono-trpc-vite). The master/detail shell: the sidebar on the left, the current page filling the rest.
// You own this file: OSL never rewrites it.

"use client";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { APP_TITLE, SIDEBAR } from "@generated/app/nav";

export function AppShell({ children }: { children: ReactNode }) {
  if (!SIDEBAR) return <div className="min-h-svh">{children}</div>;
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2 md:hidden">
          <SidebarTrigger />
          <span className="text-sm font-medium">{APP_TITLE}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

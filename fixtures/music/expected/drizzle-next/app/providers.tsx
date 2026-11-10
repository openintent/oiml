// Created once by OSL (@osl/backend-drizzle-next). Client-side providers for the app's pages.
// You own this file: OSL never rewrites it.

"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryClient } from "@/generated/app/client";

export function Providers({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

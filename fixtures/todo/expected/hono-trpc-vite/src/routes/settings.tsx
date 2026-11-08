// Created once by OSL (@osl/backend-hono-trpc-vite). The settings page the sidebar footer links to.
// You own this file: OSL never rewrites it.

import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>This app has no sign-in.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">OSL created this page once and never rewrites it. Put your settings here.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// Created once by OSL (@osl/backend-hono-trpc-vite). The settings page the sidebar footer links to.
// You own this file: OSL never rewrites it.

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { client, sessionUser } from "@generated/app/client";
import { userName, userSubtitle } from "@generated/app/nav";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>{user ? `${userName(user)} · ${userSubtitle(user)}` : "Not signed in."}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">OSL created this page once and never rewrites it. Put your settings here.</p>
        </CardContent>
      </Card>
    </div>
  );
}

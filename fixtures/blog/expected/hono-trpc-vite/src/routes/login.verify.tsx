// Created once by OSL (@osl/backend-hono-trpc-vite). Where a magic link lands: verifies the token and signs the user in.
// You own this file: OSL never rewrites it.

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { client } from "@generated/app/client";

export const Route = createFileRoute("/login/verify")({
  component: VerifyPage,
  validateSearch: (search: Record<string, unknown>): { token: string } => ({ token: typeof search.token === "string" ? search.token : "" })
});

function VerifyPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const verify = useMutation({
    mutationFn: (input: { token: string }) => client.auth.magic_link_verify(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: "/" });
    }
  });
  useEffect(() => {
    if (token) verify.mutate({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Signing you in</CardTitle>
          <CardDescription>{verify.error ? verify.error.message : token ? "One moment…" : "This link is missing its token."}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

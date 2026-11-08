// Created once by OSL (@osl/backend-drizzle-next). Where a magic link lands: verifies the token and signs the user in.
// You own this file: OSL never rewrites it.

"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { client } from "@/generated/app/client";

export default function VerifyPage() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const router = useRouter();
  const queryClient = useQueryClient();
  const verify = useMutation({
    mutationFn: (input: { token: string }) => client.auth.magic_link_verify(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await router.push("/");
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

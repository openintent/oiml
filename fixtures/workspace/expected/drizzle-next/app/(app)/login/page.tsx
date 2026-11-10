// Created once by OSL (@osl/backend-drizzle-next). Sign in: passwords, magic links and OAuth, whichever the model declares.
// You own this file: OSL never rewrites it.

"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { client } from "@/generated/app/client";
import { inviteTokenOf, useLandInvitee, type Accepted } from "@/generated/app/invite";
import { nextPath } from "@/generated/app/nav";
import { ErrorNote } from "@/generated/app/ui";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ["auth", "providers"], queryFn: () => client.auth.providers() });
  void providers;
  // After signing in: back to the page that asked for it, when `next` names one; else home
  const land = useLandInvitee();
  const done = async (accepted?: readonly Accepted[]) => {
    if (accepted?.length) return land(accepted);
    await queryClient.invalidateQueries();
    const next = nextPath();
    if (next) window.location.assign(next);
    else await router.push("/");
  };
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState({ name: "" });
  const login = useMutation({ mutationFn: (input: Parameters<typeof client.auth.login>[0]) => client.auth.login(input), onSuccess: reply => done(reply.accepted) });
  const register = useMutation({ mutationFn: (input: Parameters<typeof client.auth.register>[0]) => client.auth.register(input), onSuccess: () => done() });
  const pending = login.isPending || register.isPending;
  const error = mode === "login" ? login.error : register.error;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "login") login.mutate({ email, password, invite: inviteTokenOf(nextPath()) });
    else register.mutate({ email, password, ...fields });
  };
  const [linkEmail, setLinkEmail] = useState("");
  const magicLink = useMutation({ mutationFn: (input: { email: string }) => client.auth.magic_link(input) });
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === "login" ? "Sign in" : "Create an account"}</CardTitle>
          <CardDescription>{mode === "login" ? "Welcome back." : "Passwords must be at least 8 characters."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            {mode === "register" ? (
              <>
              <div className="grid gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={fields.name} onChange={e => setFields(v => ({ ...v, name: e.target.value }))} required />
              </div>
              </>
            ) : null}
            <ErrorNote error={error} />
            <Button type="submit" disabled={pending}>
              {mode === "login" ? "Sign in" : "Register"}
            </Button>
            <Button type="button" variant="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "No account yet? Register" : "Have an account? Sign in"}
            </Button>
          </form>
          <form
            className="grid gap-3"
            onSubmit={event => {
              event.preventDefault();
              magicLink.mutate({ email: linkEmail });
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="link-email">Email me a sign-in link</Label>
              <Input id="link-email" type="email" autoComplete="email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)} required />
            </div>
            <ErrorNote error={magicLink.error} />
            {magicLink.data ? (
              <p className="text-sm text-muted-foreground">
                Check your inbox.
                {magicLink.data.debug ? (
                  <>
                    {" "}
                    <a className="underline" href={magicLink.data.debug.url}>
                      Open the link
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
            <Button type="submit" variant="outline" disabled={magicLink.isPending}>
              Send link
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

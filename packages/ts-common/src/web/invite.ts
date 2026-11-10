/**
 * Invites in the web app: generated/app/invite.tsx (the landing a mailed link opens, and the one function that
 * lands an invitee after accepting) and the two route files that mount it. Everything else about invites in the
 * app is declared: the pending list and the form are a resource page or a section over the invite resource.
 */
import type { GeneratedFile, IR } from "@osl/core";
import { entityByName, q, type TsConventions } from "../conventions.js";
import { rowTarget } from "./pages.js";
import type { WebTarget } from "./target.js";

/** generated/app/invite.tsx */
export function inviteAppFile(ir: IR, target: WebTarget, conv: TsConventions): string {
  const auth = ir.auth!;
  const identity = entityByName(ir, auth.identity);
  const email = auth.emailColumn;
  const credentials = auth.providers.some(p => p.kind === "credentials");
  const others = auth.providers.some(p => p.kind !== "credentials");
  const oauth = auth.providers.filter(p => p.kind === "oauth").map(p => (p as { name: string }).name);
  const tenant = Boolean(ir.app?.tenant);
  const textFields = auth.registerFields.filter(f => {
    const t = identity.columns.find(c => c.name === f)!.type;
    return t.kind === "scalar" && (t.scalar === "string" || t.scalar === "text");
  });
  const label = (f: string) => f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, " ");
  // Where the row an invite joined opens: the first page that shows its entity, by the rule for any row
  const parents = [...new Set((auth.invites ?? []).map(i => i.parent))];
  const cases = parents
    .map(parent => ({ parent, to: rowTarget(ir, p => p.entity === parent) }))
    .filter((c): c is { parent: string; to: NonNullable<ReturnType<typeof rowTarget>> } => c.to !== null)
    .map(
      c => `      case ${q(c.parent)}:
        await ${target.navigateTo(c.to.base, "String(first.id)")};
        return;`
    )
    .join("\n");
  const fieldInputs = textFields
    .map(
      f => `        <div className="grid gap-1.5">
          <Label htmlFor="invite-${f}">${label(f)}</Label>
          <Input id="invite-${f}" value={fields.${f}} onChange={e => setFields(v => ({ ...v, ${f}: e.target.value }))} required />
        </div>`
    )
    .join("\n");
  const passwordInput = credentials
    ? `        <div className="grid gap-1.5">
          <Label htmlFor="invite-password">Password${others ? " (optional)" : ""}</Label>
          <Input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}${others ? "" : "\n            required"}
          />
        </div>`
    : "";
  const acceptBody = [
    ...(textFields.length ? ["...fields"] : []),
    ...(credentials ? [others ? "...(password ? { password } : {})" : "password"] : [])
  ].join(", ");
  return `${conv.header("Invites in the web app: the landing a mailed link opens, and where an invitee lands after accepting.")}
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
${target.routerImports({ navigate: true }).join("\n")}
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { client, errorStatus, sessionUser } from "./client";
${tenant ? `import { chooseTenant } from "./tenant";\n` : ""}import { ErrorNote } from "./ui";

/** What accepting made, as every reply with \`accepted\` lists it: the row joined, the role in it, its tenant */
export type Accepted = { entity: string; id: string | number; role?: string; tenant: string | number | null };

/** The token of the invite landing a sign-in page was asked to return to, if that is where \`next\` points */
export function inviteTokenOf(next: string | undefined): string | undefined {
  const match = /^\\/invite\\/([^/?#]+)$/.exec(next ?? "");
  return match && match[1] !== "accepted" ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Where an invitee lands. Every reply with \`accepted\` comes here: the accept call, a sign-in that accepted, and the
 * page a provider sign-in returns to. The first entry decides${tenant ? ": its tenant becomes the current one when the user is in\n * it, and" : ", and"} its row opens where the app shows it, or the home page when no page does.
 */
export function useLandInvitee(): (accepted: readonly Accepted[]) => Promise<void> {
  ${target.navigateDecl}
  const queryClient = useQueryClient();
  return async accepted => {
    const first = accepted[0];${
      tenant
        ? `
    if (first && first.tenant !== null) await chooseTenant(String(first.tenant)).catch(() => undefined);`
        : ""
    }
    await queryClient.invalidateQueries();
    switch (first?.entity) {
${cases ? cases + "\n" : ""}      default:
        await ${target.navigateTo("/")};
    }
  };
}

/** The address as an invite's lookup shows it: the first character and the domain */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 1 ? "•••" : email[0] + "•••" + email.slice(at);
}

function Frame({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        {children ? <CardContent className="grid gap-4">{children}</CardContent> : null}
      </Card>
    </div>
  );
}

/**
 * /invite/<token>: what the link in an invite mail opens. It shows what the token's lookup answers and never
 * accepts by itself: someone signed in under the invited address presses Accept, someone without an account makes
 * one here, and someone with an account signs in first.
 */
export function InviteLanding({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const land = useLandInvitee();
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);
  const invite = useQuery({ queryKey: ["auth", "invite", token], queryFn: () => client.auth.invite({ token }), retry: false });
  const accept = useMutation({
    mutationFn: (data: Record<string, unknown>) => client.auth.invite_accept({ token, data }),
    onSuccess: reply => land(reply.accepted)
  });
  const logout = useMutation({ mutationFn: () => client.auth.logout(), onSuccess: () => queryClient.invalidateQueries() });${
    textFields.length
      ? `
  const [fields, setFields] = useState({ ${textFields.map(f => `${f}: ""`).join(", ")} });`
      : ""
  }${
    credentials
      ? `
  const [password, setPassword] = useState("");`
      : ""
  }

  if (invite.error) {
    const status = errorStatus(invite.error);
    if (status === 410) return <Frame title="This invite has lapsed" description="Ask whoever invited you to send a new one." />;
    if (status === 404) return <Frame title="This invite is no longer valid" description="It was already used, or it was withdrawn." />;
    return (
      <Frame title="Invite">
        <ErrorNote error={invite.error} />
      </Frame>
    );
  }
  if (!invite.data || session.isPending) return <Frame title="Invite" description="One moment…" />;
  const found = invite.data;
  const what = found.name || found.entity;
  const summary = (found.inviter || "Someone") + " invited " + found.email + " to " + what + (found.role ? " as " + found.role : "") + ".";

  if (user) {
    // The lookup masks the address, so the page compares masks; the API has the last word and answers 403
    const own = String(user.${email} ?? "").trim().toLowerCase();
    if (maskEmail(own) !== found.email || errorStatus(accept.error) === 403) {
      return (
        <Frame title={"Join " + what} description={summary}>
          <p className="text-sm text-muted-foreground">
            You are signed in as {own}. Sign out, then open the link again and sign in with the invited address.
          </p>
          <Button variant="outline" disabled={logout.isPending} onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </Frame>
      );
    }
    return (
      <Frame title={"Join " + what} description={summary}>
        <ErrorNote error={accept.error} />
        <Button disabled={accept.isPending} onClick={() => accept.mutate({})}>
          Accept
        </Button>
      </Frame>
    );
  }

  if (found.account) {
    return (
      <Frame title={"Join " + what} description={summary}>
        <a className={buttonVariants()} href={"/login?next=" + encodeURIComponent("/invite/" + encodeURIComponent(token))}>
          Sign in to accept
        </a>${oauth
          .map(
            name => `
        <a className={buttonVariants({ variant: "outline" })} href="/api/auth/oauth/${name}">
          Continue with ${name}
        </a>`
          )
          .join("")}
      </Frame>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    accept.mutate({ ${acceptBody} });
  };
  return (
    <Frame title={"Join " + what} description={summary}>
      <form onSubmit={submit} className="grid gap-4">
${[fieldInputs, passwordInput].filter(Boolean).join("\n")}
        <ErrorNote error={accept.error} />
        <Button type="submit" disabled={accept.isPending}>
          Create account and accept
        </Button>
      </form>
    </Frame>
  );
}

/** /invite/accepted: where a provider sign-in that accepted invites returns to; it lands the invitee */
export function InviteAccepted() {
  const land = useLandInvitee();
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const entity = query.get("entity");
    const id = query.get("id");
    void land(entity && id ? [{ entity, id, tenant: query.get("tenant") }] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Frame title="Opening what you joined" description="One moment…" />;
}
`;
}

/** The two routes that mount the landing and the return page (generated, rewritten) */
export function inviteRouteFiles(target: WebTarget, conv: TsConventions): GeneratedFile[] {
  const module = conv.generated("app/invite");
  const header = (what: string) => conv.header(`${what}; the component lives in generated/app/invite.tsx.`);
  if (target.kind === "tanstack") {
    return [
      {
        path: "src/routes/invite.$token.tsx",
        content: `${header("Route /invite/$token")}
import { createFileRoute } from "@tanstack/react-router";
import { InviteLanding } from "${module}";

export const Route = createFileRoute("/invite/$token")({ component: InvitePage });

function InvitePage() {
  const { token } = Route.useParams();
  return <InviteLanding token={token} />;
}
`
      },
      {
        path: "src/routes/invite.accepted.tsx",
        content: `${header("Route /invite/accepted")}
import { createFileRoute } from "@tanstack/react-router";
import { InviteAccepted } from "${module}";

export const Route = createFileRoute("/invite/accepted")({ component: InviteAccepted });
`
      }
    ];
  }
  return [
    {
      path: "app/(app)/invite/[token]/page.tsx",
      content: `${header("Page /invite/{token}")}
"use client";
import { useParams } from "next/navigation";
import { InviteLanding } from "${module}";

export default function Page() {
  const { token } = useParams<{ token: string }>();
  return <InviteLanding token={token} />;
}
`
    },
    {
      path: "app/(app)/invite/accepted/page.tsx",
      content: `${header("Page /invite/accepted")}
import { InviteAccepted } from "${module}";

export default function Page() {
  return <InviteAccepted />;
}
`
    }
  ];
}

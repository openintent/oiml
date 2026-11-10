/**
 * The app shell: the sidebar's data (generated), and the scaffolds it is built from (shell, sidebar,
 * home, sign-in, settings). Scaffolds are written once and read generated/app/nav.ts, so later intents
 * that add pages need no edits.
 */
import type { GeneratedFile, IR, RuleIR } from "@osl/core";
import { entityByName, q, type TsConventions } from "../conventions.js";
import { hasInvites } from "../invites.js";
import { entityTitle, iconExport } from "./pages.js";
import type { WebTarget } from "./target.js";

/** generated/app/nav.ts */
export function navFile(ir: IR, target: WebTarget, conv: TsConventions): string {
  const app = ir.app;
  const icons = [...new Set((app?.sidebar?.items ?? []).map(i => i.icon).filter((i): i is string => Boolean(i)))]
    .map(iconExport)
    .sort();
  // A detail page opens from a row, not from the shell: its address needs the row's key
  const pages = (app?.pages ?? [])
    .filter(p => p.kind !== "detail")
    .map(
      p =>
        `  { name: ${q(p.name)}, kind: ${q(p.kind)}, path: ${q(p.path)}, title: ${q(p.title)}${p.description ? `, description: ${q(p.description)}` : ""}, access: ${accessLiteral(p.access)} }`
    );
  const sidebar = app?.sidebar
    ? `{
  items: [
${app.sidebar.items
  .map(
    i =>
      `    { label: ${q(i.label)}, path: ${q(i.path)}, icon: ${i.icon ? iconExport(i.icon) : "null"}, access: ${accessLiteral(i.access)} }`
  )
  .join(",\n")}
  ],
  footer: { user: ${app.sidebar.footer.user}, settings: ${app.sidebar.footer.settings} }
}`
    : "null";

  let userHelpers: string;
  if (ir.auth) {
    const identity = entityByName(ir, ir.auth.identity);
    const display = identity.display;
    const email = ir.auth.emailColumn;
    const hasRole = identity.columns.some(c => c.name === "role" && !c.hidden);
    const subtitle = hasRole ? `text(user.role) || text(user.${email})` : `text(user.${email})`;
    userHelpers = `/** What the shell shows for the signed-in user */
export function userName(user: SessionUser): string {
  return text(user.${display}) || text(user.${email});
}

export function userSubtitle(user: SessionUser): string {
  return ${subtitle};
}

export function userInitials(user: SessionUser): string {
  const name = userName(user).trim();
  const parts = name.split(/\\s+/).filter(Boolean);
  const initials = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return initials.toUpperCase() || "?";
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

/** Where a sign-in goes when it is done: the page's \`next\` query when that is a path of this app, else nowhere */
export function nextPath(): string | undefined {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && /^\\/(?!\\/)/.test(next) && !next.includes("\\\\") ? next : undefined;
}`;
  } else {
    userHelpers = `/** Auth is not configured, so nobody is ever signed in. */
export function userName(_user: SessionUser): string {
  return "";
}

export function userSubtitle(_user: SessionUser): string {
  return "";
}

export function userInitials(_user: SessionUser): string {
  return "";
}`;
  }

  return `${conv.header("The app shell's data: title, pages and the sidebar.")}
${icons.length ? `import { ${icons.join(", ")} } from "lucide-react";\n` : ""}import type { LucideIcon } from "lucide-react";
${target.routePathImport}
import type { SessionUser } from "./client";

/** Every route the app has; a sidebar item or page can only point at one of these */
export type RoutePath = ${target.routePathType};

/** Who may open a page: the page's access rule, as the shell evaluates it */
export type NavAccess = { kind: "public" } | { kind: "authenticated" } | { kind: "role"; role: string };

export interface NavPage {
  name: string;
  kind: "resource" | "dashboard" | "custom";
  path: RoutePath;
  title: string;
  description?: string;
  access: NavAccess;
}

export interface NavItem {
  label: string;
  path: RoutePath;
  icon: LucideIcon | null;
  access: NavAccess;
}

/** Whether the signed-in user (null when anonymous) may open a page with this access */
export function canOpen(access: NavAccess, user: SessionUser | null): boolean {
  if (access.kind === "public") return true;
  if (user === null) return false;
  return access.kind === "authenticated" || (user as { role?: unknown }).role === access.role;
}

export interface NavSidebar {
  items: readonly NavItem[];
  /** The fixed footer: the signed-in user with a sign-out menu, and a settings link */
  footer: { user: boolean; settings: boolean };
}

export const APP_TITLE = ${q(app?.title ?? ir.name)};
export const AUTH = ${Boolean(ir.auth)};

export const PAGES: readonly NavPage[] = [
${pages.join(",\n")}
];

export const SIDEBAR: NavSidebar | null = ${sidebar};

${userHelpers}
`;
}

/** The nav literal of a page's access rule */
function accessLiteral(rule: RuleIR): string {
  if (rule.kind === "role") return `{ kind: "role", role: ${q(rule.value)} }`;
  if (rule.kind === "authenticated") return `{ kind: "authenticated" }`;
  return `{ kind: "public" }`;
}

/**
 * generated/app/tenant.tsx: the tenant context of pages that filter by `{tenant.id}`. The choice is kept in the
 * browser (this tab's, else the last one made in any tab), never in the address, and it is a filter, not a
 * permission: the API's rules decide what a user may read whichever tenant is chosen.
 */
export function tenantFile(ir: IR, target: WebTarget, conv: TsConventions): string {
  const tenant = ir.app?.tenant;
  if (!tenant) throw new Error("tenantFile needs app.tenant");
  const entity = entityByName(ir, tenant.entity);
  const pk = entity.primaryKey[0];
  const one = entityTitle(entity);
  const lower = one.toLowerCase();
  const S = q(tenant.resource);
  // The empty state points at the first page that lists the tenants, where a user can make or join one
  const listPage = (ir.app?.pages ?? []).find(p => p.kind === "resource" && p.resource === tenant.resource);
  const routerImports = listPage ? target.routerImports({ link: true }) : [];
  return `${conv.header(`The tenant context: the ${lower} the sidebar's switcher chose, for the pages that filter by it.`)}
"use client";
import { useQuery } from "@tanstack/react-query";
${routerImports.length ? routerImports.join("\n") + "\n" : ""}import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { client, sessionUser, type Outputs } from "./client";
import { EmptyPane, selectClass, text } from "./ui";

/** A ${lower} the signed-in user can work in: a row the ${tenant.resource} resource lists for them */
export type Tenant = Outputs[${S}]["list"]["data"][number];

const STORAGE_KEY = "osl.tenant";
const LIST = { page_size: 200 };
const NONE: readonly Tenant[] = [];

/** The chosen key; undefined until the browser's storage has been read */
let chosen: string | null | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The remembered choice: this tab's, else the last one made in any tab */
function readChoice(): string | null {
  if (chosen !== undefined) return chosen;
  chosen = null;
  try {
    chosen = window.sessionStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(STORAGE_KEY);
    if (chosen !== null) window.sessionStorage.setItem(STORAGE_KEY, chosen);
  } catch {
    // Storage is blocked: the choice lasts until the page reloads
  }
  return chosen;
}

function writeChoice(key: string): void {
  chosen = key;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, key);
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Storage is blocked: the choice lasts until the page reloads
  }
  for (const listener of listeners) listener();
}

/**
 * The ${lower} in context, the ones the user can change to, and the setter. A remembered ${lower} the user is
 * no longer in falls back to the first one listed; tenant is null while loading and for a user who is in none.
 */
export function useTenant(): {
  tenant: Tenant | null;
  tenants: readonly Tenant[];
  setTenant: (key: string) => void;
  loading: boolean;
} {
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);
  const list = useQuery({
    queryKey: [${S}, "list", LIST],
    queryFn: () => client.${tenant.resource}.list(LIST),
    enabled: user !== null
  });
  const choice = useSyncExternalStore(subscribe, readChoice, () => null);
  const tenants = user !== null ? (list.data?.data ?? NONE) : NONE;
  const current = tenants.find(item => text(item.${pk}) === choice) ?? tenants[0] ?? null;
  return {
    tenant: current,
    tenants,
    setTenant: writeChoice,
    loading: session.isPending || (user !== null && list.isPending)
  };
}

${
  hasInvites(ir)
    ? `/** Makes a ${lower} the current one when the signed-in user is in it; otherwise the choice stays where it was */
export async function chooseTenant(key: string): Promise<void> {
  const list = await client.${tenant.resource}.list(LIST);
  if (list.data.some(item => text(item.${pk}) === key)) writeChoice(key);
}

`
    : ""
}/** The switcher the sidebar shows in its header: the current ${lower}, and the ones the user can change to */
export function TenantSwitcher({ className }: { className?: string }) {
  const { tenant, tenants, setTenant } = useTenant();
  if (tenant === null) return null;
  return (
    <select
      aria-label=${q(one)}
      className={cn(selectClass, "group-data-[collapsible=icon]:hidden", className)}
      value={text(tenant.${pk})}
      onChange={event => setTenant(event.target.value)}
    >
      {tenants.map(item => (
        <option key={text(item.${pk})} value={text(item.${pk})}>
          {text(item.${tenant.labelColumn}) || text(item.${pk})}
        </option>
      ))}
    </select>
  );
}

/** What a page filtered by the ${lower} shows to a user who is in none */
export function NoTenant() {
  return (
    <EmptyPane>
      <div className="space-y-2">
        <p>You are not in any ${lower} yet.</p>${
          listPage
            ? `
        <Link ${target.linkAttrs(listPage.path)} className="text-foreground underline underline-offset-4">
          Open ${listPage.title}
        </Link>`
            : ""
        }
      </div>
    </EmptyPane>
  );
}
`;
}

/** The scaffolds every target shares: shell, sidebar, home, settings, sign-in. Paths depend on the target. */
export function shellScaffolds(ir: IR, target: WebTarget, conv: TsConventions): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const client = conv.generated("app/client");
  const nav = conv.generated("app/nav");
  const ui = (name: string) => `@/components/ui/${name}`;
  const next = target.kind === "next";
  const invites = hasInvites(ir);
  const componentsDir = next ? "components" : "src/components";
  const page = (
    routePath: string,
    scaffoldName: string,
    component: string,
    body: string,
    what: string,
    extraImports: string[] = []
  ): GeneratedFile => {
    if (next) {
      return {
        path: `app/(app)/${routePath === "/" ? "" : routePath.replace(/^\//, "") + "/"}page.tsx`,
        mode: "scaffold",
        content: `${conv.scaffoldHeader(what)}
"use client";
${extraImports.join("\n")}

export default ${body}
`
      };
    }
    return {
      path: `src/routes/${scaffoldName}.tsx`,
      mode: "scaffold",
      content: `${conv.scaffoldHeader(what)}
import { createFileRoute } from "@tanstack/react-router";
${extraImports.join("\n")}

export const Route = createFileRoute(${q(routePath)})({ component: ${component} });

${body}
`
    };
  };

  files.push({
    path: `${componentsDir}/app-shell.tsx`,
    mode: "scaffold",
    content: `${conv.scaffoldHeader("The master/detail shell: the sidebar on the left, the current page filling the rest.")}
"use client";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "${ui("sidebar")}";
import { APP_TITLE, SIDEBAR } from "${nav}";

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
`
  });

  files.push({
    path: `${componentsDir}/app-sidebar.tsx`,
    mode: "scaffold",
    content: sidebarScaffold(ir, target, conv)
  });

  // The home scaffold, unless a page of the model takes the root path
  if (!ir.app?.pages.some(p => p.path === "/")) {
    files.push(
      page(
        "/",
        "index",
        "HomePage",
        `function HomePage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{APP_TITLE}</h1>
      <p className="mt-2 text-muted-foreground">
        Generated by OSL. This page, the sidebar and the components are yours to change; the pages the sidebar lists are
        generated from the model.
      </p>
      {PAGES.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {PAGES.map(page => (
            <Link key={page.path} ${next ? "href={page.path}" : "to={page.path}"} className="block">
              <Card className="h-full transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle>{page.title}</CardTitle>
                  <CardDescription>
                    {page.description ?? (page.kind === "resource" ? "Browse, create and edit." : page.kind === "dashboard" ? "Counts and recent rows." : "A page of your own.")}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}`,
        "The home page.",
        [
          ...target.routerImports({ link: true }),
          `import { Card, CardDescription, CardHeader, CardTitle } from "${ui("card")}";`,
          `import { APP_TITLE, PAGES } from "${nav}";`
        ]
      )
    );
  }
  files.push(
    page(
      "/settings",
      "settings",
      "SettingsPage",
      `function SettingsPage() {
${ir.auth ? `  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });\n  const user = sessionUser(session.data);\n` : ""}  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>${ir.auth ? '{user ? `${userName(user)} · ${userSubtitle(user)}` : "Not signed in."}' : "This app has no sign-in."}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">OSL created this page once and never rewrites it. Put your settings here.</p>
        </CardContent>
      </Card>
    </div>
  );
}`,
      "The settings page the sidebar footer links to.",
      [
        ...(ir.auth ? [`import { useQuery } from "@tanstack/react-query";`] : []),
        `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "${ui("card")}";`,
        ...(ir.auth
          ? [`import { client, sessionUser } from "${client}";`, `import { userName, userSubtitle } from "${nav}";`]
          : [])
      ]
    )
  );

  if (ir.auth) {
    files.push(
      page(
        "/login",
        "login",
        "LoginPage",
        loginBody(ir, target),
        "Sign in: passwords, magic links and OAuth, whichever the model declares.",
        loginImports(ir, target, client, ui)
      )
    );
    if (ir.auth.providers.some(p => p.kind === "magic_link")) {
      files.push(
        page(
          "/login/verify",
          "login.verify",
          "VerifyPage",
          `function VerifyPage() {
  ${next ? `const params = useSearchParams();\n  const token = params.get("token") ?? "";` : `const { token } = Route.useSearch();`}
  ${target.navigateDecl}
  const queryClient = useQueryClient();${
    invites
      ? `
  const land = useLandInvitee();`
      : ""
  }
  const verify = useMutation({
    mutationFn: (input: { token: string }) => client.auth.magic_link_verify(input),
    onSuccess: async ${invites ? "reply" : "()"} => {${
      invites
        ? `
      if (reply.accepted?.length) return land(reply.accepted);`
        : ""
    }
      await queryClient.invalidateQueries();
      await ${target.navigateTo("/")};
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
}`,
          "Where a magic link lands: verifies the token and signs the user in.",
          [
            `import { useMutation, useQueryClient } from "@tanstack/react-query";`,
            ...target.routerImports({ navigate: true }),
            ...(next ? [`import { useSearchParams } from "next/navigation";`] : []),
            `import { useEffect } from "react";`,
            `import { Card, CardDescription, CardHeader, CardTitle } from "${ui("card")}";`,
            `import { client } from "${client}";`,
            ...(invites ? [`import { useLandInvitee } from "${conv.generated("app/invite")}";`] : [])
          ]
        )
      );
      if (!next) {
        // TanStack reads the token from the search params declared on the route
        const file = files[files.length - 1];
        file.content = file.content.replace(
          `export const Route = createFileRoute("/login/verify")({ component: VerifyPage });`,
          `export const Route = createFileRoute("/login/verify")({
  component: VerifyPage,
  validateSearch: (search: Record<string, unknown>): { token: string } => ({ token: typeof search.token === "string" ? search.token : "" })
});`
        );
      }
    }
  }
  return files;
}

function loginImports(ir: IR, target: WebTarget, client: string, ui: (n: string) => string): string[] {
  const auth = ir.auth!;
  const credentials = auth.providers.some(p => p.kind === "credentials");
  return [
    `import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";`,
    ...target.routerImports({ navigate: true }),
    `import { useState${credentials ? ", type FormEvent" : ""} } from "react";`,
    `import { Button, buttonVariants } from "${ui("button")}";`,
    `import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "${ui("card")}";`,
    `import { Input } from "${ui("input")}";`,
    `import { Label } from "${ui("label")}";`,
    `import { client } from "${client}";`,
    ...(hasInvites(ir)
      ? [`import { inviteTokenOf, useLandInvitee, type Accepted } from "${client.replace(/client$/, "invite")}";`]
      : []),
    `import { nextPath } from "${client.replace(/client$/, "nav")}";`,
    `import { ErrorNote } from "${client.replace(/client$/, "ui")}";`
  ];
}

function loginBody(ir: IR, target: WebTarget): string {
  const auth = ir.auth!;
  const identity = entityByName(ir, auth.identity);
  const email = auth.emailColumn;
  const Email = email.charAt(0).toUpperCase() + email.slice(1);
  const credentials = auth.providers.some(p => p.kind === "credentials");
  const magic = auth.providers.some(p => p.kind === "magic_link");
  const oauth = auth.providers.filter(p => p.kind === "oauth");
  const textFields = auth.registerFields.filter(f => {
    const t = identity.columns.find(c => c.name === f)!.type;
    return t.kind === "scalar" && (t.scalar === "string" || t.scalar === "text");
  });
  const invites = hasInvites(ir);
  const fieldState = textFields.map(f => `${f}: ""`).join(", ");
  const fieldInputs = textFields
    .map(
      f => `              <div className="grid gap-1.5">
                <Label htmlFor="${f}">${f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, " ")}</Label>
                <Input id="${f}" value={fields.${f}} onChange={e => setFields(v => ({ ...v, ${f}: e.target.value }))} required />
              </div>`
    )
    .join("\n");
  return `function LoginPage() {
  ${target.navigateDecl}
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ["auth", "providers"], queryFn: () => client.auth.providers() });
  void providers;
  // After signing in: back to the page that asked for it, when \`next\` names one; else home${
    invites
      ? `
  const land = useLandInvitee();
  const done = async (accepted?: readonly Accepted[]) => {
    if (accepted?.length) return land(accepted);`
      : `
  const done = async () => {`
  }
    await queryClient.invalidateQueries();
    const next = nextPath();
    if (next) window.location.assign(next);
    else await ${target.navigateTo("/")};
  };${
    credentials
      ? `
  const [mode, setMode] = useState<"login" | "register">("login");
  const [${email}, set${Email}] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState({ ${fieldState} });
  const login = useMutation({ mutationFn: (input: Parameters<typeof client.auth.login>[0]) => client.auth.login(input), onSuccess: ${invites ? "reply => done(reply.accepted)" : "done"} });
  const register = useMutation({ mutationFn: (input: Parameters<typeof client.auth.register>[0]) => client.auth.register(input), onSuccess: ${invites ? "() => done()" : "done"} });
  const pending = login.isPending || register.isPending;
  const error = mode === "login" ? login.error : register.error;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "login") login.mutate({ ${email}, password${invites ? ", invite: inviteTokenOf(nextPath())" : ""} });
    else register.mutate({ ${email}, password, ...fields });
  };`
      : ""
  }${
    magic
      ? `
  const [linkEmail, setLinkEmail] = useState("");
  const magicLink = useMutation({ mutationFn: (input: { email: string }) => client.auth.magic_link(input) });`
      : ""
  }
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>${credentials ? '{mode === "login" ? "Sign in" : "Create an account"}' : "Sign in"}</CardTitle>
          <CardDescription>${credentials ? '{mode === "login" ? "Welcome back." : "Passwords must be at least 8 characters."}' : "Welcome back."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">${
          credentials
            ? `
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="${email}">Email</Label>
              <Input id="${email}" type="email" autoComplete="email" value={${email}} onChange={e => set${Email}(e.target.value)} required />
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
            </div>${
              fieldInputs
                ? `
            {mode === "register" ? (
              <>
${fieldInputs}
              </>
            ) : null}`
                : ""
            }
            <ErrorNote error={error} />
            <Button type="submit" disabled={pending}>
              {mode === "login" ? "Sign in" : "Register"}
            </Button>
            <Button type="button" variant="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "No account yet? Register" : "Have an account? Sign in"}
            </Button>
          </form>`
            : ""
        }${
          magic
            ? `
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
          </form>`
            : ""
        }${
          oauth.length
            ? `
          <div className="grid gap-2">
${oauth
  .map(
    p => `            <a className={buttonVariants({ variant: "outline" })} href="/api/auth/oauth/${(p as { name: string }).name}">
              Continue with ${(p as { name: string }).name}
            </a>`
  )
  .join("\n")}
          </div>`
            : ""
        }
        </CardContent>
      </Card>
    </div>
  );
}`;
}

/** The sidebar scaffold: pages with icons, a fixed footer with the user menu and settings */
function sidebarScaffold(ir: IR, target: WebTarget, conv: TsConventions): string {
  const client = conv.generated("app/client");
  const nav = conv.generated("app/nav");
  const ui = (name: string) => `@/components/ui/${name}`;
  const next = target.kind === "next";
  const linkTo = (expr: string) => (next ? `href={${expr}}` : `to={${expr}}`);
  const activeDecl = target.activeDecl;
  const isActive = (pathExpr: string) =>
    next
      ? `pathname === ${pathExpr} || pathname.startsWith(${pathExpr} + "/")`
      : `Boolean(matchRoute({ to: ${pathExpr}, fuzzy: true }))`;
  const routerImports = target.routerImports({ link: true, pathname: true, navigate: Boolean(ir.auth) });
  const footer = ir.auth ? authFooter(ir, target) : plainFooter(target);
  return `${conv.scaffoldHeader("The sidebar: the app's pages, and a fixed footer with the signed-in user and settings. Its data comes from generated/app/nav.ts, so new pages appear here without edits.")}
"use client";
${ir.auth ? `import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";\n` : ""}${routerImports.join("\n")}
import { ${ir.auth ? "ChevronsUpDown, LogIn, LogOut, " : ""}Settings } from "lucide-react";
${
  ir.auth
    ? `import { Avatar, AvatarFallback } from "${ui("avatar")}";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "${ui("dropdown-menu")}";
`
    : ""
}import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger
} from "${ui("sidebar")}";
${ir.auth ? `import { client, sessionUser } from "${client}";\nimport { APP_TITLE, SIDEBAR, canOpen, userInitials, userName, userSubtitle } from "${nav}";` : `import { APP_TITLE, SIDEBAR, canOpen } from "${nav}";`}${
    ir.app?.tenant ? `\nimport { TenantSwitcher } from "${conv.generated("app/tenant")}";` : ""
  }

export function AppSidebar() {
  ${activeDecl}${
    ir.auth
      ? `
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);`
      : `
  const user = null;`
  }
  if (!SIDEBAR) return null;
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <Link
            ${next ? 'href="/"' : 'to="/"'}
            className="flex min-w-0 flex-1 items-center rounded-md px-2 py-1 text-sm font-semibold group-data-[collapsible=icon]:hidden"
          >
            {APP_TITLE}
          </Link>
          <SidebarTrigger />
        </div>${ir.app?.tenant ? "\n        <TenantSwitcher />" : ""}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {SIDEBAR.items.filter(item => canOpen(item.access, user)).map(item => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    render={<Link ${linkTo("item.path")} />}
                    isActive={${isActive("item.path")}}
                    tooltip={item.label}
                  >
                    {item.icon ? <item.icon /> : null}
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavFooter />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

${footer}`;
}

function authFooter(ir: IR, target: WebTarget): string {
  const next = target.kind === "next";
  return `/** The fixed footer: who is signed in (with sign out) and the settings link */
function NavFooter() {
  ${target.activeDecl}
  ${target.navigateDecl}
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const logout = useMutation({
    mutationFn: () => client.auth.logout(),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await ${target.navigateTo("/")};
    }
  });
  if (!SIDEBAR) return null;
  const user = sessionUser(session.data);
  const settingsActive = ${target.isActive("/settings")};
  return (
    <SidebarMenu>
      <SidebarMenuItem className="flex items-center gap-1">
        {SIDEBAR.footer.user ? (
          user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuButton size="lg" className="flex-1 data-[popup-open]:bg-sidebar-accent" />}
              >
                <Avatar size="sm" className="rounded-md">
                  <AvatarFallback className="rounded-md text-xs">{userInitials(user)}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{userName(user)}</span>
                  <span className="truncate text-xs text-muted-foreground">{userSubtitle(user)}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                {SIDEBAR.footer.settings ? (
                  <DropdownMenuItem render={<Link ${next ? 'href="/settings"' : 'to="/settings"'} />}>
                    <Settings />
                    Settings
                  </DropdownMenuItem>
                ) : null}
                {SIDEBAR.footer.settings ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onClick={() => logout.mutate()}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <SidebarMenuButton render={<Link ${next ? 'href="/login"' : 'to="/login"'} />} className="flex-1" tooltip="Sign in">
              <LogIn />
              <span>Sign in</span>
            </SidebarMenuButton>
          )
        ) : null}
        {SIDEBAR.footer.settings ? (
          <SidebarMenuButton
            render={<Link ${next ? 'href="/settings"' : 'to="/settings"'} />}
            isActive={settingsActive}
            tooltip="Settings"
            aria-label="Settings"
            className={SIDEBAR.footer.user ? "w-auto shrink-0" : undefined}
          >
            <Settings />
            {SIDEBAR.footer.user ? null : <span>Settings</span>}
          </SidebarMenuButton>
        ) : null}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
`;
}

function plainFooter(target: WebTarget): string {
  const next = target.kind === "next";
  return `/** The fixed footer: the settings link (the model has no auth, so nobody signs in) */
function NavFooter() {
  ${target.activeDecl}
  if (!SIDEBAR?.footer.settings) return null;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          render={<Link ${next ? 'href="/settings"' : 'to="/settings"'} />}
          isActive={${target.isActive("/settings")}}
          tooltip="Settings"
        >
          <Settings />
          <span>Settings</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
`;
}

/**
 * What differs between the two web stacks when the same page code is emitted: the router. TanStack
 * Router (Vite) and the Next.js App Router link, read params and navigate differently; everything
 * else (TanStack Query, shadcn/ui, the generated client) is the same.
 */
export interface WebTarget {
  kind: "tanstack" | "next";
  /** The import lines the page needs for the router features it uses */
  routerImports(need: {
    link?: boolean;
    params?: boolean;
    navigate?: boolean;
    outlet?: boolean;
    pathname?: boolean;
  }): string[];
  /** JSX attributes of a link to a page path; `idExpr` fills a `$id` segment */
  linkAttrs(path: string, idExpr?: string): string;
  /** Statements that make `isActive(href)` available in a component (for the selected row) */
  activeDecl: string;
  /** An expression telling whether the link to `path` (with `idExpr`) is the current location */
  isActive(path: string, idExpr?: string): string;
  /** A statement reading the `id` route param into `rawId` */
  useIdParam(path: string): string;
  /** A statement that makes navigation available in the component */
  navigateDecl: string;
  /** An expression (awaitable) that navigates to a page path */
  navigateTo(path: string, idExpr?: string): string;
  /** What a layout component renders where its child route goes */
  outlet: string;
  /** The props a layout component declares, given its children */
  layoutProps: string;
  /** The type of a nav path: every route for TanStack, any string for Next */
  routePathType: string;
  /** Import line for that type, if any */
  routePathImport: string;
  /** Where `@/` points: the src directory (Vite) or the project root (Next); shadcn's components sit under it either way */
  componentsRoot: string;
}

/** `$id` in a page path becomes the parameter in each router's spelling */
export function idPath(path: string, idExpr: string | undefined, target: WebTarget["kind"]): string {
  if (idExpr === undefined) return `"${path}"`;
  if (target === "tanstack") return `"${path}/$id"`;
  return `\`${path}/\${${idExpr}}\``;
}

export const TANSTACK: WebTarget = {
  kind: "tanstack",
  routerImports: need => {
    const names = [
      ...(need.link ? ["Link"] : []),
      ...(need.outlet ? ["Outlet"] : []),
      ...(need.pathname ? ["useMatchRoute"] : []),
      ...(need.navigate ? ["useNavigate"] : []),
      ...(need.params ? ["useParams"] : [])
    ];
    return names.length ? [`import { ${names.join(", ")} } from "@tanstack/react-router";`] : [];
  },
  linkAttrs: (path, idExpr) => (idExpr === undefined ? `to="${path}"` : `to="${path}/$id" params={{ id: ${idExpr} }}`),
  activeDecl: "const matchRoute = useMatchRoute();",
  isActive: (path, idExpr) =>
    idExpr === undefined
      ? `Boolean(matchRoute({ to: "${path}" }))`
      : `Boolean(matchRoute({ to: "${path}/$id", params: { id: ${idExpr} } }))`,
  useIdParam: path => `const { id: rawId } = useParams({ from: "${path}/$id" });`,
  navigateDecl: "const navigate = useNavigate();",
  navigateTo: (path, idExpr) =>
    idExpr === undefined ? `navigate({ to: "${path}" })` : `navigate({ to: "${path}/$id", params: { id: ${idExpr} } })`,
  outlet: "<Outlet />",
  layoutProps: "",
  routePathType: 'FileRouteTypes["to"]',
  routePathImport: 'import type { FileRouteTypes } from "@/routeTree.gen";',
  componentsRoot: "@"
};

export const NEXT_APP: WebTarget = {
  kind: "next",
  routerImports: need => {
    const lines: string[] = [];
    if (need.link) lines.push(`import Link from "next/link";`);
    const nav = [
      ...(need.params ? ["useParams"] : []),
      ...(need.pathname ? ["usePathname"] : []),
      ...(need.navigate ? ["useRouter"] : [])
    ];
    if (nav.length) lines.push(`import { ${nav.join(", ")} } from "next/navigation";`);
    return lines;
  },
  linkAttrs: (path, idExpr) => (idExpr === undefined ? `href="${path}"` : `href={\`${path}/\${${idExpr}}\`}`),
  activeDecl: "const pathname = usePathname();",
  isActive: (path, idExpr) =>
    idExpr === undefined ? `pathname === "${path}"` : `pathname === \`${path}/\${${idExpr}}\``,
  useIdParam: () => `const { id: rawId } = useParams<{ id: string }>();`,
  navigateDecl: "const router = useRouter();",
  navigateTo: (path, idExpr) =>
    idExpr === undefined ? `router.push("${path}")` : `router.push(\`${path}/\${${idExpr}}\`)`,
  outlet: "{children}",
  layoutProps: "{ children }: { children: ReactNode }",
  routePathType: "string",
  routePathImport: "",
  componentsRoot: "@"
};

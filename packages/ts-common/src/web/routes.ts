import type { GeneratedFile, IR, PageIR } from "@osl/core";
import { toPascalCase } from "@osl/core";
import type { TsConventions } from "../conventions.js";
import type { WebTarget } from "./target.js";

/** Component name prefix of a page: posts -> Posts */
export function pageComponent(page: PageIR): string {
  return toPascalCase(page.name);
}

/** TanStack flat route file base name for a path: /posts -> posts, /admin/users -> admin.users */
export function routeFileBase(path: string): string {
  return path.split("/").filter(Boolean).join(".") || "index";
}

/** Next.js app directory folder for a path: /admin/users -> admin/users; / -> "" */
export function nextFolder(path: string): string {
  return path.split("/").filter(Boolean).join("/");
}

/** The Next.js page file of a path under the app shell: / -> app/(app)/page.tsx */
export function nextPageFile(path: string): string {
  const folder = nextFolder(path);
  return `app/(app)/${folder ? `${folder}/` : ""}page.tsx`;
}

/** The base path of a detail page: its path without the trailing /:id */
export function detailBase(page: PageIR): string {
  return page.path.replace(/\/:id$/, "");
}

/**
 * The TanStack route id of a detail page that sits under a dashboard or custom page's path. Its route file is
 * flat (`about_.$id.tsx`), so the row does not render inside that page; the address stays `<base>/$id`.
 * Undefined when the route id is the address.
 */
export function detailRouteId(ir: IR, page: PageIR): string | undefined {
  const base = detailBase(page);
  const under = (ir.app?.pages ?? []).some(p => (p.kind === "dashboard" || p.kind === "custom") && p.path === base);
  return under ? `${base}_/$id` : undefined;
}

/** The route files of a resource page (generated, rewritten) */
export function resourceRouteFiles(ir: IR, page: PageIR, target: WebTarget, conv: TsConventions): GeneratedFile[] {
  const Comp = pageComponent(page);
  const module = conv.generated(`app/pages/${page.name}`);
  const resource = ir.resources.find(r => r.name === page.resource)!;
  const hasCreate = resource.operations.some(o => o.kind === "create" && o.rule.kind !== "none");
  const header = (what: string, file = page.name) =>
    conv.header(`${what}; the component lives in generated/app/pages/${file}.tsx.`);
  // A detail page that takes over this page's detail renders at the row's route
  const taking = page.detailPage ? ir.app!.pages.find(p => p.name === page.detailPage)! : null;
  const detail = taking
    ? {
        component: `${pageComponent(taking)}Page`,
        module: conv.generated(`app/pages/${taking.name}`),
        file: taking.name
      }
    : { component: `${Comp}Detail`, module, file: page.name };
  if (target.kind === "tanstack") {
    const base = routeFileBase(page.path);
    const route = (suffix: string, routePath: string, component: string, from = { module, file: page.name }) => ({
      path: `src/routes/${base}${suffix}.tsx`,
      content: `${header(`Route ${routePath}`, from.file)}
import { createFileRoute } from "@tanstack/react-router";
import { ${component} } from "${from.module}";

export const Route = createFileRoute(${JSON.stringify(routePath)})({ component: ${component} });
`
    });
    return [
      route("", page.path, `${Comp}Layout`),
      route(".index", `${page.path}/`, `${Comp}Index`),
      ...(hasCreate ? [route(".new", `${page.path}/new`, `${Comp}New`)] : []),
      route(".$id", `${page.path}/$id`, detail.component, detail)
    ];
  }
  const folder = `app/(app)/${nextFolder(page.path)}`;
  const file = (rel: string, body: string, what: string): GeneratedFile => ({
    path: `${folder}/${rel}`,
    content: `${header(what)}\n${body}`
  });
  return [
    file(
      "layout.tsx",
      `import type { ReactNode } from "react";
import { ${Comp}Layout } from "${module}";

export default function Layout({ children }: { children: ReactNode }) {
  return <${Comp}Layout>{children}</${Comp}Layout>;
}
`,
      `Layout for ${page.path}`
    ),
    file(
      "page.tsx",
      `import { ${Comp}Index } from "${module}";\n\nexport default function Page() {\n  return <${Comp}Index />;\n}\n`,
      `Page ${page.path}`
    ),
    ...(hasCreate
      ? [
          file(
            "new/page.tsx",
            `import { ${Comp}New } from "${module}";\n\nexport default function Page() {\n  return <${Comp}New />;\n}\n`,
            `Page ${page.path}/new`
          )
        ]
      : []),
    {
      path: `${folder}/[id]/page.tsx`,
      content: `${header(`Page ${page.path}/{id}`, detail.file)}\nimport { ${detail.component} } from "${detail.module}";\n\nexport default function Page() {\n  return <${detail.component} />;\n}\n`
    }
  ];
}

/**
 * The route file of a detail page with an address of its own (generated). A page that takes over a resource
 * page's detail has none: that page's route files render it.
 */
export function detailRouteFile(ir: IR, page: PageIR, target: WebTarget, conv: TsConventions): GeneratedFile | null {
  if (page.listPage) return null;
  const component = `${pageComponent(page)}Page`;
  const module = conv.generated(`app/pages/${page.name}`);
  const base = detailBase(page);
  if (target.kind === "tanstack") {
    const routeId = detailRouteId(ir, page);
    return {
      path: `src/routes/${routeFileBase(base)}${routeId ? "_" : ""}.$id.tsx`,
      content: `${conv.header(`Route ${base}/$id; the component lives in generated/app/pages/${page.name}.tsx.`)}
import { createFileRoute } from "@tanstack/react-router";
import { ${component} } from "${module}";

export const Route = createFileRoute(${JSON.stringify(routeId ?? `${base}/$id`)})({ component: ${component} });
`
    };
  }
  return {
    path: `app/(app)/${nextFolder(base)}/[id]/page.tsx`,
    content: `${conv.header(`Page ${base}/{id}; the component lives in generated/app/pages/${page.name}.tsx.`)}
import { ${component} } from "${module}";

export default function Page() {
  return <${component} />;
}
`
  };
}

/** The route file of a dashboard page (generated) */
export function dashboardRouteFile(page: PageIR, target: WebTarget, conv: TsConventions): GeneratedFile {
  const Comp = pageComponent(page);
  const module = conv.generated(`app/pages/${page.name}`);
  if (target.kind === "tanstack") {
    return {
      path: `src/routes/${routeFileBase(page.path)}.tsx`,
      content: `${conv.header(`Route ${page.path}; the component lives in generated/app/pages/${page.name}.tsx.`)}
import { createFileRoute } from "@tanstack/react-router";
import { ${Comp}Page } from "${module}";

export const Route = createFileRoute(${JSON.stringify(page.path)})({ component: ${Comp}Page });
`
    };
  }
  return {
    path: nextPageFile(page.path),
    content: `${conv.header(`Page ${page.path}; the component lives in generated/app/pages/${page.name}.tsx.`)}
import { ${Comp}Page } from "${module}";

export default function Page() {
  return <${Comp}Page />;
}
`
  };
}

/** A custom page: a scaffold you fill in */
export function customPageScaffold(page: PageIR, target: WebTarget, conv: TsConventions): GeneratedFile {
  const component = `${pageComponent(page)}Page`;
  const body = `function ${component}() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight">${page.title}</h1>
      <p className="mt-2 text-muted-foreground">${page.description ?? "This page is yours: OSL created it once and never rewrites it."}</p>
    </div>
  );
}`;
  if (target.kind === "tanstack") {
    return {
      path: `src/routes/${routeFileBase(page.path)}.tsx`,
      mode: "scaffold",
      content: `${conv.scaffoldHeader(`The ${page.title} page, declared as a custom page in the model.`)}
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(${JSON.stringify(page.path)})({ component: ${component} });

${body}
`
    };
  }
  return {
    path: nextPageFile(page.path),
    mode: "scaffold",
    content: `${conv.scaffoldHeader(`The ${page.title} page, declared as a custom page in the model.`)}
export default ${body}
`
  };
}

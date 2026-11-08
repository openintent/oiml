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
  return path.split("/").filter(Boolean).join(".");
}

/** Next.js app directory folder for a path: /admin/users -> admin/users */
export function nextFolder(path: string): string {
  return path.split("/").filter(Boolean).join("/");
}

/** The route files of a resource page (generated, rewritten) */
export function resourceRouteFiles(ir: IR, page: PageIR, target: WebTarget, conv: TsConventions): GeneratedFile[] {
  const Comp = pageComponent(page);
  const module = conv.generated(`app/pages/${page.name}`);
  const resource = ir.resources.find(r => r.name === page.resource)!;
  const hasCreate = resource.operations.some(o => o.kind === "create" && o.rule.kind !== "none");
  const header = (what: string) => conv.header(`${what}; the component lives in generated/app/pages/${page.name}.tsx.`);
  if (target.kind === "tanstack") {
    const base = routeFileBase(page.path);
    const route = (suffix: string, routePath: string, component: string): GeneratedFile => ({
      path: `src/routes/${base}${suffix}.tsx`,
      content: `${header(`Route ${routePath}`)}
import { createFileRoute } from "@tanstack/react-router";
import { ${component} } from "${module}";

export const Route = createFileRoute(${JSON.stringify(routePath)})({ component: ${component} });
`
    });
    return [
      route("", page.path, `${Comp}Layout`),
      route(".index", `${page.path}/`, `${Comp}Index`),
      ...(hasCreate ? [route(".new", `${page.path}/new`, `${Comp}New`)] : []),
      route(".$id", `${page.path}/$id`, `${Comp}Detail`)
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
    file(
      "[id]/page.tsx",
      `import { ${Comp}Detail } from "${module}";\n\nexport default function Page() {\n  return <${Comp}Detail />;\n}\n`,
      `Page ${page.path}/{id}`
    )
  ];
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
    path: `app/(app)/${nextFolder(page.path)}/page.tsx`,
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
    path: `app/(app)/${nextFolder(page.path)}/page.tsx`,
    mode: "scaffold",
    content: `${conv.scaffoldHeader(`The ${page.title} page, declared as a custom page in the model.`)}
export default ${body}
`
  };
}

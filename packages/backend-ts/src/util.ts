import { conventions, type ServerConventions } from "@osl/ts-common";

export {
  cap,
  column,
  entityByName,
  enumExport,
  indent,
  q,
  relationsExport,
  singlePrimaryKey,
  tableExport,
  typeName
} from "@osl/ts-common";

/** `@/` is the project root in a Next.js app, so src and generated sit under it. */
export const NEXT = conventions("@osl/backend-drizzle-next", { src: "@/src", generated: "@/generated" });

/** The same conventions plus where the server modules live, for the shared server generators */
export const NEXT_SERVER: ServerConventions = { ...NEXT, errorsModule: "./http", authModule: "./auth" };

export const HEADER = NEXT.header;
export const SCAFFOLD_HEADER = NEXT.scaffoldHeader;

/** Path segments of a route like /api/posts/{id} as Next.js app router folders */
export function routeFolder(pathTemplate: string): string {
  return pathTemplate
    .split("/")
    .filter(Boolean)
    .map(seg => (seg.startsWith("{") ? `[${seg.slice(1, -1)}]` : seg))
    .join("/");
}

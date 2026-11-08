import type { GeneratedFile, IR } from "@osl/core";
import { HEADER } from "./util.js";

/** generated/files-api.ts: the REST handlers over the shared files core. */
export function filesApiFile(ir: IR): string {
  return `${HEADER("Files over REST: begin an upload, receive or redirect to its bytes, mark it complete, read its metadata.")}
import { Readable } from "node:stream";
import { z } from "zod";
import { checkRule, denied, type Rule } from "./access";
import { getSession } from "./auth";
import { beginUpload, completeUpload, fileContent, getFile, receiveContent } from "./files";
import { created, handleError, ok, parseBody } from "./http";

const UPLOAD: Rule = ${JSON.stringify(ir.files!.upload)};
const READ: Rule = ${JSON.stringify(ir.files!.read)};

const beginInput = z
  .object({ name: z.string().min(1).max(255), type: z.string().min(1).max(255), size: z.number().int().nonnegative() })
  .strict();

export type RouteContext = { params: Promise<{ id: string }> };

export const files = {
  /** POST /api/files: the file record and where to PUT its bytes */
  async begin(request: Request): Promise<Response> {
    try {
      const session = await getSession(request);
      const verdict = checkRule(UPLOAD, session);
      if (!verdict.ok) return denied(verdict);
      const body = await parseBody(beginInput, request);
      if (!body.ok) return body.response;
      const { file, upload } = await beginUpload(body.data, session);
      return created({ ...file, upload });
    } catch (err) {
      return handleError(err, "write");
    }
  },

  /** POST /api/files/{id}/complete */
  async complete(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const verdict = checkRule(UPLOAD, await getSession(request));
      if (!verdict.ok) return denied(verdict);
      return ok(await completeUpload((await ctx.params).id));
    } catch (err) {
      return handleError(err, "write");
    }
  },

  /** GET /api/files/{id} */
  async get(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const verdict = checkRule(READ, await getSession(request));
      if (!verdict.ok) return denied(verdict);
      return ok(await getFile((await ctx.params).id));
    } catch (err) {
      return handleError(err, "read");
    }
  },

  /** GET /api/files/{id}/content: the bytes from local storage, or a redirect to a signed S3 URL */
  async content(_request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const content = await fileContent((await ctx.params).id);
      if (content.kind === "redirect") return Response.redirect(content.url, 302);
      return new Response(Readable.toWeb(content.stream) as ReadableStream, {
        headers: {
          "content-type": content.type,
          "content-length": String(content.size),
          "content-disposition": content.disposition,
          "cache-control": "private, max-age=3600"
        }
      });
    } catch (err) {
      return handleError(err, "read");
    }
  },

  /** PUT /api/files/{id}/content: the bytes, for local storage */
  async receive(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      return ok(await receiveContent((await ctx.params).id, request.body));
    } catch (err) {
      return handleError(err, "write");
    }
  }
};
`;
}

export function filesRouteFiles(ir: IR): GeneratedFile[] {
  if (!ir.files) return [];
  const route = (folder: string, exports: { method: string; fn: string; ctx: boolean }[]) => ({
    path: `app/api/files/${folder ? folder + "/" : ""}route.ts`,
    content: `${HEADER(`Routes for /api/files${folder ? "/" + folder.replace(/\[id\]/g, "{id}") : ""}.`)}
import { files${exports.some(e => e.ctx) ? ", type RouteContext" : ""} } from "@/generated/files-api";

${exports
  .map(e =>
    e.ctx
      ? `export async function ${e.method}(request: Request, ctx: RouteContext): Promise<Response> {\n  return files.${e.fn}(request, ctx);\n}`
      : `export async function ${e.method}(request: Request): Promise<Response> {\n  return files.${e.fn}(request);\n}`
  )
  .join("\n\n")}
`
  });
  return [
    route("", [{ method: "POST", fn: "begin", ctx: false }]),
    route("[id]", [{ method: "GET", fn: "get", ctx: true }]),
    route("[id]/complete", [{ method: "POST", fn: "complete", ctx: true }]),
    route("[id]/content", [
      { method: "GET", fn: "content", ctx: true },
      { method: "PUT", fn: "receive", ctx: true }
    ])
  ];
}

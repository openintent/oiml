import { z } from "zod";

export const OIMLVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "semver required");
export const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "ISO8601 UTC required");
export type ISODate = z.infer<typeof ISODate>;

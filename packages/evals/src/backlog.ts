/**
 * The gap backlog, `evals/propose/gaps.yaml`: one entry per not_delivered cluster with a status the loop never
 * flips by itself. `pnpm evals:gaps` appends new clusters as open and refreshes counts; a person marks a gap
 * built (with the construct) or declined (with the reference sentence that says so). A built gap that reappears
 * is a regression.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { fromYaml, toYaml } from "@osl/core";
import { isTopic, type GapCluster, type GapKind } from "./gaps.js";

export const BACKLOG_FILE = "evals/propose/gaps.yaml";

export const GapStatus = z.enum(["open", "built", "declined"]);
export type GapStatus = z.infer<typeof GapStatus>;

export const BacklogEntry = z
  .object({
    key: z.string().min(1),
    kind: z.enum(["not_delivered", "check", "run", "handler", "validation"]).default("not_delivered"),
    status: GapStatus.default("open"),
    /** The run or round that first reported it */
    first_seen: z.string().min(1),
    /** The run or round that last reported it */
    last_seen: z.string().min(1),
    /** Distinct cases that hit it when it was last seen */
    cases: z.number().int().nonnegative().default(0),
    /** built: the construct that closed it */
    construct: z.string().optional(),
    /** built: the version it shipped in, or "unreleased" */
    version: z.string().optional(),
    /** declined: the reason, usually the reference sentence that now says so; open: anything worth remembering */
    note: z.string().optional()
  })
  .strict();
export type BacklogEntry = z.infer<typeof BacklogEntry>;

export const Backlog = z.object({ gaps: z.array(BacklogEntry).default([]) }).strict();
export type Backlog = z.infer<typeof Backlog>;

export async function loadBacklog(file: string): Promise<Backlog> {
  if (!existsSync(file)) return { gaps: [] };
  const parsed = Backlog.safeParse(fromYaml(await readFile(file, "utf8")) ?? {});
  if (!parsed.success)
    throw new Error(
      `${file}: ${parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`
    );
  return parsed.data;
}

export async function saveBacklog(file: string, backlog: Backlog): Promise<void> {
  const header =
    "# The gap backlog: what agents could not express, by cluster. pnpm evals:gaps appends new clusters as open and\n" +
    "# refreshes cases and last_seen; a person sets built (with construct and version) or declined (with the note).\n";
  await writeFile(file, header + toYaml(backlog));
}

export interface BacklogUpdate {
  backlog: Backlog;
  /** Clusters that were not in the backlog and are now open */
  added: BacklogEntry[];
  /** Built gaps that the clusters report again */
  regressions: BacklogEntry[];
}

/** The backlog key of a cluster: the kind and the topic or normalized text */
export function entryFor(backlog: Backlog, cluster: Pick<GapCluster, "key" | "kind">): BacklogEntry | undefined {
  return backlog.gaps.find(g => g.key === cluster.key && g.kind === cluster.kind);
}

/**
 * Fold a report's clusters into the backlog. Only not_delivered clusters are tracked: those are the asks the
 * model could not express; failures and invalid attempts are bugs or reference gaps, fixed rather than tracked.
 * A cluster keyed by a one-off line's wording (no topic matched) is tracked only once two cases share it, so
 * the backlog does not fill with rewordings; a person adds a topic to TOPICS when such a line recurs.
 */
export function updateBacklog(backlog: Backlog, clusters: GapCluster[], seenIn: string): BacklogUpdate {
  const next: Backlog = { gaps: backlog.gaps.map(g => ({ ...g })) };
  const added: BacklogEntry[] = [];
  const regressions: BacklogEntry[] = [];
  for (const cluster of clusters) {
    if (cluster.kind !== "not_delivered") continue;
    const existing = entryFor(next, cluster);
    if (!existing && !isTopic(cluster.key) && cluster.cases.length < 2) continue;
    if (existing) {
      existing.last_seen = seenIn;
      existing.cases = cluster.cases.length;
      if (existing.status === "built") regressions.push(existing);
      continue;
    }
    const entry: BacklogEntry = {
      key: cluster.key,
      kind: cluster.kind as GapKind,
      status: "open",
      first_seen: seenIn,
      last_seen: seenIn,
      cases: cluster.cases.length
    };
    next.gaps.push(entry);
    added.push(entry);
  }
  return { backlog: next, added, regressions };
}

/** "open since run6", "built: read_only (1.0.0-alpha.3)", "declined" */
export function statusText(entry: BacklogEntry): string {
  if (entry.status === "built") return `built: ${entry.construct ?? "?"}${entry.version ? ` (${entry.version})` : ""}`;
  if (entry.status === "declined") return "declined";
  return `open since ${entry.first_seen}`;
}

/** Open gaps, most cases first */
export function openGaps(backlog: Backlog): BacklogEntry[] {
  return backlog.gaps.filter(g => g.status === "open").sort((a, b) => b.cases - a.cases || a.key.localeCompare(b.key));
}

import type { DailySnapshot, Project } from "./project.ts";
import { withWorkspaceContent } from "./workspace.ts";

/** Back up the current text before replacing it, even when restoring today's snapshot. */
export function restoreWriting(project: Project, snapshot: DailySnapshot, now = new Date()): Project {
  if (snapshot.content === (project.workspace?.content ?? "")) return project;
  const backedUp: Project = { ...project, restorePoints: [...(project.restorePoints ?? []), {
    id: crypto.randomUUID(), content: project.workspace?.content ?? "", savedAt: now.toISOString(),
  }] };
  return withWorkspaceContent(backedUp, snapshot.content, now);
}

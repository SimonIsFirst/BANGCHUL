import { localDate, parseLocalDate, WORKSPACE_LIMIT } from "./project.ts";
import type { Project } from "./project.ts";

/** One atomic project update; notes and descriptions are never used as body text. */
export function withWorkspaceContent(project: Project, content: string, now = new Date()): Project {
  if (content.length > WORKSPACE_LIMIT) throw new Error("본문은 500,000자 이내로 작성해주세요.");
  if (content === (project.workspace?.content ?? "")) return project;
  const savedAt = now.toISOString();
  const date = localDate(now);
  return {
    ...project,
    updatedAt: savedAt,
    workspace: { content, updatedAt: savedAt },
    history: { ...project.history, [date]: { date, content, savedAt } },
  };
}

export function monthCells(month: string): (string | null)[] {
  const first = parseLocalDate(`${month}-01`);
  if (!first) return [];
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - first.getDay() + 1;
    return day >= 1 && day <= lastDay ? `${month}-${String(day).padStart(2, "0")}` : null;
  });
}

export function adjacentMonth(month: string, delta: number): string {
  const date = parseLocalDate(`${month}-01`);
  if (!date) return month;
  date.setMonth(date.getMonth() + delta);
  return localDate(date).slice(0, 7);
}

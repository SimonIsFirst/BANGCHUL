import type { MediaVersion, Project } from "./project.ts";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function withoutLocalFiles(source: Project): Project {
  const copy = { ...source }; delete copy.mediaVersions; delete copy.mediaHistory; delete copy.currentVersionId;
  if (copy.releaseArtifact) copy.releaseArtifact = { ...copy.releaseArtifact, versionId: undefined };
  return copy;
}
export function mappedImport(source: Project, files: MediaVersion[]): Project {
  const mapping = new Map<string, string>(); const versions: MediaVersion[] = [];
  for (const local of source.mediaVersions ?? []) {
    const remote = files.find((v) => v.sha256 === local.sha256 && v.size === local.size && v.mime === local.mime);
    if (!remote) throw new Error("아직 복사하지 못한 원본이 있어요. 가져오기를 계속해주세요.");
    mapping.set(local.id, remote.id); if (!versions.some((v) => v.id === remote.id)) versions.push(remote);
  }
  const copy = withoutLocalFiles(source);
  if (source.mediaVersions?.length) {
    copy.mediaVersions = versions; copy.currentVersionId = source.currentVersionId ? mapping.get(source.currentVersionId) : undefined;
    copy.mediaHistory = Object.fromEntries(Object.entries(source.mediaHistory ?? {}).map(([date, id]) => [date, mapping.get(id)!]));
    if (copy.releaseArtifact && source.releaseArtifact?.versionId) copy.releaseArtifact.versionId = mapping.get(source.releaseArtifact.versionId);
  }
  return copy;
}
export function sameImportedProject(a: Project | null, b: Project): boolean {
  const normalize = (p: Project | null) => p ? { ...p, ...(p.mediaVersions ? { mediaVersions: [...p.mediaVersions].sort((a,b) => a.id.localeCompare(b.id)) } : {}), ...(p.restorePoints ? { restorePoints: [...p.restorePoints].sort((a,b) => a.id.localeCompare(b.id)) } : {}) } : null;
  return canonical(normalize(a)) === canonical(normalize(b));
}
export interface ImportPlan { id: string; source: Project; status: "pending" | "complete"; files: MediaVersion[] }

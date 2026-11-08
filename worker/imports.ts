import type { ImportPlan } from "../src/domain/import-plan.ts";
import { canonical, mappedImport, withoutLocalFiles } from "../src/domain/import-plan.ts";
import type { MediaVersion, Project } from "../src/domain/project.ts";
import { validProject } from "../src/data/local-repository.ts";
import { readProject, writeProject } from "./database.ts";
import { quotaStatements } from "./quota.ts";
import { HttpError } from "./security.ts";
interface Row { id: string; owner_id: string; project_id: string; source: string; status: "pending" | "complete" }
async function plan(db: D1Database, bucket: R2Bucket, row: Row): Promise<ImportPlan> {
  const result = await db.prepare("SELECT metadata FROM file_versions WHERE project_id = ? AND status = 'ready'").bind(row.project_id).all<{ metadata: string }>();
  const files: MediaVersion[] = [];
  for (const value of result.results) {
    const version = JSON.parse(value.metadata) as MediaVersion;
    const heads = await Promise.all([version.originalKey, version.previewKey, version.thumbnailKey].filter((v): v is string => !!v).map((key) => bucket.head(key)));
    if (heads.every(Boolean) && heads[0]?.size === version.size) files.push(version);
  }
  return { id: row.id, source: JSON.parse(row.source), status: row.status, files };
}
export async function startImport(db: D1Database, bucket: R2Bucket, owner: string, source: unknown): Promise<ImportPlan> {
  if (!validProject(source)) throw new HttpError(400, "가져올 프로젝트를 확인해주세요.");
  const previous = await db.prepare("SELECT * FROM import_sessions WHERE project_id = ? AND owner_id = ?").bind(source.id, owner).first<Row>();
  if (previous) return plan(db, bucket, previous);
  const current = await readProject(db, owner); const stripped = withoutLocalFiles(source);
  if (current.state.project) {
    // Recover the exact partially imported v2.0 copy; never adopt an edited or unrelated account.
    const existing = current.state.project;
    if (canonical(withoutLocalFiles(existing)) !== canonical(stripped) || existing.currentVersionId || Object.keys(existing.mediaHistory ?? {}).length || existing.mediaVersions?.some((v) => !source.mediaVersions?.some((s) => s.sha256 === v.sha256 && s.size === v.size && s.mime === v.mime))) throw new HttpError(409, "계정에 다른 내용이 있어요. 기존 기록과 브라우저 원본을 보존했습니다.");
  }
  const row: Row = { id: crypto.randomUUID(), owner_id: owner, project_id: source.id, source: JSON.stringify(source), status: "pending" };
  const sourceBytes = new TextEncoder().encode(row.source).byteLength;
  await writeProject(db, owner, stripped, current.revision, { id: row.id, statements: [
    ...quotaStatements(db, [{ key: "text-bytes:global", amount: sourceBytes, max: 100 * 1024 * 1024 }]),
    db.prepare("INSERT INTO import_sessions (id, owner_id, project_id, source, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)").bind(row.id, owner, source.id, row.source, new Date().toISOString()),
  ] });
  return plan(db, bucket, row);
}
export async function completeImport(db: D1Database, bucket: R2Bucket, owner: string, id: string) {
  const row = await db.prepare("SELECT * FROM import_sessions WHERE id = ? AND owner_id = ?").bind(id, owner).first<Row>();
  if (!row) throw new HttpError(404, "가져오기 기록을 찾지 못했어요.");
  if (row.status === "complete") return readProject(db, owner);
  const job = await plan(db, bucket, row);
  let project: Project; try { project = mappedImport(job.source, job.files); } catch (cause) { throw new HttpError(409, (cause as Error).message); }
  const current = await readProject(db, owner);
  await writeProject(db, owner, project, current.revision, { id, statements: [db.prepare("UPDATE import_sessions SET status = 'complete', completed_at = ? WHERE id = ? AND owner_id = ?").bind(new Date().toISOString(), id, owner)] });
  return readProject(db, owner);
}

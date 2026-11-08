import { validProject } from "../src/data/local-repository.ts";
import { emptyState } from "../src/domain/project.ts";
import type { LocalState, MediaVersion, Project } from "../src/domain/project.ts";
import { HttpError } from "./security.ts";
import { quotaStatements } from "./quota.ts";
const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;

interface ProjectRow { id: string; owner_id: string; kind: string; metadata: string; revision: number; updated_at: string }
export async function owned(db: D1Database, ownerId: string, projectId: string) {
  const row = await db.prepare("SELECT * FROM projects WHERE id = ? AND owner_id = ?").bind(projectId, ownerId).first<ProjectRow>();
  if (!row) throw new HttpError(404, "프로젝트를 찾지 못했어요."); return row;
}
export async function readProject(db: D1Database, ownerId: string): Promise<{ state: LocalState; revision: number; importing?: boolean }> {
  let row = await db.prepare("SELECT * FROM projects WHERE owner_id = ?").bind(ownerId).first<ProjectRow>();
  if (!row) return { state: emptyState(), revision: 0 };
  const result = await db.batch([
    db.prepare("SELECT * FROM projects WHERE id = ? AND owner_id = ?").bind(row.id, ownerId),
    db.prepare("SELECT content, saved_at FROM workspaces WHERE project_id = ?").bind(row.id),
    db.prepare("SELECT date, content, saved_at FROM daily_history WHERE project_id = ? ORDER BY date").bind(row.id),
    db.prepare("SELECT id, content, saved_at FROM restore_backups WHERE project_id = ? ORDER BY saved_at, id").bind(row.id),
    db.prepare("SELECT metadata FROM file_versions WHERE project_id = ? AND status = 'ready' ORDER BY created_at, id").bind(row.id),
  ]);
  row = result[0].results[0] as unknown as ProjectRow;
  const workspace = result[1].results[0] as { content: string; saved_at: string } | undefined;
  const history = result[2] as unknown as D1Result<{ date: string; content: string; saved_at: string }>;
  const backups = result[3] as unknown as D1Result<{ id: string; content: string; saved_at: string }>;
  const files = result[4] as unknown as D1Result<{ metadata: string }>;
  const project = JSON.parse(row.metadata) as Project;
  if (workspace) project.workspace = { content: workspace.content, updatedAt: workspace.saved_at };
  if (history.results.length) project.history = Object.fromEntries(history.results.map((v) => [v.date, { date: v.date, content: v.content, savedAt: v.saved_at }]));
  if (backups.results.length) project.restorePoints = backups.results.map((v) => ({ id: v.id, content: v.content, savedAt: v.saved_at }));
  if (files.results.length) project.mediaVersions = files.results.map((v) => JSON.parse(v.metadata) as MediaVersion);
  const importing = await db.prepare("SELECT id FROM import_sessions WHERE project_id = ? AND owner_id = ? AND status = 'pending'").bind(row.id, ownerId).first();
  return { state: { ...emptyState(), project }, revision: row.revision, ...(importing ? { importing: true } : {}) };
}

/** The compare-and-swap statement is inside the atomic batch. Failed leases abort all history writes. */
export async function writeProject(db: D1Database, ownerId: string, project: unknown, revision: unknown, importing?: { id: string; statements: D1PreparedStatement[] }) {
  if (!validProject(project) || !Number.isSafeInteger(revision) || (revision as number) < 0) throw new HttpError(400, "저장할 작품 정보를 확인해주세요.");
  const expected = revision as number;
  const existing = await db.prepare("SELECT * FROM projects WHERE id = ? OR owner_id = ?").bind(project.id, ownerId).first<ProjectRow>();
  if (existing && (existing.owner_id !== ownerId || existing.id !== project.id)) throw new HttpError(409, "계정에 다른 프로젝트가 있어요. 기존 기록을 덮어쓰지 않았습니다.");
  if (existing && (existing.revision !== expected || existing.kind !== (project.kind ?? "writing"))) throw new HttpError(409, "다른 기기에서 수정된 내용이 있어요. 서버 기록을 덮어쓰지 않았습니다.");
  if (!existing && expected !== 0) throw new HttpError(409, "프로젝트 저장 상태가 달라요.");
  const pendingImport = await db.prepare("SELECT id FROM import_sessions WHERE project_id = ? AND status = 'pending'").bind(project.id).first<{ id: string }>();
  if (pendingImport && pendingImport.id !== importing?.id) throw new HttpError(409, "가져오기가 진행 중이에요. 원본이 있는 브라우저에서 가져오기를 계속해주세요.");
  const { workspace, history, restorePoints, mediaVersions, ...metadata } = project;
  const fileRows = await db.prepare("SELECT id, metadata FROM file_versions WHERE project_id = ? AND status = 'ready'").bind(project.id).all<{ id: string; metadata: string }>();
  const allowed = new Map(fileRows.results.map((v) => [v.id, JSON.parse(v.metadata)]));
  for (const version of mediaVersions ?? []) {
    const verified = allowed.get(version.id);
    if (!verified || Object.entries(version).some(([key, value]) => key !== "storedBytes" && verified[key] !== value)) throw new HttpError(400, "검증된 서버 파일만 연결할 수 있어요.");
  }
  if (project.currentVersionId && !allowed.has(project.currentVersionId)) throw new HttpError(400, "현재 파일의 권한을 확인하지 못했어요.");
  const now = new Date().toISOString();
  const statements = [db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").bind(ownerId, now)];
  if (!existing) statements.push(db.prepare("INSERT INTO projects (id, owner_id, kind, metadata, revision, updated_at) VALUES (?, ?, ?, ?, 1, ?)").bind(project.id, ownerId, project.kind ?? "writing", JSON.stringify(metadata), now));
  else {
    // A CHECK violation rolls back the entire batch if a concurrent save changed the revision.
    statements.push(db.prepare("UPDATE projects SET metadata = ?, revision = CASE WHEN revision = ? THEN revision + 1 ELSE -1 END, updated_at = ? WHERE id = ? AND owner_id = ?").bind(JSON.stringify(metadata), expected, now, project.id, ownerId));
  }
  if (workspace) statements.push(db.prepare("INSERT INTO workspaces (project_id, content, saved_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET content=excluded.content, saved_at=excluded.saved_at").bind(project.id, workspace.content, workspace.updatedAt));
  const oldHistory = existing ? await db.prepare("SELECT date, content, saved_at FROM daily_history WHERE project_id = ?").bind(project.id).all<{ date: string; content: string; saved_at: string }>() : { results: [] };
  const previous = new Map(oldHistory.results.map((v) => [v.date, v]));
  const oldWorkspace = existing ? await db.prepare("SELECT content FROM workspaces WHERE project_id = ?").bind(project.id).first<{ content: string }>() : null;
  const oldBackups = existing ? await db.prepare("SELECT id FROM restore_backups WHERE project_id = ?").bind(project.id).all<{ id: string }>() : { results: [] };
  const backupIds = new Set(oldBackups.results.map((v) => v.id));
  let additionalBytes = utf8Bytes(JSON.stringify(metadata)) - (existing ? utf8Bytes(existing.metadata ?? "") : 0);
  if (workspace) additionalBytes += utf8Bytes(workspace.content) - utf8Bytes(oldWorkspace?.content ?? "");
  for (const [date, snapshot] of Object.entries(history ?? {})) {
    const old = previous.get(date); if (old?.content === snapshot.content && old?.saved_at === snapshot.savedAt) continue;
    additionalBytes += utf8Bytes(snapshot.content) - utf8Bytes(old?.content ?? "");
    statements.push(db.prepare("INSERT INTO daily_history (project_id, date, content, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, date) DO UPDATE SET content=excluded.content, saved_at=excluded.saved_at").bind(project.id, date, snapshot.content, snapshot.savedAt));
  }
  for (const backup of restorePoints ?? []) if (!backupIds.has(backup.id)) {
    additionalBytes += utf8Bytes(backup.content);
    statements.push(db.prepare("INSERT INTO restore_backups (id, project_id, content, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(backup.id, project.id, backup.content, backup.savedAt));
  }
  statements.push(...quotaStatements(db, [
    { key: `text-bytes:${project.id}`, amount: additionalBytes, max: 8 * 1024 * 1024 },
    { key: "text-bytes:global", amount: additionalBytes, max: 100 * 1024 * 1024 },
    ...(!existing ? [{ key: "projects:global", amount: 1, max: 50 }] : []),
  ]));
  const artifact = project.releaseArtifact;
  if (artifact) statements.push(db.prepare("INSERT INTO release_artifacts (id, project_id, version_id, release_at, time_zone) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET version_id=excluded.version_id, release_at=excluded.release_at, time_zone=excluded.time_zone").bind(artifact.id, project.id, artifact.versionId ?? null, artifact.releaseAt, artifact.timeZone));
  statements.push(...(importing?.statements ?? []));
  if (statements.length > 250) throw new HttpError(413, "한 번에 옮길 수 있는 기록은 240개까지예요. 기존 기록은 그대로 보존됩니다.");
  try { await db.batch(statements); }
  catch { throw new HttpError(409, "저장 상태가 달라졌거나 저장에 실패했어요. 현재 입력과 서버 기록은 보존됩니다."); }
  return { revision: expected + 1 };
}

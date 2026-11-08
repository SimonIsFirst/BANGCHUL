import type { MediaVersion } from "../src/domain/project.ts";
import { DAILY_UPLOAD_LIMIT, fileError, hasFileSignature, MiB, originalKey, PROJECT_BYTES_LIMIT, PROJECT_FILE_LIMIT } from "../src/domain/media.ts";
import { owned } from "./database.ts";
import { HttpError, limitedBody, parseRange, validId } from "./security.ts";
import { quotaStatements } from "./quota.ts";
import { imageInfo, validateImage } from "../src/domain/image-validation.ts";
export { reserve } from "./quota.ts";
export async function uploadFile(request: Request, db: D1Database, bucket: R2Bucket, ownerId: string, projectId: string): Promise<MediaVersion> {
  const project = await owned(db, ownerId, projectId);
  if (project.kind !== "music" && project.kind !== "visual") throw new HttpError(400, "파일을 보관할 창작 분야를 확인해주세요.");
  const bytes = await limitedBody(request, 23 * MiB);
  const form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  const file: unknown = form.get("original"); if (!(file instanceof File)) throw new HttpError(400, "원본 파일을 선택해주세요.");
  const error = fileError(file, project.kind); if (error) throw new HttpError(400, error);
  const original = await file.arrayBuffer();
  if (!hasFileSignature(new Uint8Array(original), file.type)) throw new HttpError(400, "실제 파일 형식이 일치하지 않아요.");
  if (project.kind === "visual") try { await validateImage(new Uint8Array(original), file.type); } catch (cause) { throw new HttpError(400, (cause as Error).message); }
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", original))].map((v) => v.toString(16).padStart(2, "0")).join("");
  const find = () => db.prepare("SELECT metadata, status FROM file_versions WHERE project_id = ? AND sha256 = ?").bind(projectId, sha256).first<{ metadata: string; status: string }>();
  let previous = await find();
  const derivatives: { variant: string; bytes: ArrayBuffer }[] = [];
  if (project.kind === "visual") for (const variant of ["preview", "thumbnail"]) {
    const derivative: unknown = form.get(variant);
    if (!(derivative instanceof File) || derivative.type !== "image/webp" || derivative.size > (variant === "preview" ? 2 * MiB : .5 * MiB)) throw new HttpError(400, "안전한 이미지 미리보기를 확인하지 못했어요.");
    const data = await derivative.arrayBuffer();
    try { const info = imageInfo(new Uint8Array(data), "image/webp"); if (Math.max(info.width, info.height) > 1600) throw new Error(); }
    catch { throw new HttpError(400, "미리보기가 손상되었거나 허용 크기를 초과했어요."); }
    derivatives.push({ variant, bytes: data });
  }
  const id = crypto.randomUUID(); const base = `projects/${projectId}/versions/${id}`;
  const totalBytes = file.size + derivatives.reduce((n, d) => n + d.bytes.byteLength, 0);
  let version: MediaVersion = { id, projectId, kind: project.kind, filename: file.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "작품", mime: file.type as MediaVersion["mime"], size: file.size,
    storedBytes: totalBytes, sha256, originalKey: originalKey(projectId, id, file.type), ...(project.kind === "visual" ? { previewKey: `${base}/preview.webp`, thumbnailKey: `${base}/thumbnail.webp` } : {}), createdAt: new Date().toISOString() };
  const day = new Date().toISOString().slice(0, 10); const month = day.slice(0, 7);
  const limits = [
    { key: `bytes:${projectId}`, amount: totalBytes, max: PROJECT_BYTES_LIMIT }, { key: "bytes:global", amount: totalBytes, max: 512 * MiB },
    { key: `files:${projectId}`, amount: 1, max: PROJECT_FILE_LIMIT },
    { key: `uploads:${projectId}:${day}`, amount: 1, max: DAILY_UPLOAD_LIMIT }, { key: `uploads:global:${month}`, amount: 1, max: 500 },
  ];
  if (!previous) {
    try {
      // The quota and pending identity either both commit or both roll back.
      await db.batch([...quotaStatements(db, limits), db.prepare("INSERT INTO file_versions (id, project_id, metadata, sha256, bytes, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)").bind(id, projectId, JSON.stringify(version), sha256, totalBytes, version.createdAt)]);
    } catch {
      previous = await find();
      if (!previous) throw new HttpError(429, "저장 한도에 도달했거나 업로드를 예약하지 못했어요. 다시 시도해주세요.");
    }
  }
  if (previous) version = JSON.parse(previous.metadata);
  if (version.size !== file.size || version.mime !== file.type) throw new HttpError(409, "이 원본의 저장 정보를 확인하지 못했어요.");
  const objects = [{ key: version.originalKey, bytes: original, mime: version.mime }, ...derivatives.map((d) => ({ key: d.variant === "preview" ? version.previewKey! : version.thumbnailKey!, bytes: d.bytes, mime: "image/webp" }))];
  async function intact() {
    const heads = await Promise.all(objects.map((o) => bucket.head(o.key)));
    return heads.every(Boolean) && heads[0]!.size === version.size ? heads : null;
  }
  try {
    const existingHeads = await Promise.all(objects.map((o) => bucket.head(o.key)));
    if (previous?.status === "ready" && existingHeads.every(Boolean) && existingHeads[0]!.size === version.size) return version;
    if (existingHeads[0] && existingHeads[0].size !== version.size) throw new Error("Original size mismatch");
    const desired = objects.reduce((n, o, i) => n + (existingHeads[i]?.size ?? o.bytes.byteLength), 0);
    // Retried derivatives may differ in size. Reserve only an upward delta, atomically.
    const budget = [
      ...[ { key: `bytes:${projectId}`, max: PROJECT_BYTES_LIMIT, filter: "WHERE project_id = ?", args: [projectId] }, { key: "bytes:global", max: 512 * MiB, filter: "", args: [] } ].flatMap(({ key, max, filter, args }) => [
        db.prepare("INSERT INTO usage_limits (key, value) VALUES (?, 0) ON CONFLICT(key) DO NOTHING").bind(key),
        db.prepare(`UPDATE usage_limits SET value = CASE WHEN MAX(value, (SELECT COALESCE(SUM(bytes), 0) FROM file_versions ${filter})) + MAX(0, ? - (SELECT bytes FROM file_versions WHERE id = ?)) <= ? THEN MAX(value, (SELECT COALESCE(SUM(bytes), 0) FROM file_versions ${filter})) + MAX(0, ? - (SELECT bytes FROM file_versions WHERE id = ?)) ELSE -1 END WHERE key = ?`).bind(...args, desired, version.id, max, ...args, desired, version.id, key),
      ]),
      db.prepare("UPDATE file_versions SET bytes = MAX(bytes, ?) WHERE id = ?").bind(desired, version.id),
    ];
    await db.batch(budget);
    for (const [i, object] of objects.entries()) if (!existingHeads[i]) {
      // Concurrent retries never replace an object that another request already stored.
      await bucket.put(object.key, object.bytes, { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: object.mime, cacheControl: "private, no-store" }, customMetadata: { projectId, versionId: version.id } });
    }
    const heads = await intact(); if (!heads) throw new Error("Incomplete upload");
    version = { ...version, storedBytes: heads.reduce((n, h) => n + h!.size, 0) };
    await db.prepare("UPDATE file_versions SET metadata = ?, status = 'ready' WHERE id = ?").bind(JSON.stringify(version), version.id).run();
    return version;
  } catch {
    // A rejected acknowledgement does not prove rollback. Never delete a possibly committed original.
    try {
      const committed = await find();
      if (committed?.status === "ready" && await intact()) return JSON.parse(committed.metadata);
    } catch { /* Retain pending identity, objects and quota for the next idempotent retry. */ }
    throw new HttpError(503, "업로드가 중단됐어요. 보관된 원본은 유지됩니다. 같은 파일을 다시 선택하면 이어서 처리해요.");
  }
}
export async function serveFile(request: Request, db: D1Database, bucket: R2Bucket, ownerId: string, id: string, variant: string): Promise<Response> {
  if (!validId(id) || !["original", "preview", "thumbnail"].includes(variant)) throw new HttpError(404, "파일을 찾지 못했어요.");
  const row = await db.prepare("SELECT f.metadata FROM file_versions f JOIN projects p ON p.id = f.project_id WHERE f.id = ? AND p.owner_id = ? AND f.status = 'ready'").bind(id, ownerId).first<{ metadata: string }>();
  if (!row) throw new HttpError(404, "파일을 찾지 못했어요.");
  const version = JSON.parse(row.metadata) as MediaVersion;
  const key = variant === "original" ? version.originalKey : variant === "preview" ? version.previewKey : version.thumbnailKey;
  if (!key) throw new HttpError(404, "파일을 찾지 못했어요.");
  const metadata = await bucket.head(key); if (!metadata) throw new HttpError(404, "파일을 찾지 못했어요.");
  let range: ReturnType<typeof parseRange>;
  try { range = parseRange(request.headers.get("range"), metadata.size); }
  catch (cause) { if (cause instanceof HttpError && cause.status === 416) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${metadata.size}`, "Cache-Control": "private, no-store" } }); throw cause; }
  const download = new URL(request.url).searchParams.has("download");
  const headers = new Headers({ "Content-Type": variant === "original" ? version.mime : "image/webp", "Cache-Control": "private, no-store", "Vary": "Cookie", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition": `${download || (variant === "original" && version.kind === "visual") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(version.filename)}`,
    "Content-Length": String(range?.length ?? metadata.size) });
  if (range) headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const object = await bucket.get(key, range ? { range } : undefined);
  if (!object) throw new HttpError(404, "파일을 찾지 못했어요.");
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

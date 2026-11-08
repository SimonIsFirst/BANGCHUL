import type { MediaVersion } from "../src/domain/project.ts";
import { DAILY_UPLOAD_LIMIT, fileError, hasFileSignature, MiB, originalKey, PROJECT_BYTES_LIMIT, PROJECT_FILE_LIMIT } from "../src/domain/media.ts";
import { owned } from "./database.ts";
import { HttpError, limitedBody, parseRange, validId } from "./security.ts";
import { reserve } from "./quota.ts";
export { reserve } from "./quota.ts";
function webp(bytes: Uint8Array) { return bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"; }
export async function uploadFile(request: Request, db: D1Database, bucket: R2Bucket, ownerId: string, projectId: string): Promise<MediaVersion> {
  const project = await owned(db, ownerId, projectId);
  if (project.kind !== "music" && project.kind !== "visual") throw new HttpError(400, "파일을 보관할 창작 분야를 확인해주세요.");
  const bytes = await limitedBody(request, 23 * MiB);
  const form = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  const file: unknown = form.get("original"); if (!(file instanceof File)) throw new HttpError(400, "원본 파일을 선택해주세요.");
  const error = fileError(file, project.kind); if (error) throw new HttpError(400, error);
  const original = await file.arrayBuffer();
  if (!hasFileSignature(new Uint8Array(original), file.type)) throw new HttpError(400, "실제 파일 형식이 일치하지 않아요.");
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", original))].map((v) => v.toString(16).padStart(2, "0")).join("");
  const previous = await db.prepare("SELECT metadata, status FROM file_versions WHERE project_id = ? AND sha256 = ?").bind(projectId, sha256).first<{ metadata: string; status: string }>();
  if (previous?.status === "ready") return JSON.parse(previous.metadata);
  if (previous) throw new HttpError(409, "동일한 원본을 처리 중이에요. 잠시 후 다시 시도해주세요.");
  const derivatives: { variant: string; bytes: ArrayBuffer }[] = [];
  if (project.kind === "visual") for (const variant of ["preview", "thumbnail"]) {
    const derivative: unknown = form.get(variant);
    if (!(derivative instanceof File) || derivative.type !== "image/webp" || derivative.size > (variant === "preview" ? 2 * MiB : .5 * MiB)) throw new HttpError(400, "안전한 이미지 미리보기를 확인하지 못했어요.");
    const data = await derivative.arrayBuffer(); if (!webp(new Uint8Array(data))) throw new HttpError(400, "미리보기의 파일 형식이 올바르지 않아요.");
    derivatives.push({ variant, bytes: data });
  }
  const id = crypto.randomUUID(); const base = `projects/${projectId}/versions/${id}`;
  const totalBytes = file.size + derivatives.reduce((n, d) => n + d.bytes.byteLength, 0);
  const version: MediaVersion = { id, projectId, kind: project.kind, filename: file.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "작품", mime: file.type as MediaVersion["mime"], size: file.size,
    storedBytes: totalBytes, sha256, originalKey: originalKey(projectId, id, file.type), ...(project.kind === "visual" ? { previewKey: `${base}/preview.webp`, thumbnailKey: `${base}/thumbnail.webp` } : {}), createdAt: new Date().toISOString() };
  const day = new Date().toISOString().slice(0, 10); const month = day.slice(0, 7);
  await reserve(db, [
    { key: `bytes:${projectId}`, amount: totalBytes, max: PROJECT_BYTES_LIMIT }, { key: "bytes:global", amount: totalBytes, max: 512 * MiB },
    { key: `files:${projectId}`, amount: 1, max: PROJECT_FILE_LIMIT },
    { key: `uploads:${projectId}:${day}`, amount: 1, max: DAILY_UPLOAD_LIMIT }, { key: `uploads:global:${month}`, amount: 1, max: 500 },
  ]);
  const keys = [version.originalKey, ...derivatives.map((d) => `${base}/${d.variant}.webp`)];
  try {
    await db.prepare("INSERT INTO file_versions (id, project_id, metadata, sha256, bytes, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)").bind(id, projectId, JSON.stringify(version), sha256, totalBytes, version.createdAt).run();
    await bucket.put(version.originalKey, original, { httpMetadata: { contentType: version.mime, cacheControl: "private, no-store" }, customMetadata: { projectId, versionId: id, variant: "original" } });
    for (const d of derivatives) await bucket.put(`${base}/${d.variant}.webp`, d.bytes, { httpMetadata: { contentType: "image/webp", cacheControl: "private, no-store" } });
    await db.prepare("UPDATE file_versions SET status = 'ready' WHERE id = ? AND status = 'pending'").bind(id).run();
    return version;
  } catch {
    // Keep reservations if cleanup fails; an inaccessible orphan cannot free quota for unbounded abuse.
    try {
      await bucket.delete(keys);
      await db.batch([
        db.prepare("DELETE FROM file_versions WHERE id = ? AND status = 'pending'").bind(id),
        db.prepare("UPDATE usage_limits SET value = value - ? WHERE key IN (?, ?)").bind(totalBytes, `bytes:${projectId}`, "bytes:global"),
        db.prepare("UPDATE usage_limits SET value = value - 1 WHERE key = ?").bind(`files:${projectId}`),
      ]);
    } catch { /* Fail closed; maintenance can inspect pending versions and retained reservations. */ }
    throw new HttpError(503, "업로드를 완료하지 못했어요. 기존 원본은 그대로입니다. 다시 시도해주세요.");
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

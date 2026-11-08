import type { MediaVersion, Project } from "../domain/project";
import { fileError, hasFileSignature, originalKey, PROJECT_BYTES_LIMIT, PROJECT_FILE_LIMIT } from "../domain/media";
import { validateImage } from "../domain/image-validation";

interface StoredFile { key: string; projectId: string; blob: Blob }
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bangchul-private-media-v2", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("파일 저장소를 열지 못했어요. 브라우저 저장 권한을 확인해주세요."));
  });
}
async function storeFiles(items: StoredFile[]) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    for (const item of items) tx.objectStore("files").add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error("파일을 저장하지 못했어요. 저장 공간을 확인하고 다시 시도해주세요."));
  }); } finally { db.close(); }
}
export async function readLocalFile(projectId: string, key: string): Promise<Blob> {
  const db = await database();
  try { return await new Promise<Blob>((resolve, reject) => {
    const request = db.transaction("files").objectStore("files").get(key);
    request.onsuccess = () => request.result?.projectId === projectId ? resolve(request.result.blob) : reject(new Error("이 브라우저에서 원본 파일을 찾지 못했어요."));
    request.onerror = () => reject(new Error("파일을 읽지 못했어요."));
  }); } finally { db.close(); }
}
export async function removeLocalVersion(version: MediaVersion) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    [version.originalKey, version.previewKey, version.thumbnailKey].filter(Boolean).forEach((key) => tx.objectStore("files").delete(key!));
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error("파일 정리에 실패했어요."));
  }); } finally { db.close(); }
}
async function imageDerivatives(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("이미지는 4천만 화소 이하로 선택해주세요.");
    const resize = (max: number, quality: number) => new Promise<Blob>((resolve, reject) => {
      const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => blob?.type === "image/webp" ? resolve(blob) : reject(new Error("이 브라우저에서 WebP 미리보기를 만들지 못했어요. 최신 브라우저에서 다시 시도해주세요.")), "image/webp", quality);
    });
    return { preview: await resize(1600, .86), thumbnail: await resize(400, .8) };
  } finally { bitmap.close(); }
}
export interface PreparedUpload { original: File; preview?: Blob; thumbnail?: Blob; sha256: string }
export async function prepareUpload(file: File, project: Project): Promise<PreparedUpload> {
  const error = fileError(file, project.kind ?? "writing"); if (error) throw new Error(error);
  const bytes = await file.arrayBuffer();
  if (project.kind === "visual") await validateImage(new Uint8Array(bytes), file.type);
  if (!hasFileSignature(new Uint8Array(bytes), file.type)) throw new Error("실제 파일 형식이 확장자와 일치하지 않아요. 파일을 다시 내보내주세요.");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, "0")).join("");
  return { original: file, sha256, ...(project.kind === "visual" ? await imageDerivatives(file) : {}) };
}
export async function uploadLocal(project: Project, upload: PreparedUpload): Promise<MediaVersion> {
  const existing = project.mediaVersions?.find((item) => item.sha256 === upload.sha256);
  if (existing) return existing;
  const versions = project.mediaVersions ?? [];
  const additional = upload.original.size + (upload.preview?.size ?? 0) + (upload.thumbnail?.size ?? 0);
  if (versions.length >= PROJECT_FILE_LIMIT || versions.reduce((n, v) => n + (v.storedBytes ?? v.size), 0) + additional > PROJECT_BYTES_LIMIT)
    throw new Error("프로젝트당 50개 버전, 원본과 미리보기 합계 100MB까지 보관할 수 있어요.");
  const id = crypto.randomUUID(); const base = `projects/${project.id}/versions/${id}`;
  const version: MediaVersion = { id, projectId: project.id, kind: project.kind as "visual" | "music",
    filename: upload.original.name.slice(0, 255), mime: upload.original.type as MediaVersion["mime"],
    size: upload.original.size, storedBytes: additional, sha256: upload.sha256, originalKey: originalKey(project.id, id, upload.original.type),
    ...(upload.preview ? { previewKey: `${base}/preview.webp`, thumbnailKey: `${base}/thumbnail.webp` } : {}), createdAt: new Date().toISOString() };
  const items: StoredFile[] = [{ key: version.originalKey, projectId: project.id, blob: upload.original }];
  if (upload.preview && upload.thumbnail) items.push({ key: version.previewKey!, projectId: project.id, blob: upload.preview }, { key: version.thumbnailKey!, projectId: project.id, blob: upload.thumbnail });
  await storeFiles(items);
  return version;
}

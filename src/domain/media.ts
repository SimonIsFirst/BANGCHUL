import { localDate } from "./project.ts";
import type { CreativeKind, MediaVersion, Project } from "./project.ts";

export const MiB = 1024 * 1024;
export const IMAGE_LIMIT = 10 * MiB;
export const MUSIC_LIMIT = 20 * MiB;
export const PROJECT_BYTES_LIMIT = 100 * MiB;
export const PROJECT_FILE_LIMIT = 50;
export const DAILY_UPLOAD_LIMIT = 20;
export const KIND_LABELS: Record<CreativeKind, string> = { writing: "글", visual: "그림", music: "음악" };

export function fileError(file: { name: string; type: string; size: number }, kind: CreativeKind): string | null {
  if (file.size <= 0) return "비어 있는 파일은 올릴 수 없어요.";
  if (kind === "visual") {
    if (!/\.(jpe?g|png)$/i.test(file.name) || !["image/jpeg", "image/png"].includes(file.type))
      return "JPG 또는 PNG 이미지 파일을 선택해주세요.";
    if (file.size > IMAGE_LIMIT) return "이미지는 파일당 10MB까지 올릴 수 있어요.";
  } else if (kind === "music") {
    if (!/\.mp3$/i.test(file.name) || file.type !== "audio/mpeg") return "MP3 음원 파일을 선택해주세요.";
    if (file.size > MUSIC_LIMIT) return "음악은 파일당 20MB까지 올릴 수 있어요.";
  } else return "글 작업 공간에는 파일을 올릴 수 없어요.";
  return null;
}

/** Inspect bytes in addition to browser-supplied MIME and extension. No SVG/HTML accepted. */
export function hasFileSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "audio/mpeg") {
    const frame = (i: number) => bytes[i] === 255 && (bytes[i + 1] & 0xe0) === 0xe0 &&
      (bytes[i + 1] & 6) !== 0 && ((bytes[i + 2] >> 4) & 15) > 0 && ((bytes[i + 2] >> 4) & 15) < 15 &&
      ((bytes[i + 2] >> 2) & 3) !== 3;
    if (frame(0)) return true;
    if (bytes[0] !== 73 || bytes[1] !== 68 || bytes[2] !== 51 || bytes.length < 14) return false;
    if (![2, 3, 4].includes(bytes[3]) || bytes.slice(6, 10).some((n) => n > 127)) return false;
    const end = 10 + (bytes[6] << 21 | bytes[7] << 14 | bytes[8] << 7 | bytes[9]);
    return frame(end) || (bytes[3] === 4 && (bytes[5] & 0x10) !== 0 && frame(end + 10));
  }
  return false;
}

export function originalKey(projectId: string, versionId: string, mime: string) {
  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "mp3";
  return `projects/${projectId}/versions/${versionId}/original.${ext}`;
}
export function withMediaVersion(project: Project, version: MediaVersion, now = new Date()): Project {
  if (version.projectId !== project.id || version.kind !== (project.kind ?? "writing")) throw new Error("작품과 파일의 분야가 일치하지 않아요.");
  const versions = project.mediaVersions ?? [];
  const existing = versions.find((item) => item.sha256 === version.sha256);
  if (existing && project.currentVersionId === existing.id) return project;
  const chosen = existing ?? version;
  return { ...project, updatedAt: now.toISOString(),
    mediaVersions: existing ? versions : [...versions, version], currentVersionId: chosen.id,
    mediaHistory: { ...project.mediaHistory, [localDate(now)]: chosen.id } };
}
export function formatBytes(size: number) { return `${(size / MiB).toFixed(size < MiB ? 2 : 1)} MB`; }

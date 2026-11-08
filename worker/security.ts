export class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export interface Identity { id: string; displayName: string }
export function identity(request: Request, provider?: string): Identity | null {
  // Only Sites dispatch may establish these headers. Standalone deployments fail closed.
  if (provider !== "sites") return null;
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id || !email || id.length > 200) return null;
  let name = email;
  if (request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(request.headers.get("oai-authenticated-user-full-name") ?? "") || email; } catch { /* Use display-only fallback. */ }
  }
  return { id, displayName: name };
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site")
    throw new HttpError(403, "이 사이트에서 시작한 요청만 허용돼요.");
}
export async function limitedBody(request: Request, limit: number): Promise<Uint8Array> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) throw new HttpError(413, "요청 용량이 제한을 넘었어요.");
  const reader = request.body?.getReader(); if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, "요청 용량이 제한을 넘었어요."); }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
}
export function validId(value: string) { return /^[a-zA-Z0-9_-]{1,100}$/.test(value); }
export function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new HttpError(416, "올바르지 않은 재생 구간이에요.");
  let start: number; let end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new HttpError(416, "올바르지 않은 재생 구간이에요."); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) throw new HttpError(416, "재생 구간이 파일 범위를 벗어났어요.");
  return { offset: start, length: end - start + 1 };
}

import { readProject, writeProject } from "./database.ts";
import { reserve, serveFile, uploadFile } from "./files.ts";
import { assertSameOrigin, HttpError, identity, json, limitedBody, validId } from "./security.ts";
import { completeImport, startImport } from "./imports.ts";

export interface Env { DB?: D1Database; BUCKET?: R2Bucket; IDENTITY_PROVIDER?: string }
declare const STATIC_ASSETS: Record<string, { mime: string; body: string }>;
const encoder = new TextDecoder();
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
        const assets = typeof STATIC_ASSETS === "undefined" ? {} : STATIC_ASSETS;
        const asset = assets[url.pathname] ?? (url.pathname === "/" ? assets["/index.html"] : undefined);
        if (!asset) return new Response("Not found", { status: 404 });
        const bytes = Uint8Array.from(atob(asset.body), (c) => c.charCodeAt(0));
        return new Response(request.method === "HEAD" ? null : bytes, { headers: { "Content-Type": asset.mime, "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" } });
      }
      const user = identity(request, env.IDENTITY_PROVIDER);
      if (url.pathname === "/api/session" && request.method === "GET") return json({ user, available: !!env.DB && !!env.BUCKET && env.IDENTITY_PROVIDER === "sites", provider: env.IDENTITY_PROVIDER === "sites" ? "chatgpt" : null });
      if (!user) throw new HttpError(401, "로그인이 필요해요.");
      if (!env.DB || !env.BUCKET) throw new HttpError(503, "계정 저장소 연결을 준비 중이에요. 기존 브라우저 기록은 그대로 사용할 수 있어요.");
      if (!["GET", "HEAD"].includes(request.method)) {
        assertSameOrigin(request);
        await reserve(env.DB, [{ key: `writes:${user.id}:${Math.floor(Date.now() / 60_000)}`, amount: 1, max: 60 }, { key: `writes:global:${new Date().toISOString().slice(0, 10)}`, amount: 1, max: 7000 }]);
      }
      if (url.pathname === "/api/project" && request.method === "GET") return json(await readProject(env.DB, user.id));
      if (url.pathname === "/api/imports/start" && request.method === "POST") {
        const body = JSON.parse(encoder.decode(await limitedBody(request, 8 * 1024 * 1024))) as { source: unknown };
        return json(await startImport(env.DB, env.BUCKET, user.id, body.source));
      }
      const complete = /^\/api\/imports\/([^/]+)\/complete$/.exec(url.pathname);
      if (complete && validId(complete[1]) && request.method === "POST") return json(await completeImport(env.DB, env.BUCKET, user.id, complete[1]));
      if (url.pathname === "/api/project" && request.method === "PUT") {
        if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(415, "JSON 형식으로 저장해주세요.");
        const body = JSON.parse(encoder.decode(await limitedBody(request, 8 * 1024 * 1024))) as { project: unknown; revision: unknown };
        return json(await writeProject(env.DB, user.id, body.project, body.revision));
      }
      const upload = /^\/api\/projects\/([^/]+)\/files$/.exec(url.pathname);
      if (upload && request.method === "POST") {
        if (!validId(upload[1])) throw new HttpError(404, "프로젝트를 찾지 못했어요.");
        return json({ version: await uploadFile(request, env.DB, env.BUCKET, user.id, upload[1]) }, 201);
      }
      const file = /^\/api\/files\/([^/]+)\/(original|preview|thumbnail)$/.exec(url.pathname);
      if (file && ["GET", "HEAD"].includes(request.method)) return await serveFile(request, env.DB, env.BUCKET, user.id, file[1], file[2]);
      throw new HttpError(404, "요청한 기능을 찾지 못했어요.");
    } catch (cause) {
      if (cause instanceof HttpError) return json({ error: cause.message }, cause.status);
      if (cause instanceof SyntaxError || cause instanceof TypeError) return json({ error: "요청 형식을 확인해주세요." }, 400);
      return json({ error: "서버에서 처리하지 못했어요. 기존 기록을 유지하고 다시 시도해주세요." }, 503);
    }
  },
};

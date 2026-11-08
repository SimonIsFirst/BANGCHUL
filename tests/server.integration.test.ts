import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { getPlatformProxy } from "wrangler";
import worker from "../worker/index.ts";
import { createProject, emptyState } from "../src/domain/project.ts";
import type { Project } from "../src/domain/project.ts";
import { withWorkspaceContent } from "../src/domain/workspace.ts";
import { reserve } from "../worker/files.ts";
import { readProject, writeProject } from "../worker/database.ts";

let platform: Awaited<ReturnType<typeof getPlatformProxy>>;
let env: Parameters<typeof worker.fetch>[1];
const origin = "https://bangchul.test";
before(async () => {
  platform = await getPlatformProxy({ configPath: "wrangler.local.jsonc", persist: false });
  env = { ...platform.env, IDENTITY_PROVIDER: "sites" };
  for (const name of (await readdir("drizzle")).filter((v) => v.endsWith(".sql")).sort()) {
    for (const statement of (await readFile(`drizzle/${name}`, "utf8")).split("--> statement-breakpoint").map((v) => v.trim()).filter(Boolean)) await env.DB!.prepare(statement).run();
  }
});
after(async () => { await platform?.dispose(); });
const p = (kind: Project["kind"] = "writing") => createProject({ kind, name: "QA 가상 창작자", title: "QA 비공개 테스트", description: "운영 데이터와 무관한 가상 데이터", releaseDate: "2027-12-31", agreed: true }, new Date(2026, 10, 8));
function request(path: string, user?: string, init: RequestInit = {}) {
  return new Request(`${origin}${path}`, { ...init, headers: { origin, ...(user ? { "oai-authenticated-user-id": user, "oai-authenticated-user-email": `${user}@example.test` } : {}), ...init.headers } });
}
function save(project: Project, user: string, revision: number) {
  return worker.fetch(request("/api/project", user, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ project, revision }) }), env);
}
test("D1: legacy text, description, notes and history survive a verified copy without modifying the source", async () => {
  const source = withWorkspaceContent(p(), "  원본\n\n긴 문단\n".repeat(500), new Date(2026, 10, 8, 12)); delete source.kind;
  source.notes = [{ id: "legacy-note", text: "옛 메모", createdAt: "2026-10-01T00:00:00Z" }];
  const beforeCopy = JSON.stringify(source); assert.equal((await save(source, "writer", 0)).status, 200);
  assert.deepEqual((await readProject(env.DB!, "writer")).state.project, source); assert.equal(JSON.stringify(source), beforeCopy);
});
test("D1: missing identity, wrong owner, forged project IDs and deletion requests cannot modify another project", async () => {
  assert.equal((await worker.fetch(request("/api/project"), env)).status, 401);
  const own = (await readProject(env.DB!, "writer")).state.project!;
  assert.equal((await save({ ...own, description: "attacker" }, "other", 0)).status, 409);
  assert.equal((await worker.fetch(request(`/api/projects/${own.id}/files`, "other", { method: "POST", body: new FormData() }), env)).status, 404);
  assert.equal((await worker.fetch(request(`/api/projects/${own.id}`, "other", { method: "DELETE" }), env)).status, 404);
  assert.equal((await readProject(env.DB!, "other")).state.project, null);
  assert.notEqual((await readProject(env.DB!, "writer")).state.project!.description, "attacker");
});
test("D1: compare-and-swap rejects stale and simultaneous saves atomically", async () => {
  const saved = await readProject(env.DB!, "writer"); const old = saved.state.project!;
  const a = withWorkspaceContent(old, "동시 작업 A", new Date(2026, 10, 9)); const b = withWorkspaceContent(old, "동시 작업 B", new Date(2026, 10, 9));
  const results = await Promise.all([save(a, "writer", saved.revision), save(b, "writer", saved.revision)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const next = await readProject(env.DB!, "writer"); assert.equal(next.revision, saved.revision + 1);
  assert.equal(next.state.project!.workspace!.content, next.state.project!.history!["2026-11-09"].content);
  assert.equal((await save(old, "writer", saved.revision)).status, 409);
});
test("R2: image original, preview and thumbnail stay separate; duplicate content reuses a version", async () => {
  const project = p("visual"); assert.equal((await save(project, "artist", 0)).status, 200);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
  const webp = await readFile("public/art/threshold.webp");
  const form = () => { const data = new FormData(); data.append("original", new File([png], "原본.png", { type: "image/png" })); data.append("preview", new File([webp], "preview.webp", { type: "image/webp" })); data.append("thumbnail", new File([webp], "thumbnail.webp", { type: "image/webp" })); return data; };
  const first = await worker.fetch(request(`/api/projects/${project.id}/files`, "artist", { method: "POST", body: form() }), env);
  assert.equal(first.status, 201, await first.clone().text()); const version = (await first.json()).version;
  const duplicate = await worker.fetch(request(`/api/projects/${project.id}/files`, "artist", { method: "POST", body: form() }), env); assert.equal((await duplicate.json()).version.id, version.id);
  assert.notEqual(version.originalKey, version.previewKey); assert.notEqual(version.previewKey, version.thumbnailKey);
  const original = await worker.fetch(request(`/api/files/${version.id}/original`, "artist"), env);
  assert.equal(original.status, 200); assert.deepEqual(Buffer.from(await original.arrayBuffer()), png);
  assert.equal(original.headers.get("cache-control"), "private, no-store"); assert.ok(original.headers.get("content-disposition")!.startsWith("attachment"));
  assert.equal((await worker.fetch(request(`/api/files/${version.id}/original`), env)).status, 401);
  assert.equal((await worker.fetch(request(`/api/files/${version.id}/original`, "other"), env)).status, 404);
  const malicious = new FormData(); malicious.append("original", new File(["<html>fake</html>"], "fake.png", { type: "image/png" }));
  assert.equal((await worker.fetch(request(`/api/projects/${project.id}/files`, "artist", { method: "POST", body: malicious }), env)).status, 400);
  assert.equal((await env.DB!.prepare("SELECT COUNT(*) AS n FROM file_versions WHERE project_id=?").bind(project.id).first<{ n: number }>())!.n, 1);
});
test("R2: MP3 byte ranges and HEAD permit playback without publicly exposing originals", async () => {
  const project = p("music"); await save(project, "musician", 0);
  // A deterministic MPEG frame fixture exercises transfer/range handling; audible decoding is browser QA.
  const bytes = Uint8Array.from([255, 251, 144, 0, ...Array(1024).fill(0)]);
  const form = new FormData(); form.append("original", new File([bytes], "demo.mp3", { type: "audio/mpeg" }));
  const uploaded = await worker.fetch(request(`/api/projects/${project.id}/files`, "musician", { method: "POST", body: form }), env); assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const version = (await uploaded.json()).version;
  const range = await worker.fetch(request(`/api/files/${version.id}/original`, "musician", { headers: { range: "bytes=2-5" } }), env);
  assert.equal(range.status, 206); assert.equal(range.headers.get("content-range"), `bytes 2-5/${bytes.length}`); assert.deepEqual(new Uint8Array(await range.arrayBuffer()), bytes.slice(2, 6));
  const head = await worker.fetch(request(`/api/files/${version.id}/original`, "musician", { method: "HEAD" }), env); assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await worker.fetch(request(`/api/files/${version.id}/original`, "musician", { headers: { range: "bytes=9000-" } }), env)).status, 416);
});
test("R2: failed upload leaves prior originals intact and rolls back storage reservations", async () => {
  const project = p("music"); await save(project, "failure-test", 0);
  const failingEnv = { ...env, BUCKET: { put: async () => { throw new Error("injected failure"); }, delete: async () => {} } as unknown as NonNullable<typeof env.BUCKET> };
  const form = new FormData(); form.append("original", new File([Uint8Array.from([255, 251, 144, 0, 0, 1])], "demo.mp3", { type: "audio/mpeg" }));
  assert.equal((await worker.fetch(request(`/api/projects/${project.id}/files`, "failure-test", { method: "POST", body: form }), failingEnv)).status, 503);
  assert.equal((await env.DB!.prepare("SELECT COUNT(*) AS n FROM file_versions WHERE project_id=?").bind(project.id).first<{ n: number }>())!.n, 0);
  assert.equal((await env.DB!.prepare("SELECT value FROM usage_limits WHERE key=?").bind(`bytes:${project.id}`).first<{ value: number }>())!.value, 0);
});
test("quota reservations are atomic and cannot race past their cap", async () => {
  const attempts = await Promise.allSettled([reserve(env.DB!, [{ key: "test:atomic-quota", amount: 4, max: 5 }]), reserve(env.DB!, [{ key: "test:atomic-quota", amount: 4, max: 5 }])]);
  assert.equal(attempts.filter((v) => v.status === "fulfilled").length, 1);
  assert.equal((await env.DB!.prepare("SELECT value FROM usage_limits WHERE key='test:atomic-quota'").first<{ value: number }>())!.value, 4);
});
test("cross-origin writes, fake metadata and public release claims are rejected", async () => {
  const project = p();
  const badOrigin = request("/api/project", "security", { method: "PUT", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: JSON.stringify({ project, revision: 0 }) });
  assert.equal((await worker.fetch(badOrigin, env)).status, 403);
  const fileProject = p("visual"); fileProject.currentVersionId = "guessed";
  assert.equal((await save(fileProject, "security", 0)).status, 400);
  project.releaseArtifact = { id: "artifact", status: "private", releaseAt: project.releaseAt, timeZone: project.timeZone, autoReleaseConsent: false, salesEnabled: false };
  await writeProject(env.DB!, "security", project, 0);
  assert.deepEqual((await readProject(env.DB!, "security")).state, { ...emptyState(), project });
});

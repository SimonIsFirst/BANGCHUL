import test from "node:test";
import assert from "node:assert/strict";
import { createProject, emptyState } from "../src/domain/project.ts";
import type { MediaVersion, Project } from "../src/domain/project.ts";
import { fileError, hasFileSignature, originalKey, withMediaVersion, MiB } from "../src/domain/media.ts";
import { restoreWriting } from "../src/domain/restore.ts";
import { withWorkspaceContent } from "../src/domain/workspace.ts";
import { createCloudRepository } from "../src/data/cloud-repository.ts";
import { createLocalRepository, isLocalState, STORAGE_KEY } from "../src/data/local-repository.ts";
import { assertSameOrigin, identity, limitedBody, parseRange } from "../worker/security.ts";

const project = (kind: Project["kind"] = "writing") => createProject({ name: "창작자", title: "계절의 기록", description: "작은 작품", releaseDate: "2027-12-31", agreed: true, kind }, new Date(2026, 10, 8, 10));
function version(p: Project, n: string): MediaVersion { return { id: `version-${n}`, projectId: p.id, kind: p.kind as "visual", filename: "작품.png", mime: "image/png", size: 100, sha256: n.repeat(64), originalKey: originalKey(p.id, `version-${n}`, "image/png"), createdAt: "2026-11-08T01:00:00Z" }; }
function memory() { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; }

test("v2 accepts all creative kinds while preserving legacy key and records exactly", () => {
  for (const kind of ["writing", "visual", "music"] as const) assert.equal(project(kind).kind, kind);
  const old = project(); delete old.kind; const state = { ...emptyState(), project: withWorkspaceContent(old, "  원고\n\n둘째 문단  ") };
  const storage = memory(); const raw = JSON.stringify(state); storage.setItem(STORAGE_KEY, raw);
  assert.deepEqual(createLocalRepository(() => storage).load(), { ok: true, value: state });
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.equal(isLocalState({ ...state, project: { ...old, kind: "video" } }), false);
});
test("upload admission checks MIME, extension, empty bytes and per-format size", () => {
  assert.equal(fileError({ name: "a.png", type: "image/png", size: MiB }, "visual"), null);
  assert.equal(fileError({ name: "a.mp3", type: "audio/mpeg", size: 20 * MiB }, "music"), null);
  for (const file of [{ name: "a.svg", type: "image/svg+xml", size: 1 }, { name: "a.png", type: "text/html", size: 1 }, { name: "a.png", type: "image/png", size: 0 }, { name: "a.png", type: "image/png", size: 10 * MiB + 1 }]) assert.ok(fileError(file, "visual"));
  assert.ok(fileError({ name: "a.mp3", type: "audio/mpeg", size: 20 * MiB + 1 }, "music"));
});
test("actual signatures reject renamed HTML and ID3 tags without an MP3 frame", () => {
  assert.equal(hasFileSignature(new TextEncoder().encode("<html>fake</html>"), "image/png"), false);
  assert.equal(hasFileSignature(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"), true);
  assert.equal(hasFileSignature(Uint8Array.from([255, 216, 255, 224]), "image/jpeg"), true);
  assert.equal(hasFileSignature(Uint8Array.from([255, 251, 144, 0]), "audio/mpeg"), true);
  assert.equal(hasFileSignature(Uint8Array.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "audio/mpeg"), false);
});
test("media versions are immutable, deduplicated, project-scoped and one representative per local day", () => {
  const p = project("visual"); const first = version(p, "a"); const second = version(p, "b");
  const day1 = withMediaVersion(p, first, new Date(2026, 10, 8, 12));
  const day2 = withMediaVersion(day1, second, new Date(2026, 10, 9, 12));
  assert.equal(day1.mediaVersions!.length, 1); assert.equal(day2.mediaVersions!.length, 2);
  assert.deepEqual(day2.mediaHistory, { "2026-11-08": first.id, "2026-11-09": second.id });
  assert.equal(withMediaVersion(day2, second), day2);
  const restored = withMediaVersion(day2, first, new Date(2026, 10, 9, 13));
  assert.equal(restored.mediaVersions!.length, 2); assert.equal(restored.mediaHistory!["2026-11-09"], first.id);
  assert.equal(isLocalState({ ...emptyState(), project: restored }), true);
  assert.throws(() => withMediaVersion(project("visual"), first));
  assert.equal(isLocalState({ ...emptyState(), project: { ...restored, currentVersionId: "foreign" } }), false);
});
test("writing restore protects current text before replacing today's representative snapshot", () => {
  const current = withWorkspaceContent(project(), "현재 원고", new Date(2026, 10, 8, 12));
  const restored = restoreWriting(current, { date: "2026-11-07", content: "이전 원고", savedAt: "2026-11-07T01:00:00Z" }, new Date(2026, 10, 8, 13));
  assert.equal(restored.workspace!.content, "이전 원고"); assert.equal(restored.restorePoints![0].content, "현재 원고");
  assert.equal(current.workspace!.content, "현재 원고");
  assert.equal(restoreWriting(restored, { date: "2026-11-07", content: "이전 원고", savedAt: "2026-11-07T01:00:00Z" }), restored);
});
test("private release metadata cannot claim public, sales or automatic consent", () => {
  const p = project(); const artifact = { id: "artifact", status: "private", releaseAt: p.releaseAt, timeZone: p.timeZone, autoReleaseConsent: false, salesEnabled: false };
  assert.equal(isLocalState({ ...emptyState(), project: { ...p, releaseArtifact: artifact } }), true);
  for (const patch of [{ status: "public" }, { autoReleaseConsent: true }, { salesEnabled: true }]) assert.equal(isLocalState({ ...emptyState(), project: { ...p, releaseArtifact: { ...artifact, ...patch } } }), false);
});
test("cloud save preserves browser original and separates account caches", async () => {
  const storage = memory(); storage.setItem(STORAGE_KEY, "original"); const a = createCloudRepository("alice", { state: emptyState(), revision: 0 }, storage, async () => ({ revision: 1 }));
  a.repository.save({ ...emptyState(), project: project() }); await a.flush();
  assert.equal(a.getStatus().kind, "saved"); assert.equal(storage.getItem(STORAGE_KEY), "original");
  const b = createCloudRepository("bob", { state: emptyState(), revision: 0 }, storage); assert.equal(b.repository.load().ok && (b.repository.load() as { value: { project: null } }).value.project, null);
  assert.equal(a.repository.clear().ok, false); a.dispose(); b.dispose();
});
test("failed cloud writes keep pending backup; retry reports success only after real acknowledgement", async () => {
  const storage = memory(); let fail = true; const repo = createCloudRepository("alice", { state: emptyState(), revision: 0 }, storage, async () => { if (fail) throw new Error("offline"); return { revision: 1 }; });
  const state = { ...emptyState(), project: project() }; repo.repository.save(state);
  await assert.rejects(repo.flush()); assert.equal(repo.hasPending(), true); assert.equal(repo.getStatus().kind, "error"); assert.equal(JSON.parse(storage.getItem("bangchul:account:v2:alice")!).pending, true);
  fail = false; await repo.flush(); assert.equal(repo.hasPending(), false); repo.dispose();
});
test("concurrent edits during a cloud write are serialized with the returned revision", async () => {
  const storage = memory(); let unblock: (() => void) | undefined; const revisions: number[] = [];
  const repo = createCloudRepository("a", { state: emptyState(), revision: 0 }, storage, async (_p, revision) => { revisions.push(revision); if (!revision) await new Promise<void>((r) => { unblock = r; }); return { revision: revision + 1 }; });
  repo.repository.save({ ...emptyState(), project: project() }); const work = repo.flush();
  repo.repository.save({ ...emptyState(), project: project() }); unblock!(); await work;
  assert.deepEqual(revisions, [0, 1]); assert.equal(repo.hasPending(), false); repo.dispose();
});
test("a stale pending cache is never silently sent over another device's revision", async () => {
  const storage = memory(); const pending = { state: { ...emptyState(), project: project() }, revision: 2, pending: true };
  storage.setItem("bangchul:account:v2:a", JSON.stringify(pending)); let sent = 0;
  const repo = createCloudRepository("a", { state: emptyState(), revision: 3 }, storage, async () => { sent++; return { revision: 4 }; });
  await assert.rejects(repo.flush()); assert.equal(sent, 0); assert.equal(repo.repository.load().ok, true); assert.equal(repo.getStatus().kind, "error"); repo.dispose();
});
test("corrupt cloud backup and device quota errors cannot overwrite previous data", async () => {
  const storage = memory(); storage.setItem("bangchul:account:v2:a", "broken");
  const repo = createCloudRepository("a", { state: emptyState(), revision: 0 }, storage); assert.equal(repo.repository.load().ok, false); assert.equal(repo.repository.save(emptyState()).ok, false); assert.equal(storage.getItem("bangchul:account:v2:a"), "broken"); repo.dispose();
  const full = createCloudRepository("b", { state: emptyState(), revision: 0 }, { ...storage, setItem: () => { throw new Error("quota"); } });
  assert.equal(full.repository.save({ ...emptyState(), project: project() }).ok, false); assert.equal(full.hasPending(), false); full.dispose();
});
test("explicit server reload protects a verified copy of pending local data before replacing the cache", async () => {
  const storage = memory(); const pending = { state: { ...emptyState(), project: withWorkspaceContent(project(), "아직 보내지 않은 원고") }, revision: 2, pending: true };
  const raw = JSON.stringify(pending); storage.setItem("bangchul:account:v2:a", raw);
  const remote = { state: { ...emptyState(), project: withWorkspaceContent(project(), "다른 기기의 원고") }, revision: 3 };
  const old = createCloudRepository("a", remote, storage);
  const next = await old.replaceFromServer(async () => remote);
  assert.ok([...storage.data.entries()].some(([key, value]) => key.includes(":protected:") && value === raw));
  assert.deepEqual(next.repository.load(), { ok: true, value: remote.state }); assert.equal(next.hasPending(), false);
  old.dispose(); next.dispose();
});
test("identity fails closed outside Sites, and mutating requests require same-origin navigation", () => {
  const request = new Request("https://site.test/api/project", { headers: { "oai-authenticated-user-id": "a", "oai-authenticated-user-email": "a@example.test" } });
  assert.equal(identity(request, "disabled"), null); assert.equal(identity(request, "sites")?.id, "a");
  assert.throws(() => assertSameOrigin(request));
  assert.throws(() => assertSameOrigin(new Request(request, { headers: { origin: "https://evil.test" } })));
  assert.doesNotThrow(() => assertSameOrigin(new Request(request, { headers: { origin: "https://site.test" } })));
});
test("bounded request streams reject oversized bodies, even without a content-length header", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10)); controller.close(); } });
  await assert.rejects(limitedBody(new Request("https://site.test", { method: "POST", body, duplex: "half" } as RequestInit), 9));
});
test("audio ranges support start/end and suffix; invalid and multi-range requests reject", () => {
  assert.deepEqual(parseRange("bytes=2-5", 10), { offset: 2, length: 4 }); assert.deepEqual(parseRange("bytes=7-", 10), { offset: 7, length: 3 }); assert.deepEqual(parseRange("bytes=-3", 10), { offset: 7, length: 3 });
  assert.equal(parseRange(null, 10), null);
  for (const range of ["bytes=10-", "bytes=5-1", "bytes=0-1,3-4", "bytes=-0", "garbage"]) assert.throws(() => parseRange(range, 10));
});

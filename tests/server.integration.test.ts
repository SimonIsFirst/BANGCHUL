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
import { pngFixture } from "./image-fixtures.ts";
import { importProject } from "../src/data/import-project.ts";
import type { ImportPlan } from "../src/domain/import-plan.ts";
import { withoutLocalFiles } from "../src/domain/import-plan.ts";
import type { CloudSnapshot } from "../src/data/cloud-repository.ts";
import type { MediaVersion } from "../src/domain/project.ts";

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
  const png = pngFixture();
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
test("R2: failed upload retains a resumable version and retry does not reserve twice", async () => {
  const project = p("music"); await save(project, "failure-test", 0);
  const failingEnv = { ...env, BUCKET: new Proxy(env.BUCKET!, { get(target,key) { if (key === "put") return async () => { throw new Error("injected failure"); }; const value = Reflect.get(target,key); return typeof value === "function" ? value.bind(target) : value; } }) };
  const form = () => { const data = new FormData(); data.append("original", new File([Uint8Array.from([255, 251, 144, 0, 0, 1])], "demo.mp3", { type: "audio/mpeg" })); return data; };
  assert.equal((await worker.fetch(request(`/api/projects/${project.id}/files`, "failure-test", { method: "POST", body: form() }), failingEnv)).status, 503);
  const pending = await env.DB!.prepare("SELECT id,status FROM file_versions WHERE project_id=?").bind(project.id).first<{ id:string;status:string }>(); assert.equal(pending!.status,"pending");
  const readQuota = () => env.DB!.prepare("SELECT value FROM usage_limits WHERE key=?").bind(`bytes:${project.id}`).first<{ value: number }>(); const reserved = (await readQuota())!.value;
  assert.equal(reserved,6);
  const retried = await worker.fetch(request(`/api/projects/${project.id}/files`, "failure-test", { method: "POST", body: form() }), env);
  assert.equal(retried.status,201,await retried.clone().text()); assert.equal((await retried.json()).version.id,pending!.id); assert.equal((await readQuota())!.value,reserved);
  assert.equal((await worker.fetch(request(`/api/files/${pending!.id}/original`, "failure-test"),env)).status,200);
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

test("R3: committed ready update with a lost acknowledgement never deletes objects; retry serves real bytes",async()=>{
  const project=p("music");await save(project,"ack-loss-fix",0);
  let committed=false;let loseRecheck=true;let deleted=false;
  const db=new Proxy(env.DB!,{get(target,key){if(key==="prepare")return(sql:string)=>{
    if(sql.startsWith("UPDATE file_versions SET metadata = ?, status = 'ready'"))return{bind:(...args:unknown[])=>({run:async()=>{await target.prepare(sql).bind(...args).run();committed=true;throw new Error("lost acknowledgement after commit");}})};
    if(committed && loseRecheck && sql.startsWith("SELECT metadata, status FROM file_versions")){loseRecheck=false;throw new Error("temporary read failure");}
    return target.prepare(sql);
  };const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
  const bucket=new Proxy(env.BUCKET!,{get(target,key){if(key==="delete")return async()=>{deleted=true;throw new Error("must not delete")};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
  const bytes=Uint8Array.from([255,251,144,0,7,8,9]);const form=()=>{const data=new FormData();data.append("original",new File([bytes],"ack.mp3",{type:"audio/mpeg"}));return data};
  const first=await worker.fetch(request(`/api/projects/${project.id}/files`,"ack-loss-fix",{method:"POST",body:form()}),{...env,DB:db,BUCKET:bucket});assert.equal(first.status,503);
  const row=await env.DB!.prepare("SELECT id,status FROM file_versions WHERE project_id=?").bind(project.id).first<{id:string;status:string}>();assert.equal(row!.status,"ready");assert.equal(deleted,false);
  const retry=await worker.fetch(request(`/api/projects/${project.id}/files`,"ack-loss-fix",{method:"POST",body:form()}),env);assert.equal(retry.status,201);assert.equal((await retry.json()).version.id,row!.id);
  const read=await worker.fetch(request(`/api/files/${row!.id}/original`,"ack-loss-fix"),env);assert.equal(read.status,200);assert.deepEqual(new Uint8Array(await read.arrayBuffer()),bytes);
  const quota=await env.DB!.prepare("SELECT value FROM usage_limits WHERE key=?").bind(`files:${project.id}`).first<{value:number}>();assert.equal(quota!.value,1);
});
test("R4: truncated originals and derivatives fail before file reservations or R2 writes",async()=>{
  const project=p("visual");await save(project,"invalid-image-fix",0);
  const validWebp=await readFile("public/art/threshold.webp");
  for(const [original,webp] of [[pngFixture().subarray(0,8),validWebp],[pngFixture(),Buffer.from("RIFF0000WEBP0")]]){
    const form=new FormData();form.append("original",new File([original],"broken.png",{type:"image/png"}));for(const variant of ["preview","thumbnail"])form.append(variant,new File([webp],`${variant}.webp`,{type:"image/webp"}));
    const result=await worker.fetch(request(`/api/projects/${project.id}/files`,"invalid-image-fix",{method:"POST",body:form}),env);assert.equal(result.status,400,await result.text());
  }
  assert.equal((await env.DB!.prepare("SELECT COUNT(*) AS n FROM file_versions WHERE project_id=?").bind(project.id).first<{n:number}>())!.n,0);
  assert.equal(await env.DB!.prepare("SELECT value FROM usage_limits WHERE key=?").bind(`bytes:${project.id}`).first(),null);
});

test("R2: interrupted multi-file import resumes after reload, skips completed originals and restores exact pointers",async()=>{
  const source=p("music");const bytes=[1,2,3].map(n=>Uint8Array.from([255,251,144,0,n,9]));
  source.mediaVersions=await Promise.all(bytes.map(async(data,n)=>({id:`local-${n}`,projectId:source.id,kind:"music" as const,filename:`local-${n}.mp3`,mime:"audio/mpeg" as const,size:data.length,sha256:[...new Uint8Array(await crypto.subtle.digest("SHA-256",data))].map(v=>v.toString(16).padStart(2,"0")).join(""),originalKey:`local/${n}.mp3`,createdAt:"2026-11-08T00:00:00Z"})));
  source.currentVersionId=source.mediaVersions[2].id;source.mediaHistory={"2026-11-07":source.mediaVersions[0].id,"2026-11-08":source.mediaVersions[2].id};source.notes=[{id:"original-note",text:"유지할 메모",createdAt:"2026-11-08T00:00:00Z"}];
  const original=JSON.stringify(source);let interrupt=true;const uploads:string[]=[];
  const call=async<T>(path:string,init:RequestInit={})=>{const response=await worker.fetch(request(path,"import-fix",init),env);const value=await response.json();if(!response.ok)throw new Error(value.error);return value as T};
  const ports={
    start:(source:Project)=>call<ImportPlan>("/api/imports/start",{method:"POST",body:JSON.stringify({source})}),
    upload:async(_source:Project,version:MediaVersion)=>{if(interrupt && version.id==="local-1")throw new Error("interrupted connection");uploads.push(version.id);const index=Number(version.id.split("-")[1]);const form=new FormData();form.append("original",new File([bytes[index]],version.filename,{type:version.mime}));return(await call<{version:MediaVersion}>(`/api/projects/${source.id}/files`,{method:"POST",body:form})).version;},
    complete:(id:string)=>call<CloudSnapshot>(`/api/imports/${id}/complete`,{method:"POST"}),read:()=>call<CloudSnapshot>("/api/project"),
  };
  await assert.rejects(importProject(source,ports,()=>{}),/interrupted/);assert.equal((await ports.read()).importing,true);
  assert.equal((await save(withoutLocalFiles(source),"import-fix",2)).status,409);
  assert.equal((await worker.fetch(request("/api/imports/start","other-import-owner",{method:"POST",body:JSON.stringify({source})}),env)).status,409);
  interrupt=false;const copied=await importProject({...source,description:"복사 시작 후 바뀐 로컬 설명"},ports,()=>{});
  assert.equal(copied.importing,undefined);assert.equal(copied.state.project!.description,source.description);assert.deepEqual(uploads,["local-0","local-1","local-2"]);
  const versions=copied.state.project!.mediaVersions!;assert.equal(versions.length,3);assert.equal(copied.state.project!.currentVersionId,versions.find(v=>v.sha256===source.mediaVersions![2].sha256)!.id);
  assert.equal(copied.state.project!.mediaHistory!["2026-11-07"],versions.find(v=>v.sha256===source.mediaVersions![0].sha256)!.id);assert.deepEqual(copied.state.project!.notes,source.notes);
  assert.equal(JSON.stringify(source),original);assert.equal((await importProject(source,ports,()=>{})).revision,copied.revision);
  for(const v of versions)assert.equal((await worker.fetch(request(`/api/files/${v.id}/original`,"import-fix"),env)).status,200);
  const job=await ports.start(source);assert.equal((await worker.fetch(request(`/api/imports/${job.id}/complete`,"other-import-owner",{method:"POST"}),env)).status,404);
});

test("R3: concurrent identical uploads reserve once and a legacy missing object can be repaired",async()=>{
  const project=p("music");await save(project,"concurrent-files",0);
  const form=()=>{const data=new FormData();data.append("original",new File([Uint8Array.from([255,251,144,0,3,1,4,1])],"same.mp3",{type:"audio/mpeg"}));return data};
  const responses=await Promise.all([1,2].map(()=>worker.fetch(request(`/api/projects/${project.id}/files`,"concurrent-files",{method:"POST",body:form()}),env)));
  for(const response of responses)assert.equal(response.status,201,await response.clone().text());
  const versions=await Promise.all(responses.map(async(r)=>(await r.json()).version));assert.equal(versions[0].id,versions[1].id);
  assert.equal((await env.DB!.prepare("SELECT value FROM usage_limits WHERE key=?").bind(`files:${project.id}`).first<{value:number}>())!.value,1);
  await env.BUCKET!.delete(versions[0].originalKey);
  const repaired=await worker.fetch(request(`/api/projects/${project.id}/files`,"concurrent-files",{method:"POST",body:form()}),env);assert.equal(repaired.status,201);assert.equal((await repaired.json()).version.id,versions[0].id);
  assert.equal((await worker.fetch(request(`/api/files/${versions[0].id}/original`,"concurrent-files"),env)).status,200);
});

test("R2: exact unfinished v2.0 imports can be adopted, while edited account records remain protected",async()=>{
  const source=p();source.workspace={content:"이전 버전이 먼저 복사한 원고",updatedAt:"2026-11-08T00:00:00Z"};await save(source,"old-import",0);
  const start=async(project:Project,user:string)=>worker.fetch(request("/api/imports/start",user,{method:"POST",body:JSON.stringify({source:project})}),env);
  const started=await start(source,"old-import");assert.equal(started.status,200,await started.clone().text());const job=await started.json();
  const completed=await worker.fetch(request(`/api/imports/${job.id}/complete`,"old-import",{method:"POST"}),env);assert.equal(completed.status,200);assert.equal((await completed.json()).state.project.workspace.content,source.workspace.content);
  const edited=p();await save({...edited,description:"계정에서 수정된 설명"},"edited-import",0);assert.equal((await start(edited,"edited-import")).status,409);
  assert.equal((await readProject(env.DB!,"edited-import")).state.project!.description,"계정에서 수정된 설명");
});

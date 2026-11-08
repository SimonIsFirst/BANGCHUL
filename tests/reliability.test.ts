import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCloudRepository } from "../src/data/cloud-repository.ts";
import { createProject, emptyState } from "../src/domain/project.ts";
import { withWorkspaceContent } from "../src/domain/workspace.ts";
import { imageInfo, validateImage } from "../src/domain/image-validation.ts";
import { pngFixture } from "./image-fixtures.ts";
const project = () => createProject({ name:"QA", title:"보호할 원고", description:"보존할 작품 설명", releaseDate:"2028-12-31", agreed:true },new Date(2026,10,8));
function memory() { const data = new Map<string,string>(); return { data, get length() { return data.size; }, key:(i:number) => [...data.keys()][i] ?? null, getItem:(k:string) => data.get(k) ?? null, setItem:(k:string,v:string) => { data.set(k,v); }, removeItem:(k:string) => { data.delete(k); } }; }

test("R1: two tabs, stale save, reload and explicit recovery preserve both drafts and server history",async () => {
  const storage = memory(); let remote = { state:{ ...emptyState(),project:withWorkspaceContent(project(),"BASE") },revision:1 };
  const send = async (p:ReturnType<typeof project>,revision:number) => { if (revision !== remote.revision) throw new Error("409 conflict"); remote = {state:{...emptyState(),project:structuredClone(p)},revision:revision+1};return{revision:remote.revision}; };
  const a = createCloudRepository("same-user",structuredClone(remote),storage,send); const b = createCloudRepository("same-user",structuredClone(remote),storage,send);
  try {
    b.repository.save({...remote.state,project:withWorkspaceContent(remote.state.project,"B_UNSENT")});
    a.repository.save({...remote.state,project:withWorkspaceContent(remote.state.project,"A_SAVED")}); await a.flush(); await assert.rejects(b.flush());
    const reloaded = createCloudRepository("same-user",structuredClone(remote),storage,send);
    try {
      assert.equal(reloaded.getDrafts().find((d) => d.id === b.id)!.state.project!.workspace!.content,"B_UNSENT");
      const next = await reloaded.recoverDraft(b.id,async () => structuredClone(remote));
      try {
        await next.flush(); assert.equal(remote.state.project.workspace!.content,"B_UNSENT");
        assert.equal(remote.state.project.restorePoints!.at(-1)!.content,"A_SAVED"); assert.equal(remote.state.project.description,"보존할 작품 설명");
        assert.ok([...storage.data.values()].some((v) => v.includes("B_UNSENT")));
      } finally {next.dispose();}
    } finally {reloaded.dispose();}
    const other = createCloudRepository("other-user",remote,storage,send); assert.equal(other.getDrafts().length,0);other.dispose();
  } finally {a.dispose();b.dispose();}
});
test("R1: two failed tabs keep independent recoverable snapshots, even if one reloads",async () => {
  const storage=memory();const initial={state:{...emptyState(),project:project()},revision:1};
  const send=async()=>{throw new Error("offline")};
  const a=createCloudRepository("offline",initial,storage,send);const b=createCloudRepository("offline",initial,storage,send);
  a.repository.save({...initial.state,project:withWorkspaceContent(initial.state.project,"A")});b.repository.save({...initial.state,project:withWorkspaceContent(initial.state.project,"B")});
  await Promise.allSettled([a.flush(),b.flush()]);a.dispose();b.dispose();
  const reopened=createCloudRepository("offline",initial,storage,send);assert.deepEqual(reopened.getDrafts().map((d)=>d.state.project!.workspace!.content).sort(),["A","B"]);reopened.dispose();
});
test("R4: valid PNG/WebP accepted; signatures, truncation, CRC corruption and false RIFF lengths rejected",async()=>{
  const png=pngFixture();assert.deepEqual(imageInfo(png,"image/png"),{width:2,height:2});
  assert.deepEqual(await validateImage(png,"image/png"),{width:2,height:2});
  await assert.rejects(validateImage(pngFixture(2,2,Buffer.from([1,2,3])),"image/png"));
  assert.throws(()=>imageInfo(pngFixture(40_000_001,1,Buffer.from([1])),"image/png"));
  const corrupt=Buffer.from(png);corrupt[45]^=1;
  for(const bytes of [png.subarray(0,8),png.subarray(0,png.length-1),corrupt,Buffer.concat([png,Buffer.from([0])])]) assert.throws(()=>imageInfo(bytes,"image/png"));
  const webp=await readFile("public/art/threshold.webp");assert.deepEqual(imageInfo(webp,"image/webp"),{width:1536,height:1024});
  const badSize=Buffer.from(webp);badSize.writeUInt32LE(0,4);
  for(const bytes of [Buffer.from("RIFF0000WEBP0"),webp.subarray(0,30),badSize])assert.throws(()=>imageInfo(bytes,"image/webp"));
  assert.throws(()=>imageInfo(Uint8Array.from([255,216,255,224]),"image/jpeg"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { createProject, emptyState, localDate, WORKSPACE_LIMIT } from "../src/domain/project.ts";
import { adjacentMonth, monthCells, withWorkspaceContent } from "../src/domain/workspace.ts";
import { createLocalRepository, isLocalState, STORAGE_KEY } from "../src/data/local-repository.ts";
import { createAutosaveController } from "../src/domain/autosave.ts";

function project() {
  return createProject({ name: "창작자", title: "나의 일기", description: "작품 소개입니다.", releaseDate: "2026-12-31", agreed: true }, new Date(2026, 9, 30, 10));
}

test("legacy projects keep description/notes, open an empty body, and visiting does not mark activity", () => {
  const old = project();
  old.notes.push({ id: "old-note", text: "진행 메모이지 작품 본문이 아닙니다.", createdAt: "2026-10-20T12:00:00Z" });
  assert.equal(isLocalState({ ...emptyState(), project: old }), true);
  assert.equal(old.workspace, undefined);
  assert.equal(withWorkspaceContent(old, ""), old);
  assert.equal(old.history, undefined);
  const updated = withWorkspaceContent(old, "첫 작품 본문", new Date(2026, 9, 30, 12));
  assert.equal(updated.description, old.description);
  assert.deepEqual(updated.notes, old.notes);
  assert.equal(old.workspace, undefined);
});

test("long multi-paragraph text round-trips exactly without trimming", () => {
  const content = `  첫 문장.\n\n${"오래 쓰는 작품입니다.\n".repeat(10_000)}\n마지막 문장.  `;
  const updated = withWorkspaceContent(project(), content, new Date(2026, 9, 30, 12));
  const state = JSON.parse(JSON.stringify({ ...emptyState(), project: updated }));
  assert.equal(isLocalState(state), true);
  assert.equal(state.project.workspace.content, content);
  assert.equal(state.project.history["2026-10-30"].content, content);
  assert.throws(() => withWorkspaceContent(project(), "x".repeat(WORKSPACE_LIMIT + 1)));
});

test("repeat saves update one daily snapshot, no-op saves do not change timestamps or create new days", () => {
  const first = withWorkspaceContent(project(), "하나", new Date(2026, 9, 30, 12));
  const second = withWorkspaceContent(first, "둘", new Date(2026, 9, 30, 13));
  assert.deepEqual(Object.keys(second.history!), ["2026-10-30"]);
  assert.equal(second.history!["2026-10-30"].content, "둘");
  assert.equal(first.history!["2026-10-30"].content, "하나");
  assert.equal(withWorkspaceContent(second, "둘", new Date(2026, 9, 31, 12)), second);
});

test("next-day edits and deletion preserve previous day's independent snapshot", () => {
  const old = withWorkspaceContent(project(), "첫날 작품", new Date(2026, 9, 30, 23, 59));
  const updated = withWorkspaceContent(old, "다음 날 작품", new Date(2026, 9, 31, 0, 1));
  assert.equal(updated.history!["2026-10-30"].content, "첫날 작품");
  assert.equal(updated.history!["2026-10-31"].content, "다음 날 작품");
  const beforeRead = JSON.stringify(updated);
  assert.equal(updated.history!["2026-10-30"].content, "첫날 작품");
  assert.equal(JSON.stringify(updated), beforeRead);
  assert.equal(updated.workspace!.content, "다음 날 작품");
  const cleared = withWorkspaceContent(updated, "", new Date(2026, 10, 1, 10));
  assert.equal(cleared.workspace!.content, "");
  assert.equal(cleared.history!["2026-11-01"].content, "");
  assert.equal(cleared.history!["2026-10-31"].content, "다음 날 작품");
});

test("description-only changes do not change body, history or workspace modification time", () => {
  const saved = withWorkspaceContent(project(), "실제 원본", new Date(2026, 9, 30, 12));
  const described = { ...saved, description: "새 작품 소개" };
  assert.deepEqual(described.workspace, saved.workspace);
  assert.deepEqual(described.history, saved.history);
});

test("snapshot keys use local dates, including UTC+14, UTC-10, DST and midnight", () => {
  const original = process.env.TZ;
  try {
    for (const [zone, instant, date] of [
      ["Pacific/Kiritimati", "2026-10-30T10:30:00Z", "2026-10-31"],
      ["Pacific/Honolulu", "2026-10-31T09:30:00Z", "2026-10-30"],
      ["America/New_York", "2026-11-01T06:30:00Z", "2026-11-01"],
    ]) {
      process.env.TZ = zone;
      const updated = withWorkspaceContent(project(), "작성", new Date(instant));
      assert.equal(localDate(new Date(instant)), date);
      assert.deepEqual(Object.keys(updated.history!), [date]);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test("calendar is Sunday-first, handles leap day, six-week months and year rollover", () => {
  assert.equal(monthCells("2026-11")[0], "2026-11-01");
  assert.equal(monthCells("2026-08")[6], "2026-08-01");
  assert.equal(monthCells("2026-08")[36], "2026-08-31");
  assert.equal(monthCells("2028-02").filter(Boolean).length, 29);
  assert.equal(monthCells("2026-02").filter(Boolean).length, 28);
  assert.equal(adjacentMonth("2026-12", 1), "2027-01");
  assert.equal(adjacentMonth("2026-01", -1), "2025-12");
  assert.deepEqual(monthCells("invalid"), []);
});

test("save/load/reset include body and history without changing the storage key", () => {
  const values = new Map<string, string>([["unrelated", "keep"]]);
  const repo = createLocalRepository(() => ({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } }));
  const state = { ...emptyState(), project: withWorkspaceContent(project(), "보관할 본문", new Date(2026, 9, 30)) };
  assert.ok(repo.save(state).ok);
  assert.equal(STORAGE_KEY, "bangchul:mvp:v1");
  assert.deepEqual(repo.load(), { ok: true, value: state });
  assert.ok(repo.clear().ok);
  assert.deepEqual(repo.load(), { ok: true, value: emptyState() });
  assert.equal(values.get("unrelated"), "keep");
});

test("malformed body/history data is reported and not silently overwritten", () => {
  const good = withWorkspaceContent(project(), "원본", new Date(2026, 9, 30));
  for (const invalid of [
    { ...good, workspace: { content: 42, updatedAt: "bad" } },
    { ...good, history: { "2026-02-30": { date: "2026-02-30", content: "x", savedAt: "2026-10-30T00:00:00Z" } } },
    { ...good, history: { "2026-10-30": { date: "2026-10-29", content: "x", savedAt: "2026-10-30T00:00:00Z" } } },
  ]) {
    const raw = JSON.stringify({ ...emptyState(), project: invalid });
    let writes = 0;
    const repo = createLocalRepository(() => ({ getItem: () => raw, setItem: () => { writes++; }, removeItem: () => {} }));
    assert.equal(repo.load().ok, false);
    assert.equal(writes, 0);
  }
});

test("quota failure cannot commit either body or snapshot; retry commits both together", () => {
  let stored = JSON.stringify({ ...emptyState(), project: project() });
  let full = true;
  const repo = createLocalRepository(() => ({ getItem: () => stored, setItem: (_key, value) => { if (full) throw new Error("QuotaExceededError"); stored = value; }, removeItem: () => {} }));
  const initial = stored;
  const changed = { ...emptyState(), project: withWorkspaceContent(project(), "아직 저장 못한 본문", new Date(2026, 9, 30)) };
  assert.equal(repo.save(changed).ok, false);
  assert.equal(stored, initial);
  full = false;
  assert.equal(repo.save(changed).ok, true);
  assert.deepEqual(repo.load(), { ok: true, value: changed });
});

function clock() {
  let now = 0;
  const tasks = new Map<number, { at: number; run(): void }>();
  let nextId = 0;
  return {
    schedule(run: () => void, delay: number) { const id = ++nextId; tasks.set(id, { at: now + delay, run }); return () => { tasks.delete(id); }; },
    advance(delay: number) { now += delay; for (const [id, task] of tasks) if (task.at <= now) { tasks.delete(id); task.run(); } },
  };
}

test("autosave debounces at 750ms and only saves the latest multi-paragraph value", () => {
  const fake = clock(); const writes: string[] = []; const states: string[] = [];
  const controller = createAutosaveController({ content: "", savedAt: "", schedule: fake.schedule, save: (content) => { writes.push(content); return { ok: true, savedAt: "2026-10-30T12:00:00Z" }; }, statusChanged: (state) => { states.push(state.kind); } });
  controller.edit("첫 문장"); fake.advance(500); controller.edit("첫 문장\n\n두 번째 문장"); fake.advance(749);
  assert.equal(writes.length, 0); assert.equal(controller.isDirty(), true);
  fake.advance(1); assert.deepEqual(writes, ["첫 문장\n\n두 번째 문장"]);
  assert.equal(controller.isDirty(), false); assert.equal(states.at(-1), "saved");
});

test("failed autosave retains dirty content and only reports success after a real retry", () => {
  const fake = clock(); let fail = true; const writes: string[] = []; const states: string[] = [];
  const controller = createAutosaveController({ content: "원본", savedAt: "2026-10-30T10:00:00Z", schedule: fake.schedule, save: (content) => { if (fail) return { ok: false, error: "용량 부족" }; writes.push(content); return { ok: true, savedAt: "2026-10-30T12:00:00Z" }; }, statusChanged: (state) => { states.push(state.kind); } });
  controller.edit("계속 작성한 내용"); fake.advance(750);
  assert.equal(controller.isDirty(), true); assert.equal(states.at(-1), "error"); assert.equal(writes.length, 0);
  fail = false; assert.equal(controller.flush(), true); assert.equal(controller.isDirty(), false);
  assert.deepEqual(writes, ["계속 작성한 내용"]); assert.equal(states.at(-1), "saved");
});

test("exit/blur flush writes immediately and cancels the pending duplicate", () => {
  const fake = clock(); const writes: string[] = [];
  const controller = createAutosaveController({ content: "", savedAt: "", schedule: fake.schedule, save: (content) => { writes.push(content); return { ok: true, savedAt: "2026-10-30T12:00:00Z" }; }, statusChanged: () => {} });
  controller.edit("마지막 순간의 입력"); assert.equal(controller.flush(), true); fake.advance(1000);
  assert.deepEqual(writes, ["마지막 순간의 입력"]);
  controller.edit(""); controller.flush(); assert.deepEqual(writes, ["마지막 순간의 입력", ""]);
});

test("Korean IME composition waits for the complete value, and reverting avoids an extra save", () => {
  const fake = clock(); const writes: string[] = [];
  const controller = createAutosaveController({ content: "", savedAt: "", schedule: fake.schedule, save: (content) => { writes.push(content); return { ok: true, savedAt: "2026-10-30T12:00:00Z" }; }, statusChanged: () => {} });
  controller.compositionStart(); controller.edit("ㅎ"); fake.advance(2000); assert.equal(writes.length, 0);
  controller.compositionEnd("한글"); fake.advance(750); assert.deepEqual(writes, ["한글"]);
  controller.edit("한글 수정"); controller.edit("한글"); fake.advance(1000); assert.equal(writes.length, 1);
});

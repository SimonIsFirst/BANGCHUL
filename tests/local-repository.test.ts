import test from "node:test";
import assert from "node:assert/strict";
import {
  createLocalRepository,
  STORAGE_KEY,
} from "../src/data/local-repository.ts";
import type { StoragePort } from "../src/data/local-repository.ts";
import { createProject, emptyState } from "../src/domain/project.ts";

function memoryStorage(): StoragePort & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

test("draft and current scene restore after a fresh repository instance", () => {
  const storage = memoryStorage();
  const state = emptyState();
  state.step = "description";
  state.draft.name = "Simon";
  state.draft.title = "여름의 끝";
  assert.ok(createLocalRepository(() => storage).save(state).ok);
  assert.deepEqual(createLocalRepository(() => storage).load(), {
    ok: true,
    value: state,
  });
});

test("description changes and new notes persist with the project", () => {
  const storage = memoryStorage();
  const project = createProject(
    {
      name: "Simon",
      title: "여름의 끝",
      description: "사진집",
      releaseDate: "2026-10-18",
      agreed: true,
    },
    new Date(2026, 9, 11),
  );
  project.description = "사진과 짧은 문장을 엮은 사진집";
  project.notes.push({
    id: "note-1",
    text: "첫 사진을 골랐다.\n내일은 두 번째.",
    createdAt: new Date().toISOString(),
  });
  const state = { ...emptyState(), project };
  assert.ok(createLocalRepository(() => storage).save(state).ok);
  assert.deepEqual(createLocalRepository(() => storage).load(), {
    ok: true,
    value: state,
  });
});

test("corrupt, unknown-version and malformed data is reported and never overwritten", () => {
  const storage = memoryStorage();
  const repo = createLocalRepository(() => storage);
  for (const raw of [
    "{broken",
    JSON.stringify({ ...emptyState(), version: 2 }),
    JSON.stringify({ ...emptyState(), project: { title: "bad" } }),
  ]) {
    storage.values.set(STORAGE_KEY, raw);
    assert.equal(repo.load().ok, false);
    assert.equal(storage.values.get(STORAGE_KEY), raw);
  }
});

test("storage access and quota failures return usable errors instead of throwing", () => {
  const unavailable = createLocalRepository(() => {
    throw new Error("SecurityError");
  });
  assert.equal(unavailable.load().ok, false);
  assert.equal(unavailable.save(emptyState()).ok, false);
  assert.equal(unavailable.clear().ok, false);
  const quota = createLocalRepository(() => ({
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  }));
  assert.equal(quota.save(emptyState()).ok, false);
});

test("reset only removes this app key and leaves unrelated browser data alone", () => {
  const storage = memoryStorage();
  storage.values.set("another-app", "keep me");
  storage.values.set("bangchul-v3", "legacy app stays intact");
  const repo = createLocalRepository(() => storage);
  repo.save(emptyState());
  assert.ok(repo.clear().ok);
  assert.equal(storage.values.get("another-app"), "keep me");
  assert.equal(storage.values.get("bangchul-v3"), "legacy app stays intact");
  assert.deepEqual(repo.load(), { ok: true, value: emptyState() });
});

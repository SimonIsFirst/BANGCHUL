import test from "node:test";
import assert from "node:assert/strict";
import { nextScene, ONBOARDING_SCENES, previousScene, readExperience } from "../src/domain/experience.ts";
import { emptyState, validateStep } from "../src/domain/project.ts";
import { createPreviewRepository } from "../src/data/preview-repository.ts";
import { isLocalState } from "../src/data/local-repository.ts";

test("three input steps lead to a non-blocking transition, with symmetric back navigation", () => {
  assert.deepEqual(ONBOARDING_SCENES, ["opening", "name", "title", "description", "transition", "deadline", "agreement"]);
  for (let index = 0; index < ONBOARDING_SCENES.length - 1; index += 1) {
    assert.equal(nextScene(ONBOARDING_SCENES[index]), ONBOARDING_SCENES[index + 1]);
    assert.equal(previousScene(ONBOARDING_SCENES[index + 1]), ONBOARDING_SCENES[index]);
  }
  assert.equal(previousScene("opening"), "opening");
  assert.equal(nextScene("agreement"), "agreement");
  assert.equal(validateStep("transition", emptyState().draft), null);
});

test("all legacy scene values and the new transition are valid without changing the v1 storage shape", () => {
  for (const step of ONBOARDING_SCENES) {
    const state = { ...emptyState(), step };
    assert.equal(isLocalState(state), true);
    assert.deepEqual(Object.keys(state), ["version", "draft", "step", "project"]);
  }
});

test("design review is opt-in and background-only comparison does not change persistence mode", () => {
  assert.deepEqual(readExperience(""), { design: "cinematic", preview: false });
  assert.deepEqual(readExperience("?design=minimal"), { design: "minimal", preview: false });
  assert.deepEqual(readExperience("?design=minimal&preview=1"), { design: "minimal", preview: true });
  assert.deepEqual(readExperience("?design=cinematic&preview=1"), { design: "cinematic", preview: true });
  assert.deepEqual(readExperience("?design=unknown&preview=true"), { design: "cinematic", preview: false });
});

test("review repository keeps navigation in memory and cannot read or clear the real project", () => {
  const repo = createPreviewRepository();
  const state = emptyState();
  state.step = "transition";
  state.draft.title = "디자인 검토 작품";
  assert.equal(repo.save(state).ok, true);
  assert.deepEqual(repo.load(), { ok: true, value: state });
  assert.deepEqual(createPreviewRepository().load(), { ok: true, value: emptyState() });
  assert.equal(repo.clear().ok, true);
  assert.deepEqual(repo.load(), { ok: true, value: emptyState() });
});
